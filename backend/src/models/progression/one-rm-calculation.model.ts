import type {
  MeasurementUnit,
  OneRmFormula,
  OneRmSuitability,
  WorkoutSetKind,
  WorkoutSetStatus,
  WorkoutStatus,
} from '../../generated/prisma/client';

export type CalculationReason =
  | 'LOAD_MISSING'
  | 'LOAD_INVALID'
  | 'LOAD_NOT_POSITIVE'
  | 'DECIMAL_OUT_OF_RANGE'
  | 'UNIT_UNKNOWN'
  | 'CANONICAL_LOAD_MISSING'
  | 'CANONICAL_LOAD_INVALID'
  | 'CANONICAL_LOAD_NOT_POSITIVE'
  | 'CANONICAL_LOAD_INCONSISTENT'
  | 'REPETITIONS_MISSING'
  | 'REPETITIONS_INVALID'
  | 'REPETITIONS_OUT_OF_RANGE'
  | 'SESSION_STATUS_UNKNOWN'
  | 'SESSION_NOT_COMPLETED'
  | 'SET_STATUS_UNKNOWN'
  | 'SET_NOT_COMPLETED'
  | 'SET_COMPLETION_INCONSISTENT'
  | 'SET_COMPLETION_UNKNOWN'
  | 'SET_KIND_UNKNOWN'
  | 'SET_NOT_WORK'
  | 'OMISSION_UNKNOWN'
  | 'EXERCISE_OMITTED'
  | 'SUITABILITY_UNKNOWN'
  | 'EXERCISE_NOT_SUITABLE'
  | 'LOAD_MEANING_UNKNOWN'
  | 'LOAD_MEANING_UNSUPPORTED'
  | 'RPE_INVALID';
export type CalculationWarning =
  'EFFORT_UNVERIFIED' | 'EPLEY_SINGLE_REPETITION_LITERAL';

// These are analysis context, not new persisted Exercise or Prisma enum fields.
export type LoadMeaning =
  | 'EXTERNAL_TOTAL'
  | 'PER_HAND'
  | 'MACHINE_NOMINAL'
  | 'BODYWEIGHT'
  | 'ASSISTANCE'
  | 'NON_QUANTIFIABLE'
  | 'UNKNOWN';

export type KnownLoad = Readonly<{
  originalLoad: string;
  originalUnit: MeasurementUnit;
  loadKg: string;
}>;
export type LoadResult =
  { ok: true; value: KnownLoad } | { ok: false; reasons: CalculationReason[] };

// Unknown scalar inputs are intentionally validated at this pure boundary.
export type CalculationInput = Readonly<{
  load: unknown;
  loadUnit: unknown;
  repetitions: unknown;
}>;
export type FormulaEstimate = Readonly<{
  formula: OneRmFormula;
  estimatedOneRm: string;
  unit: 'KG';
  warnings: CalculationWarning[];
}>;
export type CalculationResult =
  | { ok: false; policyVersion: string; reasons: CalculationReason[] }
  | {
      ok: true;
      policyVersion: string;
      load: KnownLoad;
      repetitions: number;
      estimates: readonly [FormulaEstimate, FormulaEstimate];
      warnings: CalculationWarning[];
    };

export type SetProvenance = Readonly<{
  sessionId?: string;
  workoutExerciseId?: string;
  setId?: string;
  exerciseId?: string;
}>;
export type HistoricalSetInput = CalculationInput &
  Readonly<{
    loadKg: unknown;
    sessionStatus: WorkoutStatus | null;
    status: WorkoutSetStatus | null;
    kind: WorkoutSetKind | null;
    isCompleted: boolean | null;
    isOmitted: boolean | null;
    oneRmSuitability: OneRmSuitability | null;
    loadMeaning: LoadMeaning | null;
    rpe?: unknown;
    provenance?: SetProvenance;
  }>;
export type EligibilityResult = Readonly<{
  policyVersion: string;
  status: 'ELIGIBLE_WITH_WARNINGS' | 'NOT_ELIGIBLE' | 'NOT_EVALUABLE';
  mathematicallyUsable: boolean;
  descriptiveEligible: boolean;
  officialEvidence: 'NOT_ASSESSED';
  reasons: CalculationReason[];
  warnings: CalculationWarning[];
}>;
