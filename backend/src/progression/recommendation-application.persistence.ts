// Implementation detail of the existing progression repository.
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  RecommendationContext,
  ValidatedRecommendationCommand,
} from '../models/progression/recommendation-draft.model';
import type {
  ApplicationAudit,
  ApplicationReceipt,
  ApplicationTarget,
  ApplyOperation,
} from '../models/progression/recommendation-application.model';
import { RecommendationApplicationError as Failure } from '../models/progression/recommendation-application.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { RecommendationPersistenceError } from '../models/progression/persisted-recommendation.model';
import {
  activeActor,
  rowOwned,
  readState,
} from './recommendation-review.persistence';
import { retryable } from './recommendation.persistence';
import {
  commitAuthorizedProgressionApplication,
  applicationReceiptSelect,
  type ApplicationReceiptRow,
} from './commit-progression-application';
import { PlanningError } from '../training-plans/daily-planning.policy';
import { APPLICATION_AUDIT_VERSION } from '../domain/progression/recommendation-application.policy';
type Tx = Prisma.TransactionClient;
type Reader = (
  tx: Tx,
  command: ValidatedRecommendationCommand,
) => Promise<RecommendationContext>;
export function receipt(row: ApplicationReceiptRow): ApplicationReceipt {
  const a = row.audit as unknown as ApplicationAudit | null;
  if (
    !a ||
    a.schemaVersion !== APPLICATION_AUDIT_VERSION ||
    a.action !== 'APPLY' ||
    a.fromStatus !== 'APPROVED' ||
    a.toStatus !== 'APPLIED' ||
    !row.athleteId ||
    !row.actorUserId ||
    !row.intentId ||
    !row.requestKey ||
    !row.reviewId ||
    !row.planExerciseId ||
    !row.scheduledActivityId ||
    !row.previousLoad ||
    !row.cycleKey ||
    row.origin !== 'MANUAL' ||
    (row.loadUnit !== 'KG' && row.loadUnit !== 'LB') ||
    a.authorization?.reviewId !== row.reviewId ||
    a.authorization.cycleKey !== row.cycleKey ||
    a.destination?.prescriptionId !== row.planExerciseId ||
    a.temporal?.activityId !== row.scheduledActivityId ||
    a.load?.unit !== row.loadUnit ||
    !row.appliedLoad.eq(a.load.appliedLoad) ||
    !row.previousLoad.eq(a.load.previousLoad) ||
    a.temporal.checkedAt !== row.effectiveAt.toISOString()
  )
    throw new Failure('APPLICATION_CORRUPT');
  return {
    id: row.id,
    recommendationId: row.recommendationId,
    athleteId: row.athleteId,
    actorUserId: row.actorUserId,
    intentId: row.intentId,
    requestKey: row.requestKey,
    reviewId: row.reviewId,
    planExerciseId: row.planExerciseId,
    scheduledActivityId: row.scheduledActivityId,
    cycleKey: row.cycleKey,
    previousLoad: row.previousLoad.toFixed(6),
    appliedLoad: row.appliedLoad.toFixed(6),
    loadUnit: row.loadUnit,
    origin: 'MANUAL',
    effectiveAt: row.effectiveAt,
    audit: a,
  };
}
async function now(tx: Tx): Promise<Date> {
  return (
    await tx.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
  )[0].now;
}
async function existingReceipt(
  tx: Tx,
  athleteId: string,
  userId: string,
  operation: ApplyOperation,
  definitive = false,
): Promise<ApplicationReceipt | null> {
  const input = operation.input;
  const existing = await tx.progressionApplication.findUnique({
    where: { athleteId_intentId: { athleteId, intentId: input.intentId } },
    select: applicationReceiptSelect,
  });
  if (existing) {
    if (
      existing.actorUserId !== userId ||
      existing.requestKey !== operation.requestKey ||
      existing.recommendationId !== input.recommendationId
    )
      throw new Failure('INTENT_REUSED');
    if (
      !(await tx.progressionRecommendation.count({
        where: { id: existing.recommendationId, athleteId },
      }))
    )
      throw new Failure('SOURCE_NOT_FOUND');
    return receipt(existing);
  }
  if (!definitive) return null;
  await rowOwned(tx, userId, input.recommendationId);
  const previous = await tx.progressionApplication.findUnique({
    where: { recommendationId: input.recommendationId },
    select: { audit: true },
  });
  if (previous)
    throw new Failure(
      previous.audit === null
        ? 'LEGACY_APPLICATION_UNKNOWN'
        : 'ALREADY_APPLIED',
    );
  return null;
}
export async function fenceMutableSources(tx: Tx, athleteId: string) {
  // A single ordered statement both enumerates and locks each mutable cohort.
  // The athlete fence prevents inserts; locking editable sessions prevents them
  // entering the completed cohort after the definitive evidence read.
  const sessions = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM workout_sessions WHERE athlete_id=${athleteId}::uuid AND status IN ('PLANNED','IN_PROGRESS') ORDER BY id LIMIT 1001 FOR SHARE NOWAIT`;
  const settings = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM progression_settings WHERE athlete_id=${athleteId}::uuid ORDER BY id LIMIT 1001 FOR SHARE NOWAIT`;
  if (sessions.length > 1000 || settings.length > 1000)
    throw new Failure('APPLICATION_BLOCKED', ['SOURCE_COVERAGE_INCOMPLETE']);
}
export async function target(
  tx: Tx,
  athleteId: string,
  input: {
    destination: ApplyOperation['input']['destination'];
    command: { history: { exerciseId: string } };
  },
  locking = true,
): Promise<ApplicationTarget | null> {
  const d = input.destination;
  const p = await tx.planExercise.findFirst({
    where: {
      id: d.prescriptionId,
      exerciseId: input.command.history.exerciseId,
      planWeekId: d.weekId,
      planDayId: d.dayId,
      planWeek: { trainingPlanId: d.planId, trainingPlan: { athleteId } },
    },
    select: {
      id: true,
      exerciseId: true,
      targetLoad: true,
      targetLoadUnit: true,
      _count: { select: { workoutExercises: true, recommendations: true } },
      planDay: {
        select: {
          id: true,
          retiredAt: true,
          _count: { select: { workoutSessions: true } },
        },
      },
      planWeek: {
        select: {
          id: true,
          _count: { select: { workoutSessions: true } },
          trainingPlan: {
            select: {
              id: true,
              status: true,
              version: true,
              startsOn: true,
              endsOn: true,
              _count: { select: { workoutSessions: true } },
            },
          },
        },
      },
    },
  });
  if (!p || !p.planDay) return null;
  const readActivities = () =>
    tx.scheduledActivity.findMany({
      where: { planDayId: p.planDay!.id },
      orderBy: { id: 'asc' },
      take: 1001,
      select: {
        id: true,
        athleteId: true,
        planWeekId: true,
        version: true,
        scheduledOn: true,
        timeZone: true,
        status: true,
        _count: { select: { workouts: true } },
      },
    });
  let activities = await readActivities();
  if (activities.length && locking)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM scheduled_activities WHERE id IN (${Prisma.join(activities.map((a) => Prisma.sql`${a.id}::uuid`))}) ORDER BY id FOR UPDATE NOWAIT`,
    );
  activities = await readActivities();
  if (
    activities.some(
      (a) => a.athleteId !== athleteId || a.planWeekId !== d.weekId,
    )
  )
    throw new Failure('APPLICATION_BLOCKED', [
      'ACTIVITY_RELATIONSHIP_MISMATCH',
    ]);
  const plan = p.planWeek.trainingPlan;
  return {
    planId: plan.id,
    weekId: p.planWeek.id,
    dayId: p.planDay.id,
    prescriptionId: p.id,
    exerciseId: p.exerciseId,
    planVersion: plan.version,
    status: plan.status,
    retired: p.planDay.retiredAt !== null,
    hasHistory: p._count.workoutExercises > 0 || p._count.recommendations > 0,
    hasSessions:
      plan._count.workoutSessions > 0 ||
      p.planWeek._count.workoutSessions > 0 ||
      p.planDay._count.workoutSessions > 0,
    load: p.targetLoad?.toFixed(3) ?? null,
    loadUnit: p.targetLoadUnit,
    startsOn: plan.startsOn?.toISOString().slice(0, 10) ?? null,
    endsOn: plan.endsOn?.toISOString().slice(0, 10) ?? null,
    truncated: activities.length > 1000,
    activities: activities.map((a) => ({
      id: a.id,
      version: a.version,
      on: a.scheduledOn.toISOString().slice(0, 10),
      timeZone: a.timeZone,
      status: a.status,
      hasWorkouts: a._count.workouts > 0,
    })),
  };
}
export async function applyRecommendation(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  operation: ApplyOperation,
  read: Reader,
): Promise<ApplicationReceipt> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const actor = await activeActor(tx, userId, sessionId),
            input = operation.input;
          const existing = await existingReceipt(
            tx,
            actor.athleteId,
            userId,
            operation,
          );
          if (existing) return existing;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id=${sessionId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${actor.athleteId}::uuid FOR UPDATE NOWAIT`;
          await activeActor(tx, userId, sessionId);
          // A competing application may have committed between the fast path and fence.
          const committed = await existingReceipt(
            tx,
            actor.athleteId,
            userId,
            operation,
            true,
          );
          if (committed) return committed;
          await fenceMutableSources(tx, actor.athleteId);
          const review = await readState(
            tx,
            userId,
            input.recommendationId,
            input.command,
            read,
            'APPLICATION',
          );
          await tx.$queryRaw`SELECT id FROM progression_recommendations WHERE id=${input.recommendationId}::uuid FOR UPDATE NOWAIT`;
          const locked = await tx.$queryRaw<
            { ok: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtextextended(${input.expectedCycleKey},0)) AS ok`;
          if (!locked[0]?.ok) throw new Failure('SOURCE_BUSY');
          const currentTarget = await target(tx, actor.athleteId, input),
            serverNow = await now(tx);
          const audit = operation.assess({
            review: { ...review, now: serverNow },
            target: currentTarget,
            now: serverNow,
            actorUserId: userId,
          });
          await activeActor(tx, userId, sessionId);
          const row = await commitAuthorizedProgressionApplication(
            tx,
            {
              athleteId: actor.athleteId,
              exerciseId: review.proposal.exerciseId,
              ...input.destination,
              version: input.expectedPlanVersion,
              previousLoad: input.previousLoad,
              appliedLoad: input.appliedLoad,
              unit: input.loadUnit,
            },
            {
              recommendationId: input.recommendationId,
              appliedLoad: input.appliedLoad,
              origin: 'MANUAL',
              effectiveAt: serverNow,
              athleteId: actor.athleteId,
              actorUserId: userId,
              reviewId: input.reviewId,
              planExerciseId: input.destination.prescriptionId,
              scheduledActivityId: input.activityId,
              previousLoad: input.previousLoad,
              loadUnit: input.loadUnit,
              intentId: input.intentId,
              requestKey: operation.requestKey,
              cycleKey: input.expectedCycleKey,
              audit: audit as unknown as Prisma.InputJsonValue,
            },
            {
              status: 'APPROVED',
              reviewVersion: input.expectedReviewVersion,
              semanticKey: input.expectedSemanticKey,
              cycleKey: input.expectedCycleKey,
            },
          );
          return receipt(row);
          // Fresh statement snapshots after fences must see writes committed before
          // those fences. A SERIALIZABLE snapshot fixed by identity lookup cannot do so.
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (error instanceof PlanningError)
        throw new Failure('STALE_APPLICATION', [
          'DESTINATION_NO_LONGER_EDITABLE',
        ]);
      if (
        error instanceof RecommendationReviewError &&
        error.code !== 'SOURCE_BUSY'
      )
        throw new Failure(
          error.code === 'AUTHENTICATION_REQUIRED'
            ? 'AUTHENTICATION_REQUIRED'
            : 'SOURCE_NOT_FOUND',
        );
      if (
        error instanceof RecommendationPersistenceError &&
        error.code !== 'SOURCE_BUSY'
      )
        throw new Failure('APPLICATION_BLOCKED', [error.code]);
      if (
        !(error instanceof Failure && error.code === 'SOURCE_BUSY') &&
        !(
          error instanceof RecommendationReviewError &&
          error.code === 'SOURCE_BUSY'
        ) &&
        !retryable(error)
      )
        throw error;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
