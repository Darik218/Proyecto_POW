import { createHash } from 'node:crypto';
import type {
  EstimateCommand,
  EstimateDraft,
  EstimateSource,
  EvidenceValue,
} from '../../models/progression/one-rm-estimate.model';
import { OneRmPersistenceError } from '../../models/progression/one-rm-estimate.model';
import { calculateHistoricalOneRm } from './eligibility.policy';
import { readDecimal } from './decimal';

export function evidenceIdentity(value: EvidenceValue): string {
  function canonical(item: EvidenceValue): string {
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']';
    if (item !== null && typeof item === 'object')
      return (
        '{' +
        Object.keys(item)
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) +
              ':' +
              canonical((item as { [key: string]: EvidenceValue })[key]),
          )
          .join(',') +
        '}'
      );
    if (typeof item === 'number' && !Number.isSafeInteger(item))
      throw new OneRmPersistenceError('INVALID_COMMAND');
    return JSON.stringify(item);
  }
  return createHash('sha256')
    .update('one-rm-identity-v1\n' + canonical(value))
    .digest('hex');
}
export function assertPersistableDecimal(
  value: string,
  precision: number,
  scale: number,
): void {
  const parsed = readDecimal(value);
  if (
    !parsed.ok ||
    parsed.value.lte(0) ||
    parsed.value.decimalPlaces() > scale ||
    parsed.value.e + 1 > precision - scale
  )
    throw new OneRmPersistenceError('DECIMAL_NOT_PERSISTABLE');
}
// A single allowlist for observations copied from the locked execution source.
// This captures recorded values, never current plan targets or inferred units.
export function captureSourceEvidence(source: EstimateSource) {
  function decimal(value: EstimateSource['load'], scale?: number) {
    const parsed = readDecimal(value);
    return parsed.ok
      ? scale === undefined
        ? parsed.value.toFixed()
        : parsed.value.toFixed(scale)
      : null;
  }
  return {
    source: {
      athleteId: source.athleteId,
      exerciseId: source.exerciseId,
      sessionId: source.sessionId,
      workoutExerciseId: source.workoutExerciseId,
      setId: source.sourceSetId,
      setVersion: source.sourceSetVersion,
      sessionVersion: source.sessionVersion,
      sessionStatus: source.sessionStatus,
      status: source.status,
      kind: source.kind,
      isCompleted: source.isCompleted,
      isOmitted: source.isOmitted,
      recordedAt: source.recordedAt,
      performedOn: source.performedOn,
      timeZone: source.timeZone,
    },
    input: {
      load: decimal(source.load),
      loadUnit: source.loadUnit,
      loadKg: decimal(source.loadKg, 6),
      repetitions: source.repetitions,
      rpe: decimal(source.rpe),
    },
    exercise: { oneRmSuitability: source.oneRmSuitability },
  };
}
export function prepareEstimates(
  source: EstimateSource,
  command: EstimateCommand,
): EstimateDraft[] {
  if (
    command.interpretation?.meaning !== 'EXTERNAL_TOTAL' ||
    command.interpretation?.source !== 'OWNER_DECLARATION_AFTER_RECORDING'
  )
    throw new OneRmPersistenceError('CONTEXT_REQUIRED');
  if (
    !Array.isArray(command.formulas) ||
    command.formulas.length < 1 ||
    command.formulas.length > 2 ||
    new Set(command.formulas).size !== command.formulas.length ||
    command.formulas.some((f) => f !== 'EPLEY' && f !== 'BRZYCKI') ||
    !Number.isSafeInteger(command.expectedSetVersion) ||
    command.expectedSetVersion < 0 ||
    command.sourceSetId !== source.sourceSetId
  )
    throw new OneRmPersistenceError('INVALID_COMMAND');
  if (command.expectedSetVersion !== source.sourceSetVersion)
    throw new OneRmPersistenceError('SOURCE_CHANGED');
  const result = calculateHistoricalOneRm({
    ...source,
    loadMeaning: command.interpretation.meaning,
  });
  if (!result.calculation?.ok)
    throw new OneRmPersistenceError('NOT_ELIGIBLE', result.eligibility.reasons);
  const math = result.calculation;
  const original = readDecimal(math.load.originalLoad);
  if (!original.ok) throw new OneRmPersistenceError('DECIMAL_NOT_PERSISTABLE');
  const inputLoad = original.value.toFixed();
  assertPersistableDecimal(inputLoad, 8, 3);
  assertPersistableDecimal(math.load.loadKg, 24, 6);
  return math.estimates
    .filter((estimate) => command.formulas.includes(estimate.formula))
    .map((estimate) => {
      assertPersistableDecimal(estimate.estimatedOneRm, 24, 6);
      const snapshot = {
        schemaVersion: 'one-rm-evidence-v1',
        estimateKind: 'DESCRIPTIVE',
        evidenceStatus: 'NOT_ASSESSED',
        ...captureSourceEvidence(source),
        interpretation: {
          meaning: command.interpretation.meaning,
          source: command.interpretation.source,
          declaredByUserId: source.userId,
        },
        formula: estimate.formula,
        calculationVersion: math.policyVersion,
        eligibilityVersion: result.eligibility.policyVersion,
        numericPolicy: {
          canonicalUnit: 'KG',
          poundFactor: '0.45359237',
          scale: 6,
          rounding: 'ROUND_HALF_UP',
          precision: 128,
        },
        eligibility: {
          status: result.eligibility.status,
          reasons: result.eligibility.reasons,
          warnings: [...math.warnings, ...estimate.warnings],
        },
        result: {
          estimatedOneRm: estimate.estimatedOneRm,
          unit: estimate.unit,
        },
      } as const;
      return {
        athleteId: source.athleteId,
        exerciseId: source.exerciseId,
        sourceSetId: source.sourceSetId,
        sourceSetVersion: source.sourceSetVersion,
        inputLoad,
        inputLoadUnit: math.load.originalUnit,
        inputLoadKg: math.load.loadKg,
        inputReps: math.repetitions,
        estimatedOneRm: estimate.estimatedOneRm,
        resultUnit: estimate.unit,
        formula: estimate.formula,
        algorithmVersion: math.policyVersion,
        eligibilityVersion: result.eligibility.policyVersion,
        estimateKind: 'DESCRIPTIVE',
        snapshot,
        calculationKey: evidenceIdentity(snapshot),
      };
    });
}
