// Part of the existing PrismaProgressionRepository, not a second repository/provider.
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  RecommendationContext,
  ValidatedRecommendationCommand,
} from '../models/progression/recommendation-draft.model';
import type {
  ManualAcceptance,
  ReviewEvent,
  ReviewInspection,
  ReviewOperation,
  ReviewState,
} from '../models/progression/recommendation-review.model';
import { RecommendationReviewError as Failure } from '../models/progression/recommendation-review.model';
import {
  authorizeReview,
  REVIEW_VERSION,
} from '../domain/progression/recommendation-review.policy';
import {
  mapped,
  lockRecommendationSources,
  retryable,
} from './recommendation.persistence';
import type { DependencyKeys } from '../models/progression/persisted-recommendation.model';
type Tx = Prisma.TransactionClient;
type Reader = (
  tx: Tx,
  command: ValidatedRecommendationCommand,
) => Promise<RecommendationContext>;
type Inspector = (state: ReviewState) => ReviewInspection;
function event(
  row: Prisma.RecommendationReviewGetPayload<object>,
): ReviewEvent {
  return {
    id: row.id,
    recommendationId: row.recommendationId,
    athleteId: row.athleteId,
    actorUserId: row.actorUserId,
    action: row.action as ReviewEvent['action'],
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    fromVersion: row.fromVersion,
    version: row.version,
    semanticKey: row.semanticKey,
    cycleKey: row.cycleKey,
    dependencyKeys: row.dependencyKeys as DependencyKeys | null,
    intentId: row.intentId,
    payloadKey: row.payloadKey,
    decidedAt: row.decidedAt,
    justification: row.justification,
    acceptance: row.acceptance as ManualAcceptance | null,
  };
}
export async function activeActor(tx: Tx, userId: string, sessionId: string) {
  const result = await tx.$queryRaw<
    { athleteId: string }[]
  >`SELECT a.id AS "athleteId" FROM athletes a JOIN users u ON u.id=a.user_id JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=${userId}::uuid AND s.id=${sessionId}::uuid AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()`;
  if (!result[0]) throw new Failure('AUTHENTICATION_REQUIRED');
  return result[0];
}
export async function rowOwned(tx: Tx, userId: string, id: string) {
  const row = await tx.progressionRecommendation.findFirst({
    where: { id, athlete: { userId, user: { status: 'ACTIVE' } } },
    include: { evidence: true },
  });
  if (
    !row ||
    (await tx.recommendationEvidence.count({
      where: {
        recommendationId: id,
        session: { athleteId: { not: row.athleteId } },
      },
    }))
  )
    throw new Failure('SOURCE_NOT_FOUND');
  return row;
}
export async function readState(
  tx: Tx,
  userId: string,
  id: string,
  command: ValidatedRecommendationCommand | undefined,
  read: Reader,
  locking: boolean | 'APPLICATION',
): Promise<ReviewState> {
  const row = await rowOwned(tx, userId, id);
  let context: RecommendationContext | null = null,
    sourceUnavailable = false;
  if (row.semanticKey && command) {
    try {
      context = await read(tx, command);
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_NOT_FOUND')
        sourceUnavailable = true;
      else throw error;
    }
  }
  if (locking && context) {
    await lockRecommendationSources(
      tx,
      context,
      locking === 'APPLICATION' ? 'UPDATE' : 'SHARE',
    );
    if (locking === 'APPLICATION' && context.target.weekId)
      await tx.$queryRaw`SELECT id FROM plan_weeks WHERE id=${context.target.weekId}::uuid FOR UPDATE NOWAIT`;
    // Direct updates of destination children are also fenced, not just plan writers.
    if (locking === 'APPLICATION' && context.target.dayId)
      await tx.$queryRaw`SELECT id FROM plan_days WHERE id=${context.target.dayId}::uuid FOR UPDATE NOWAIT`;
    else if (context.target.dayId)
      await tx.$queryRaw`SELECT id FROM plan_days WHERE id=${context.target.dayId}::uuid FOR SHARE NOWAIT`;
    if (context.target.prescriptionId)
      await tx.$queryRaw`SELECT id FROM plan_exercises WHERE id=${context.target.prescriptionId}::uuid FOR UPDATE NOWAIT`;
    context = await read(tx, command!);
  }
  const proposal = mapped(row),
    d = proposal.generation?.draft.evidence.destination;
  const prescription =
    d?.kind === 'PRESCRIPTION' && d.prescriptionId
      ? await tx.planExercise.findFirst({
          where: {
            id: d.prescriptionId,
            exerciseId: row.exerciseId,
            planWeekId: d.weekId!,
            planDayId: d.dayId,
            planWeek: {
              trainingPlanId: d.planId!,
              trainingPlan: { athleteId: row.athleteId },
            },
          },
          select: {
            targetLoadUnit: true,
            planDay: { select: { retiredAt: true } },
            planWeek: {
              select: { trainingPlan: { select: { status: true } } },
            },
            _count: {
              select: { workoutExercises: true, recommendations: true },
            },
          },
        })
      : null;
  const reviews = await tx.recommendationReview.findMany({
    where: { recommendationId: row.id, athleteId: row.athleteId },
    orderBy: [{ version: 'asc' }, { id: 'asc' }],
  });
  return {
    proposal,
    events: reviews.map(event),
    context,
    sourceUnavailable,
    now: new Date(),
    target: prescription
      ? {
          editable: prescription.planWeek.trainingPlan.status === 'DRAFT',
          retired:
            prescription.planDay?.retiredAt !== null &&
            prescription.planDay?.retiredAt !== undefined,
          hasHistory:
            prescription._count.workoutExercises > 0 ||
            prescription._count.recommendations > 0,
          loadUnit: prescription.targetLoadUnit,
        }
      : null,
    cycleConflict:
      !!row.cycleKey &&
      (await tx.progressionRecommendation.count({
        where: {
          athleteId: row.athleteId,
          cycleKey: row.cycleKey,
          id: { not: row.id },
        },
      })) > 0,
  };
}
export async function inspectRecommendation(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
  command: ValidatedRecommendationCommand | undefined,
  read: Reader,
  inspect: Inspector,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await activeActor(tx, userId, sessionId);
      return inspect(await readState(tx, userId, id, command, read, false));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function reviewRecommendation(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  operation: ReviewOperation,
  read: Reader,
): Promise<ReviewEvent> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Bind new audit instants consistently even when the server default is not UTC.
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const actor = await activeActor(tx, userId, sessionId),
            input = operation.input;
          const existing = await tx.recommendationReview.findUnique({
            where: {
              athleteId_intentId: {
                athleteId: actor.athleteId,
                intentId: input.intentId,
              },
            },
          });
          if (existing) {
            if (
              existing.actorUserId !== userId ||
              existing.payloadKey !== operation.payloadKey ||
              existing.recommendationId !== input.recommendationId
            )
              throw new Failure('INTENT_REUSED');
            return event(existing);
          }
          await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id=${sessionId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${actor.athleteId}::uuid FOR UPDATE NOWAIT`;
          await activeActor(tx, userId, sessionId);
          const state = await readState(
            tx,
            userId,
            input.recommendationId,
            input.command,
            read,
            input.action === 'APPROVE',
          );
          await tx.$queryRaw`SELECT id FROM progression_recommendations WHERE id=${state.proposal.id}::uuid FOR UPDATE NOWAIT`;
          if (state.proposal.generation) {
            const acquired = await tx.$queryRaw<
              { ok: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(hashtextextended(${state.proposal.generation.cycleKey},0)) AS ok`;
            if (!acquired[0]?.ok) throw new Failure('SOURCE_BUSY');
          }
          const inspected = operation.inspect(state),
            next = authorizeReview(inspected, input);
          // Natural expiration is checked again after potentially expensive evidence reads.
          await activeActor(tx, userId, sessionId);
          const decidedAt = new Date();
          if (
            next === 'APPROVED' &&
            state.proposal.expiresAt &&
            state.proposal.expiresAt <= decidedAt
          )
            throw new Failure('APPROVAL_BLOCKED', ['PROPOSAL_EXPIRED']);
          const created = await tx.recommendationReview.create({
            data: {
              recommendationId: state.proposal.id,
              athleteId: actor.athleteId,
              actorUserId: userId,
              intentId: input.intentId,
              payloadKey: operation.payloadKey,
              schemaVersion: REVIEW_VERSION,
              action: input.action,
              fromStatus: 'PENDING',
              toStatus: next,
              fromVersion: input.expectedVersion,
              version: 1,
              semanticKey: input.expectedSemanticKey,
              cycleKey: input.expectedCycleKey,
              dependencyKeys: input.expectedDependencyKeys ?? Prisma.DbNull,
              acceptance:
                input.action === 'APPROVE'
                  ? (input.acceptance as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              justification: input.justification ?? null,
              decidedAt,
            },
          });
          const updated = await tx.progressionRecommendation.updateMany({
            where: {
              id: state.proposal.id,
              athleteId: actor.athleteId,
              status: 'PENDING',
              reviewVersion: input.expectedVersion,
              reviewedAt: null,
            },
            data: { status: next, reviewedAt: decidedAt, reviewVersion: 1 },
          });
          if (updated.count !== 1) throw new Failure('REVIEW_CONFLICT');
          return event(created);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (
        !(error instanceof Failure && error.code === 'SOURCE_BUSY') &&
        !retryable(error)
      )
        throw error;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
