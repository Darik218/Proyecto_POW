import type {
  EstimatePoint,
  PerformanceHistory,
  PerformanceReason,
  PerformanceSet,
  PerformanceSetAnalysis,
  PerformanceTask,
  TaskContext,
  ValidatedPerformanceQuery,
} from '../../models/progression/performance-analysis.model';
import { PerformanceError } from '../../models/progression/performance-analysis.model';
import { evidenceIdentity } from './estimate-evidence.policy';
import { readDecimal } from './decimal';
import { interpretLoad } from './load';
import { comparableTasks } from './comparability.policy';
import { historicalEstimateEvidence } from './performance-estimates.policy';
import { PERFORMANCE_LIMITS } from './performance-query.policy';

export const PERFORMANCE_POLICY_VERSION = 'prog-2-descriptive-v1';
const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = <T>(values: readonly T[]) => [...new Set(values)];
function decimal(value: string) {
  const parsed = readDecimal(value);
  if (!parsed.ok) throw new PerformanceError('INVALID_QUERY');
  return parsed.value;
}
function sum(values: readonly string[]) {
  return values.length
    ? values
        .reduce((total, value) => total.plus(value), decimal('0'))
        .toFixed(6)
    : null;
}
function pointKey(point: EstimatePoint) {
  return [
    point.formula,
    point.algorithmVersion,
    point.eligibilityVersion,
    point.numericPolicyKey,
  ].join('|');
}

function describeSet(
  s: PerformanceSet,
  task: PerformanceTask,
  context: TaskContext | null,
  persistedMeaning: boolean,
  conflict: boolean,
): PerformanceSetAnalysis {
  const reasons: PerformanceReason[] = [];
  const rpe = s.rpe === null ? null : readDecimal(s.rpe);
  const validRpe =
    rpe && rpe.ok && rpe.value.gte(0) && rpe.value.lte(10)
      ? rpe.value.toFixed()
      : null;
  let meaning =
    context?.loadMeaning ?? (persistedMeaning ? 'EXTERNAL_TOTAL' : null);
  const meaningSource = context
    ? 'OWNER_DECLARATION_FOR_ANALYSIS'
    : persistedMeaning
      ? 'PERSISTED_OWNER_DECLARATION'
      : null;
  if (conflict)
    return {
      record: s,
      loadMeaning: meaning,
      meaningSource,
      validRepetitions: false,
      volumeStatus: 'NOT_EVALUABLE',
      volumeKgRepetitions: null,
      rpe: validRpe,
      reasons: ['CONFLICTING_SET_REFERENCE'],
    };
  if (persistedMeaning && context && context.loadMeaning !== 'EXTERNAL_TOTAL') {
    meaning = null;
    reasons.push('LOAD_MEANING_CONFLICT');
  }
  const executed =
    s.status === 'COMPLETED' ||
    s.status === 'INCOMPLETE' ||
    s.status === 'FAILED';
  const rep = s.repetitions;
  const validRepetitions =
    executed &&
    typeof rep === 'number' &&
    Number.isSafeInteger(rep) &&
    rep >= 0 &&
    rep <= 2147483647 &&
    (s.status !== 'COMPLETED' || rep > 0) &&
    (s.status !== 'FAILED' || rep === 0) &&
    s.isCompleted === (s.status === 'COMPLETED');
  if (s.status === null) reasons.push('SET_STATUS_UNKNOWN');
  else if (!executed) reasons.push('SET_NOT_COMPLETED');
  else if (!validRepetitions) reasons.push('REPETITIONS_INVALID');
  if (s.kind === null) reasons.push('SET_KIND_UNKNOWN');
  if (task.isOmitted) reasons.push('EXERCISE_OMITTED');
  if (executed) {
    if (s.load === null) reasons.push('LOAD_MISSING');
    else {
      const original = readDecimal(s.load);
      if (original.ok && original.value.eq(0)) {
        if (s.loadUnit !== 'KG' && s.loadUnit !== 'LB')
          reasons.push('UNIT_UNKNOWN');
        if (s.loadKg === null) reasons.push('CANONICAL_LOAD_MISSING');
        else {
          const kg = readDecimal(s.loadKg);
          if (!kg.ok || !kg.value.eq(0))
            reasons.push('CANONICAL_LOAD_INCONSISTENT');
        }
      } else {
        const load = interpretLoad(s.load, s.loadUnit);
        if (!load.ok) reasons.push(...load.reasons);
        if (s.loadKg === null) reasons.push('CANONICAL_LOAD_MISSING');
        else {
          const kg = readDecimal(s.loadKg);
          if (!kg.ok) reasons.push('CANONICAL_LOAD_INVALID');
          else if (load.ok && !kg.value.eq(load.value.loadKg))
            reasons.push('CANONICAL_LOAD_INCONSISTENT');
        }
      }
    }
    if (!meaning || meaning === 'UNKNOWN') reasons.push('LOAD_MEANING_UNKNOWN');
    else if (meaning !== 'EXTERNAL_TOTAL')
      reasons.push('LOAD_MEANING_UNSUPPORTED');
  }
  const included = executed && validRepetitions && reasons.length === 0;
  const volumeStatus = included
    ? 'INCLUDED'
    : (!executed && s.status !== null) ||
        task.isOmitted ||
        (meaning && meaning !== 'UNKNOWN' && meaning !== 'EXTERNAL_TOTAL')
      ? 'EXCLUDED'
      : 'NOT_EVALUABLE';
  const volume = included
    ? decimal(s.loadKg!).mul(String(rep)).toFixed(6)
    : null;
  if (s.rpe !== null && validRpe === null) reasons.push('RPE_INVALID');
  return {
    record: s,
    loadMeaning: meaning,
    meaningSource,
    validRepetitions,
    volumeStatus,
    volumeKgRepetitions: volume,
    rpe: validRpe,
    reasons: unique(reasons),
  };
}

function compareSets(
  previous: PerformanceSetAnalysis,
  current: PerformanceSetAnalysis,
) {
  const a = previous.record,
    b = current.record;
  const before = decimal(a.loadKg!),
    after = decimal(b.loadKg!);
  const sameLoad = before.eq(after),
    sameReps = a.repetitions === b.repetitions;
  const reasons: PerformanceReason[] = [];
  const rpeReasons: PerformanceReason[] = [];
  if (!sameLoad) rpeReasons.push('LOAD_CHANGED');
  if (!sameReps) rpeReasons.push('REPETITIONS_CHANGED');
  if (previous.rpe === null || current.rpe === null)
    rpeReasons.push('RPE_MISSING');
  const rpeDelta = !rpeReasons.length
    ? decimal(current.rpe!).minus(previous.rpe!).toFixed(1)
    : null;
  const change = after.minus(before);
  if (before.eq(0)) reasons.push('REFERENCE_LOAD_ZERO');
  return {
    setNumber: a.setNumber,
    previousSetId: a.id,
    currentSetId: b.id,
    deltaRepetitions: sameLoad ? b.repetitions! - a.repetitions! : null,
    deltaLoadKg: change.toFixed(6),
    deltaLoadPercent: before.gt(0)
      ? change.mul(100).div(before).toFixed(6)
      : null,
    outcome:
      sameLoad && sameReps
        ? 'UNCHANGED_OUTPUT'
        : sameLoad
          ? b.repetitions! > a.repetitions!
            ? 'MORE_REPETITIONS_AT_SAME_LOAD'
            : 'FEWER_REPETITIONS_AT_SAME_LOAD'
          : sameReps
            ? after.gt(before)
              ? 'HIGHER_LOAD_AT_SAME_REPETITIONS'
              : 'LOWER_LOAD_AT_SAME_REPETITIONS'
            : 'MIXED_OUTPUT_CHANGE',
    rpe: {
      delta: rpeDelta,
      description:
        rpeDelta === null
          ? null
          : decimal(rpeDelta).gt(0)
            ? 'HIGHER_DECLARED_EFFORT'
            : decimal(rpeDelta).lt(0)
              ? 'LOWER_DECLARED_EFFORT'
              : 'SAME_DECLARED_EFFORT',
      reasons: rpeReasons,
    },
    reasons,
  };
}

export function analyzePerformance(
  history: PerformanceHistory,
  query: ValidatedPerformanceQuery,
) {
  if (
    history.exerciseId !== query.exerciseId ||
    history.tasks.some(
      (t) =>
        t.athleteId !== history.athleteId ||
        t.exerciseId !== history.exerciseId,
    ) ||
    history.estimates.some(
      (e) =>
        e.athleteId !== history.athleteId ||
        e.exerciseId !== history.exerciseId,
    ) ||
    history.sets.some(
      (s) => !history.tasks.some((t) => t.id === s.workoutExerciseId),
    )
  )
    throw new PerformanceError('SOURCE_NOT_FOUND');
  if (
    history.tasks.length > PERFORMANCE_LIMITS.tasks ||
    history.sets.length > PERFORMANCE_LIMITS.sets ||
    history.estimates.length > PERFORMANCE_LIMITS.estimates
  )
    throw new PerformanceError('INVALID_QUERY');
  for (const context of query.contexts)
    if (!history.tasks.some((t) => t.id === context.workoutExerciseId))
      throw new PerformanceError('TASK_NOT_IN_SELECTION');
  const setMap = new Map<string, PerformanceSet>();
  const conflicts = new Set<string>();
  let duplicateSetReferences = 0;
  for (const s of history.sets) {
    const old = setMap.get(s.id);
    if (old) {
      duplicateSetReferences++;
      if (evidenceIdentity(old) !== evidenceIdentity(s)) {
        conflicts.add(s.id);
        if (text(evidenceIdentity(s), evidenceIdentity(old)) < 0)
          setMap.set(s.id, s);
      }
    } else setMap.set(s.id, s);
  }
  const evidence = historicalEstimateEvidence({
    ...history,
    sets: [...setMap.values()].filter((s) => !conflicts.has(s.id)),
  });
  const points = evidence.points.sort(
    (a, b) =>
      text(a.performedOn ?? '~', b.performedOn ?? '~') ||
      text(a.sessionId, b.sessionId) ||
      text(a.id, b.id),
  );
  const tasks = [...history.tasks]
    .sort(
      (a, b) =>
        text(a.performedOn ?? '~', b.performedOn ?? '~') ||
        text(a.sessionId, b.sessionId) ||
        a.orderInSession - b.orderInSession ||
        text(a.id, b.id),
    )
    .map((t) => {
      const context =
        query.contexts.find((c) => c.workoutExerciseId === t.id) ?? null;
      const records = [...setMap.values()]
        .filter((s) => s.workoutExerciseId === t.id)
        .sort((a, b) => a.setNumber - b.setNumber || text(a.id, b.id));
      const sets = records.map((s) =>
        describeSet(
          s,
          t,
          context,
          points.some((p) => p.sourceSetId === s.id),
          conflicts.has(s.id),
        ),
      );
      const keys = unique(
        sets.map(
          (s) =>
            `${s.record.kind ?? 'UNKNOWN'}:${s.record.status ?? 'UNKNOWN'}`,
        ),
      ).sort(text);
      const groups = keys.map((key) => {
        const items = sets.filter(
          (s) =>
            `${s.record.kind ?? 'UNKNOWN'}:${s.record.status ?? 'UNKNOWN'}` ===
            key,
        );
        const withReps = items.filter((s) => s.validRepetitions);
        return {
          kind: items[0].record.kind,
          status: items[0].record.status,
          recordedRepetitions: withReps.length
            ? withReps.reduce((n, s) => n + s.record.repetitions!, 0)
            : null,
          volumeKgRepetitions: sum(
            items.flatMap((s) =>
              s.volumeKgRepetitions === null ? [] : [s.volumeKgRepetitions],
            ),
          ),
          coverage: {
            reviewed: items.length,
            included: items.filter((s) => s.volumeStatus === 'INCLUDED').length,
            excluded: items.filter((s) => s.volumeStatus === 'EXCLUDED').length,
            notEvaluable: items.filter(
              (s) => s.volumeStatus === 'NOT_EVALUABLE',
            ).length,
            complete:
              items.every((s) => s.volumeStatus === 'INCLUDED') &&
              records.length === t.availableSets,
          },
          includedSetIds: items
            .filter((s) => s.volumeStatus === 'INCLUDED')
            .map((s) => s.record.id),
          excludedSetIds: items
            .filter((s) => s.volumeStatus === 'EXCLUDED')
            .map((s) => s.record.id),
          nonEvaluableSetIds: items
            .filter((s) => s.volumeStatus === 'NOT_EVALUABLE')
            .map((s) => s.record.id),
        };
      });
      const reasons: PerformanceReason[] = [];
      if (!t.performedOn) reasons.push('DATE_UNKNOWN');
      if (t.timeZone !== query.timeZone) reasons.push('TIME_ZONE_MISMATCH');
      if (t.sessionStatus !== 'COMPLETED')
        reasons.push('SESSION_NOT_COMPLETED');
      if (records.length < t.availableSets) reasons.push('READ_LIMIT_REACHED');
      return {
        ...t,
        context,
        sets,
        groups,
        reasons,
        coverage: {
          availableSets: t.availableSets,
          reviewedSets: records.length,
        },
        rpe: {
          withRpe: sets
            .filter((s) => s.rpe !== null)
            .map((s) => ({
              setId: s.record.id,
              setNumber: s.record.setNumber,
              value: s.rpe!,
            })),
          withoutRpe: sets
            .filter((s) => s.record.rpe === null)
            .map((s) => s.record.id),
          invalidRpe: sets
            .filter((s) => s.record.rpe !== null && s.rpe === null)
            .map((s) => s.record.id),
        },
      };
    });
  const estimateGroups = unique(points.map(pointKey))
    .sort(text)
    .map((key) => {
      const selected = points.filter((p) => pointKey(p) === key),
        first = selected[0];
      return {
        formula: first.formula,
        algorithmVersion: first.algorithmVersion,
        eligibilityVersion: first.eligibilityVersion,
        numericPolicyKey: first.numericPolicyKey,
        unit: 'KG',
        points: selected,
      };
    });
  const comparisons = query.comparisons.map((pair) => {
    const a = tasks.find((t) => t.id === pair.previousTaskId),
      b = tasks.find((t) => t.id === pair.currentTaskId);
    if (!a || !b) throw new PerformanceError('TASK_NOT_IN_SELECTION');
    const reasons = comparableTasks(a, b, a.context, b.context, query.timeZone);
    const results: ReturnType<typeof compareSets>[] = [];
    const estimateDifferences: {
      previousEstimateId: string;
      currentEstimateId: string;
      formula: string;
      algorithmVersion: string;
      eligibilityVersion: string;
      deltaKg: string;
      deltaPercent: string;
    }[] = [];
    const estimateReasons: PerformanceReason[] = [];
    if (!reasons.length) {
      const usable = (items: readonly PerformanceSetAnalysis[]) =>
        items.filter(
          (s) =>
            s.record.kind === 'WORK' &&
            s.record.status === 'COMPLETED' &&
            s.volumeStatus === 'INCLUDED',
        );
      const previous = usable(a.sets),
        current = usable(b.sets);
      if (
        previous.length !== current.length ||
        previous.some(
          (s) =>
            !current.some((c) => c.record.setNumber === s.record.setNumber),
        )
      )
        reasons.push('SET_POSITIONS_DIFFER');
      for (const left of previous) {
        const right = current.filter(
          (s) => s.record.setNumber === left.record.setNumber,
        );
        if (
          right.length !== 1 ||
          previous.filter((s) => s.record.setNumber === left.record.setNumber)
            .length !== 1
        )
          continue;
        results.push(compareSets(left, right[0]));
        const before = points.filter((p) => p.sourceSetId === left.record.id),
          after = points.filter((p) => p.sourceSetId === right[0].record.id);
        if (!before.length || !after.length)
          estimateReasons.push('ESTIMATES_UNAVAILABLE');
        for (const key of unique(before.map(pointKey))) {
          const x = before.filter((p) => pointKey(p) === key),
            y = after.filter((p) => pointKey(p) === key);
          if (x.length !== 1 || y.length > 1) {
            estimateReasons.push('AMBIGUOUS_ESTIMATES');
            continue;
          }
          if (!y.length) {
            estimateReasons.push(
              after.some((p) => p.formula === x[0].formula)
                ? 'ALGORITHM_VERSION_MISMATCH'
                : 'MIXED_FORMULAS',
            );
            continue;
          }
          const delta = decimal(y[0].resultKg).minus(x[0].resultKg);
          estimateDifferences.push({
            previousEstimateId: x[0].id,
            currentEstimateId: y[0].id,
            formula: x[0].formula,
            algorithmVersion: x[0].algorithmVersion,
            eligibilityVersion: x[0].eligibilityVersion,
            deltaKg: delta.toFixed(6),
            deltaPercent: delta.mul(100).div(x[0].resultKg).toFixed(6),
          });
        }
      }
      if (!results.length) reasons.push('INSUFFICIENT_DATA');
    }
    if (
      a.coverage.reviewedSets < a.coverage.availableSets ||
      b.coverage.reviewedSets < b.coverage.availableSets
    )
      reasons.push('READ_LIMIT_REACHED');
    if (history.truncated.estimates) estimateReasons.push('READ_LIMIT_REACHED');
    return {
      ...pair,
      status: reasons.length
        ? results.length
          ? 'PARTIAL'
          : 'NOT_COMPARABLE'
        : 'AVAILABLE',
      reasons: unique(reasons),
      sets: results,
      estimates: {
        differences: estimateDifferences,
        reasons: unique(estimateReasons),
      },
      warnings: ['TASK_CONTEXT_DECLARED_FOR_ANALYSIS'],
    };
  });
  const warnings: PerformanceReason[] = unique([
    ...(Object.values(history.truncated).some(Boolean)
      ? ['READ_LIMIT_REACHED' as const]
      : []),
    ...(!history.exerciseIsActive ? ['EXERCISE_INACTIVE' as const] : []),
    ...(duplicateSetReferences ? ['DUPLICATE_SET_REFERENCE' as const] : []),
    ...tasks.flatMap((t) => t.reasons),
    ...(query.contexts.length
      ? ['TASK_CONTEXT_DECLARED_FOR_ANALYSIS' as const]
      : []),
  ]);
  const hasData =
    tasks.some((t) => t.sets.some((s) => s.validRepetitions)) ||
    points.length > 0;
  const partial =
    Object.values(history.truncated).some(Boolean) ||
    tasks.some(
      (t) =>
        t.reasons.length ||
        t.sets.some(
          (s) =>
            s.volumeStatus === 'NOT_EVALUABLE' ||
            s.reasons.includes('RPE_INVALID'),
        ),
    ) ||
    comparisons.some((p) => p.reasons.length) ||
    evidence.excluded.length > 0;
  return {
    policyVersion: PERFORMANCE_POLICY_VERSION,
    athleteId: history.athleteId,
    exerciseId: history.exerciseId,
    window: {
      from: query.from,
      to: query.to,
      timeZone: query.timeZone,
      undatedRecords: 'SEPARATE_UNPLACED_EVIDENCE',
    },
    status: !hasData ? 'INSUFFICIENT_DATA' : partial ? 'PARTIAL' : 'AVAILABLE',
    tasks,
    comparisons,
    estimates: { groups: estimateGroups, excluded: evidence.excluded },
    coverage: {
      uniqueSessions: new Set(tasks.map((t) => t.sessionId)).size,
      tasksReturned: tasks.length,
      reviewedSets: setMap.size,
      duplicateSetReferences,
      truncated: { ...history.truncated },
      limits: { ...PERFORMANCE_LIMITS, tasks: query.limit },
    },
    warnings,
  };
}
