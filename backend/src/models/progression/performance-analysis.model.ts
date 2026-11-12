import type {
  MeasurementUnit,
  OneRmFormula,
  WorkoutStatus,
  WorkoutSetKind,
  WorkoutSetStatus,
} from '../../generated/prisma/client';
import type {
  CalculationReason,
  LoadMeaning,
} from './one-rm-calculation.model';
import type { EvidenceValue } from './one-rm-estimate.model';

export type PerformanceReason =
  | CalculationReason
  | 'INVALID_QUERY'
  | 'TASK_NOT_IN_SELECTION'
  | 'SOURCE_NOT_FOUND'
  | 'LOAD_MEANING_CONFLICT'
  | 'PROTOCOL_NOT_COMPARABLE'
  | 'EQUIPMENT_NOT_COMPARABLE'
  | 'ATHLETE_MISMATCH'
  | 'EXERCISE_MISMATCH'
  | 'DATE_UNKNOWN'
  | 'TIME_ZONE_MISMATCH'
  | 'INTRADAY_ORDER_UNKNOWN'
  | 'REVERSED_DATE_ORDER'
  | 'SET_POSITIONS_DIFFER'
  | 'LOAD_CHANGED'
  | 'REPETITIONS_CHANGED'
  | 'REFERENCE_LOAD_ZERO'
  | 'RPE_MISSING'
  | 'ESTIMATES_UNAVAILABLE'
  | 'MIXED_FORMULAS'
  | 'ALGORITHM_VERSION_MISMATCH'
  | 'AMBIGUOUS_ESTIMATES'
  | 'ESTIMATE_PROVENANCE_INVALID'
  | 'LEGACY_ESTIMATE_UNVERIFIABLE'
  | 'DUPLICATE_SET_REFERENCE'
  | 'CONFLICTING_SET_REFERENCE'
  | 'CONFLICTING_ESTIMATE_REFERENCE'
  | 'SOURCE_VERSION_MISMATCH'
  | 'READ_LIMIT_REACHED'
  | 'EXERCISE_INACTIVE'
  | 'TASK_CONTEXT_DECLARED_FOR_ANALYSIS'
  | 'INSUFFICIENT_DATA';
export type TaskContext = Readonly<{
  workoutExerciseId: string;
  loadMeaning: LoadMeaning;
  protocolKey: string | null;
  equipmentKey: string | null;
  source: 'OWNER_DECLARATION_FOR_ANALYSIS';
}>;
export type PerformanceQuery = Readonly<{
  exerciseId: string;
  from: string;
  to: string;
  timeZone: string;
  limit: number;
  contexts?: readonly TaskContext[];
  comparisons?: readonly { previousTaskId: string; currentTaskId: string }[];
}>;
export type ValidatedPerformanceQuery = Omit<
  PerformanceQuery,
  'contexts' | 'comparisons'
> & {
  contexts: readonly TaskContext[];
  comparisons: readonly { previousTaskId: string; currentTaskId: string }[];
};
export type RecordedTargets = {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: string | null;
  targetLoadUnit: MeasurementUnit | null;
  targetRpe: string | null;
};
export type PerformanceTask = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string;
  sessionId: string;
  sessionVersion: number;
  originalExerciseId?: string | null;
  planExerciseId?: string | null;
  replacesWorkoutExerciseId?: string | null;
  sessionStatus: WorkoutStatus;
  orderInSession: number;
  isOmitted: boolean;
  performedOn: string | null;
  timeZone: string | null;
  availableSets: number;
  originalTargets: Readonly<
    Partial<Record<keyof RecordedTargets, EvidenceValue>>
  > | null;
  adjustedTargets: RecordedTargets;
}>;
export type PerformanceSet = Readonly<{
  id: string;
  workoutExerciseId: string;
  setNumber: number;
  version: number;
  status: WorkoutSetStatus | null;
  kind: WorkoutSetKind | null;
  isCompleted: boolean;
  load: string | null;
  loadUnit: MeasurementUnit | null;
  loadKg: string | null;
  repetitions: number | null;
  rpe: string | null;
  recordedAt: string;
}>;
export type HistoricalEstimate = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string;
  sourceSetId: string | null;
  sourceSetVersion: number | null;
  formula: OneRmFormula;
  algorithmVersion: string;
  eligibilityVersion: string | null;
  estimateKind: string | null;
  inputLoad: string;
  inputLoadUnit: MeasurementUnit | null;
  inputLoadKg: string | null;
  inputReps: number;
  result: string;
  resultUnit: MeasurementUnit | null;
  calculationKey: string | null;
  calculatedAt: string;
  snapshot: EvidenceValue;
}>;
export type PerformanceHistory = Readonly<{
  athleteId: string;
  userId: string;
  exerciseId: string;
  exerciseIsActive: boolean;
  tasks: readonly PerformanceTask[];
  sets: readonly PerformanceSet[];
  estimates: readonly HistoricalEstimate[];
  truncated: { tasks: boolean; sets: boolean; estimates: boolean };
}>;
export type PerformanceSetAnalysis = Readonly<{
  record: PerformanceSet;
  loadMeaning: LoadMeaning | null;
  meaningSource:
    'OWNER_DECLARATION_FOR_ANALYSIS' | 'PERSISTED_OWNER_DECLARATION' | null;
  validRepetitions: boolean;
  volumeStatus: 'INCLUDED' | 'EXCLUDED' | 'NOT_EVALUABLE';
  volumeKgRepetitions: string | null;
  rpe: string | null;
  reasons: readonly PerformanceReason[];
}>;
export type EstimatePoint = Readonly<{
  id: string;
  sourceSetId: string;
  workoutExerciseId: string;
  sessionId: string;
  performedOn: string | null;
  timeZone: string | null;
  calculatedAt: string;
  formula: OneRmFormula;
  algorithmVersion: string;
  eligibilityVersion: string;
  numericPolicyKey: string;
  resultKg: string;
  inputLoad: string;
  inputLoadUnit: MeasurementUnit;
  inputLoadKg: string;
  inputReps: number;
  warnings: readonly string[];
  evidenceStatus: 'NOT_ASSESSED';
  calculationKey: string;
}>;
export class PerformanceError extends Error {
  constructor(
    readonly code:
      'INVALID_QUERY' | 'SOURCE_NOT_FOUND' | 'TASK_NOT_IN_SELECTION',
  ) {
    super(code);
  }
}
