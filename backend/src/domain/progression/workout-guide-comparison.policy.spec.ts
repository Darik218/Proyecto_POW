import { context } from '../../../test/helpers/recommendation-fixtures';
import type { WorkoutGuideSource } from '../../models/progression/workout-guide.model';
import { prepareGuideCalculationContext } from './workout-guide-preview.policy';
import { prepareRepetitionContext } from './workout-repetition-preview.policy';

function fixture() {
  const c = context();
  c.target = {
    ...c.target,
    kind: 'PRESCRIPTION',
    taskId: null,
    prescriptionId: 'p',
    planId: 'plan',
    weekId: 'week',
    dayId: 'day',
    planVersion: 1,
    targets: { ...c.history.tasks[0].adjustedTargets },
  };
  c.history.tasks.forEach((t) => {
    t.planExerciseId = 'p';
  });
  const source: WorkoutGuideSource = {
    kind: 'ACTIVITY',
    id: 'activity',
    activityId: 'activity',
    sessionId: null,
    planDayId: 'day',
    trainingPlanId: 'plan',
    planWeekId: 'week',
    performedOn: '2026-01-14',
    timeZone: 'UTC',
    status: 'PLANNED',
    title: 'Day',
  };
  const provenance = {
    occurrenceVersion: 0 as number | null,
    originalExerciseId: 'exercise',
    replacesWorkoutExerciseId: null as string | null,
    isOmitted: false,
  };
  const rep = (s = source) =>
    prepareRepetitionContext(c, s, '2026-01-14', c.target.targets, provenance);
  const load = (s = source) =>
    prepareGuideCalculationContext(
      c,
      s,
      '2026-01-14',
      c.target.targets,
      provenance,
    );
  return { c, source, provenance, rep, load };
}
describe('narrow authoritative workout comparison identity', () => {
  it('shares exact evidence between methods and from a scheduled activity to its session', () => {
    const f = fixture(),
      original = f.rep();
    const session = {
      ...f.source,
      kind: 'SESSION' as const,
      id: 'session',
      sessionId: 'session',
      status: 'IN_PROGRESS',
      title: 'Renamed',
    };
    expect(original.comparisonKey).toMatch(/^[a-f0-9]{64}$/);
    expect(f.load().comparisonKey).toBe(original.comparisonKey);
    expect(f.rep(session).comparisonKey).toBe(original.comparisonKey);
    expect(f.load(session).comparisonKey).toBe(original.comparisonKey);
    expect(f.rep(session).contextKey).not.toBe(original.contextKey);
  });
  it('separates physical occurrences even for the same plan prescription and names', () => {
    const f = fixture(),
      key = f.rep().comparisonKey;
    expect(
      f.rep({ ...f.source, id: 'other', activityId: 'other' }).comparisonKey,
    ).not.toBe(key);
    const a = {
      ...f.source,
      kind: 'SESSION' as const,
      id: 'a',
      activityId: null,
      sessionId: 'a',
    };
    const b = { ...a, id: 'b', sessionId: 'b' };
    expect(f.rep(a).comparisonKey).not.toBe(f.rep(b).comparisonKey);
    expect(
      f.rep({ ...f.source, kind: 'PLAN_DAY', id: 'day', activityId: null })
        .comparisonKey,
    ).not.toBe(key);
  });
  it('keeps a standalone session comparison stable for current recording and notes while retaining evidence versions', () => {
    const f = fixture();
    f.provenance.occurrenceVersion = null;
    const session = {
      ...f.source,
      kind: 'SESSION' as const,
      id: 'session',
      activityId: null,
      sessionId: 'session',
      status: 'PLANNED',
    };
    const original = f.rep(session).comparisonKey;
    // Current-session records are excluded from historical comparison; only
    // descriptive lifecycle fields can differ in this pure input.
    expect(
      f.rep({ ...session, status: 'IN_PROGRESS', title: 'Notes edited' })
        .comparisonKey,
    ).toBe(original);
    f.c.history.tasks[0].sessionVersion++;
    expect(f.rep(session).comparisonKey).not.toBe(original);
  });
  it.each([
    [
      'athlete',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.athleteId = 'other';
      },
    ],
    [
      'exercise variant',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.exerciseId = 'other';
      },
    ],
    [
      'substitution',
      (f: ReturnType<typeof fixture>) => {
        f.provenance.replacesWorkoutExerciseId = 'old';
      },
    ],
    [
      'original variant',
      (f: ReturnType<typeof fixture>) => {
        f.provenance.originalExerciseId = 'old';
      },
    ],
    [
      'activity revision',
      (f: ReturnType<typeof fixture>) => {
        f.provenance.occurrenceVersion =
          (f.provenance.occurrenceVersion ?? 0) + 1;
      },
    ],
    [
      'date',
      (f: ReturnType<typeof fixture>) => {
        f.source.performedOn = '2026-01-15';
      },
    ],
    [
      'zone',
      (f: ReturnType<typeof fixture>) => {
        f.source.timeZone = 'America/Bogota';
      },
    ],
    [
      'plan version',
      (f: ReturnType<typeof fixture>) => {
        f.c.target.planVersion = 2;
      },
    ],
    [
      'destination',
      (f: ReturnType<typeof fixture>) => {
        f.c.target.dayId = 'other';
      },
    ],
    [
      'targets',
      (f: ReturnType<typeof fixture>) => {
        f.c.target.targets!.targetLoad = '90';
      },
    ],
    [
      'setting',
      (f: ReturnType<typeof fixture>) => {
        f.c.settings[0].updatedAt = '2026-01-02';
      },
    ],
    [
      'minimum',
      (f: ReturnType<typeof fixture>) => {
        f.c.settings[0].minSuccessfulSessions = 1;
      },
    ],
    [
      'task version',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.tasks[0].sessionVersion++;
      },
    ],
    [
      'set version',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].version++;
      },
    ],
    [
      'unit',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].loadUnit = 'LB';
      },
    ],
    [
      'load',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].load = '81';
      },
    ],
    [
      'repetitions',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].repetitions = 7;
      },
    ],
    [
      'effort',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].rpe = '9';
      },
    ],
    [
      'set classification',
      (f: ReturnType<typeof fixture>) => {
        f.c.history.sets[0].kind = 'WARMUP';
      },
    ],
  ])('invalidates on changed %s evidence', (_name, mutate) => {
    const f = fixture(),
      before = f.rep().comparisonKey;
    mutate(f);
    expect(f.rep().comparisonKey).not.toBe(before);
  });
  it('binds current source targets independently of prescription targets', () => {
    const f = fixture();
    expect(
      prepareRepetitionContext(
        f.c,
        f.source,
        '2026-01-14',
        { ...f.c.target.targets!, targetLoadUnit: 'LB' },
        f.provenance,
      ).comparisonKey,
    ).not.toBe(f.rep().comparisonKey);
  });
  it('does not share a declaration when repetition and load cohorts differ', () => {
    const f = fixture();
    f.c.settings[0].minSuccessfulSessions = 1;
    expect(f.rep().tasks).toHaveLength(1);
    expect(f.load().tasks).toHaveLength(2);
    expect(f.rep().comparisonKey).not.toBe(f.load().comparisonKey);
    const key = f.rep().comparisonKey;
    f.c.history.sets[0].version++;
    expect(f.rep().comparisonKey).toBe(key);
    f.c.history.tasks.push({
      ...f.c.history.tasks[1],
      id: 'new',
      sessionId: 'new-session',
      performedOn: '2026-01-10',
    });
    expect(f.rep().comparisonKey).not.toBe(key);
  });
  it('is independent of input row ordering and includes no clock or random salt', () => {
    const f = fixture(),
      before = JSON.stringify(f.c),
      key = f.load().comparisonKey;
    f.c.history.tasks.reverse();
    f.c.history.sets.reverse();
    expect(f.load().comparisonKey).toBe(key);
    f.c.history.tasks.reverse();
    f.c.history.sets.reverse();
    expect(JSON.stringify(f.c)).toBe(before);
  });
  it('withholds identity when comparison records or physical occurrence are absent', () => {
    const f = fixture();
    f.c.history.tasks = [];
    expect(f.rep().comparisonKey).toBeNull();
    expect(f.load().comparisonKey).toBeNull();
  });
});
