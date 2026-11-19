// Implementation detail of the existing progression repository; no second client/provider.
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { RecommendationContext } from '../models/progression/recommendation-draft.model';
import type {
  PersistedRecommendation,
  PersistProposalOperation,
} from '../models/progression/persisted-recommendation.model';
import { RecommendationPersistenceError as Failure } from '../models/progression/persisted-recommendation.model';
import { recordRevalidationRequest } from './revalidation-request.persistence';
import {
  inspectGeneration,
  recommendationCycleKey,
  recommendationRequestKey,
} from '../domain/progression/recommendation-persistence.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
type Row = Prisma.ProgressionRecommendationGetPayload<{
  include: { evidence: true };
}>;
type Tx = Prisma.TransactionClient;
export function mapped(row: Row): PersistedRecommendation {
  let generation: PersistedRecommendation['generation'] = null;
  if (row.semanticKey !== null) {
    const draft = inspectGeneration(
        row.snapshot,
        row.semanticKey,
        row.dependencyKeys,
      ),
      i = draft.increment!;
    const matches = (a: Prisma.Decimal | null, b: string | null) =>
      !!a && b !== null && a.eq(b);
    if (
      row.proposalKind !== 'NEUTRAL_INTERNAL' ||
      row.athleteId !== draft.evidence.athleteId ||
      row.exerciseId !== draft.evidence.exerciseId ||
      row.algorithmVersion !== draft.evidence.engineVersion ||
      row.planWeekId !== null ||
      row.planExerciseId !== null ||
      row.loadUnit !== i.unit ||
      !matches(row.previousLoad, i.currentLoad) ||
      !matches(row.recommendedLoad, i.proposedLoad) ||
      !matches(row.previousLoadKg, i.currentLoadKg) ||
      !matches(row.recommendedLoadKg, i.proposedLoadKg) ||
      recommendationIdentity(row.effectiveSettings) !==
        recommendationIdentity(draft.evidence.configuration) ||
      row.cycleKey !== recommendationCycleKey(draft.evidence) ||
      !row.requestKey ||
      (row.cycleSlot !== null && row.cycleSlot !== row.cycleKey) ||
      row.evidence.some((e) => e.role !== 'CONTEXT') ||
      [...new Set(draft.evidence.source.tasks.map((t) => t.sessionId))]
        .sort()
        .join(',') !==
        row.evidence
          .map((e) => e.sessionId)
          .sort()
          .join(',')
    )
      throw new Failure('IDENTITY_CONFLICT');
    generation = {
      kind: 'NEUTRAL_INTERNAL',
      semanticKey: row.semanticKey,
      cycleKey: row.cycleKey,
      cycleSlot: row.cycleSlot,
      requestKey: row.requestKey,
      draft,
    };
  }
  return {
    id: row.id,
    athleteId: row.athleteId,
    exerciseId: row.exerciseId,
    status: row.status,
    reviewVersion: row.reviewVersion,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    expiresAt: row.expiresAt,
    previousLoad: row.previousLoad?.toFixed(6) ?? null,
    recommendedLoad: row.recommendedLoad.toFixed(6),
    loadUnit: row.loadUnit,
    previousLoadKg: row.previousLoadKg?.toFixed(6) ?? null,
    recommendedLoadKg: row.recommendedLoadKg?.toFixed(6) ?? null,
    generation,
    evidence: row.evidence.map((e) => ({
      sessionId: e.sessionId,
      role: e.role,
      associatedAt: e.associatedAt,
    })),
    generationAuthorization: generation ? 'NOT_GRANTED' : 'LEGACY_UNKNOWN',
  };
}
async function owner(tx: Tx, userId: string, exerciseId: string) {
  const athlete = await tx.athlete.findFirst({
    where: { userId, user: { status: 'ACTIVE' } },
    select: { id: true },
  });
  const exercise = await tx.exercise.findFirst({
    where: {
      id: exerciseId,
      OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
    },
    select: { id: true },
  });
  if (!athlete || !exercise) throw new Failure('SOURCE_NOT_FOUND');
  return athlete;
}
export async function getOwnedRecommendation(
  prisma: PrismaService,
  userId: string,
  id: string,
): Promise<PersistedRecommendation | null> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const row = await tx.progressionRecommendation.findFirst({
        where: { id, athlete: { userId, user: { status: 'ACTIVE' } } },
        include: { evidence: true },
      });
      if (!row) return null;
      await owner(tx, userId, row.exerciseId);
      if (
        await tx.recommendationEvidence.count({
          where: {
            recommendationId: row.id,
            session: { athleteId: { not: row.athleteId } },
          },
        })
      )
        throw new Failure('IDENTITY_CONFLICT');
      return mapped(row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export function retryable(error: unknown): boolean {
  if (error instanceof Failure) return error.code === 'SOURCE_BUSY';
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    code?: string;
    meta?: {
      code?: string;
      driverAdapterError?: { cause?: { originalCode?: string } };
    };
  };
  return (
    ['P2034', 'P2002', '40001', '40P01', '55P03', '23505'].includes(
      e.code ?? '',
    ) ||
    ['40001', '40P01', '55P03', '23505'].includes(
      e.meta?.code ?? e.meta?.driverAdapterError?.cause?.originalCode ?? '',
    )
  );
}
export async function persistRecommendation(
  prisma: PrismaService,
  userId: string,
  operation: PersistProposalOperation,
  read: (tx: Tx) => Promise<RecommendationContext>,
): Promise<PersistedRecommendation> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const athlete = await owner(
            tx,
            userId,
            operation.command.history.exerciseId,
          );
          const existing = await tx.progressionRecommendation.findUnique({
            where: { semanticKey: operation.expectedSemanticKey },
            include: { evidence: true },
          });
          if (existing) {
            if (
              existing.athleteId !== athlete.id ||
              existing.exerciseId !== operation.command.history.exerciseId
            )
              throw new Failure('SOURCE_NOT_FOUND');
            const result = mapped(existing);
            if (
              result.generation!.requestKey !==
              recommendationRequestKey(
                operation.command,
                result.generation!.draft.evidence.source.tasks.map((t) => t.id),
              )
            )
              throw new Failure('REQUEST_MISMATCH');
            if (
              recommendationIdentity(
                result.generation!.draft.dependencyKeys,
              ) !== recommendationIdentity(operation.expectedDependencyKeys)
            )
              throw new Failure('IDENTITY_CONFLICT');
            if (operation.recordContext)
              await recordRevalidationRequest(
                tx,
                existing.id,
                existing.requestKey!,
                operation.command,
                'MATCHING_REPLAY_REQUEST',
              );
            return result;
          }
          // Parent-to-child fences, nonblocking to avoid cycles with existing writers.
          await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${athlete.id}::uuid FOR UPDATE NOWAIT`;
          const context = await read(tx),
            h = context.history;
          await lockRecommendationSources(tx, context);
          const insert = operation.prepare(await read(tx));
          if (
            insert.athleteId !== athlete.id ||
            insert.exerciseId !== h.exerciseId ||
            insert.semanticKey !== operation.expectedSemanticKey
          )
            throw new Failure('IDENTITY_CONFLICT');
          const locked = await tx.$queryRaw<
            { ok: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtextextended(${insert.cycleKey},0)) AS ok`;
          if (!locked[0]?.ok) throw new Failure('SOURCE_BUSY');
          if (
            await tx.progressionRecommendation.findFirst({
              where: { athleteId: athlete.id, cycleKey: insert.cycleKey },
              select: { id: true },
            })
          )
            throw new Failure('CYCLE_CONFLICT');
          const row = await tx.progressionRecommendation.create({
            data: {
              athleteId: insert.athleteId,
              exerciseId: insert.exerciseId,
              previousLoad: insert.previousLoad,
              recommendedLoad: insert.recommendedLoad,
              loadUnit: insert.loadUnit,
              previousLoadKg: insert.previousLoadKg,
              recommendedLoadKg: insert.recommendedLoadKg,
              semanticKey: insert.semanticKey,
              cycleKey: insert.cycleKey,
              cycleSlot: insert.cycleSlot,
              requestKey: insert.requestKey,
              proposalKind: insert.proposalKind,
              algorithmVersion: insert.algorithmVersion,
              status: 'PENDING',
              justification:
                'Neutral internal mathematical proposal; application authorization NOT_GRANTED.',
              snapshot: insert.snapshot as unknown as Prisma.InputJsonValue,
              dependencyKeys: insert.dependencyKeys,
              effectiveSettings:
                insert.effectiveSettings as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.recommendationEvidence.createMany({
            data: insert.sessionIds.map((sessionId) => ({
              recommendationId: row.id,
              sessionId,
              role: 'CONTEXT' as const,
            })),
          });
          if (operation.recordContext)
            await recordRevalidationRequest(
              tx,
              row.id,
              insert.requestKey,
              operation.command,
              'HTTP_SAVE_REQUEST',
            );
          return mapped(
            await tx.progressionRecommendation.findUniqueOrThrow({
              where: { id: row.id },
              include: { evidence: true },
            }),
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (!retryable(error)) throw error;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}

export async function lockRecommendationSources(
  tx: Tx,
  context: RecommendationContext,
  planLock: 'SHARE' | 'UPDATE' = 'SHARE',
) {
  const h = context.history;
  const sessionIds = [...new Set(h.tasks.map((t) => t.sessionId))].sort();
  if (sessionIds.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM workout_sessions WHERE id IN (${Prisma.join(sessionIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE NOWAIT`,
    );
  if (context.target.planId) {
    if (planLock === 'UPDATE')
      await tx.$queryRaw`SELECT id FROM training_plans WHERE id=${context.target.planId}::uuid FOR UPDATE NOWAIT`;
    else
      await tx.$queryRaw`SELECT id FROM training_plans WHERE id=${context.target.planId}::uuid FOR SHARE NOWAIT`;
  }
  await tx.$queryRaw`SELECT id FROM exercises WHERE id=${h.exerciseId}::uuid FOR SHARE NOWAIT`;
  if (context.settings.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM progression_settings WHERE id IN (${Prisma.join(context.settings.map((s) => Prisma.sql`${s.id}::uuid`))}) ORDER BY id FOR SHARE NOWAIT`,
    );
  if (h.tasks.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM workout_exercises WHERE id IN (${Prisma.join(h.tasks.map((t) => Prisma.sql`${t.id}::uuid`))}) ORDER BY id FOR UPDATE NOWAIT`,
    );
  if (h.sets.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM set_records WHERE id IN (${Prisma.join(h.sets.map((s) => Prisma.sql`${s.id}::uuid`))}) ORDER BY id FOR UPDATE NOWAIT`,
    );
}
