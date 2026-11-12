import { RECOMMENDATION_ENGINE_VERSION } from '../domain/progression/recommendation.policy';
import { LOAD_INCREMENT_NUMERIC_POLICY } from '../domain/progression/load-increment.policy';
import { Prisma } from '../generated/prisma/client';
import type {
  ConsentSnapshot,
  ConsentReceipt,
  ConsentContract,
  ConsentBinding,
  ConsentDestination,
} from '../models/progression/automation-consent.model';
import { AutomationConsentError as Failure } from '../models/progression/automation-consent.model';
import {
  settingsBindingKey,
  normalizeConsentContract,
} from '../domain/progression/automation-consent.policy';
import { recommendationIdentity } from '../domain/progression/recommendation-evidence.policy';
import { resolveEffectiveSettings } from '../domain/progression/effective-settings.policy';
type Tx = Prisma.TransactionClient;
type Event = Prisma.ProgressionAutomationConsentEventGetPayload<object>;
export const consentTargetInclude = {
  _count: { select: { workoutExercises: true, recommendations: true } },
  planDay: {
    select: {
      id: true,
      name: true,
      planWeekId: true,
      retiredAt: true,
      _count: { select: { workoutSessions: true } },
    },
  },
  planWeek: {
    include: {
      _count: { select: { workoutSessions: true } },
      trainingPlan: {
        include: { _count: { select: { workoutSessions: true } } },
      },
    },
  },
} as const;
type ConsentTarget = Prisma.PlanExerciseGetPayload<{
  include: typeof consentTargetInclude;
}>;
export function configurableConsentTarget(
  r: ConsentTarget,
  unit: 'KG' | 'LB',
  maximumLoad?: string,
) {
  return (
    !!r.planDay &&
    r.planDay.planWeekId === r.planWeekId &&
    r.planDay.retiredAt === null &&
    r.planWeek.trainingPlan.status === 'DRAFT' &&
    r._count.workoutExercises === 0 &&
    r._count.recommendations === 0 &&
    r.planDay._count.workoutSessions === 0 &&
    r.planWeek._count.workoutSessions === 0 &&
    r.planWeek.trainingPlan._count.workoutSessions === 0 &&
    r.targetLoadUnit === unit &&
    !!r.targetLoad &&
    r.targetLoad.gt(0) &&
    (maximumLoad === undefined || r.targetLoad.lte(maximumLoad))
  );
}
export async function readConsentSettings(tx: Tx, athleteId: string) {
  const settings = (
    await tx.progressionSetting.findMany({
      where: { athleteId },
      orderBy: { id: 'asc' },
      take: 1001,
    })
  ).map((s) => ({
    id: s.id,
    athleteId: s.athleteId,
    exerciseId: s.exerciseId,
    trainingPlanId: s.trainingPlanId,
    minSuccessfulSessions: s.minSuccessfulSessions,
    targetRpeMin: s.targetRpeMin.toFixed(1),
    targetRpeMax: s.targetRpeMax.toFixed(1),
    incrementPercent: s.incrementPercent?.toFixed(3) ?? null,
    incrementAbsolute: s.incrementAbsolute?.toFixed(3) ?? null,
    maxIncrementPercent: s.maxIncrementPercent.toFixed(3),
    maxLoad: s.maxLoad?.toFixed(3) ?? null,
    autoApplyAuthorized: s.autoApplyAuthorized,
    updatedAt: s.updatedAt.toISOString(),
  }));
  if (settings.length > 1000)
    throw new Failure('CONSENT_CONFIGURATION_REQUIRED', [
      'CONFIGURATION_COVERAGE_INCOMPLETE',
    ]);
  return settings;
}
export async function consentNow(tx: Tx) {
  return (
    await tx.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
  )[0].now;
}
export function readConsentSnapshot(
  value: Prisma.JsonValue,
  key: string,
): ConsentSnapshot {
  const s = value as unknown as ConsentSnapshot;
  if (
    !s ||
    s.schemaVersion !== 'automation-consent-snapshot-v1' ||
    typeof s.engine?.recommendation !== 'string' ||
    typeof s.engine?.numeric !== 'string' ||
    s.humanAcceptance !== 'NOT_RECORDED' ||
    s.operationalAuthorization !== 'NOT_AVAILABLE_IN_PROG_5C_A' ||
    !Array.isArray(s.destinations) ||
    !Array.isArray(s.bindings) ||
    recommendationIdentity(s) !== key
  )
    throw new Failure('CONSENT_CORRUPT');
  try {
    normalizeConsentContract(s.contract);
  } catch {
    throw new Failure('CONSENT_CORRUPT');
  }
  return s;
}
export function consentReceipt(e: Event): ConsentReceipt {
  return {
    id: e.id,
    consentId: e.consentId,
    athleteId: e.athleteId,
    actorUserId: e.actorUserId,
    action: e.action as ConsentReceipt['action'],
    intentId: e.intentId,
    requestKey: e.requestKey,
    fromVersion: e.fromVersion,
    version: e.version,
    fromState: e.fromState as ConsentReceipt['fromState'],
    state: e.state as ConsentReceipt['state'],
    contractKey: e.contractKey,
    snapshot: readConsentSnapshot(e.snapshot, e.contractKey),
    recordedAt: e.recordedAt,
    reason: e.reason,
    acceptanceEvidence: (e.acceptanceEvidence ??
      null) as unknown as ConsentReceipt['acceptanceEvidence'],
  };
}
export async function ownedConsent(tx: Tx, athleteId: string, id: string) {
  const row = await tx.progressionAutomationConsent.findFirst({
    where: { id, athleteId },
  });
  if (!row) throw new Failure('SOURCE_NOT_FOUND');
  return row;
}
export async function buildConsentSnapshot(
  tx: Tx,
  athleteId: string,
  userId: string,
  contract: ConsentContract,
  locking: boolean,
): Promise<ConsentSnapshot> {
  if (locking) {
    await tx.$queryRaw`SELECT id FROM exercises WHERE id=${contract.exerciseId}::uuid FOR SHARE NOWAIT`;
    const all = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM progression_settings WHERE athlete_id=${athleteId}::uuid ORDER BY id LIMIT 1001 FOR SHARE NOWAIT`;
    if (all.length > 1000)
      throw new Failure('CONSENT_CONFIGURATION_REQUIRED', [
        'CONFIGURATION_COVERAGE_INCOMPLETE',
      ]);
  }
  const exercise = await tx.exercise.findFirst({
    where: {
      id: contract.exerciseId,
      isActive: true,
      OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
    },
    select: { id: true },
  });
  if (!exercise) throw new Failure('SOURCE_NOT_FOUND');
  const readTargets = () =>
    tx.planExercise.findMany({
      where: {
        id: { in: [...contract.selector.prescriptionIds] },
        exerciseId: contract.exerciseId,
        planWeek: {
          trainingPlan: {
            athleteId,
            ...(contract.trainingPlanId ? { id: contract.trainingPlanId } : {}),
          },
        },
      },
      orderBy: { id: 'asc' },
      include: consentTargetInclude,
    });
  let rows = await readTargets();
  if (rows.length !== contract.selector.prescriptionIds.length)
    throw new Failure('SOURCE_NOT_FOUND');
  if (locking) {
    const plans = [
        ...new Set(rows.map((r) => r.planWeek.trainingPlanId)),
      ].sort(),
      weeks = [...new Set(rows.map((r) => r.planWeekId))].sort(),
      days = [
        ...new Set(
          rows
            .map((r) => r.planDayId)
            .filter((id): id is string => id !== null),
        ),
      ].sort();
    for (const id of plans)
      await tx.$queryRaw`SELECT id FROM training_plans WHERE id=${id}::uuid FOR UPDATE NOWAIT`;
    for (const id of weeks)
      await tx.$queryRaw`SELECT id FROM plan_weeks WHERE id=${id}::uuid FOR UPDATE NOWAIT`;
    for (const id of days)
      await tx.$queryRaw`SELECT id FROM plan_days WHERE id=${id}::uuid FOR UPDATE NOWAIT`;
    for (const row of rows)
      await tx.$queryRaw`SELECT id FROM plan_exercises WHERE id=${row.id}::uuid FOR UPDATE NOWAIT`;
    const locations = rows
      .map((r) =>
        [r.id, r.planWeekId, r.planDayId, r.planWeek.trainingPlanId].join(':'),
      )
      .join('|');
    rows = await readTargets();
    if (
      rows
        .map((r) =>
          [r.id, r.planWeekId, r.planDayId, r.planWeek.trainingPlanId].join(
            ':',
          ),
        )
        .join('|') !== locations
    )
      throw new Failure('CONSENT_CONFIGURATION_REQUIRED', [
        'DESTINATION_CHANGED_DURING_REQUEST',
      ]);
  }
  if (
    rows.length !== contract.selector.prescriptionIds.length ||
    rows.some(
      (r) =>
        !configurableConsentTarget(
          r,
          contract.limits.unit,
          contract.limits.maximumLoad,
        ),
    )
  )
    throw new Failure('CONSENT_CONFIGURATION_REQUIRED', [
      'DESTINATION_NOT_AUTHORIZABLE',
    ]);
  const settings = await readConsentSettings(tx, athleteId);
  const bindings: ConsentBinding[] = [];
  for (const planId of [
    ...new Set(rows.map((r) => r.planWeek.trainingPlanId)),
  ].sort()) {
    const resolved = resolveEffectiveSettings(
      settings,
      athleteId,
      contract.exerciseId,
      planId,
      contract.policy,
    );
    if (resolved.status !== 'VALID' || !resolved.selected)
      throw new Failure('CONSENT_CONFIGURATION_REQUIRED', resolved.reasons);
    bindings.push({
      planId,
      selected: resolved.selected,
      configurationKey: settingsBindingKey(resolved.selected, contract.policy),
    });
  }
  const destinations: ConsentDestination[] = rows.map((r) => ({
    prescriptionId: r.id,
    exerciseId: r.exerciseId,
    planId: r.planWeek.trainingPlanId,
    weekId: r.planWeekId,
    dayId: r.planDay!.id,
    recordedPlanVersion: r.planWeek.trainingPlan.version,
  }));
  return {
    schemaVersion: 'automation-consent-snapshot-v1',
    engine: {
      recommendation: RECOMMENDATION_ENGINE_VERSION,
      numeric: LOAD_INCREMENT_NUMERIC_POLICY.version,
    },
    athleteId,
    contract,
    destinations,
    bindings,
    humanAcceptance: 'NOT_RECORDED',
    operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A',
  };
}
