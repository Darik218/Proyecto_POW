import type {
  CalculationReason,
  EligibilityResult,
  HistoricalSetInput,
  SetProvenance,
} from '../../models/progression/one-rm-calculation.model';
import { calculateOneRm } from './one-rm';
import { readDecimal } from './decimal';

export function evaluateOneRmEligibility(
  input: HistoricalSetInput,
): EligibilityResult {
  const math = calculateOneRm(input);
  const missing: CalculationReason[] = [];
  const excluded: CalculationReason[] = [];
  if (!math.ok) {
    for (const reason of math.reasons) {
      if (
        reason === 'LOAD_NOT_POSITIVE' ||
        reason === 'REPETITIONS_OUT_OF_RANGE' ||
        reason === 'CANONICAL_LOAD_NOT_POSITIVE'
      )
        excluded.push(reason);
      else missing.push(reason);
    }
  }

  if (input.sessionStatus == null) missing.push('SESSION_STATUS_UNKNOWN');
  else if (input.sessionStatus !== 'COMPLETED')
    excluded.push('SESSION_NOT_COMPLETED');
  if (input.status == null) missing.push('SET_STATUS_UNKNOWN');
  else if (input.status !== 'COMPLETED') excluded.push('SET_NOT_COMPLETED');
  else if (input.isCompleted == null) missing.push('SET_COMPLETION_UNKNOWN');
  else if (input.isCompleted !== true)
    excluded.push('SET_COMPLETION_INCONSISTENT');

  if (input.kind == null) missing.push('SET_KIND_UNKNOWN');
  else if (input.kind !== 'WORK') excluded.push('SET_NOT_WORK');
  if (input.isOmitted == null) missing.push('OMISSION_UNKNOWN');
  else if (input.isOmitted !== false) excluded.push('EXERCISE_OMITTED');
  if (input.oneRmSuitability === 'NOT_SUITABLE')
    excluded.push('EXERCISE_NOT_SUITABLE');
  else if (input.oneRmSuitability !== 'SUITABLE')
    missing.push('SUITABILITY_UNKNOWN');

  if (input.loadMeaning == null || input.loadMeaning === 'UNKNOWN')
    missing.push('LOAD_MEANING_UNKNOWN');
  else if (input.loadMeaning !== 'EXTERNAL_TOTAL')
    excluded.push('LOAD_MEANING_UNSUPPORTED');

  if (input.loadKg == null) missing.push('CANONICAL_LOAD_MISSING');
  else {
    const canonical = readDecimal(input.loadKg);
    if (!canonical.ok) missing.push('CANONICAL_LOAD_INVALID');
    else if (canonical.value.lte(0))
      excluded.push('CANONICAL_LOAD_NOT_POSITIVE');
    else if (math.ok && !canonical.value.eq(math.load.loadKg))
      excluded.push('CANONICAL_LOAD_INCONSISTENT');
  }

  if (input.rpe != null) {
    // The existing model uses Decimal; HTTP currently presents RPE as a number.
    const rpe = readDecimal(
      typeof input.rpe === 'number' ? String(input.rpe) : input.rpe,
    );
    if (!rpe.ok || rpe.value.lt(0) || rpe.value.gt(10))
      missing.push('RPE_INVALID');
  }
  const descriptiveEligible = excluded.length === 0 && missing.length === 0;
  return {
    policyVersion: 'prog-1a-series-v1',
    status: excluded.length
      ? 'NOT_ELIGIBLE'
      : missing.length
        ? 'NOT_EVALUABLE'
        : 'ELIGIBLE_WITH_WARNINGS',
    mathematicallyUsable: math.ok,
    descriptiveEligible,
    officialEvidence: 'NOT_ASSESSED',
    reasons: [...new Set([...excluded, ...missing])],
    warnings: ['EFFORT_UNVERIFIED'],
  };
}

export function calculateHistoricalOneRm(input: HistoricalSetInput) {
  const eligibility = evaluateOneRmEligibility(input);
  const provenance: SetProvenance | undefined = input.provenance && {
    ...(input.provenance.sessionId !== undefined
      ? { sessionId: input.provenance.sessionId }
      : {}),
    ...(input.provenance.workoutExerciseId !== undefined
      ? { workoutExerciseId: input.provenance.workoutExerciseId }
      : {}),
    ...(input.provenance.setId !== undefined
      ? { setId: input.provenance.setId }
      : {}),
    ...(input.provenance.exerciseId !== undefined
      ? { exerciseId: input.provenance.exerciseId }
      : {}),
  };
  return {
    eligibility,
    calculation: eligibility.descriptiveEligible ? calculateOneRm(input) : null,
    provenance,
  };
}
