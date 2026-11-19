import { WorkoutGuideService } from './workout-guide.service';
import { context, command } from '../../test/helpers/recommendation-fixtures';
import type { WorkoutGuideSnapshot } from '../models/progression/workout-guide.model';
import type { AuthenticatedIdentity } from '../auth/auth.types';
const identity = {
  account: { id: 'user' },
  sessionId: 'auth',
} as AuthenticatedIdentity;
function fixture() {
  const c = command(),
    h = context();
  c.destination = {
    kind: 'PRESCRIPTION',
    planId: 'plan',
    weekId: 'week',
    dayId: 'day',
    prescriptionId: 'p',
  };
  c.policy!.baseline = 'DESTINATION_PRESCRIPTION';
  h.target = {
    ...h.target,
    kind: 'PRESCRIPTION',
    taskId: null,
    planId: 'plan',
    weekId: 'week',
    dayId: 'day',
    prescriptionId: 'p',
    planVersion: 1,
    planStatus: 'DRAFT',
    targets: { ...h.history.tasks[1].adjustedTargets },
  };
  const exercise = {
    id: 'p',
    exerciseId: 'exercise',
    name: 'Press',
    position: 1,
    prescriptionId: 'p',
    isOmitted: false,
    target: { ...h.history.tasks[1].adjustedTargets },
    originalTarget: null,
    history: h.history.tasks.map((t) => ({
      taskId: t.id,
      sessionId: t.sessionId,
      performedOn: t.performedOn,
      timeZone: t.timeZone,
      sets: h.history.sets
        .filter((s) => s.workoutExerciseId === t.id)
        .map((s) => ({ ...s })),
    })),
    historyTruncated: false,
    candidates: [],
    calculations: [
      {
        command: c,
        context: h,
        source: 'VERIFIED_REPLAY' as const,
        sourceId: 'recipe',
      },
    ],
    configurationReasons: [] as string[],
  };
  const snapshot = {
    status: 'TRAINABLE',
    now: new Date('2026-01-14'),
    historyCutoffOn: '2026-01-14',
    source: {
      kind: 'PLAN_DAY',
      id: 'day',
      activityId: null,
      planDayId: 'day',
      sessionId: null,
      trainingPlanId: 'plan',
      planWeekId: 'week',
      performedOn: '2026-01-14',
      timeZone: 'UTC',
      status: 'DRAFT',
      title: 'Day',
    },
    exercises: [exercise],
  };
  const service = new WorkoutGuideService({
    read: async () => snapshot as WorkoutGuideSnapshot,
  });
  return { c, h, snapshot, exercise, service };
}
const read = (f: ReturnType<typeof fixture>) =>
  f.service.forMyWorkout(identity, {
    activityId: '00000000-0000-4000-8000-000000000001',
  });
describe('on-demand workout recommendations', () => {
  it('calculates a fresh load without a persisted destination proposal and preserves every source', async () => {
    const f = fixture(),
      before = JSON.stringify(f.snapshot),
      result = await read(f);
    expect(result.exercises[0]).toMatchObject({
      proposal: null,
      guidanceSuggested: {
        origin: 'CALCULATED',
        action: 'INCREASE',
        load: '82.500000',
        unit: 'KG',
        sets: 1,
        reps: 6,
        policyVersion: 'fixture-v1',
        executionAuthorized: false,
      },
    });
    expect(JSON.stringify(f.snapshot)).toBe(before);
    f.h.settings[0].incrementAbsolute = '5';
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: { origin: 'CALCULATED', load: '85.000000' },
    });
  });
  it('uses a historical reference when no declared policy exists, with no copied numeric suggestion', async () => {
    const f = fixture();
    f.exercise.calculations = [];
    f.exercise.configurationReasons = ['POLICY_PROVENANCE_REQUIRED'];
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        origin: 'HISTORICAL_REFERENCE',
        action: 'CONFIGURATION_REQUIRED',
        load: null,
        reps: null,
        sets: null,
        reasons: ['POLICY_PROVENANCE_REQUIRED', 'CONTEXTUAL_HISTORY_ONLY'],
      },
    });
  });
  it('requires configuration even when an explicit policy exists without settings', async () => {
    const f = fixture();
    f.h.settings = [];
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        action: 'CONFIGURATION_REQUIRED',
        load: null,
        reasons: expect.arrayContaining(['SETTING_REQUIRED']),
      },
    });
  });
  it('keeps no history and one-session evidence distinct from a valid increase', async () => {
    const empty = fixture();
    empty.exercise.history = [];
    empty.h.history.tasks = [];
    empty.h.history.sets = [];
    expect((await read(empty)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        origin: 'INSUFFICIENT_DATA',
        action: 'INSUFFICIENT_DATA',
        load: null,
      },
    });
    const one = fixture();
    one.h.history.tasks.shift();
    one.h.history.sets.shift();
    one.exercise.history.shift();
    expect((await read(one)).exercises[0]).toMatchObject({
      guidanceSuggested: { action: 'INSUFFICIENT_DATA', load: null },
    });
  });
  it.each([
    'effort',
    'unit',
    'exercise',
    'newer',
    'same-day',
    'truncated',
  ] as const)('withholds numeric advice for %s evidence', async (mode) => {
    const f = fixture();
    if (mode === 'effort') f.h.history.sets[1].rpe = '11';
    if (mode === 'unit') f.h.history.sets[1].loadUnit = null;
    if (mode === 'exercise') f.h.history.exerciseId = 'other';
    if (mode === 'newer')
      f.exercise.history.push({
        ...f.exercise.history[1],
        taskId: 'c',
        sessionId: 'c',
        performedOn: '2026-01-13',
      });
    if (mode === 'same-day')
      f.exercise.history.push({
        ...f.exercise.history[1],
        taskId: 'c',
        sessionId: 'c',
        performedOn: '2026-01-14',
      });
    if (mode === 'truncated') f.exercise.historyTruncated = true;
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        action: 'INSUFFICIENT_DATA',
        load: null,
        reps: null,
        sets: null,
      },
    });
  });
  it.each(['2026-02-10', '2026-09-01'])(
    'requires review outside the weekly preview scope for %s without inventing a loss',
    async (performedOn) => {
      const f = fixture();
      f.snapshot.source.performedOn = performedOn;
      f.snapshot.historyCutoffOn = performedOn;
      expect((await read(f)).exercises[0]).toMatchObject({
        guidanceSuggested: {
          origin: 'HISTORICAL_REFERENCE',
          action: 'REVIEW_REQUIRED',
          load: null,
          reps: null,
          sets: null,
          reasons: expect.arrayContaining(['REFERENCE_OUTSIDE_PREVIEW_PERIOD']),
        },
      });
    },
  );
  it('keeps the whole immediately previous civil week eligible, including its Sunday boundary', async () => {
    const f = fixture();
    f.snapshot.source.performedOn = '2026-01-18';
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: { action: 'INCREASE', load: '82.500000' },
    });
    f.snapshot.source.performedOn = '2026-01-19';
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        action: 'REVIEW_REQUIRED',
        load: null,
        reasons: expect.arrayContaining(['REFERENCE_OUTSIDE_PREVIEW_PERIOD']),
      },
    });
  });
});

describe('progressive exercise preparation', () => {
  function mixedReference() {
    const f = fixture();
    f.exercise.calculations = [];
    Object.assign(f.exercise.target, {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetLoad: null,
      targetLoadUnit: null,
    });
    f.exercise.history = f.exercise.history.map((task) => ({
      ...task,
      sessionStatus: 'COMPLETED',
      trainingPlanId: f.snapshot.source.trainingPlanId,
      planDayId: f.snapshot.source.planDayId,
      planExerciseId: f.exercise.prescriptionId,
      sets: [9, 12, 11].map((repetitions, index) => ({
        ...task.sets[0],
        setNumber: [3, 1, 2][index],
        repetitions,
        load: '60.000',
        loadUnit: 'KG',
      })),
    }));
    Object.assign(f.exercise, {
      progressiveContext: { ready: false, reasons: ['MINIMUM_NOT_REACHED'] },
    });
    return f;
  }
  it('keeps a full same-prescription record as a descriptive per-set draft while the minimum is unmet', async () => {
    const f = mixedReference();
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: { origin: 'HISTORICAL_REFERENCE', load: null },
      preparation: {
        stage: 'PLAN_WITH_REFERENCE',
        draft: {
          origin: 'HISTORICAL_REFERENCE',
          load: '60.000',
          unit: 'KG',
          sets: 3,
          reps: null,
          repsBySet: [12, 11, 9],
          executionAuthorized: false,
        },
      },
    });
  });
  it.each(['same-day other prescription', 'other day', 'free session'])(
    'shows %s without auto-copying it into the plan draft',
    async (scope) => {
      const f = mixedReference();
      for (const task of f.exercise.history) {
        Object.assign(task, {
          planExerciseId:
            scope === 'free session' ? null : 'another-prescription',
          planDayId:
            scope === 'same-day other prescription'
              ? 'day'
              : scope === 'other day'
                ? 'another-day'
                : null,
          trainingPlanId: scope === 'free session' ? null : 'plan',
        });
        for (const set of task.sets) set.repetitions = 9;
      }
      expect((await read(f)).exercises[0]).toMatchObject({
        guidanceSuggested: { origin: 'HISTORICAL_REFERENCE', load: null },
        preparation: {
          before: { performedOn: '2026-01-06' },
          draft: { origin: 'PLAN_TARGET', load: null, reps: 8 },
        },
      });
    },
  );

  it('provides a practical plan draft without claiming a calculation when there is no history', async () => {
    const f = fixture();
    f.exercise.history = [];
    f.exercise.calculations = [];
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'PLAN_ONLY',
        plan: f.exercise.target,
        before: null,
        draft: {
          origin: 'PLAN_TARGET',
          load: '80',
          unit: 'KG',
          reps: 5,
          sets: 1,
          executionAuthorized: false,
        },
        executionAuthorized: false,
      },
    });
  });
  it('keeps actual no-effort history next to a useful plan draft while respecting a configured minimum', async () => {
    const f = fixture();
    f.exercise.calculations = [];
    Object.assign(f.exercise, {
      progressiveContext: {
        ready: false,
        reasons: ['MINIMUM_NOT_REACHED'],
        minimumSessions: 3,
      },
    });
    f.exercise.history.forEach((t) =>
      t.sets.forEach((s) => {
        s.rpe = null;
      }),
    );
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'PLAN_WITH_REFERENCE',
        before: { performedOn: '2026-01-06' },
        draft: { origin: 'PLAN_TARGET', load: '80', reps: 5 },
        blockers: expect.arrayContaining([
          { category: 'evidence', code: 'MINIMUM_NOT_REACHED' },
        ]),
      },
    });
  });
  it('separates declaration-ready repetition preparation from explicitly calculated guidance', async () => {
    const f = fixture();
    f.exercise.calculations = [];
    Object.assign(f.exercise, {
      progressiveContext: { ready: true, reasons: [], minimumSessions: 2 },
    });
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'REPETITION_READY',
        draft: { origin: 'PLAN_TARGET' },
        blockers: expect.arrayContaining([
          {
            category: 'comparability',
            code: 'COMPARABILITY_DECLARATION_REQUIRED',
          },
        ]),
      },
    });
    const result = await read(f);
    expect(result.exercises[0].guidanceSuggested.origin).toBe(
      'HISTORICAL_REFERENCE',
    );
  });
  it('withholds the practical draft when records conflict or the reference is outside the preview period', async () => {
    const f = fixture();
    f.exercise.calculations = [];
    Object.assign(f.exercise, {
      progressiveContext: {
        ready: false,
        reasons: ['HISTORY_REPETITIONS_INCONSISTENT'],
      },
    });
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'REVIEW_REQUIRED',
        draft: null,
        blockers: expect.arrayContaining([
          { category: 'evidence', code: 'HISTORY_REPETITIONS_INCONSISTENT' },
        ]),
      },
    });
    f.snapshot.source.performedOn = '2026-09-01';
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'REVIEW_REQUIRED',
        draft: null,
        blockers: expect.arrayContaining([
          { category: 'temporal', code: 'REFERENCE_OUTSIDE_PREVIEW_PERIOD' },
        ]),
      },
    });
  });
  it('reports failed load grid math separately while comparable repetition preparation remains usable', async () => {
    const f = fixture();
    f.c.policy!.grid.step = '1000';
    Object.assign(f.exercise, {
      progressiveContext: { ready: true, reasons: [] },
      calculationContext: { ready: true, reasons: [] },
    });
    expect((await read(f)).exercises[0]).toMatchObject({
      guidanceSuggested: {
        action: 'NO_REPRESENTABLE_INCREMENT',
        load: null,
        reasons: expect.arrayContaining(['GRID_HAS_NO_POSITIVE_INCREMENT']),
      },
      preparation: {
        stage: 'REPETITION_READY',
        draft: { origin: 'PLAN_TARGET', load: '80' },
        diagnostics: {
          repetition: { ready: true, reasons: [] },
          load: {
            ready: false,
            reasons: expect.arrayContaining([
              { category: 'math', code: 'GRID_HAS_NO_POSITIVE_INCREMENT' },
            ]),
          },
        },
      },
    });
  });
  it('requires review for unordered same-day records instead of presenting them as a first baseline', async () => {
    const f = fixture();
    f.exercise.calculations = [];
    f.exercise.history.forEach((task) => {
      task.performedOn = f.snapshot.source.performedOn;
    });
    Object.assign(f.exercise, {
      progressiveContext: { ready: false, reasons: ['NO_ELIGIBLE_HISTORY'] },
    });
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'REVIEW_REQUIRED',
        draft: null,
        blockers: expect.arrayContaining([
          { category: 'temporal', code: 'SAME_DAY_NOT_ORDERED' },
        ]),
      },
    });
  });
  it('exposes an existing eligible load calculation as a draft without writing or authorizing execution', async () => {
    const f = fixture();
    Object.assign(f.exercise, {
      progressiveContext: {
        ready: false,
        reasons: ['HISTORY_REPETITIONS_INCONSISTENT'],
      },
    });
    const before = JSON.stringify(f.snapshot);
    expect((await read(f)).exercises[0]).toMatchObject({
      preparation: {
        stage: 'LOAD_DRAFT',
        draft: {
          origin: 'CALCULATED',
          load: '82.500000',
          reps: 6,
          sets: 1,
          executionAuthorized: false,
        },
      },
    });
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });
});
