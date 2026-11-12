import type {
  AssessmentOptions,
  AssessedTask,
  ComplianceRule,
  CriterionResult,
  PerformanceAnalysis,
} from '../../models/progression/prescription-assessment.model';
import { AssessmentError } from '../../models/progression/prescription-assessment.model';
import type { LoadMeaning } from '../../models/progression/one-rm-calculation.model';
import type { EvidenceValue } from '../../models/progression/one-rm-estimate.model';
import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import { readDecimal } from './decimal';
import { interpretLoad } from './load';
import { validateAssessmentOptions } from './assessment-query.policy';
export { validateAssessmentOptions } from './assessment-query.policy';
export const ASSESSMENT_VERSION = 'prog-3-observable-v1';
const unique = (v: readonly string[]) => [...new Set(v)];
export function assessmentDecimal(value: string) {
  const d = readDecimal(value);
  if (!d.ok) throw new AssessmentError('INVALID_POLICY');
  return d.value;
}
export function targetKg(value: unknown, unit: unknown): string | null {
  const d = readDecimal(value);
  if (d.ok && d.value.eq(0) && (unit === 'KG' || unit === 'LB'))
    return '0.000000';
  const load = interpretLoad(value, unit);
  return load.ok ? load.value.loadKg : null;
}
export function normalizeTargets(
  raw:
    | Readonly<Partial<Record<keyof RecordedTargets, EvidenceValue>>>
    | RecordedTargets
    | null,
): { targets: RecordedTargets | null; reasons: string[] } {
  if (raw === null)
    return { targets: null, reasons: ['ORIGINAL_TARGETS_UNKNOWN'] };
  const reasons: string[] = [];
  const integer = (v: unknown) =>
    typeof v === 'number' &&
    Number.isSafeInteger(v) &&
    v >= 1 &&
    v <= 2147483647
      ? v
      : null;
  const count = integer(raw.targetSets),
    minimum = integer(raw.targetRepsMin),
    maximum = integer(raw.targetRepsMax);
  if (count === null) reasons.push('TARGET_SETS_UNKNOWN_OR_INVALID');
  if (minimum === null || maximum === null)
    reasons.push('TARGET_REPETITIONS_UNKNOWN_OR_INVALID');
  else if (minimum > maximum) reasons.push('TARGET_RANGE_INVALID');
  const load =
    raw.targetLoad == null
      ? null
      : typeof raw.targetLoad === 'string'
        ? raw.targetLoad
        : null;
  const unit =
    raw.targetLoadUnit === 'KG' || raw.targetLoadUnit === 'LB'
      ? raw.targetLoadUnit
      : null;
  if (
    raw.targetLoad != null &&
    (load === null || targetKg(load, unit) === null)
  )
    reasons.push('TARGET_LOAD_UNKNOWN_OR_INVALID');
  if (raw.targetLoad == null && raw.targetLoadUnit != null)
    reasons.push('TARGET_UNIT_WITHOUT_LOAD');
  const rpe =
    raw.targetRpe == null
      ? null
      : readDecimal(
          typeof raw.targetRpe === 'number'
            ? String(raw.targetRpe)
            : raw.targetRpe,
        );
  if (rpe && (!rpe.ok || rpe.value.lt(0) || rpe.value.gt(10)))
    reasons.push('TARGET_RPE_INVALID');
  return {
    targets: {
      targetSets: count,
      targetRepsMin: minimum,
      targetRepsMax: maximum,
      targetLoad: load,
      targetLoadUnit: unit,
      targetRpe: rpe?.ok ? rpe.value.toFixed() : null,
    },
    reasons,
  };
}
function assessSlot(
  task: AssessedTask,
  number: number,
  targets: RecordedTargets | null,
  targetLoadMeaning: LoadMeaning | null,
) {
  const candidates = task.sets.filter((s) => s.record.setNumber === number);
  const s = candidates.length === 1 ? candidates[0] : null;
  const record = s?.record ?? null;
  const reasons: string[] = [];
  if (candidates.length > 1) reasons.push('DUPLICATE_SET_POSITION');
  else if (!s) reasons.push('SET_UNRECORDED');
  if (s) {
    if (record!.kind !== 'WORK')
      reasons.push(record!.kind === null ? 'SET_KIND_UNKNOWN' : 'NOT_WORK');
    if (record!.status === null) reasons.push('SET_STATUS_UNKNOWN');
    else if (
      record!.isCompleted !== (record!.status === 'COMPLETED') ||
      (['PENDING', 'SKIPPED'].includes(record!.status) &&
        [record!.load, record!.repetitions, record!.rpe].some(
          (v) => v !== null,
        ))
    )
      reasons.push('CONTRADICTORY_SET_STATE');
    if (s.reasons.includes('REPETITIONS_INVALID'))
      reasons.push('REPETITIONS_INVALID');
    if (s.reasons.includes('CONFLICTING_SET_REFERENCE'))
      reasons.push('CONFLICTING_SET_REFERENCE');
  }
  const observable =
    !!s && record!.kind === 'WORK' && s.validRepetitions && !reasons.length;
  const reps = observable ? record!.repetitions : null;
  const minimum = targets?.targetRepsMin,
    maximum = targets?.targetRepsMax;
  const repetitions =
    reps == null || minimum == null || maximum == null || minimum > maximum
      ? 'NOT_EVALUABLE'
      : reps < minimum
        ? 'BELOW_MINIMUM'
        : reps > maximum
          ? 'ABOVE_MAXIMUM'
          : reps === maximum
            ? 'MAXIMUM_REACHED'
            : 'MINIMUM_REACHED';
  const kg =
    targets?.targetLoad == null
      ? null
      : targetKg(targets.targetLoad, targets.targetLoadUnit);
  const actualKg =
    targetLoadMeaning === 'EXTERNAL_TOTAL' &&
    s?.volumeStatus === 'INCLUDED' &&
    task.context?.loadMeaning === 'EXTERNAL_TOTAL' &&
    s.loadMeaning === 'EXTERNAL_TOTAL'
      ? record!.loadKg
      : null;
  const loadDifferenceKg =
    kg !== null && actualKg !== null
      ? assessmentDecimal(actualKg).minus(kg).toFixed(6)
      : null;
  const load =
    targets?.targetLoad == null
      ? 'NO_TARGET'
      : loadDifferenceKg === null
        ? 'NOT_COMPARABLE'
        : assessmentDecimal(loadDifferenceKg).eq(0)
          ? 'TARGET_REACHED'
          : assessmentDecimal(loadDifferenceKg).lt(0)
            ? 'BELOW_TARGET'
            : 'ABOVE_TARGET';
  if (s?.record.rpe !== null && s?.rpe === null) reasons.push('RPE_INVALID');
  const rpe =
    s?.rpe == null
      ? record?.rpe == null
        ? 'MISSING'
        : 'INVALID'
      : targets?.targetRpe == null
        ? 'NO_TARGET'
        : assessmentDecimal(s.rpe).eq(targets.targetRpe)
          ? 'AT_TARGET'
          : assessmentDecimal(s.rpe).gt(targets.targetRpe)
            ? 'ABOVE_TARGET'
            : 'BELOW_TARGET';
  return {
    setNumber: number,
    record,
    sourceAnalysis: s
      ? {
          loadMeaning: s.loadMeaning,
          meaningSource: s.meaningSource,
          validRepetitions: s.validRepetitions,
          volumeStatus: s.volumeStatus,
          reasons: s.reasons,
        }
      : null,
    repetitions,
    load,
    targetLoadKg: kg,
    loadReasons:
      targets?.targetLoad == null
        ? []
        : targetLoadMeaning === null || targetLoadMeaning === 'UNKNOWN'
          ? ['TARGET_LOAD_MEANING_UNKNOWN']
          : targetLoadMeaning !== 'EXTERNAL_TOTAL'
            ? ['TARGET_LOAD_MEANING_UNSUPPORTED']
            : [],
    loadDifferenceKg,
    rpe,
    rpeValue: s?.rpe ?? null,
    observable,
    reasons,
  };
}
type Slot = ReturnType<typeof assessSlot>;
function rpeCheck(
  slot: Slot,
  targets: RecordedTargets | null,
  rule: ComplianceRule | undefined,
) {
  const interval = rule?.rpe;
  const minimum =
    interval && typeof interval !== 'string' ? interval.minimum : null;
  const maximum =
    interval === 'AT_MOST_TARGET'
      ? (targets?.targetRpe ?? null)
      : interval && typeof interval !== 'string'
        ? interval.maximum
        : null;
  const base = {
    setNumber: slot.setNumber,
    value: slot.rpeValue,
    minimum,
    maximum,
  };
  if (!rule)
    return {
      ...base,
      state: 'CONFIGURATION_REQUIRED',
      accepted: null as boolean | null,
    };
  if (slot.record?.rpe != null && slot.rpeValue === null)
    return { ...base, state: 'INVALID', accepted: null };
  if (slot.rpeValue === null)
    return { ...base, state: 'MISSING', accepted: null };
  if (interval === 'DESCRIBE')
    return { ...base, state: 'DESCRIPTIVE_ONLY', accepted: null };
  if (maximum === null) return { ...base, state: 'NO_TARGET', accepted: null };
  if (minimum !== null && assessmentDecimal(slot.rpeValue).lt(minimum))
    return { ...base, state: 'BELOW_INTERVAL', accepted: false };
  if (assessmentDecimal(slot.rpeValue).gt(maximum))
    return { ...base, state: 'ABOVE_INTERVAL', accepted: false };
  return { ...base, state: 'WITHIN_INTERVAL', accepted: true };
}
function criterion(
  slots: readonly Slot[],
  t: RecordedTargets | null,
  rule: ComplianceRule | undefined,
  blockers: readonly string[],
) {
  const reasons = [...blockers];
  const rpeChecks = slots.map((s) => rpeCheck(s, t, rule));
  if (!rule)
    return {
      result: 'CONFIGURATION_REQUIRED' as CriterionResult,
      reasons: unique([...reasons, 'CRITERIA_REQUIRED']),
      rpeChecks,
    };
  if (blockers.includes('WORK_SLOT_MAPPING_REQUIRED'))
    return {
      result: 'CONFIGURATION_REQUIRED' as CriterionResult,
      reasons,
      rpeChecks,
    };
  if (!t || blockers.length)
    return { result: 'NOT_EVALUABLE' as CriterionResult, reasons, rpeChecks };
  let met = 0,
    unknown = 0,
    failed = 0;
  for (const [index, s] of slots.entries()) {
    if (s.reasons.length) {
      unknown++;
      continue;
    }
    let missing =
      !s.observable ||
      s.repetitions === 'NOT_EVALUABLE' ||
      s.reasons.includes('RPE_INVALID');
    let fail = s.observable && s.record!.status !== 'COMPLETED';
    if (
      s.repetitions === 'BELOW_MINIMUM' ||
      (rule.repetitions === 'UPPER_BOUND' &&
        s.repetitions === 'MINIMUM_REACHED')
    )
      fail = true;
    if (
      rule.load !== 'IGNORE' &&
      !(rule.load === 'IF_PRESENT_AT_LEAST' && s.load === 'NO_TARGET')
    ) {
      if (s.load === 'NO_TARGET' || s.load === 'NOT_COMPARABLE') missing = true;
      else if (
        s.load === 'BELOW_TARGET' ||
        (rule.load === 'EXACT_TARGET' && s.load !== 'TARGET_REACHED')
      )
        fail = true;
    }
    if (rule.rpe !== 'DESCRIBE') {
      const check = rpeChecks[index];
      if (check.accepted === null) missing = true;
      else if (!check.accepted) fail = true;
    }
    // Explicit FAILED/SKIPPED/INCOMPLETE is observable lifecycle evidence;
    // unrecorded/PENDING/legacy are absence, not inferred failure.
    if (
      s.record?.kind === 'WORK' &&
      (s.record.status === 'SKIPPED' ||
        (s.observable &&
          ['FAILED', 'INCOMPLETE'].includes(s.record.status ?? ''))) &&
      !s.reasons.length
    )
      fail = true;
    if (fail) failed++;
    else if (missing) unknown++;
    else met++;
  }
  if (failed) reasons.push('CRITERIA_NOT_MET');
  if (unknown) reasons.push('INSUFFICIENT_SLOT_EVIDENCE');
  const result: CriterionResult = failed
    ? met || unknown
      ? 'PARTIAL'
      : 'NOT_MET'
    : unknown
      ? met
        ? 'PARTIAL'
        : 'NOT_EVALUABLE'
      : slots.length
        ? 'SATISFIED'
        : 'NOT_EVALUABLE';
  return { result, reasons: unique(reasons), rpeChecks };
}
export function assessTarget(
  task: AssessedTask,
  basis: 'ORIGINAL' | 'ADJUSTED',
  policy: AssessmentOptions['compliance'],
) {
  const raw =
    basis === 'ORIGINAL' ? task.originalTargets : task.adjustedTargets;
  const parsed = normalizeTargets(raw),
    targets = parsed.targets;
  const mapping = policy?.slots.find((s) => s.taskId === task.id);
  const positions = mapping
    ? basis === 'ORIGINAL'
      ? mapping.original
      : mapping.adjusted
    : [];
  const reasons = [...parsed.reasons];
  if (
    basis === 'ORIGINAL' &&
    task.originalExerciseId !== undefined &&
    task.originalExerciseId !== task.exerciseId
  )
    reasons.push(
      task.originalExerciseId === null
        ? 'ORIGINAL_EXERCISE_UNKNOWN'
        : 'ORIGINAL_EXERCISE_MISMATCH',
    );
  if (!mapping) reasons.push('WORK_SLOT_MAPPING_REQUIRED');
  else if (targets?.targetSets !== positions.length)
    reasons.push('SLOT_MAPPING_TARGET_COUNT_MISMATCH');
  if (task.isOmitted) reasons.push('EXERCISE_OMITTED');
  if (task.sessionStatus !== 'COMPLETED') reasons.push('SESSION_NOT_COMPLETED');
  if (task.coverage.reviewedSets < task.coverage.availableSets)
    reasons.push('READ_LIMIT_REACHED');
  const targetLoadMeaning =
    (basis === 'ORIGINAL'
      ? mapping?.originalLoadMeaning
      : mapping?.adjustedLoadMeaning) ?? null;
  const slots = positions.map((n) =>
    assessSlot(task, n, targets, targetLoadMeaning),
  );
  const valid = slots.filter(
    (s) => s.record?.kind === 'WORK' && s.observable && s.rpeValue !== null,
  );
  const basic = criterion(slots, targets, policy?.basic, reasons);
  const readiness = criterion(slots, targets, policy?.readiness, reasons);
  const status =
    parsed.reasons.length || task.isOmitted
      ? ('NOT_EVALUABLE' as const)
      : !mapping
        ? ('CONFIGURATION_REQUIRED' as const)
        : reasons.length ||
            basic.result === 'PARTIAL' ||
            slots.some((s) => !s.observable || s.reasons.length > 0)
          ? ('PARTIAL' as const)
          : ('AVAILABLE' as const);
  return {
    basis,
    source:
      basis === 'ORIGINAL' ? 'ORIGINAL_SNAPSHOT' : 'WORKOUT_EXERCISE_TARGETS',
    rawTargets: raw,
    targetLoadMeaning,
    targetLoadMeaningSource:
      targetLoadMeaning === null ? null : 'ANALYSIS_POLICY_DECLARATION',
    targets,
    status,
    reasons: unique(reasons),
    basic,
    readiness,
    slots,
    additionalSetIds: task.sets
      .filter((s) => !positions.includes(s.record.setNumber))
      .map((s) => s.record.id),
    coverage: {
      required: targets?.targetSets ?? null,
      mapped: positions.length,
      recorded: slots.filter((s) => s.record !== null).length,
      completedWork: slots.filter(
        (s) => s.observable && s.record?.status === 'COMPLETED',
      ).length,
      availableSets: task.availableSets,
      reviewedSets: task.coverage.reviewedSets,
    },
    rpeCoverage: {
      evaluatedWork: slots.filter((s) => s.record?.kind === 'WORK').length,
      valid: valid.length,
      missing: slots.filter(
        (s) => s.record?.kind === 'WORK' && s.record.rpe === null,
      ).length,
      invalid: slots.filter(
        (s) =>
          s.record?.kind === 'WORK' &&
          s.record.rpe !== null &&
          s.rpeValue === null,
      ).length,
      positions: valid.map((s) => s.setNumber),
      percent: positions.length
        ? assessmentDecimal(String(valid.length))
            .mul(100)
            .div(positions.length)
            .toFixed(6)
        : null,
    },
  };
}
export function assessPrescriptions(
  analysis: PerformanceAnalysis,
  input: AssessmentOptions,
) {
  const policy = validateAssessmentOptions(input);
  for (const slots of policy.compliance?.slots ?? [])
    if (!analysis.tasks.some((t) => t.id === slots.taskId))
      throw new AssessmentError('TASK_NOT_IN_SELECTION');
  const tasks = analysis.tasks.map((task) => ({
    taskId: task.id,
    athleteId: task.athleteId,
    sessionId: task.sessionId,
    exerciseId: task.exerciseId,
    sessionVersion: task.sessionVersion,
    sessionStatus: task.sessionStatus,
    orderInSession: task.orderInSession,
    performedOn: task.performedOn,
    timeZone: task.timeZone,
    planExerciseId: task.planExerciseId ?? null,
    replacesWorkoutExerciseId: task.replacesWorkoutExerciseId ?? null,
    originalExerciseId: task.originalExerciseId ?? null,
    context: task.context,
    observedSets: task.sets,
    sourceReasons: task.reasons,
    original: assessTarget(task, 'ORIGINAL', policy.compliance),
    adjusted: assessTarget(task, 'ADJUSTED', policy.compliance),
  }));
  const truncated = Object.values(analysis.coverage.truncated).some(Boolean);
  return {
    policyVersion: ASSESSMENT_VERSION,
    policy,
    athleteId: analysis.athleteId,
    exerciseId: analysis.exerciseId,
    window: analysis.window,
    status:
      truncated ||
      tasks.some(
        (t) =>
          t.original.status !== 'AVAILABLE' ||
          t.adjusted.status !== 'AVAILABLE',
      )
        ? ('PARTIAL' as const)
        : tasks.length
          ? ('AVAILABLE' as const)
          : ('NOT_EVALUABLE' as const),
    reasons: truncated ? ['READ_LIMIT_REACHED'] : [],
    tasks,
    coverage: analysis.coverage,
    warnings: analysis.warnings,
  };
}
