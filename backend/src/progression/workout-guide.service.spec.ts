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
        reasons: ['POLICY_PROVENANCE_REQUIRED'],
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
