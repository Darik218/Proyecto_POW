import type {
  PerformanceHistory,
  PerformanceQuery,
  RecordedTargets,
  ValidatedPerformanceQuery,
} from './performance-analysis.model';
import type {
  AssessmentOptions,
  TargetBasis,
} from './prescription-assessment.model';
export type LoadUnit = 'KG' | 'LB';
export type WeeklyPeriod = Readonly<{
  start: string;
  endExclusive: string;
  timeZone: string;
  cutoffOn: string;
  weekStartsOn: number;
}>;
export type Destination = Readonly<
  | {
      kind: 'PRESCRIPTION';
      planId: string;
      weekId: string;
      dayId: string | null;
      prescriptionId: string;
    }
  | { kind: 'WORKOUT_TASK'; taskId: string }
>;
export type RecommendationTarget = Readonly<{
  kind: Destination['kind'];
  taskId: string | null;
  planId: string | null;
  weekId: string | null;
  dayId: string | null;
  prescriptionId: string | null;
  planVersion: number | null;
  planStatus: string | null;
  retired: boolean;
  targets: RecordedTargets | null;
}>;
export type StoredProgressionSetting = Readonly<{
  id: string;
  athleteId: string;
  exerciseId: string | null;
  trainingPlanId: string | null;
  minSuccessfulSessions: number;
  targetRpeMin: string;
  targetRpeMax: string;
  incrementPercent: string | null;
  incrementAbsolute: string | null;
  maxIncrementPercent: string;
  maxLoad: string | null;
  autoApplyAuthorized: boolean;
  updatedAt: string;
}>;
export type RecommendationPolicy = Readonly<{
  id: string;
  version: string;
  provenance: { source: 'EXPLICIT_INTERNAL_POLICY'; reference: string };
  basis: TargetBasis;
  baseline: 'DESTINATION_PRESCRIPTION' | 'ANCHOR_ORIGINAL' | 'ANCHOR_ADJUSTED';
  cohort:
    | { mode: 'SAME_PRESCRIPTION' }
    | { mode: 'EXPLICIT_TASK_SET'; taskIds: readonly string[] };
  assessment: AssessmentOptions;
  settingRpeUse: 'REQUIRE_INTERVAL' | 'CONTEXT_ONLY_EXPLICIT';
  review: 'NOT_REQUIRED_EXPLICIT' | 'ANY_SIGNAL' | 'TEMPORAL_SIGNAL';
  oneRm: 'DESCRIPTIVE_CONTEXT_ONLY' | 'DECISION_CRITERION';
  requireClosedWeek: boolean;
  knowledge: 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF';
  loadMeaning: 'EXTERNAL_TOTAL' | 'UNKNOWN';
  settingLoadUnit?: LoadUnit;
  incrementMode?: 'ABSOLUTE' | 'PERCENT';
  grid: {
    unit: LoadUnit;
    step: string;
    origin: string;
    rounding: 'FLOOR';
    source: string;
  };
}>;
export type RecommendationCommand = Readonly<{
  history: PerformanceQuery;
  period: WeeklyPeriod;
  destination: Destination;
  expectedPlanVersion?: number;
  policy?: RecommendationPolicy;
}>;
export type ValidatedRecommendationCommand = Omit<
  RecommendationCommand,
  'history'
> & { history: ValidatedPerformanceQuery };
export type RecommendationContext = Readonly<{
  history: PerformanceHistory;
  settings: readonly StoredProgressionSetting[];
  target: RecommendationTarget;
}>;
export type Decision =
  | 'INCREASE'
  | 'MAINTAIN'
  | 'REVIEW_REQUIRED'
  | 'INSUFFICIENT_DATA'
  | 'CONFIGURATION_REQUIRED'
  | 'NO_REPRESENTABLE_INCREMENT';
export class RecommendationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_COMMAND'
      | 'INVALID_PERIOD'
      | 'SOURCE_NOT_FOUND'
      | 'NUMERIC_INPUT_INVALID',
  ) {
    super(code);
  }
}

export type RecommendationAssessment = ReturnType<
  typeof import('../../progression/assessment.service').assessHistory
>;
