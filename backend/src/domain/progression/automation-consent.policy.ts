import type { ConsentSnapshot } from '../../models/progression/automation-consent.model';
import type {
  ConsentContract,
  ConsentOperation,
  ConsentState,
  FutureConsentAcceptance,
} from '../../models/progression/automation-consent.model';
import {
  CONSENT_SCHEMA,
  AutomationConsentError as Failure,
} from '../../models/progression/automation-consent.model';
import type {
  RecommendationPolicy,
  StoredProgressionSetting,
} from '../../models/progression/recommendation-draft.model';
import { readDecimal } from './decimal';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { policyProjection } from './recommendation-query.policy';
import { resolveEffectiveSettings } from './effective-settings.policy';
import { localDate } from '../../workout-sessions/workout-calendar.policy';
const fail = (): never => {
  throw new Failure('CONSENT_CONFIGURATION_REQUIRED');
};
export const consentUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== keys.sort().join(',')
  )
    return fail();
  return v as Record<string, unknown>;
}
const text = (v: unknown) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
export function consentDecimal(v: unknown, positive = true) {
  if (typeof v !== 'string') return fail();
  const d = readDecimal(v);
  if (
    !d.ok ||
    d.value.decimalPlaces() > 6 ||
    d.value.abs().gte('1000000000000000000') ||
    (positive ? d.value.lte(0) : d.value.lt(0))
  )
    return fail();
  return d.value.toFixed();
}
function instant(v: unknown) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)
  )
    return fail();
  const date = new Date(v),
    civil = new Date(v.slice(0, 10) + 'T00:00:00Z');
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(civil.getTime()) ||
    civil.toISOString().slice(0, 10) !== v.slice(0, 10)
  )
    return fail();
  return date.toISOString();
}
export function normalizeConsentContract(value: unknown): ConsentContract {
  try {
    const v = object(value, [
      'schemaVersion',
      'exerciseId',
      'trainingPlanId',
      'policy',
      'historyWindowDays',
      'limits',
      'selector',
      'validity',
      'termsVersion',
      'provenance',
    ]);
    if (
      v.schemaVersion !== CONSENT_SCHEMA ||
      !consentUuid(v.exerciseId) ||
      (v.trainingPlanId !== null && !consentUuid(v.trainingPlanId)) ||
      !Number.isSafeInteger(v.historyWindowDays) ||
      (v.historyWindowDays as number) < 1 ||
      (v.historyWindowDays as number) > 3660 ||
      !text(v.termsVersion)
    )
      return fail();
    const l = object(v.limits, [
      'unit',
      'loadMeaning',
      'maximumAbsoluteIncrement',
      'maximumPercentIncrement',
      'maximumLoad',
      'maximumApplicationsPerWeek',
      'weekStartsOn',
    ]);
    if (
      !['KG', 'LB'].includes(l.unit as string) ||
      l.loadMeaning !== 'EXTERNAL_TOTAL' ||
      !Number.isSafeInteger(l.maximumApplicationsPerWeek) ||
      (l.maximumApplicationsPerWeek as number) < 1 ||
      (l.maximumApplicationsPerWeek as number) > 2147483647 ||
      !Number.isSafeInteger(l.weekStartsOn) ||
      (l.weekStartsOn as number) < 1 ||
      (l.weekStartsOn as number) > 7
    )
      return fail();
    const limits = {
      unit: l.unit as 'KG' | 'LB',
      loadMeaning: 'EXTERNAL_TOTAL' as const,
      maximumAbsoluteIncrement: consentDecimal(l.maximumAbsoluteIncrement),
      maximumPercentIncrement: consentDecimal(l.maximumPercentIncrement),
      maximumLoad: consentDecimal(l.maximumLoad),
      maximumApplicationsPerWeek: l.maximumApplicationsPerWeek as number,
      weekStartsOn: l.weekStartsOn as number,
    };
    const s = object(v.selector, [
      'kind',
      'prescriptionIds',
      'futureOnly',
      'planState',
      'versionPolicy',
    ]);
    if (
      s.kind !== 'EXACT_PRESCRIPTION_ALLOWLIST' ||
      s.futureOnly !== true ||
      s.planState !== 'DRAFT' ||
      s.versionPolicy !== 'READ_CURRENT_AND_CAS' ||
      !Array.isArray(s.prescriptionIds) ||
      !s.prescriptionIds.length ||
      s.prescriptionIds.length > 100 ||
      s.prescriptionIds.some((id) => !consentUuid(id)) ||
      new Set(s.prescriptionIds.map((id) => id.toLowerCase())).size !==
        s.prescriptionIds.length
    )
      return fail();
    const t = object(v.validity, ['startsAt', 'endsAt', 'timeZone']),
      startsAt = instant(t.startsAt),
      endsAt = instant(t.endsAt);
    if (startsAt >= endsAt || typeof t.timeZone !== 'string') return fail();
    localDate(t.timeZone, new Date(0));
    const p = object(v.provenance, ['source', 'reference']);
    if (p.source !== 'INTERNAL_CONFIGURATION_REQUEST' || !text(p.reference))
      return fail();
    let policy = structuredClone(
      policyProjection(v.policy as RecommendationPolicy),
    );
    if (
      !policy ||
      resolveEffectiveSettings([], '', '', null, policy).reasons.some(
        (r) => r !== 'SETTING_REQUIRED',
      ) ||
      policy.baseline !== 'DESTINATION_PRESCRIPTION' ||
      policy.loadMeaning !== 'EXTERNAL_TOTAL' ||
      policy.settingLoadUnit !== limits.unit ||
      policy.grid?.unit !== limits.unit ||
      policy.grid.rounding !== 'FLOOR' ||
      !['ABSOLUTE', 'PERCENT'].includes(policy.incrementMode ?? '')
    )
      return fail();
    policy = {
      ...policy,
      grid: {
        ...policy.grid,
        step: consentDecimal(policy.grid.step),
        origin: consentDecimal(policy.grid.origin, false),
      },
    };
    return structuredClone({
      schemaVersion: CONSENT_SCHEMA,
      exerciseId: v.exerciseId.toLowerCase(),
      trainingPlanId:
        v.trainingPlanId === null
          ? null
          : (v.trainingPlanId as string).toLowerCase(),
      policy,
      historyWindowDays: v.historyWindowDays as number,
      limits,
      selector: {
        kind: 'EXACT_PRESCRIPTION_ALLOWLIST',
        prescriptionIds: s.prescriptionIds
          .map((id) => id.toLowerCase())
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        futureOnly: true,
        planState: 'DRAFT',
        versionPolicy: 'READ_CURRENT_AND_CAS',
      },
      validity: { startsAt, endsAt, timeZone: t.timeZone },
      termsVersion: v.termsVersion as string,
      provenance: {
        source: 'INTERNAL_CONFIGURATION_REQUEST',
        reference: p.reference as string,
      },
    });
  } catch (error) {
    if (error instanceof Failure) throw error;
    return fail();
  }
}
export function consentRequest(
  action: Exclude<ConsentOperation['action'], 'ACCEPT'>,
  value: unknown,
): ConsentOperation {
  try {
    const v = object(
      value,
      action === 'CREATE'
        ? ['intentId', 'contract']
        : action === 'REVISE'
          ? ['intentId', 'consentId', 'expectedVersion', 'contract']
          : ['intentId', 'consentId', 'expectedVersion', 'reason'],
    );
    if (
      !consentUuid(v.intentId) ||
      (action !== 'CREATE' &&
        (!consentUuid(v.consentId) ||
          !Number.isSafeInteger(v.expectedVersion) ||
          (v.expectedVersion as number) < 1 ||
          (v.expectedVersion as number) >= 2147483647)) ||
      (action === 'REVOKE' && v.reason !== 'OWNER_REQUEST')
    )
      throw new Error();
    const input = {
      action,
      intentId: v.intentId.toLowerCase(),
      ...(action === 'CREATE'
        ? {}
        : {
            consentId: (v.consentId as string).toLowerCase(),
            expectedVersion: v.expectedVersion as number,
          }),
      ...(action === 'REVOKE'
        ? { reason: 'OWNER_REQUEST' as const }
        : { contract: normalizeConsentContract(v.contract) }),
    };
    return {
      ...input,
      requestKey: recommendationIdentity({
        schemaVersion: 'automation-consent-command-v1',
        ...input,
      }),
    };
  } catch (error) {
    if (
      error instanceof Failure &&
      error.code === 'CONSENT_CONFIGURATION_REQUIRED'
    )
      throw error;
    throw new Failure('INVALID_CONSENT_COMMAND');
  }
}
export function settingsBindingKey(
  selected: StoredProgressionSetting,
  policy: RecommendationPolicy,
) {
  const {
    autoApplyAuthorized: _preference,
    updatedAt: _revision,
    athleteId: _owner,
    ...decisory
  } = selected;
  return recommendationIdentity({
    schemaVersion: 'automation-settings-binding-v1',
    selected: decisory,
    policy,
  });
}
export function consentLifecycle(
  state: ConsentState,
  contract: ConsentContract,
  now: Date,
): ConsentState | 'EXPIRED' | 'NOT_YET_VALID' {
  if (state === 'REVOKED') return 'REVOKED';
  if (!Number.isFinite(now.getTime())) return fail();
  if (now >= new Date(contract.validity.endsAt)) return 'EXPIRED';
  if (now < new Date(contract.validity.startsAt)) return 'NOT_YET_VALID';
  return state;
}
export function consentChallenge(
  consentId: string,
  version: number,
  contractKey: string,
  contract: ConsentContract,
): FutureConsentAcceptance {
  return {
    schemaVersion: 'recurring-consent-acceptance-v1',
    scope: 'RECURRING_BOUNDED',
    consentId,
    version,
    contractKey,
    termsVersion: contract.termsVersion,
    humanAcceptance: 'NOT_RECORDED',
  };
}
export function changedConsentConditions(
  before: ConsentSnapshot,
  after: ConsentSnapshot,
) {
  const changed: string[] = [];
  if (
    recommendationIdentity(before.engine) !==
    recommendationIdentity(after.engine)
  )
    changed.push('ENGINE_CHANGED');
  if (
    recommendationIdentity(before.destinations) !==
    recommendationIdentity(after.destinations)
  )
    changed.push('DESTINATION_VERSIONS_CHANGED');
  if (
    recommendationIdentity(
      before.bindings.map((b) => ({
        planId: b.planId,
        key: b.configurationKey,
      })),
    ) !==
    recommendationIdentity(
      after.bindings.map((b) => ({
        planId: b.planId,
        key: b.configurationKey,
      })),
    )
  )
    changed.push('EFFECTIVE_SETTINGS_CHANGED');
  return changed;
}
