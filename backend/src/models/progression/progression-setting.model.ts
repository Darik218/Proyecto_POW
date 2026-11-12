import type {
  RecommendationPolicy,
  StoredProgressionSetting,
} from './recommendation-draft.model';
export type SettingParameters = Readonly<{
  minSuccessfulSessions: number;
  targetRpeMin: string;
  targetRpeMax: string;
  incrementPercent: string | null;
  incrementAbsolute: string | null;
  maxIncrementPercent: string;
  maxLoad: string | null;
}>;
export type SettingScope = Readonly<{
  exerciseId: string | null;
  trainingPlanId: string | null;
}>;
export type SettingRecord = StoredProgressionSetting &
  Readonly<{
    revision: string;
    createdAt: string;
    exerciseName: string | null;
    planName: string | null;
  }>;
export type SettingContext = Readonly<{
  exerciseId: string;
  trainingPlanId: string | null;
  policy?: RecommendationPolicy;
}>;
export type SettingResolution = Readonly<{
  context: { exerciseId: string; trainingPlanId: string | null };
  scope: 'ATHLETE' | 'EXERCISE' | 'EXERCISE_PLAN' | null;
  selected: SettingRecord | null;
  status: 'VALID' | 'CONFIGURATION_REQUIRED';
  reasons: readonly string[];
  settingReasons: readonly string[];
  externalRequirements: readonly string[];
  policyProvided: boolean;
  mode: 'ABSOLUTE' | 'PERCENT' | null;
}>;
export type SettingOperation = Readonly<{
  action: 'CREATE' | 'REPLACE';
  intentId: string;
  settingId?: string;
  expectedRevision?: string;
  scope?: SettingScope;
  parameters: SettingParameters;
  requestKey: string;
}>;
export type SettingReceipt = Readonly<{
  id: string;
  settingId: string;
  intentId: string;
  action: 'CREATE' | 'REPLACE';
  beforeRevision: string | null;
  revision: string;
  result: SettingRecord;
  effective: SettingResolution | null;
  recordedAt: string;
}>;
export type SettingList = Readonly<{
  items: readonly SettingRecord[];
  total: number;
  page: number;
  limit: number;
}>;
export type SettingImpact = Readonly<{
  settingId: string;
  expectedRevision: string;
  parametersChanged: boolean;
  recommendationIds: readonly string[];
  recommendationRevisionChanges: boolean;
  consents: readonly {
    id: string;
    state: string;
    compatibility: 'UNCHANGED' | 'REQUIRES_REEVALUATION' | 'UNAVAILABLE';
    challengeMayBeStale: boolean;
  }[];
  coverage: 'COMPLETE' | 'TRUNCATED';
  warnings: readonly string[];
}>;
export class ProgressionSettingError extends Error {
  constructor(
    readonly code:
      | 'INVALID_SETTING'
      | 'AUTHENTICATION_REQUIRED'
      | 'SOURCE_NOT_FOUND'
      | 'SETTING_SCOPE_EXISTS'
      | 'STALE_SETTING'
      | 'INTENT_REUSED'
      | 'SOURCE_BUSY'
      | 'SETTING_CORRUPT',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}
