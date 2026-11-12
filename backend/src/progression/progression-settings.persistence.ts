import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type {
  SettingRecord,
  SettingContext,
  SettingResolution,
  SettingOperation,
  SettingReceipt,
  SettingList,
  SettingImpact,
} from '../models/progression/progression-setting.model';
import { ProgressionSettingError as Failure } from '../models/progression/progression-setting.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { activeActor } from './recommendation-review.persistence';
import { retryable } from './recommendation.persistence';
import { resolveEffectiveSettings } from '../domain/progression/effective-settings.policy';
import { settingParameters } from '../domain/progression/progression-settings.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { settingsBindingKey } from '../domain/progression/automation-consent.policy';
import type { ConsentSnapshot } from '../models/progression/automation-consent.model';
type Tx = Prisma.TransactionClient;
async function rows(
  tx: Tx,
  athleteId: string,
  userId: string,
): Promise<SettingRecord[]> {
  const values = await tx.$queryRaw<
    (Omit<SettingRecord, 'createdAt' | 'updatedAt'> & {
      createdAt: Date;
      updatedAt: Date;
    })[]
  >`SELECT s.id,s.athlete_id AS "athleteId",s.exercise_id AS "exerciseId",s.training_plan_id AS "trainingPlanId",s.min_successful_sessions AS "minSuccessfulSessions",s.target_rpe_min::text AS "targetRpeMin",s.target_rpe_max::text AS "targetRpeMax",s.increment_percent::text AS "incrementPercent",s.increment_absolute::text AS "incrementAbsolute",s.max_increment_percent::text AS "maxIncrementPercent",s.max_load::text AS "maxLoad",s.auto_apply_authorized AS "autoApplyAuthorized",s.created_at AS "createdAt",s.updated_at AS "updatedAt",e.name AS "exerciseName",t.name AS "planName",progression_setting_revision(s) AS revision FROM progression_settings s LEFT JOIN exercises e ON e.id=s.exercise_id LEFT JOIN training_plans t ON t.id=s.training_plan_id WHERE s.athlete_id=${athleteId}::uuid AND (s.exercise_id IS NULL OR e.origin='GLOBAL' OR (e.origin='PERSONAL' AND e.owner_id=${userId}::uuid)) ORDER BY s.id LIMIT 1001`;
  if (values.length > 1000)
    throw new Failure('INVALID_SETTING', ['SETTING_COVERAGE_EXCEEDED']);
  return values.map((v) => ({
    ...v,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }));
}
// Only the pre-existing engine contract crosses into semantic comparators.
// Read-model revision/name/creation metadata must never change consent binding keys.
function engineRows(all: readonly SettingRecord[]) {
  return all.map((v) => ({
    id: v.id,
    athleteId: v.athleteId,
    exerciseId: v.exerciseId,
    trainingPlanId: v.trainingPlanId,
    ...settingParameters(v),
    autoApplyAuthorized: v.autoApplyAuthorized,
    updatedAt: v.updatedAt,
  }));
}
async function contextOwned(
  tx: Tx,
  athleteId: string,
  userId: string,
  exerciseId: string | null,
  planId: string | null,
  locking = false,
) {
  if (exerciseId) {
    if (locking)
      await tx.$queryRaw`SELECT id FROM exercises WHERE id=${exerciseId}::uuid FOR SHARE NOWAIT`;
    const e = await tx.exercise.findFirst({
      where: {
        id: exerciseId,
        isActive: true,
        OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
      },
      select: { id: true },
    });
    if (!e) throw new Failure('SOURCE_NOT_FOUND');
  }
  if (planId) {
    if (locking)
      await tx.$queryRaw`SELECT id FROM training_plans WHERE id=${planId}::uuid FOR SHARE NOWAIT`;
    const plan = await tx.trainingPlan.findFirst({
      where: { id: planId, athleteId },
      select: { id: true },
    });
    if (
      !plan ||
      !exerciseId ||
      !(await tx.planExercise.findFirst({
        where: { exerciseId, planWeek: { trainingPlanId: planId } },
        select: { id: true },
      }))
    )
      throw new Failure('SOURCE_NOT_FOUND');
  }
}
function resolved(
  all: SettingRecord[],
  athleteId: string,
  c: SettingContext,
): SettingResolution {
  const r = resolveEffectiveSettings(
    engineRows(all),
    athleteId,
    c.exerciseId,
    c.trainingPlanId,
    c.policy,
  );
  const settingCodes = [
    'SETTING_REQUIRED',
    'AMBIGUOUS_SETTING_SCOPE',
    'SETTING_VALUES_INVALID',
    'INCREMENT_REQUIRED',
    'INCREMENT_MODE_REQUIRED',
    'AMBIGUOUS_INCREMENT_MODE',
    'INCREMENT_EXCEEDS_CONFIGURED_CAP',
  ];
  return {
    context: { exerciseId: c.exerciseId, trainingPlanId: c.trainingPlanId },
    scope: r.scope as SettingResolution['scope'],
    selected: r.selected
      ? (all.find((v) => v.id === r.selected!.id) ?? null)
      : null,
    status: r.status,
    reasons: r.reasons,
    settingReasons: r.reasons.filter((v) => settingCodes.includes(v)),
    externalRequirements: r.reasons.filter((v) => !settingCodes.includes(v)),
    policyProvided: !!c.policy,
    mode: r.mode,
  };
}
async function read<T>(
  prisma: PrismaService,
  userId: string,
  sessionId: string,
  fn: (tx: Tx, athleteId: string) => Promise<T>,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const a = await activeActor(tx, userId, sessionId);
        return fn(tx, a.athleteId);
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
export function listProgressionSettings(
  prisma: PrismaService,
  u: string,
  s: string,
  q: { page: number; limit: number },
): Promise<SettingList> {
  return read(prisma, u, s, async (tx, a) => {
    const all = await rows(tx, a, u);
    return {
      items: all.slice((q.page - 1) * q.limit, q.page * q.limit),
      total: all.length,
      ...q,
    };
  });
}
export function getProgressionSetting(
  prisma: PrismaService,
  u: string,
  s: string,
  id: string,
) {
  return read(prisma, u, s, async (tx, a) => {
    const r = (await rows(tx, a, u)).find((v) => v.id === id);
    if (!r) throw new Failure('SOURCE_NOT_FOUND');
    return r;
  });
}
export function effectiveProgressionSetting(
  prisma: PrismaService,
  u: string,
  s: string,
  c: SettingContext,
) {
  return read(prisma, u, s, async (tx, a) => {
    await contextOwned(tx, a, u, c.exerciseId, c.trainingPlanId);
    return resolved(await rows(tx, a, u), a, c);
  });
}
function receipt(
  v: Prisma.ProgressionSettingMutationGetPayload<object>,
): SettingReceipt {
  const s = v.snapshot as unknown as {
    schemaVersion: string;
    result: SettingRecord;
    effective: SettingResolution | null;
  };
  if (
    s.schemaVersion !== 'progression-setting-receipt-v1' ||
    s.result.id !== v.settingId ||
    s.result.athleteId !== v.athleteId ||
    s.result.revision !== v.revision
  )
    throw new Failure('SETTING_CORRUPT');
  return {
    id: v.id,
    settingId: v.settingId,
    intentId: v.intentId,
    action: v.action as SettingReceipt['action'],
    beforeRevision: v.beforeRevision,
    revision: v.revision,
    result: s.result,
    effective: s.effective,
    recordedAt: v.recordedAt.toISOString(),
  };
}
export function getSettingMutation(
  prisma: PrismaService,
  u: string,
  s: string,
  id: string,
) {
  return read(prisma, u, s, async (tx, a) => {
    const v = await tx.progressionSettingMutation.findUnique({
      where: { athleteId_intentId: { athleteId: a, intentId: id } },
    });
    if (!v) throw new Failure('SOURCE_NOT_FOUND');
    return receipt(v);
  });
}
export async function mutateProgressionSetting(
  prisma: PrismaService,
  u: string,
  s: string,
  op: SettingOperation,
): Promise<SettingReceipt> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          const a = await activeActor(tx, u, s);
          await tx.$queryRaw`SELECT id FROM users WHERE id=${u}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id=${s}::uuid FOR SHARE NOWAIT`;
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${a.athleteId}::uuid FOR UPDATE NOWAIT`;
          await activeActor(tx, u, s);
          const prior = await tx.progressionSettingMutation.findUnique({
            where: {
              athleteId_intentId: {
                athleteId: a.athleteId,
                intentId: op.intentId,
              },
            },
          });
          if (prior) {
            if (prior.actorUserId !== u || prior.requestKey !== op.requestKey)
              throw new Failure('INTENT_REUSED');
            return receipt(prior);
          }
          let all = await rows(tx, a.athleteId, u),
            current =
              op.action === 'REPLACE'
                ? all.find((v) => v.id === op.settingId)
                : null;
          if (op.action === 'REPLACE' && !current)
            throw new Failure('SOURCE_NOT_FOUND');
          const scope = current
            ? {
                exerciseId: current.exerciseId,
                trainingPlanId: current.trainingPlanId,
              }
            : op.scope!;
          // Match the existing owner/exercise/settings/plan fences; NOWAIT avoids lock-order waits.
          if (scope.exerciseId)
            await tx.$queryRaw`SELECT id FROM exercises WHERE id=${scope.exerciseId}::uuid FOR SHARE NOWAIT`;
          if (current) {
            await tx.$queryRaw`SELECT id FROM progression_settings WHERE id=${current.id}::uuid FOR UPDATE NOWAIT`;
            all = await rows(tx, a.athleteId, u);
            current = all.find((v) => v.id === op.settingId);
            if (!current) throw new Failure('SOURCE_NOT_FOUND');
            if (
              current.exerciseId !== scope.exerciseId ||
              current.trainingPlanId !== scope.trainingPlanId ||
              current.revision !== op.expectedRevision
            )
              throw new Failure('STALE_SETTING');
          }
          await contextOwned(
            tx,
            a.athleteId,
            u,
            scope.exerciseId,
            scope.trainingPlanId,
            true,
          );
          if (
            op.action === 'CREATE' &&
            all.some(
              (v) =>
                v.exerciseId === scope.exerciseId &&
                v.trainingPlanId === scope.trainingPlanId,
            )
          )
            throw new Failure('SETTING_SCOPE_EXISTS');
          const [at] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
          let id: string;
          if (op.action === 'CREATE') {
            id = (
              await tx.progressionSetting.create({
                data: {
                  athleteId: a.athleteId,
                  ...scope,
                  ...op.parameters,
                  autoApplyAuthorized: false,
                  createdAt: at.now,
                  updatedAt: at.now,
                },
                select: { id: true },
              })
            ).id;
          } else {
            const p = op.parameters;
            id = current!.id;
            const changed = await tx.$queryRaw<
              { id: string }[]
            >`UPDATE progression_settings AS r SET min_successful_sessions=${p.minSuccessfulSessions},target_rpe_min=${p.targetRpeMin}::numeric,target_rpe_max=${p.targetRpeMax}::numeric,increment_percent=${p.incrementPercent}::numeric,increment_absolute=${p.incrementAbsolute}::numeric,max_increment_percent=${p.maxIncrementPercent}::numeric,max_load=${p.maxLoad}::numeric,updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),r.updated_at+interval '1 millisecond') WHERE r.id=${id}::uuid AND r.athlete_id=${a.athleteId}::uuid AND progression_setting_revision(r)=${op.expectedRevision} RETURNING r.id`;
            if (changed.length !== 1) throw new Failure('STALE_SETTING');
          }
          const result = (await rows(tx, a.athleteId, u)).find(
            (v) => v.id === id,
          )!;
          const effective = scope.exerciseId
            ? resolved(await rows(tx, a.athleteId, u), a.athleteId, {
                exerciseId: scope.exerciseId,
                trainingPlanId: scope.trainingPlanId,
              })
            : null;
          await activeActor(tx, u, s);
          const [stamp] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
          return receipt(
            await tx.progressionSettingMutation.create({
              data: {
                athleteId: a.athleteId,
                actorUserId: u,
                actorSessionId: s,
                settingId: id,
                intentId: op.intentId,
                action: op.action,
                requestKey: op.requestKey,
                beforeRevision: current?.revision ?? null,
                revision: result.revision,
                snapshot: {
                  schemaVersion: 'progression-setting-receipt-v1',
                  result,
                  effective,
                } as unknown as Prisma.InputJsonValue,
                recordedAt: stamp.now,
              },
            }),
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (e instanceof RecommendationReviewError)
        throw new Failure('AUTHENTICATION_REQUIRED');
      if (!retryable(e)) throw e;
      if (attempt === 4) throw new Failure('SOURCE_BUSY');
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
  throw new Failure('SOURCE_BUSY');
}
export function progressionSettingImpact(
  prisma: PrismaService,
  u: string,
  s: string,
  id: string,
  revision: string,
  parameters: SettingOperation['parameters'],
): Promise<SettingImpact> {
  return read(prisma, u, s, async (tx, a) => {
    const all = await rows(tx, a, u),
      row = all.find((v) => v.id === id);
    if (!row) throw new Failure('SOURCE_NOT_FOUND');
    if (row.revision !== revision) throw new Failure('STALE_SETTING');
    const after = all.map((v) => (v.id === id ? { ...v, ...parameters } : v)),
      changed =
        recommendationIdentity(settingParameters(row)) !==
        recommendationIdentity(parameters);
    const recommendations = await tx.progressionRecommendation.findMany({
      where: {
        athleteId: a,
        snapshot: { path: ['configuration', 'selected', 'id'], equals: id },
      },
      select: { id: true },
      take: 201,
      orderBy: { id: 'asc' },
    });
    const consentRows = await tx.progressionAutomationConsent.findMany({
      where: {
        athleteId: a,
        ...(row.exerciseId ? { exerciseId: row.exerciseId } : {}),
      },
      select: { id: true, state: true, snapshot: true },
      orderBy: { id: 'asc' },
      take: 201,
    });
    const consents = consentRows.slice(0, 200).map((c) => {
      const capture = c.snapshot as unknown as ConsentSnapshot;
      try {
        let incompatible = false;
        for (const b of capture.bindings) {
          const selected = resolveEffectiveSettings(
            engineRows(after),
            a,
            capture.contract.exerciseId,
            b.planId,
            capture.contract.policy,
          );
          if (
            !selected.selected ||
            selected.status !== 'VALID' ||
            settingsBindingKey(selected.selected, capture.contract.policy) !==
              b.configurationKey
          )
            incompatible = true;
        }
        const applicable =
          row.exerciseId === null ||
          (row.exerciseId === capture.contract.exerciseId &&
            (row.trainingPlanId === null ||
              capture.destinations.some(
                (d) => d.planId === row.trainingPlanId,
              )));
        return {
          id: c.id,
          state: c.state,
          compatibility: incompatible
            ? ('REQUIRES_REEVALUATION' as const)
            : ('UNCHANGED' as const),
          challengeMayBeStale: changed && applicable,
        };
      } catch {
        return {
          id: c.id,
          state: c.state,
          compatibility: 'UNAVAILABLE' as const,
          challengeMayBeStale: true,
        };
      }
    });
    return {
      settingId: id,
      expectedRevision: revision,
      parametersChanged: changed,
      recommendationIds: recommendations.slice(0, 200).map((v) => v.id),
      recommendationRevisionChanges: true,
      consents,
      coverage:
        recommendations.length > 200 || consentRows.length > 200
          ? 'TRUNCATED'
          : 'COMPLETE',
      warnings: [
        'RECOMMENDATION_REVALIDATION_REQUIRED_ON_REVISION',
        'CONSENT_HISTORY_IS_NOT_REWRITTEN',
        'PENDING_CHALLENGES_MAY_CHANGE_WITH_SHADOWED_SETTINGS',
        'NO_OPERATIONAL_AUTHORIZATION_GRANTED',
      ],
    };
  });
}
