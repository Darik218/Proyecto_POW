import type { Decimal } from '@prisma/client/runtime/client';
import type {
  MeasurementUnit,
  OneRmFormula,
  OneRmSuitability,
  WorkoutSetKind,
  WorkoutSetStatus,
  WorkoutStatus,
} from '../../generated/prisma/client';

export type EvidenceValue =
  | null
  | boolean
  | number
  | string
  | readonly EvidenceValue[]
  | { readonly [key: string]: EvidenceValue };
export type LoadDeclaration = Readonly<{
  meaning: 'EXTERNAL_TOTAL';
  source: 'OWNER_DECLARATION_AFTER_RECORDING';
}>;
export type EstimateCommand = Readonly<{
  sourceSetId: string;
  expectedSetVersion: number;
  formulas: readonly OneRmFormula[];
  interpretation: LoadDeclaration;
}>;
export type EstimateSource = Readonly<{
  userId: string;
  athleteId: string;
  exerciseId: string;
  sessionId: string;
  workoutExerciseId: string;
  sourceSetId: string;
  sourceSetVersion: number;
  sessionVersion: number;
  sessionStatus: WorkoutStatus;
  status: WorkoutSetStatus | null;
  kind: WorkoutSetKind | null;
  isCompleted: boolean;
  isOmitted: boolean;
  load: Decimal | string | null;
  loadUnit: MeasurementUnit | null;
  loadKg: Decimal | string | null;
  repetitions: number | null;
  rpe: Decimal | string | null;
  oneRmSuitability: OneRmSuitability;
  recordedAt: string;
  performedOn: string | null;
  timeZone: string | null;
}>;
export type EstimateDraft = Readonly<{
  athleteId: string;
  exerciseId: string;
  sourceSetId: string;
  sourceSetVersion: number;
  inputLoad: string;
  inputLoadUnit: MeasurementUnit;
  inputLoadKg: string;
  inputReps: number;
  estimatedOneRm: string;
  resultUnit: 'KG';
  formula: OneRmFormula;
  algorithmVersion: string;
  eligibilityVersion: string;
  estimateKind: 'DESCRIPTIVE';
  calculationKey: string;
  snapshot: { readonly [key: string]: EvidenceValue };
}>;
// Nullable new fields preserve the absence of evidence on legacy estimates.
export type StoredOneRmEstimate = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string;
  sourceSetId: string | null;
  sourceSetVersion: number | null;
  inputLoad: Decimal;
  inputLoadUnit: MeasurementUnit | null;
  inputLoadKg: Decimal | null;
  inputReps: number;
  estimatedOneRm: Decimal;
  resultUnit: MeasurementUnit | null;
  formula: OneRmFormula;
  algorithmVersion: string;
  eligibilityVersion: string | null;
  estimateKind: string | null;
  calculationKey: string | null;
  snapshot: EvidenceValue;
  calculatedAt: Date;
}>;

export class OneRmPersistenceError extends Error {
  constructor(
    readonly code:
      | 'SOURCE_NOT_FOUND'
      | 'CONTEXT_REQUIRED'
      | 'INVALID_COMMAND'
      | 'SOURCE_CHANGED'
      | 'NOT_ELIGIBLE'
      | 'DECIMAL_NOT_PERSISTABLE'
      | 'IDENTITY_CONFLICT',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}
