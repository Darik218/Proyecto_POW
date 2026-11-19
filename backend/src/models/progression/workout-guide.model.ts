import type { ReviewState } from './recommendation-review.model';
import type { RecordedTargets } from './performance-analysis.model';
import type {
  RecommendationCommand,
  RecommendationContext,
  Decision,
} from './recommendation-draft.model';
import type {
  PersistedRecommendation,
  RecommendationDraft,
} from './persisted-recommendation.model';
export type WorkoutGuideQuery = {
  activityId?: string;
  planDayId?: string;
  sessionId?: string;
  performedOn?: string;
  timeZone?: string;
};
export type GuideSet = {
  setNumber: number;
  load: string | null;
  loadUnit: 'KG' | 'LB' | null;
  repetitions: number | null;
  rpe: string | null;
  status: string | null;
  kind: string | null;
  isCompleted: boolean;
};
export type GuideHistoryTask = {
  sessionId: string;
  sessionStatus?: string | null;
  taskId: string;
  performedOn: string | null;
  timeZone: string | null;
  trainingPlanId?: string | null;
  planDayId?: string | null;
  planExerciseId?: string | null;
  sets: GuideSet[];
};
export type GuideProposal = {
  id: string;
  status: 'CURRENT' | 'REQUIRES_REVIEW';
  recommendedLoad: string | null;
  loadUnit: 'KG' | 'LB' | null;
  reasons: string[];
  href: string;
};
export type GuideCandidate = {
  proposal: PersistedRecommendation;
  command: RecommendationCommand | null;
  context: RecommendationContext | null;
  review: ReviewState | null;
};
export type GuideCalculation = {
  command: RecommendationCommand;
  context: RecommendationContext;
  source: 'VERIFIED_REPLAY' | 'EXPLICIT_PREVIEW';
  sourceId: string | null;
};
export type GuideSuggestion = {
  origin:
    | 'CALCULATED'
    | 'PERSISTED_PROPOSAL'
    | 'HISTORICAL_REFERENCE'
    | 'INSUFFICIENT_DATA';
  action: Decision;
  load: string | null;
  unit: 'KG' | 'LB' | null;
  reps: number | null;
  sets: number | null;
  reason: string;
  reasons: string[];
  policyVersion: string | null;
  executionAuthorized: false;
};
export type GuideExerciseSource = {
  id: string;
  exerciseId: string;
  name: string;
  position: number;
  prescriptionId: string | null;
  isOmitted: boolean;
  target: RecordedTargets;
  originalTarget: RecordedTargets | null;
  history: GuideHistoryTask[];
  historyTruncated: boolean;
  candidates: GuideCandidate[];
  calculations?: GuideCalculation[];
  configurationReasons?: string[];
  calculationContext?: GuideCalculationContext;
  repetitionContext?: GuideRepetitionContext;
  progressiveContext?: GuideRepetitionContext;
  repetitionSuggestion?: GuideSuggestion;
};
export type WorkoutGuidePreviewInput = {
  source: WorkoutGuideQuery;
  exerciseId: string;
  contextKey: string;
  gridStep: string;
  incrementMode: 'ABSOLUTE' | 'PERCENT';
  declaration: { sameVariant: true; sameEquipment: true; externalTotal: true };
  policyContract:
    'session-readiness-preview-v1' | 'session-load-compliance-preview-v1';
};
export type GuideCalculationContext = {
  contextKey: string | null;
  comparisonKey: string | null;
  ready: boolean;
  reasons: string[];
  setting: Pick<
    import('./recommendation-draft.model').StoredProgressionSetting,
    | 'minSuccessfulSessions'
    | 'targetRpeMin'
    | 'targetRpeMax'
    | 'incrementAbsolute'
    | 'incrementPercent'
    | 'maxIncrementPercent'
    | 'maxLoad'
  > | null;
  unit: 'KG' | 'LB' | null;
  incrementModes: ('ABSOLUTE' | 'PERCENT')[];
  tasks: {
    id: string;
    sessionId: string;
    performedOn: string | null;
    timeZone: string | null;
    status: string;
    sets: number;
  }[];
  policyContract: 'session-readiness-preview-v1';
  executionAuthorized: false;
};
export type WorkoutGuideSource = {
  kind: 'ACTIVITY' | 'PLAN_DAY' | 'SESSION';
  id: string;
  activityId: string | null;
  planDayId: string | null;
  sessionId: string | null;
  trainingPlanId: string | null;
  planWeekId: string | null;
  performedOn: string | null;
  timeZone: string | null;
  status: string;
  title: string | null;
};
export type WorkoutGuideSnapshot = {
  source: WorkoutGuideSource;
  status: 'TRAINABLE' | 'REST' | 'OMITTED' | 'UNAVAILABLE';
  now: Date;
  historyCutoffOn: string;
  exercises: GuideExerciseSource[];
};
export type GuideProposalAssessment = {
  proposal: PersistedRecommendation;
  command: RecommendationCommand | null;
  current: RecommendationDraft | null;
  target: RecordedTargets;
  prescriptionId: string | null;
  latestDate: string | null;
  now: Date;
  performedOn: string | null;
};

export type GuideRepetitionContext = {
  historyCutoffOn?: string;
  contextKey: string | null;
  comparisonKey: string | null;
  ready: boolean;
  reasons: string[];
  minimumSessions: number;
  minimumSource: 'PERSISTED_SETTING' | 'PLAN_BOUND_INITIAL_POLICY';
  baselineSource?: 'PRESCRIPTION' | 'RECORDED_HISTORY' | null;
  tasks: {
    id: string;
    sessionId: string;
    performedOn: string | null;
    timeZone: string | null;
  }[];
  policyContract:
    'session-repetition-preview-v1' | 'session-repetition-preview-v2';
  executionAuthorized: false;
};
// Internal provenance for the current occurrence; never an owner declaration.
export type GuideComparisonSourceEvidence = {
  occurrenceVersion: number | null;
  originalExerciseId: string | null;
  replacesWorkoutExerciseId: string | null;
  isOmitted: boolean;
};
export type WorkoutGuideRepetitionPreviewInput = {
  source: WorkoutGuideQuery;
  exerciseId: string;
  contextKey: string;
  declaration: {
    sameVariant: true;
    sameEquipment: true;
    sameLoadConvention: true;
  };
  policyContract:
    'session-repetition-preview-v1' | 'session-repetition-preview-v2';
};

export type GuidePreparationBlocker = {
  category:
    | 'evidence'
    | 'configuration'
    | 'policy'
    | 'comparability'
    | 'temporal'
    | 'math'
    | 'integration';
  code: string;
};
export type GuidePreparation = {
  stage:
    | 'PLAN_ONLY'
    | 'PLAN_WITH_REFERENCE'
    | 'REPETITION_READY'
    | 'REPETITION_DRAFT'
    | 'LOAD_DRAFT'
    | 'REVIEW_REQUIRED';
  plan: RecordedTargets;
  before: {
    performedOn: string;
    sessions: (GuideHistoryTask & {
      trainingPlanId: string | null;
      planDayId: string | null;
      planExerciseId: string | null;
      sessionStatus: string | null;
    })[];
    gapDays: number | null;
    scope: 'SAME_PLAN_DAY' | 'FREE_SESSION' | 'OTHER_CONTEXT';
  } | null;
  draft: {
    origin:
      | 'PLAN_TARGET'
      | 'HISTORICAL_REFERENCE'
      | 'CALCULATED'
      | 'PERSISTED_PROPOSAL';
    load: string | null;
    unit: 'KG' | 'LB' | null;
    reps: number | null;
    sets: number | null;
    executionAuthorized: false;
  } | null;
  why: string[];
  blockers: GuidePreparationBlocker[];
  diagnostics?: {
    repetition: { ready: boolean; reasons: GuidePreparationBlocker[] } | null;
    load: { ready: boolean; reasons: GuidePreparationBlocker[] } | null;
  };
  executionAuthorized: false;
};
