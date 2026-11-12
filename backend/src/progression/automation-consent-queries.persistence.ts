import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  ConsentCandidateQuery,
  ConsentCandidates,
  ConsentContract,
  ConsentListQuery,
  ConsentListResult,
  ConsentPreview,
} from '../models/progression/automation-consent.model';
import { AutomationConsentError as Failure } from '../models/progression/automation-consent.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { activeActor } from './recommendation-review.persistence';
import {
  buildConsentSnapshot,
  consentReceipt,
  consentTargetInclude,
  configurableConsentTarget,
  readConsentSettings,
} from './automation-consent.persistence';
import { resolveEffectiveSettings } from '../domain/progression/effective-settings.policy';
async function read<T>(
  db: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        return fn(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  } catch (e) {
    if (e instanceof RecommendationReviewError)
      throw new Failure('AUTHENTICATION_REQUIRED');
    throw e;
  }
}
export function consentCandidates(
  db: PrismaService,
  userId: string,
  sessionId: string,
  q: ConsentCandidateQuery,
): Promise<ConsentCandidates> {
  return read(db, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      exercise = await tx.exercise.findFirst({
        where: {
          id: q.exerciseId,
          isActive: true,
          OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
        },
        select: { id: true },
      });
    if (!exercise) throw new Failure('SOURCE_NOT_FOUND');
    if (
      q.trainingPlanId &&
      !(await tx.trainingPlan.findFirst({
        where: { id: q.trainingPlanId, athleteId: actor.athleteId },
        select: { id: true },
      }))
    )
      throw new Failure('SOURCE_NOT_FOUND');
    const rows = await tx.planExercise.findMany({
        where: {
          exerciseId: q.exerciseId,
          planWeek: {
            trainingPlan: {
              athleteId: actor.athleteId,
              ...(q.trainingPlanId ? { id: q.trainingPlanId } : {}),
            },
          },
        },
        include: consentTargetInclude,
        orderBy: { id: 'asc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit + 1,
      }),
      selected = rows
        .slice(0, q.limit)
        .filter((r) => configurableConsentTarget(r, q.unit)),
      settings = await readConsentSettings(tx, actor.athleteId),
      tasks = await tx.workoutExercise.findMany({
        where: {
          exerciseId: q.exerciseId,
          isOmitted: false,
          session: { athleteId: actor.athleteId, status: 'COMPLETED' },
        },
        orderBy: [{ session: { performedOn: 'desc' } }, { id: 'asc' }],
        take: 101,
        select: {
          id: true,
          sessionId: true,
          session: { select: { performedOn: true } },
        },
      });
    return {
      items: selected.map((r) => ({
        prescriptionId: r.id,
        exerciseId: r.exerciseId,
        planId: r.planWeek.trainingPlanId,
        planName: r.planWeek.trainingPlan.name,
        weekId: r.planWeekId,
        weekNumber: r.planWeek.weekNumber,
        dayId: r.planDay!.id,
        dayName: r.planDay!.name,
        recordedPlanVersion: r.planWeek.trainingPlan.version,
        load: r.targetLoad!.toFixed(3),
        unit: q.unit,
      })),
      hasMore: rows.length > q.limit,
      page: q.page,
      settings: [
        ...new Set(selected.map((r) => r.planWeek.trainingPlanId)),
      ].map((planId) => {
        const resolved = resolveEffectiveSettings(
          settings,
          actor.athleteId,
          q.exerciseId,
          planId,
          undefined,
        );
        return {
          planId,
          status: resolved.status,
          scope: resolved.scope,
          reasons: resolved.reasons,
          selected: resolved.selected,
        };
      }),
      tasks: tasks.slice(0, 100).map((t) => ({
        id: t.id,
        performedOn: t.session.performedOn?.toISOString().slice(0, 10) ?? null,
        sessionId: t.sessionId,
      })),
      tasksTruncated: tasks.length > 100,
    };
  });
}
export function previewConsent(
  db: PrismaService,
  userId: string,
  sessionId: string,
  contract: ConsentContract,
): Promise<ConsentPreview> {
  return read(db, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      snapshot = await buildConsentSnapshot(
        tx,
        actor.athleteId,
        userId,
        contract,
        false,
      ),
      [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
    if (new Date(contract.validity.endsAt) <= clock.now)
      throw new Failure('CONSENT_EXPIRED');
    return { snapshot, inspectedAt: clock.now, executionAuthorized: false };
  });
}
export function listConsents(
  db: PrismaService,
  userId: string,
  sessionId: string,
  q: ConsentListQuery,
): Promise<ConsentListResult> {
  return read(db, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      where: Prisma.ProgressionAutomationConsentWhereInput = {
        athleteId: actor.athleteId,
        ...(q.state ? { state: q.state } : {}),
      },
      total = await tx.progressionAutomationConsent.count({ where }),
      rows = await tx.progressionAutomationConsent.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          exerciseId: true,
          trainingPlanId: true,
          state: true,
          version: true,
          validFrom: true,
          validUntil: true,
          updatedAt: true,
          exercise: { select: { name: true } },
          plan: { select: { name: true } },
        },
      });
    return {
      items: rows.map((r) => ({
        id: r.id,
        exerciseId: r.exerciseId,
        exerciseName: r.exercise.name,
        trainingPlanId: r.trainingPlanId,
        planName: r.plan?.name ?? null,
        state: r.state as 'PENDING_CONFIRMATION' | 'REVOKED',
        version: r.version,
        startsAt: r.validFrom,
        endsAt: r.validUntil,
        updatedAt: r.updatedAt,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  });
}
export function consentOperationReceipt(
  db: PrismaService,
  userId: string,
  sessionId: string,
  intentId: string,
) {
  return read(db, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      event = await tx.progressionAutomationConsentEvent.findUnique({
        where: { athleteId_intentId: { athleteId: actor.athleteId, intentId } },
      });
    if (!event) throw new Failure('SOURCE_NOT_FOUND');
    return consentReceipt(event);
  });
}
