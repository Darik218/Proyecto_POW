import type {
  RecommendationCommand,
  ValidatedRecommendationCommand,
} from '../../models/progression/recommendation-draft.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import { validatePerformanceQuery } from './performance-query.policy';
import { validateWeeklyPeriod } from './weekly-period.policy';
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
// Allowlist policy fields as well as the request envelope. Unknown caller
// properties never become recommendation evidence.
export function policyProjection(policy: RecommendationCommand['policy']) {
  if (policy === undefined || policy === null || typeof policy !== 'object')
    return policy;
  const pick = (value: unknown, keys: readonly string[]): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      keys.filter((k) => Object.hasOwn(object, k)).map((k) => [k, object[k]]),
    );
  };
  const rule = (v: unknown) => {
    const r = pick(v, ['repetitions', 'load', 'rpe', 'coverage']);
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const fields = r as Record<string, unknown>;
      if (Object.hasOwn(fields, 'rpe'))
        fields.rpe = pick(fields.rpe, ['minimum', 'maximum']);
    }
    return r;
  };
  const result = pick(policy, [
    'id',
    'version',
    'provenance',
    'basis',
    'baseline',
    'cohort',
    'assessment',
    'settingRpeUse',
    'review',
    'oneRm',
    'requireClosedWeek',
    'knowledge',
    'loadMeaning',
    'settingLoadUnit',
    'incrementMode',
    'grid',
  ]) as Record<string, unknown>;
  result.provenance = pick(policy.provenance, ['source', 'reference']);
  result.grid = pick(policy.grid, [
    'unit',
    'step',
    'origin',
    'rounding',
    'source',
  ]);
  result.cohort = pick(policy.cohort, ['mode', 'taskIds']);
  const assessment = pick(policy.assessment, [
    'compliance',
    'count',
    'signal',
    'persistence',
  ]);
  if (
    assessment &&
    typeof assessment === 'object' &&
    !Array.isArray(assessment)
  ) {
    const a = assessment as Record<string, unknown>;
    const compliance = pick(a.compliance, [
      'id',
      'slots',
      'basic',
      'readiness',
    ]);
    if (
      compliance &&
      typeof compliance === 'object' &&
      !Array.isArray(compliance)
    ) {
      const c = compliance as Record<string, unknown>;
      if (Array.isArray(c.slots))
        c.slots = c.slots.map((slot) =>
          pick(slot, [
            'taskId',
            'original',
            'adjusted',
            'originalLoadMeaning',
            'adjustedLoadMeaning',
          ]),
        );
      if (Object.hasOwn(c, 'basic')) c.basic = rule(c.basic);
      if (Object.hasOwn(c, 'readiness')) c.readiness = rule(c.readiness);
    }
    if (Object.hasOwn(a, 'compliance')) a.compliance = compliance;
    if (Object.hasOwn(a, 'count'))
      a.count = pick(a.count, [
        'id',
        'basis',
        'criterion',
        'mode',
        'sameDate',
        'minimumSessions',
        'anchorTaskId',
      ]);
    if (Object.hasOwn(a, 'signal'))
      a.signal = pick(a.signal, [
        'id',
        'basis',
        'rpeComparison',
        'referenceSize',
        'rpeThreshold',
        'performanceThresholdPercent',
        'minimumRpeCoveragePercent',
      ]);
    if (Object.hasOwn(a, 'persistence'))
      a.persistence = pick(a.persistence, ['id', 'k', 'm']);
  }
  result.assessment = assessment;
  return result as RecommendationCommand['policy'];
}
export function validateRecommendationCommand(
  input: RecommendationCommand,
): ValidatedRecommendationCommand {
  if (!input || typeof input !== 'object')
    throw new RecommendationError('INVALID_COMMAND');
  const period = validateWeeklyPeriod(input.period);
  const history = validatePerformanceQuery(input.history);
  const target = input.destination;
  if (
    !target ||
    (target.kind === 'WORKOUT_TASK'
      ? !uuid(target.taskId)
      : target.kind === 'PRESCRIPTION'
        ? !uuid(target.planId) ||
          !uuid(target.weekId) ||
          !uuid(target.prescriptionId) ||
          (target.dayId !== null && !uuid(target.dayId))
        : true) ||
    (input.expectedPlanVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedPlanVersion) ||
        input.expectedPlanVersion < 0))
  )
    throw new RecommendationError('INVALID_COMMAND');
  if (
    history.to !== period.cutoffOn ||
    history.from > period.start ||
    history.timeZone !== period.timeZone
  )
    throw new RecommendationError('INVALID_PERIOD');
  // No async caller mutation or accidental extra input fields in evidence.
  let policy: RecommendationCommand['policy'];
  try {
    policy = structuredClone(policyProjection(input.policy));
  } catch {
    throw new RecommendationError('INVALID_COMMAND');
  }
  const uniquePairs = [
    ...new Map(
      history.comparisons.map((p) => [
        p.previousTaskId + ':' + p.currentTaskId,
        p,
      ]),
    ).values(),
  ];
  return {
    period: {
      start: period.start,
      endExclusive: period.endExclusive,
      cutoffOn: period.cutoffOn,
      weekStartsOn: period.weekStartsOn,
      timeZone: period.timeZone,
    },
    history: { ...history, comparisons: uniquePairs },
    destination:
      target.kind === 'WORKOUT_TASK'
        ? { kind: target.kind, taskId: target.taskId }
        : {
            kind: target.kind,
            planId: target.planId,
            weekId: target.weekId,
            dayId: target.dayId,
            prescriptionId: target.prescriptionId,
          },
    ...(input.expectedPlanVersion === undefined
      ? {}
      : { expectedPlanVersion: input.expectedPlanVersion }),
    ...(policy === undefined ? {} : { policy }),
  };
}
