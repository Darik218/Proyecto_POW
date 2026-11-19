import type {
  AssessmentStatus,
  PerformanceAnalysis,
  SignalPolicy,
  SignalObservation,
  PersistencePolicy,
} from '../../models/progression/prescription-assessment.model';
import {
  assessPrescriptions,
  assessmentDecimal as d,
  normalizeTargets,
  targetKg,
} from './prescription-assessment.policy';
import { evidenceIdentity } from './estimate-evidence.policy';
import { comparableTasks } from './comparability.policy';
import { validateAssessmentOptions } from './assessment-query.policy';
import type {
  AssessedTask,
  TargetBasis,
} from '../../models/progression/prescription-assessment.model';
export function median(values: readonly string[]): string | null {
  if (!values.length) return null;
  const sorted = values.map(d).sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle].toFixed()
    : sorted[middle - 1].plus(sorted[middle]).div(2).toFixed();
}
export function sameTargets(
  a: AssessedTask,
  b: AssessedTask,
  basis: TargetBasis,
): boolean {
  if (
    basis === 'ORIGINAL' &&
    [a, b].some(
      (t) =>
        t.originalExerciseId !== undefined &&
        t.originalExerciseId !== t.exerciseId,
    )
  )
    return false;
  const x = normalizeTargets(
      basis === 'ORIGINAL' ? a.originalTargets : a.adjustedTargets,
    ),
    y = normalizeTargets(
      basis === 'ORIGINAL' ? b.originalTargets : b.adjustedTargets,
    );
  if (!x.targets || !y.targets || x.reasons.length || y.reasons.length)
    return false;
  const p = x.targets,
    q = y.targets;
  return (
    p.targetSets === q.targetSets &&
    p.targetRepsMin === q.targetRepsMin &&
    p.targetRepsMax === q.targetRepsMax &&
    p.targetRpe === q.targetRpe &&
    ((p.targetLoad === null && q.targetLoad === null) ||
      (p.targetLoad !== null &&
        q.targetLoad !== null &&
        targetKg(p.targetLoad, p.targetLoadUnit) ===
          targetKg(q.targetLoad, q.targetLoadUnit)))
  );
}
// Arithmetic only. Context, pairing and coverage are enforced by analyzeEffort;
// these numbers alone never constitute an accredited observation.
export function reviewMetrics(
  currentRpe: string,
  referenceRpe: string,
  currentPerformance: string,
  referencePerformance: string,
  policy: SignalPolicy,
) {
  validateAssessmentOptions({ signal: policy });
  const deltaRpe = d(currentRpe).minus(referenceRpe),
    reference = d(referencePerformance);
  const delta = reference.gt(0)
    ? d(currentPerformance).minus(reference).mul(100).div(reference)
    : null;
  return {
    deltaRpe: deltaRpe.toFixed(6),
    deltaPerformancePercent: delta?.toFixed(6) ?? null,
    reviewSignal:
      delta === null
        ? null
        : deltaRpe.gte(policy.rpeThreshold) &&
          delta.lte(d(policy.performanceThresholdPercent).negated()),
    reasons: delta === null ? ['REFERENCE_PERFORMANCE_ZERO'] : [],
  };
}
type Assessments = ReturnType<typeof assessPrescriptions>;
export function analyzeEffort(
  analysis: PerformanceAnalysis,
  assessments: Assessments,
  input: SignalPolicy | undefined,
): SignalObservation[] {
  const policy = validateAssessmentOptions(
    input ? { signal: input } : {},
  ).signal;
  const ids = [...new Set(analysis.comparisons.map((c) => c.currentTaskId))];
  return ids.map((currentTaskId) => {
    const current = analysis.tasks.find((t) => t.id === currentTaskId)!;
    const referenceTaskIds = [
      ...new Set(
        analysis.comparisons
          .filter((c) => c.currentTaskId === currentTaskId)
          .map((c) => c.previousTaskId),
      ),
    ].sort();
    const base = {
      policyKey: policy ? evidenceIdentity({ ...policy }) : null,
      basis: policy?.basis ?? null,
      currentTaskId,
      referenceTaskIds,
      sessionId: current.sessionId,
      performedOn: current.performedOn,
      timeZone: current.timeZone,
    };
    const empty = (
      status: AssessmentStatus,
      reasons: readonly string[],
      coveragePercent: string | null = null,
      positions: readonly number[] = [],
    ): SignalObservation => ({
      ...base,
      status,
      reasons: [...new Set(reasons)],
      reviewSignal: null,
      currentRpe: null,
      referenceRpe: null,
      currentPerformance: null,
      referencePerformance: null,
      deltaRpe: null,
      deltaPerformancePercent: null,
      coveragePercent,
      positions,
    });
    if (!policy)
      return empty('CONFIGURATION_REQUIRED', ['SIGNAL_POLICY_REQUIRED']);
    const reasons: string[] = [];
    if (referenceTaskIds.length !== policy.referenceSize)
      reasons.push('REFERENCE_SIZE_MISMATCH');
    const references = referenceTaskIds.map((id) =>
      analysis.tasks.find((t) => t.id === id)!,
    );
    if (
      new Set(references.map((t) => t.sessionId)).size !== references.length ||
      references.some((t) => t.sessionId === current.sessionId)
    )
      reasons.push('REFERENCE_SESSIONS_NOT_DISTINCT');
    if (
      new Set(references.map((t) => t.performedOn)).size !== references.length
    )
      reasons.push('INTRADAY_REFERENCE_ORDER_UNKNOWN');
    for (const t of [current, ...references]) {
      if (
        !t.performedOn ||
        t.performedOn < analysis.window.from ||
        t.performedOn > analysis.window.to
      )
        reasons.push('DATE_OUTSIDE_WINDOW_OR_UNKNOWN');
      if (t.coverage.reviewedSets !== t.availableSets)
        reasons.push('READ_LIMIT_REACHED');
    }
    if (Object.values(analysis.coverage.truncated).some(Boolean))
      reasons.push('READ_LIMIT_REACHED');
    for (const reference of references) {
      reasons.push(
        ...comparableTasks(
          reference,
          current,
          reference.context,
          current.context,
          analysis.window.timeZone,
        ),
      );
      if (!sameTargets(reference, current, policy.basis))
        reasons.push('TARGETS_NOT_COMPARABLE');
    }
    const assessed = [current, ...references].map(
      (t) =>
        assessments.tasks.find((a) => a.taskId === t.id)?.[
          policy.basis === 'ORIGINAL' ? 'original' : 'adjusted'
        ],
    );
    if (assessed.some((a) => !a || a.reasons.length || !a.slots.length))
      reasons.push('REQUIRED_SLOT_EVIDENCE_UNAVAILABLE');
    if (
      assessed.some(
        (a) =>
          a?.targets?.targetLoad !== null &&
          a?.targetLoadMeaning !== 'EXTERNAL_TOTAL',
      )
    )
      reasons.push('TARGET_LOAD_MEANING_UNKNOWN_OR_UNSUPPORTED');
    const positions = assessed[0]?.slots.map((s) => s.setNumber) ?? [];
    if (
      assessed.some(
        (a) =>
          a?.slots.map((s) => s.setNumber).join(',') !== positions.join(','),
      )
    )
      reasons.push('SET_POSITIONS_DIFFER');
    if (reasons.length) return empty('NOT_EVALUABLE', reasons);
    const rows: {
      position: number;
      currentRpe: string;
      referenceRpe: string;
      currentReps: string;
      referenceReps: string;
    }[] = [];
    let changedReps = false;
    for (const position of positions) {
      const entries = [current, ...references].map((t) =>
        t.sets.filter((s) => s.record.setNumber === position),
      );
      if (
        entries.some(
          (s) =>
            s.length !== 1 ||
            s[0].record.kind !== 'WORK' ||
            s[0].record.status !== 'COMPLETED' ||
            !s[0].validRepetitions ||
            s[0].volumeStatus !== 'INCLUDED',
        )
      ) {
        reasons.push('INCOMPLETE_MATCHED_WORK');
        continue;
      }
      const sets = entries.map((s) => s[0]),
        first = sets[0];
      if (sets.some((s) => !d(s.record.loadKg!).eq(first.record.loadKg!))) {
        reasons.push('LOAD_CHANGED');
        continue;
      }
      const differentReps = sets.some(
        (s) => s.record.repetitions !== first.record.repetitions,
      );
      changedReps ||= differentReps;
      if (differentReps && policy.rpeComparison === 'STRICT_PROG2') {
        reasons.push('REPETITIONS_CHANGED');
        continue;
      }
      if (sets.some((s) => s.rpe === null)) continue;
      rows.push({
        position,
        currentRpe: first.rpe!,
        referenceRpe: median(sets.slice(1).map((s) => s.rpe!))!,
        currentReps: String(first.record.repetitions),
        referenceReps: median(
          sets.slice(1).map((s) => String(s.record.repetitions)),
        )!,
      });
    }
    const coveragePercent = positions.length
      ? d(String(rows.length)).mul(100).div(positions.length).toFixed(6)
      : null;
    if (
      !rows.length ||
      coveragePercent === null ||
      d(String(rows.length))
        .mul(100)
        .lt(d(policy.minimumRpeCoveragePercent).mul(positions.length))
    )
      reasons.push('RPE_COVERAGE_INSUFFICIENT');
    if (reasons.length)
      return empty(
        'NOT_EVALUABLE',
        reasons,
        coveragePercent,
        rows.map((r) => r.position),
      );
    const currentRpe = median(rows.map((r) => r.currentRpe))!,
      referenceRpe = median(rows.map((r) => r.referenceRpe))!,
      currentPerformance = median(rows.map((r) => r.currentReps))!,
      referencePerformance = median(rows.map((r) => r.referenceReps))!;
    const metrics = reviewMetrics(
      currentRpe,
      referenceRpe,
      currentPerformance,
      referencePerformance,
      policy,
    );
    return {
      ...base,
      status: metrics.reviewSignal === null ? 'NOT_EVALUABLE' : 'AVAILABLE',
      reasons: [
        ...metrics.reasons,
        ...(changedReps ? ['DESCRIPTIVE_RPE_WITH_CHANGED_REPETITIONS'] : []),
      ],
      currentRpe,
      referenceRpe,
      currentPerformance,
      referencePerformance,
      deltaRpe: metrics.deltaRpe,
      deltaPerformancePercent: metrics.deltaPerformancePercent,
      reviewSignal: metrics.reviewSignal,
      coveragePercent,
      positions: rows.map((r) => r.position),
    };
  });
}
export function persistentSignals(
  observations: readonly SignalObservation[],
  analysis: PerformanceAnalysis,
  input: PersistencePolicy | undefined,
) {
  const policy = validateAssessmentOptions(
    input ? { persistence: input } : {},
  ).persistence;
  const empty = (status: AssessmentStatus, reasons: string[]) => ({
    status,
    reasons,
    evaluated: 0,
    signals: 0,
    persistentReviewSignal: null as boolean | null,
    sourceTaskIds: [] as string[],
  });
  if (!policy)
    return empty('CONFIGURATION_REQUIRED', ['PERSISTENCE_POLICY_REQUIRED']);
  if (Object.values(analysis.coverage.truncated).some(Boolean))
    return empty('NOT_EVALUABLE', ['READ_LIMIT_REACHED']);
  if (
    observations.some(
      (o) => !o.performedOn || o.timeZone !== analysis.window.timeZone,
    )
  )
    return empty('NOT_EVALUABLE', ['TEMPORAL_DATE_OR_ZONE_UNKNOWN']);
  if (observations.length < policy.m)
    return empty('NOT_EVALUABLE', ['INSUFFICIENT_OBSERVATIONS']);
  if (
    observations.some((o) => !o.policyKey || !o.basis) ||
    new Set(observations.map((o) => o.policyKey)).size !== 1 ||
    new Set(observations.map((o) => o.basis)).size !== 1
  )
    return empty('NOT_EVALUABLE', ['SIGNAL_POLICY_MISMATCH']);
  const sorted = [...observations].sort(
    (a, b) =>
      (a.performedOn ?? '').localeCompare(b.performedOn ?? '') ||
      a.currentTaskId.localeCompare(b.currentTaskId),
  );
  // Never choose arbitrarily among tasks within one session/date or skip a
  // latest unknown observation in order to satisfy k-of-m.
  if (
    new Set(sorted.map((o) => o.sessionId)).size !== sorted.length ||
    new Set(sorted.map((o) => o.performedOn)).size !== sorted.length
  )
    return empty('NOT_EVALUABLE', [
      'AMBIGUOUS_SESSION_OR_INTRADAY_OBSERVATIONS',
    ]);
  const selected = sorted.slice(-policy.m);
  if (
    selected.some(
      (o) =>
        !o.performedOn ||
        o.performedOn < analysis.window.from ||
        o.performedOn > analysis.window.to ||
        o.timeZone !== analysis.window.timeZone ||
        o.status !== 'AVAILABLE' ||
        o.reviewSignal === null,
    )
  )
    return empty('NOT_EVALUABLE', ['INSUFFICIENT_COMPARABLE_OBSERVATIONS']);
  const tasks = selected.map((o) =>
    analysis.tasks.find((t) => t.id === o.currentTaskId),
  );
  if (tasks.some((t) => !t))
    return empty('NOT_EVALUABLE', ['SOURCE_NOT_FOUND']);
  for (let i = 1; i < tasks.length; i++) {
    const a = tasks[i - 1]!,
      b = tasks[i]!;
    if (
      comparableTasks(a, b, a.context, b.context, analysis.window.timeZone)
        .length ||
      !sameTargets(a, b, selected[0].basis!)
    )
      return empty('NOT_EVALUABLE', ['TEMPORAL_COHORT_NOT_COMPARABLE']);
  }
  const signals = selected.filter((o) => o.reviewSignal).length;
  return {
    status: 'AVAILABLE' as const,
    reasons: [],
    evaluated: selected.length,
    signals,
    persistentReviewSignal: signals >= policy.k,
    sourceTaskIds: selected.map((o) => o.currentTaskId),
  };
}
