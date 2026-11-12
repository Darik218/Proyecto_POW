import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  RecommendationListQuery,
  RecommendationListResult,
  ApplicationReadinessOperation,
  ApplicationReadiness,
} from '../models/progression/progression-http.model';
import {
  activeActor,
  rowOwned,
  readState,
} from './recommendation-review.persistence';
import { RecommendationApplicationError } from '../models/progression/recommendation-application.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { RecommendationPersistenceError } from '../models/progression/persisted-recommendation.model';
import { mapped } from './recommendation.persistence';
import { receipt, target } from './recommendation-application.persistence';
import { replayRequest } from './revalidation-request.persistence';
import type {
  RecommendationContext,
  ValidatedRecommendationCommand,
} from '../models/progression/recommendation-draft.model';
type Reader = (
  tx: Prisma.TransactionClient,
  command: ValidatedRecommendationCommand,
) => Promise<RecommendationContext>;
async function readonly<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
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
}
export function listRecommendations(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  query: RecommendationListQuery,
): Promise<RecommendationListResult> {
  return readonly(prisma, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      where: Prisma.ProgressionRecommendationWhereInput = {
        athleteId: actor.athleteId,
        ...(query.exerciseId ? { exerciseId: query.exerciseId } : {}),
        ...(query.semanticKey ? { semanticKey: query.semanticKey } : {}),
        ...(query.status
          ? {
              status:
                query.status as Prisma.EnumRecommendationStatusFilter['equals'],
            }
          : {}),
      };
    const total = await tx.progressionRecommendation.count({ where }),
      rows = await tx.progressionRecommendation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          exerciseId: true,
          status: true,
          createdAt: true,
          previousLoad: true,
          recommendedLoad: true,
          loadUnit: true,
          semanticKey: true,
          exercise: { select: { name: true } },
        },
      });
    return {
      items: rows.map((r) => ({
        id: r.id,
        exerciseId: r.exerciseId,
        exerciseName: r.exercise.name,
        status: r.status,
        createdAt: r.createdAt,
        previousLoad: r.previousLoad?.toFixed(6) ?? null,
        recommendedLoad: r.recommendedLoad.toFixed(6),
        loadUnit: r.loadUnit,
        generationKnown: r.semanticKey !== null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  });
}
export function getRevalidationRequest(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
) {
  return readonly(prisma, async (tx) => {
    await activeActor(tx, userId, sessionId);
    const row = await rowOwned(tx, userId, id),
      proposal = mapped(row),
      request = await tx.progressionRevalidationRequest.findUnique({
        where: { recommendationId: id },
      });
    if (!request || !proposal.generation) return null;
    return replayRequest(
      request,
      proposal.generation.requestKey,
      proposal.generation.draft.evidence.source.tasks.map((t) => t.id),
    );
  });
}
export function getApplicationReceipt(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
) {
  return readonly(prisma, async (tx) => {
    await activeActor(tx, userId, sessionId);
    await rowOwned(tx, userId, id);
    const row = await tx.progressionApplication.findUnique({
      where: { recommendationId: id },
    });
    return row?.audit ? receipt(row) : null;
  });
}
export function inspectApplication(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  id: string,
  operation: ApplicationReadinessOperation,
  read: Reader,
): Promise<ApplicationReadiness> {
  return readonly(prisma, async (tx) => {
    const actor = await activeActor(tx, userId, sessionId),
      review = await readState(tx, userId, id, operation.command, read, false),
      [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
    const applied = await tx.progressionApplication.findUnique({
      where: { recommendationId: id },
    });
    if (applied?.audit)
      return {
        eligible: false,
        reasons: ['ALREADY_APPLIED'],
        command: null,
        receipt: receipt(applied),
        inspectedAt: clock.now,
      };
    const activity = await tx.scheduledActivity.findFirst({
      where: { id: operation.activityId, athleteId: actor.athleteId },
      select: { id: true, version: true, scheduledOn: true, timeZone: true },
    });
    if (!activity)
      return {
        eligible: false,
        reasons: ['FUTURE_DATE_UNVERIFIED'],
        command: null,
        receipt: null,
        inspectedAt: clock.now,
      };
    try {
      const command = operation.prepare(review, {
          id: activity.id,
          version: activity.version,
          scheduledOn: activity.scheduledOn.toISOString().slice(0, 10),
          timeZone: activity.timeZone,
        }),
        current = await target(tx, actor.athleteId, command, false);
      operation.assess(
        {
          review: { ...review, now: clock.now },
          target: current,
          now: clock.now,
          actorUserId: userId,
        },
        command,
      );
      return {
        eligible: true,
        reasons: [],
        command,
        receipt: null,
        inspectedAt: clock.now,
      };
    } catch (error) {
      if (
        error instanceof RecommendationApplicationError ||
        error instanceof RecommendationReviewError ||
        error instanceof RecommendationPersistenceError
      )
        return {
          eligible: false,
          reasons: [error.code, ...('reasons' in error ? error.reasons : [])],
          command: null,
          receipt: null,
          inspectedAt: clock.now,
        };
      throw error;
    }
  });
}
