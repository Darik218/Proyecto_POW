import type {
  RecommendationCommand,
  RecommendationContext,
  RecommendationPolicy,
  StoredProgressionSetting,
} from '../../src/models/progression/recommendation-draft.model';
import { task, set, policy as compliance } from './assessment-fixtures';
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export const setting = (id = 'setting'): Mutable<StoredProgressionSetting> => ({
  id,
  athleteId: 'athlete',
  exerciseId: null,
  trainingPlanId: null,
  minSuccessfulSessions: 2,
  targetRpeMin: '6',
  targetRpeMax: '8',
  incrementPercent: null,
  incrementAbsolute: '2.5',
  maxIncrementPercent: '10',
  maxLoad: null,
  autoApplyAuthorized: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
});
export const recommendationPolicy = (): Mutable<RecommendationPolicy> => ({
  id: 'fixture-policy',
  version: 'fixture-v1',
  provenance: {
    source: 'EXPLICIT_INTERNAL_POLICY',
    reference: 'test-only-not-a-default',
  },
  basis: 'ADJUSTED',
  baseline: 'ANCHOR_ADJUSTED',
  cohort: { mode: 'EXPLICIT_TASK_SET', taskIds: ['a', 'b'] },
  assessment: {
    compliance: {
      ...compliance(['a', 'b']),
      slots: compliance(['a', 'b']).slots.map((s) => ({
        ...s,
        original: [...s.original],
        adjusted: [...s.adjusted],
      })),
      readiness: {
        repetitions: 'UPPER_BOUND',
        load: 'AT_LEAST_TARGET',
        rpe: { minimum: '6', maximum: '8' },
        coverage: 'ALL_REQUIRED',
      },
    },
    count: {
      id: 'count',
      basis: 'ADJUSTED',
      criterion: 'BASIC',
      mode: 'ACCUMULATED',
      sameDate: 'DISTINCT_SESSIONS',
      minimumSessions: 2,
      anchorTaskId: 'b',
    },
  },
  settingRpeUse: 'REQUIRE_INTERVAL',
  review: 'NOT_REQUIRED_EXPLICIT',
  oneRm: 'DESCRIPTIVE_CONTEXT_ONLY',
  requireClosedWeek: true,
  knowledge: 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF',
  loadMeaning: 'EXTERNAL_TOTAL',
  settingLoadUnit: 'KG',
  grid: {
    unit: 'KG',
    step: '2.5',
    origin: '0',
    rounding: 'FLOOR',
    source: 'test-only-grid',
  },
});
export const command = (): Mutable<RecommendationCommand> => ({
  history: {
    exerciseId: 'exercise',
    from: '2026-01-01',
    to: '2026-01-11',
    timeZone: 'UTC',
    limit: 100,
    contexts: ['a', 'b'].map((workoutExerciseId) => ({
      workoutExerciseId,
      loadMeaning: 'EXTERNAL_TOTAL',
      protocolKey: 'p',
      equipmentKey: 'e',
      source: 'OWNER_DECLARATION_FOR_ANALYSIS',
    })),
    comparisons: [{ previousTaskId: 'a', currentTaskId: 'b' }],
  },
  period: {
    start: '2026-01-05',
    endExclusive: '2026-01-12',
    timeZone: 'UTC',
    cutoffOn: '2026-01-11',
    weekStartsOn: 1,
  },
  destination: { kind: 'WORKOUT_TASK', taskId: 'b' },
  policy: recommendationPolicy(),
});
export const context = (): Mutable<RecommendationContext> => ({
  history: {
    athleteId: 'athlete',
    userId: 'user',
    exerciseId: 'exercise',
    exerciseIsActive: true,
    tasks: JSON.parse(
      JSON.stringify([task('a', '2026-01-05'), task('b', '2026-01-06')]),
    ),
    sets: JSON.parse(JSON.stringify([set('a'), set('b')])),
    estimates: [],
    truncated: { tasks: false, sets: false, estimates: false },
  },
  settings: [setting()],
  target: {
    kind: 'WORKOUT_TASK',
    taskId: 'b',
    planId: null,
    weekId: null,
    dayId: null,
    prescriptionId: null,
    planVersion: null,
    planStatus: null,
    retired: false,
    targets: null,
  },
});
