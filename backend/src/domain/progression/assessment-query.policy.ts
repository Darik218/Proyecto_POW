import { AssessmentError } from '../../models/progression/prescription-assessment.model';
import type {
  AssessmentOptions,
  ComplianceRule,
} from '../../models/progression/prescription-assessment.model';
import { readDecimal } from './decimal';
const invalid = (): never => {
  throw new AssessmentError('INVALID_POLICY');
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const key = (v: unknown) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 120;
const integer = (v: unknown, max: number) =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;
function bounded(v: unknown, max: string, positive = false) {
  const d = readDecimal(v);
  return (
    d.ok && (positive ? d.value.gt(0) : d.value.gte(0)) && d.value.lte(max)
  );
}
function rule(v: unknown): ComplianceRule {
  if (
    !object(v) ||
    !['MINIMUM', 'UPPER_BOUND'].includes(String(v.repetitions)) ||
    ![
      'IGNORE',
      'AT_LEAST_TARGET',
      'EXACT_TARGET',
      'IF_PRESENT_AT_LEAST',
    ].includes(String(v.load)) ||
    v.coverage !== 'ALL_REQUIRED'
  )
    invalid();
  const rpe = (v as Record<string, unknown>).rpe;
  if (rpe !== 'DESCRIBE' && rpe !== 'AT_MOST_TARGET') {
    if (
      !object(rpe) ||
      !bounded(rpe.minimum, '10') ||
      !bounded(rpe.maximum, '10')
    )
      invalid();
    const interval = rpe as Record<string, unknown>;
    const a = readDecimal(interval.minimum),
      b = readDecimal(interval.maximum);
    if (!a.ok || !b.ok || a.value.gt(b.value)) invalid();
  }
  const p = v as unknown as ComplianceRule;
  return {
    repetitions: p.repetitions,
    load: p.load,
    coverage: p.coverage,
    rpe:
      typeof p.rpe === 'string'
        ? p.rpe
        : { minimum: p.rpe.minimum, maximum: p.rpe.maximum },
  };
}
export function validateAssessmentOptions(
  input: AssessmentOptions = {},
): AssessmentOptions {
  if (!object(input)) invalid();
  const out: {
    -readonly [K in keyof AssessmentOptions]: AssessmentOptions[K];
  } = {};
  if (input.compliance !== undefined) {
    const p = input.compliance;
    if (
      !object(p) ||
      !key(p.id) ||
      !Array.isArray(p.slots) ||
      p.slots.length > 100
    )
      invalid();
    const ids = new Set<string>();
    for (const s of p.slots) {
      if (!object(s) || !key(s.taskId) || ids.has(s.taskId)) invalid();
      ids.add(s.taskId);
      for (const meaning of [s.originalLoadMeaning, s.adjustedLoadMeaning])
        if (
          meaning !== undefined &&
          ![
            'EXTERNAL_TOTAL',
            'PER_HAND',
            'MACHINE_NOMINAL',
            'BODYWEIGHT',
            'ASSISTANCE',
            'NON_QUANTIFIABLE',
            'UNKNOWN',
          ].includes(meaning)
        )
          invalid();
      for (const positions of [s.original, s.adjusted]) {
        if (
          !Array.isArray(positions) ||
          positions.length > 1000 ||
          positions.some((n) => !integer(n, 2147483647)) ||
          new Set(positions).size !== positions.length
        )
          invalid();
      }
    }
    out.compliance = {
      id: p.id,
      slots: p.slots.map((s) => ({
        taskId: s.taskId,
        ...(s.originalLoadMeaning !== undefined
          ? { originalLoadMeaning: s.originalLoadMeaning }
          : {}),
        ...(s.adjustedLoadMeaning !== undefined
          ? { adjustedLoadMeaning: s.adjustedLoadMeaning }
          : {}),
        original: [...s.original].sort((a, b) => a - b),
        adjusted: [...s.adjusted].sort((a, b) => a - b),
      })),
      ...(p.basic !== undefined ? { basic: rule(p.basic) } : {}),
      ...(p.readiness !== undefined ? { readiness: rule(p.readiness) } : {}),
    };
  }
  if (input.signal !== undefined) {
    const p = input.signal;
    if (
      !object(p) ||
      !key(p.id) ||
      !['ORIGINAL', 'ADJUSTED'].includes(p.basis) ||
      !['STRICT_PROG2', 'MATCHED_LOAD_DESCRIPTIVE'].includes(p.rpeComparison) ||
      !integer(p.referenceSize, 100) ||
      !bounded(p.rpeThreshold, '10', true) ||
      !bounded(p.performanceThresholdPercent, '100', true) ||
      !bounded(p.minimumRpeCoveragePercent, '100', true)
    )
      invalid();
    out.signal = {
      id: p.id,
      basis: p.basis,
      rpeComparison: p.rpeComparison,
      referenceSize: p.referenceSize,
      rpeThreshold: p.rpeThreshold,
      performanceThresholdPercent: p.performanceThresholdPercent,
      minimumRpeCoveragePercent: p.minimumRpeCoveragePercent,
    };
  }
  if (input.count !== undefined) {
    const p = input.count;
    if (
      !object(p) ||
      !key(p.id) ||
      !key(p.anchorTaskId) ||
      !['ORIGINAL', 'ADJUSTED'].includes(p.basis) ||
      !['BASIC', 'READINESS'].includes(p.criterion) ||
      !['ACCUMULATED', 'CONSECUTIVE'].includes(p.mode) ||
      !['DISTINCT_SESSIONS', 'DISTINCT_DATES'].includes(p.sameDate) ||
      !integer(p.minimumSessions, 100)
    )
      invalid();
    out.count = {
      id: p.id,
      basis: p.basis,
      criterion: p.criterion,
      mode: p.mode,
      sameDate: p.sameDate,
      minimumSessions: p.minimumSessions,
      anchorTaskId: p.anchorTaskId,
    };
  }
  if (input.persistence !== undefined) {
    const p = input.persistence;
    if (
      !object(p) ||
      !key(p.id) ||
      !integer(p.k, 50) ||
      !integer(p.m, 50) ||
      p.k > p.m
    )
      invalid();
    out.persistence = { id: p.id, k: p.k, m: p.m };
  }
  return out;
}
