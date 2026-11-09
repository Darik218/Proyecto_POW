import type {
  EstimatePoint,
  HistoricalEstimate,
  PerformanceHistory,
  PerformanceReason,
} from '../../models/progression/performance-analysis.model';
import type { EvidenceValue } from '../../models/progression/one-rm-estimate.model';
import { evidenceIdentity } from './estimate-evidence.policy';
import { readDecimal } from './decimal';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function equalDecimal(a: unknown, b: unknown) {
  if (a === null || b === null) return a === b;
  const left = readDecimal(a),
    right = readDecimal(b);
  return left.ok && right.ok && left.value.eq(right.value);
}

export function historicalEstimateEvidence(history: PerformanceHistory) {
  const points: EstimatePoint[] = [];
  const excluded: {
    id: string;
    sourceSetId: string | null;
    formula: string;
    algorithmVersion: string;
    eligibilityVersion: string | null;
    result: string;
    unit: string | null;
    reasons: PerformanceReason[];
  }[] = [];
  const observations = new Map<string, Map<string, HistoricalEstimate>>();
  for (const row of history.estimates) {
    // Observation equality is not a replacement for PROG-1B's calculation hash.
    // Legacy JSON may contain numeric values that are not calculation inputs.
    const key = JSON.stringify(row, (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const fields = value as Record<string, unknown>;
        return Object.fromEntries(
          Object.keys(fields)
            .sort()
            .map((k) => [k, fields[k]]),
        );
      }
      return value;
    });
    if (!observations.has(row.id)) observations.set(row.id, new Map());
    observations.get(row.id)!.set(key, row);
  }
  function exclude(row: HistoricalEstimate, reasons: PerformanceReason[]) {
    excluded.push({
      id: row.id,
      sourceSetId: row.sourceSetId,
      formula: row.formula,
      algorithmVersion: row.algorithmVersion,
      eligibilityVersion: row.eligibilityVersion,
      result: row.result,
      unit: row.resultUnit,
      reasons,
    });
  }
  for (const id of [...observations.keys()].sort()) {
    const candidates = observations.get(id)!;
    if (candidates.size > 1) {
      for (const key of [...candidates.keys()].sort())
        exclude(candidates.get(key)!, ['CONFLICTING_ESTIMATE_REFERENCE']);
      continue;
    }
    const row = candidates.values().next().value!;
    const reasons: PerformanceReason[] = [];
    const set = history.sets.find((s) => s.id === row.sourceSetId);
    const task = history.tasks.find((t) => t.id === set?.workoutExerciseId);
    const snap = object(row.snapshot),
      source = object(snap.source),
      input = object(snap.input),
      result = object(snap.result),
      eligibility = object(snap.eligibility),
      interpretation = object(snap.interpretation);
    if (
      row.estimateKind !== 'DESCRIPTIVE' ||
      !row.calculationKey ||
      !row.resultUnit ||
      !row.eligibilityVersion
    )
      reasons.push('LEGACY_ESTIMATE_UNVERIFIABLE');
    else {
      let identityValid = false;
      try {
        identityValid = evidenceIdentity(row.snapshot) === row.calculationKey;
      } catch {
        /* Invalid historical JSON is preserved, not interpreted. */
      }
      const value = readDecimal(row.result);
      const numericPolicy = object(snap.numericPolicy);
      if (
        !set ||
        !task ||
        row.athleteId !== history.athleteId ||
        row.exerciseId !== history.exerciseId ||
        snap.schemaVersion !== 'one-rm-evidence-v1' ||
        !identityValid ||
        snap.evidenceStatus !== 'NOT_ASSESSED' ||
        snap.estimateKind !== 'DESCRIPTIVE' ||
        snap.formula !== row.formula ||
        snap.calculationVersion !== row.algorithmVersion ||
        snap.eligibilityVersion !== row.eligibilityVersion ||
        source.athleteId !== history.athleteId ||
        source.exerciseId !== history.exerciseId ||
        source.setId !== set.id ||
        source.sessionId !== task.sessionId ||
        source.workoutExerciseId !== task.id ||
        source.status !== 'COMPLETED' ||
        set.status !== 'COMPLETED' ||
        source.kind !== 'WORK' ||
        set.kind !== 'WORK' ||
        source.isCompleted !== true ||
        !set.isCompleted ||
        source.isOmitted !== false ||
        task.isOmitted ||
        source.recordedAt !== set.recordedAt ||
        source.performedOn !== task.performedOn ||
        source.timeZone !== task.timeZone ||
        interpretation.meaning !== 'EXTERNAL_TOTAL' ||
        interpretation.source !== 'OWNER_DECLARATION_AFTER_RECORDING' ||
        interpretation.declaredByUserId !== history.userId ||
        eligibility.status !== 'ELIGIBLE_WITH_WARNINGS' ||
        !Array.isArray(eligibility.warnings) ||
        eligibility.warnings.some((v) => typeof v !== 'string') ||
        !eligibility.warnings.includes('EFFORT_UNVERIFIED') ||
        !Array.isArray(eligibility.reasons) ||
        eligibility.reasons.length !== 0 ||
        numericPolicy.canonicalUnit !== 'KG' ||
        numericPolicy.scale !== 6 ||
        numericPolicy.rounding !== 'ROUND_HALF_UP' ||
        numericPolicy.poundFactor !== '0.45359237' ||
        !Number.isSafeInteger(numericPolicy.precision) ||
        (numericPolicy.precision as number) < 1 ||
        (row.inputLoadUnit !== 'KG' && row.inputLoadUnit !== 'LB') ||
        row.inputLoadKg === null ||
        row.inputReps < 1 ||
        row.inputReps > 10 ||
        row.resultUnit !== 'KG' ||
        result.unit !== 'KG' ||
        !value.ok ||
        value.value.lte(0) ||
        !equalDecimal(result.estimatedOneRm, row.result) ||
        input.loadUnit !== set.loadUnit ||
        row.inputLoadUnit !== set.loadUnit ||
        !equalDecimal(input.load, set.load) ||
        !equalDecimal(row.inputLoad, set.load) ||
        !equalDecimal(input.loadKg, set.loadKg) ||
        !equalDecimal(row.inputLoadKg, set.loadKg) ||
        !equalDecimal(input.rpe, set.rpe) ||
        input.repetitions !== set.repetitions ||
        row.inputReps !== set.repetitions
      )
        reasons.push('ESTIMATE_PROVENANCE_INVALID');
      if (
        set &&
        task &&
        (row.sourceSetVersion !== set.version ||
          source.setVersion !== set.version ||
          source.sessionVersion !== task.sessionVersion)
      )
        reasons.push('SOURCE_VERSION_MISMATCH');
      if (!reasons.length && set && task && value.ok) {
        points.push({
          id: row.id,
          sourceSetId: set.id,
          workoutExerciseId: task.id,
          sessionId: task.sessionId,
          performedOn: task.performedOn,
          timeZone: task.timeZone,
          calculatedAt: row.calculatedAt,
          formula: row.formula,
          algorithmVersion: row.algorithmVersion,
          eligibilityVersion: row.eligibilityVersion!,
          numericPolicyKey: evidenceIdentity(
            snap.numericPolicy as EvidenceValue,
          ),
          resultKg: value.value.toFixed(6),
          inputLoad: row.inputLoad,
          inputLoadUnit: row.inputLoadUnit!,
          inputLoadKg: row.inputLoadKg!,
          inputReps: row.inputReps,
          warnings: eligibility.warnings as string[],
          evidenceStatus: 'NOT_ASSESSED',
          calculationKey: row.calculationKey!,
        });
        continue;
      }
    }
    exclude(row, reasons);
  }
  return { points, excluded };
}
