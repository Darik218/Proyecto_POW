import { ProgressionSettingError as Failure } from '../../models/progression/progression-setting.model';
import type {
  SettingParameters,
  SettingScope,
  SettingOperation,
} from '../../models/progression/progression-setting.model';
import { readDecimal } from './decimal';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { consentUuid } from './automation-consent.policy';
const fail = (): never => {
  throw new Failure('INVALID_SETTING');
};
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    return fail();
  return v as Record<string, unknown>;
}
function decimal(v: unknown, p: number, s: number, zero = false) {
  if (typeof v !== 'string' || v.length > 256 || !/^\d+(\.\d+)?$/.test(v))
    return fail();
  const r = readDecimal(v);
  if (
    !r.ok ||
    r.value.lt(0) ||
    (!zero && r.value.eq(0)) ||
    r.value.decimalPlaces() > s ||
    r.value.e + 1 > p - s
  )
    return fail();
  return r.value.toFixed(s);
}
export function normalizeSettingParameters(v: unknown): SettingParameters {
  const o = exact(v, [
    'minSuccessfulSessions',
    'targetRpeMin',
    'targetRpeMax',
    'incrementPercent',
    'incrementAbsolute',
    'maxIncrementPercent',
    'maxLoad',
  ]);
  if (
    !Number.isSafeInteger(o.minSuccessfulSessions) ||
    (o.minSuccessfulSessions as number) < 1 ||
    (o.minSuccessfulSessions as number) > 2147483647
  )
    return fail();
  const result = {
    minSuccessfulSessions: o.minSuccessfulSessions as number,
    targetRpeMin: decimal(o.targetRpeMin, 3, 1, true),
    targetRpeMax: decimal(o.targetRpeMax, 3, 1, true),
    incrementPercent:
      o.incrementPercent === null ? null : decimal(o.incrementPercent, 6, 3),
    incrementAbsolute:
      o.incrementAbsolute === null ? null : decimal(o.incrementAbsolute, 8, 3),
    maxIncrementPercent: decimal(o.maxIncrementPercent, 6, 3, true),
    maxLoad: o.maxLoad === null ? null : decimal(o.maxLoad, 8, 3),
  };
  const a = readDecimal(result.targetRpeMin),
    b = readDecimal(result.targetRpeMax),
    p = readDecimal(result.incrementPercent),
    cap = readDecimal(result.maxIncrementPercent);
  if (
    !a.ok ||
    !b.ok ||
    a.value.gt(b.value) ||
    b.value.gt(10) ||
    (!result.incrementAbsolute && !result.incrementPercent) ||
    (p.ok && cap.ok && p.value.gt(cap.value))
  )
    return fail();
  return result;
}
export function settingParameters(row: SettingParameters): SettingParameters {
  return {
    minSuccessfulSessions: row.minSuccessfulSessions,
    targetRpeMin: row.targetRpeMin,
    targetRpeMax: row.targetRpeMax,
    incrementPercent: row.incrementPercent,
    incrementAbsolute: row.incrementAbsolute,
    maxIncrementPercent: row.maxIncrementPercent,
    maxLoad: row.maxLoad,
  };
}
export function settingParameterIssues(v: SettingParameters): string[] {
  try {
    normalizeSettingParameters(settingParameters(v));
    return [];
  } catch {
    return ['PERSISTED_PARAMETERS_INCOMPLETE_OR_INVALID'];
  }
}
export function settingScope(v: unknown): SettingScope {
  const o = exact(v, ['exerciseId', 'trainingPlanId']);
  if (
    (o.exerciseId !== null && !consentUuid(o.exerciseId)) ||
    (o.trainingPlanId !== null && !consentUuid(o.trainingPlanId)) ||
    (o.exerciseId === null && o.trainingPlanId !== null)
  )
    return fail();
  return {
    exerciseId:
      o.exerciseId === null ? null : (o.exerciseId as string).toLowerCase(),
    trainingPlanId:
      o.trainingPlanId === null
        ? null
        : (o.trainingPlanId as string).toLowerCase(),
  };
}
export function settingOperation(
  action: SettingOperation['action'],
  v: unknown,
): SettingOperation {
  const o = exact(
    v,
    action === 'CREATE'
      ? ['intentId', 'scope', 'parameters']
      : [
          'intentId',
          'settingId',
          'expectedRevision',
          'parameters',
          'confirmImpact',
        ],
  );
  if (
    !consentUuid(o.intentId) ||
    (action === 'REPLACE' &&
      (!consentUuid(o.settingId) ||
        typeof o.expectedRevision !== 'string' ||
        !/^[0-9a-f]{64}$/.test(o.expectedRevision) ||
        o.confirmImpact !== true))
  )
    return fail();
  const input = {
    action,
    intentId: (o.intentId as string).toLowerCase(),
    parameters: normalizeSettingParameters(o.parameters),
    ...(action === 'CREATE'
      ? { scope: settingScope(o.scope) }
      : {
          settingId: (o.settingId as string).toLowerCase(),
          expectedRevision: o.expectedRevision as string,
        }),
  };
  return {
    ...input,
    requestKey: recommendationIdentity({
      schemaVersion: 'progression-setting-command-v1',
      ...input,
    }),
  };
}
