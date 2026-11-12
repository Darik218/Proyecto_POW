import type { analyzePerformance } from '../../domain/progression/performance';
import type { LoadMeaning } from './one-rm-calculation.model';
import type { PerformanceQuery } from './performance-analysis.model';
export type PerformanceAnalysis = ReturnType<typeof analyzePerformance>;
export type AssessedTask = PerformanceAnalysis['tasks'][number];
export type TargetBasis = 'ORIGINAL' | 'ADJUSTED';
export type AssessmentStatus =
  'AVAILABLE' | 'PARTIAL' | 'NOT_EVALUABLE' | 'CONFIGURATION_REQUIRED';
export type CriterionResult =
  | 'SATISFIED'
  | 'PARTIAL'
  | 'NOT_MET'
  | 'NOT_EVALUABLE'
  | 'CONFIGURATION_REQUIRED';
// Explicit caller policies; their existence does not authorize progression.
export type ComplianceRule = Readonly<{
  repetitions: 'MINIMUM' | 'UPPER_BOUND';
  load: 'IGNORE' | 'AT_LEAST_TARGET' | 'EXACT_TARGET' | 'IF_PRESENT_AT_LEAST';
  rpe:
    | 'DESCRIBE'
    | 'AT_MOST_TARGET'
    | Readonly<{ minimum: string; maximum: string }>;
  coverage: 'ALL_REQUIRED';
}>;
export type TaskSlots = Readonly<{
  originalLoadMeaning?: LoadMeaning;
  adjustedLoadMeaning?: LoadMeaning;
  taskId: string;
  original: readonly number[];
  adjusted: readonly number[];
}>;
export type CompliancePolicy = Readonly<{
  id: string;
  slots: readonly TaskSlots[];
  basic?: ComplianceRule;
  readiness?: ComplianceRule;
}>;
export type SignalPolicy = Readonly<{
  id: string;
  basis: TargetBasis;
  rpeComparison: 'STRICT_PROG2' | 'MATCHED_LOAD_DESCRIPTIVE';
  referenceSize: number;
  rpeThreshold: string;
  performanceThresholdPercent: string;
  minimumRpeCoveragePercent: string;
}>;
export type CountPolicy = Readonly<{
  id: string;
  basis: TargetBasis;
  criterion: 'BASIC' | 'READINESS';
  mode: 'ACCUMULATED' | 'CONSECUTIVE';
  sameDate: 'DISTINCT_SESSIONS' | 'DISTINCT_DATES';
  minimumSessions: number;
  anchorTaskId: string;
}>;
export type PersistencePolicy = Readonly<{ id: string; k: number; m: number }>;
export type AssessmentOptions = Readonly<{
  compliance?: CompliancePolicy;
  signal?: SignalPolicy;
  count?: CountPolicy;
  persistence?: PersistencePolicy;
}>;
export type AssessmentQuery = Readonly<{
  history: PerformanceQuery;
  policy?: AssessmentOptions;
}>;
export type SignalObservation = Readonly<{
  policyKey: string | null;
  basis: TargetBasis | null;
  currentTaskId: string;
  referenceTaskIds: readonly string[];
  sessionId: string;
  performedOn: string | null;
  timeZone: string | null;
  status: AssessmentStatus;
  reasons: readonly string[];
  reviewSignal: boolean | null;
  currentRpe: string | null;
  referenceRpe: string | null;
  currentPerformance: string | null;
  referencePerformance: string | null;
  deltaRpe: string | null;
  deltaPerformancePercent: string | null;
  coveragePercent: string | null;
  positions: readonly number[];
}>;
export class AssessmentError extends Error {
  constructor(readonly code: 'INVALID_POLICY' | 'TASK_NOT_IN_SELECTION') {
    super(code);
  }
}
