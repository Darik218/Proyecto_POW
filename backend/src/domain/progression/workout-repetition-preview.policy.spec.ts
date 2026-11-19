import { context } from '../../../test/helpers/recommendation-fixtures';
import type { WorkoutGuideSource } from '../../models/progression/workout-guide.model';
import {
  prepareRepetitionContext,
  repetitionPreview,
} from './workout-repetition-preview.policy';
function fixture() {
  const c = context();
  c.target = {
    ...c.target,
    kind: 'PRESCRIPTION',
    prescriptionId: 'p',
    planId: 'plan',
    targets: {
      ...c.history.tasks[0].adjustedTargets,
      targetRepsMin: 6,
      targetRepsMax: 10,
    },
  };
  c.history.tasks = c.history.tasks.map((t) => ({
    ...t,
    planExerciseId: 'p',
    adjustedTargets: { ...c.target.targets! },
  }));
  c.history.sets = c.history.sets.map((s) => ({
    ...s,
    repetitions: 8,
    rpe: null,
  }));
  const source = {
    kind: 'PLAN_DAY',
    id: 'day',
    performedOn: '2026-01-14',
    timeZone: 'UTC',
  } as WorkoutGuideSource;
  const prepared = () => prepareRepetitionContext(c, source, '2026-01-14');
  const calculate = () =>
    repetitionPreview(c, source, prepared(), {
      source: { planDayId: 'day' },
      exerciseId: 'exercise',
      contextKey: prepared().contextKey!,
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
      policyContract: 'session-repetition-preview-v1',
    });
  return { c, source, prepared, calculate };
}
describe('optional plan-bound repetition preview without subjective effort', () => {
  it('uses actual successful sessions to propose one repetition inside the existing range with unchanged load and sets', () => {
    const f = fixture(),
      before = JSON.stringify(f.c);
    expect(f.calculate()).toMatchObject({
      origin: 'CALCULATED',
      action: 'MAINTAIN',
      load: '80.000000',
      unit: 'KG',
      reps: 9,
      sets: 1,
      policyVersion: 'session-repetition-preview-v1',
      executionAuthorized: false,
      reasons: expect.arrayContaining([
        'REPETITION_TARGET_ADVANCE',
        'EFFORT_NOT_REQUIRED_BY_POLICY',
      ]),
    });
    expect(JSON.stringify(f.c)).toBe(before);
  });
  it('uses one complete reference only under explicit plan-bound initial policy when no setting exists', () => {
    const f = fixture();
    f.c.settings = [];
    f.c.history.tasks.shift();
    f.c.history.sets.shift();
    expect(f.prepared()).toMatchObject({
      ready: true,
      minimumSessions: 1,
      minimumSource: 'PLAN_BOUND_INITIAL_POLICY',
    });
    expect(f.calculate().reps).toBe(9);
  });
  it('uses a uniform explicitly recorded nominal load when the plan did not prescribe a load', () => {
    const f = fixture();
    f.c.settings = [];
    f.c.target.targets!.targetLoad = null;
    f.c.target.targets!.targetLoadUnit = null;
    f.c.history.tasks.forEach((t) => {
      t.adjustedTargets.targetLoad = null;
      t.adjustedTargets.targetLoadUnit = null;
    });
    f.c.history.sets.forEach((s) => {
      s.load = '40';
      s.loadUnit = 'KG';
      s.loadKg = '40.000000';
    });
    const before = JSON.stringify(f.c);
    expect(f.prepared()).toMatchObject({
      ready: true,
      baselineSource: 'RECORDED_HISTORY',
    });
    expect(f.calculate()).toMatchObject({
      origin: 'CALCULATED',
      load: '40.000000',
      unit: 'KG',
      reps: 9,
      reasons: expect.arrayContaining(['LOAD_FROM_RECORDED_HISTORY']),
    });
    expect(JSON.stringify(f.c)).toBe(before);
  });
  it.each([
    'mixed-load',
    'mixed-unit',
    'unknown-unit',
    'missing-load',
    'zero-load',
    'plan-load-unknown-unit',
  ] as const)('does not fabricate a baseline for %s', (mode) => {
    const f = fixture();
    f.c.target.targets!.targetLoad = null;
    f.c.target.targets!.targetLoadUnit = null;
    f.c.history.tasks.forEach((t) => {
      t.adjustedTargets.targetLoad = null;
      t.adjustedTargets.targetLoadUnit = null;
    });
    f.c.history.sets.forEach((s) => {
      s.load = '40';
      s.loadUnit = 'KG';
    });
    if (mode === 'mixed-load') f.c.history.sets[0].load = '41';
    if (mode === 'mixed-unit') f.c.history.sets[0].loadUnit = 'LB';
    if (mode === 'unknown-unit') f.c.history.sets[1].loadUnit = null;
    if (mode === 'missing-load') f.c.history.sets[1].load = null;
    if (mode === 'zero-load') f.c.history.sets[1].load = '0';
    if (mode === 'plan-load-unknown-unit') {
      f.c.target.targets!.targetLoad = '40';
      f.c.history.tasks.forEach((t) => (t.adjustedTargets.targetLoad = '40'));
    }
    expect(f.calculate().load).toBeNull();
  });
  it('rejects mixed nominal loads within a configless complete session', () => {
    const f = fixture();
    f.c.settings = [];
    f.c.target.targets!.targetLoad = null;
    f.c.target.targets!.targetLoadUnit = null;
    f.c.target.targets!.targetSets = 2;
    f.c.history.tasks.forEach((t) => {
      t.adjustedTargets = { ...f.c.target.targets! };
      t.availableSets = 2;
    });
    f.c.history.sets.push(
      ...f.c.history.sets.map((s) => ({
        ...s,
        id: s.id + '-second',
        setNumber: 2,
        load: '41',
      })),
    );
    f.c.history.sets
      .filter((s) => s.setNumber === 1)
      .forEach((s) => (s.load = '40'));
    expect(f.calculate()).toMatchObject({
      load: null,
      reasons: ['RECORDED_LOAD_DIFFERS'],
    });
  });
  it('honours an existing minimum and never substitutes a more permissive initial policy', () => {
    const f = fixture();
    f.c.history.tasks.shift();
    f.c.history.sets.shift();
    expect(f.prepared()).toMatchObject({
      minimumSessions: 2,
      minimumSource: 'PERSISTED_SETTING',
    });
    expect(f.calculate()).toMatchObject({
      origin: 'HISTORICAL_REFERENCE',
      load: null,
      reasons: expect.arrayContaining(['MINIMUM_NOT_REACHED']),
    });
  });
  it('maintains at the top of the prescribed range without inventing equipment increments', () => {
    const f = fixture();
    f.c.history.sets.forEach((s) => (s.repetitions = 10));
    expect(f.calculate()).toMatchObject({
      origin: 'CALCULATED',
      action: 'MAINTAIN',
      load: '80.000000',
      reps: 10,
      reasons: expect.arrayContaining([
        'REPETITION_RANGE_COMPLETED',
        'LOAD_INCREMENT_REQUIRES_EXPLICIT_POLICY',
      ]),
    });
  });
  it.each([
    'no-history',
    'partial',
    'failed',
    'omitted',
    'unit',
    'load',
    'targets',
    'substitution',
    'duplicate',
    'mixed-reps',
    'below-range',
    'same-day',
    'zone',
    'old',
    'truncated',
    'invalid-rpe',
    'effort-above-limit',
  ] as const)('withholds numeric advice for %s', (mode) => {
    const f = fixture();
    if (mode === 'no-history') {
      f.c.history.tasks = [];
      f.c.history.sets = [];
    }
    if (mode === 'partial') f.c.history.tasks[1].sessionStatus = 'IN_PROGRESS';
    if (mode === 'failed') {
      f.c.history.sets[1].status = 'FAILED';
      f.c.history.sets[1].isCompleted = false;
    }
    if (mode === 'omitted') f.c.history.tasks[1].isOmitted = true;
    if (mode === 'unit') f.c.history.sets[1].loadUnit = 'LB';
    if (mode === 'load') f.c.history.sets[1].load = '81';
    if (mode === 'targets')
      f.c.history.tasks[1].adjustedTargets.targetRepsMax = 11;
    if (mode === 'substitution')
      f.c.history.tasks[1].replacesWorkoutExerciseId = 'other';
    if (mode === 'duplicate')
      f.c.history.sets.push({ ...f.c.history.sets[1], id: 'duplicate' });
    if (mode === 'mixed-reps') f.c.history.sets[1].repetitions = 9;
    if (mode === 'below-range') f.c.history.sets[1].repetitions = 5;
    if (mode === 'same-day')
      f.c.history.tasks[1].performedOn = f.c.history.tasks[0].performedOn;
    if (mode === 'zone') f.c.history.tasks[1].timeZone = 'America/Bogota';
    if (mode === 'old') f.source.performedOn = '2026-03-15';
    if (mode === 'truncated') f.c.history.truncated.sets = true;
    if (mode === 'invalid-rpe') f.c.history.sets[1].rpe = '11';
    if (mode === 'effort-above-limit') f.c.history.sets[1].rpe = '9';
    expect(f.calculate().load).toBeNull();
  });
  it('re-evaluates the latest N sessions rather than freezing the initial baseline', () => {
    const f = fixture();
    f.c.history.tasks.push({
      ...f.c.history.tasks[1],
      id: 'c',
      sessionId: 'session-c',
      performedOn: '2026-01-07',
    });
    f.c.history.sets.push({
      ...f.c.history.sets[1],
      id: 'set-c',
      workoutExerciseId: 'c',
      repetitions: 9,
    });
    expect(f.calculate().load).toBeNull();
    f.c.history.tasks.push({
      ...f.c.history.tasks[1],
      id: 'd',
      sessionId: 'session-d',
      performedOn: '2026-01-08',
    });
    f.c.history.sets.push({
      ...f.c.history.sets[1],
      id: 'set-d',
      workoutExerciseId: 'd',
      repetitions: 9,
    });
    expect(f.calculate().reps).toBe(10);
    f.c.settings = [];
    expect(f.prepared().tasks.map((t) => t.id)).toEqual(['d']);
    expect(f.calculate().reps).toBe(10);
  });
  it('accepts valid recorded effort as additional context without inferring RIR', () => {
    const f = fixture();
    f.c.history.sets.forEach((s) => (s.rpe = '7'));
    expect(f.calculate()).toMatchObject({
      reps: 9,
      reasons: expect.arrayContaining(['RECORDED_EFFORT_CONTEXT']),
    });
  });
  it('binds requests to versions, source date, settings and explicit same-variant/equipment declaration', () => {
    const f = fixture(),
      p = f.prepared(),
      input = {
        source: { planDayId: 'day' },
        exerciseId: 'exercise',
        contextKey: p.contextKey!,
        declaration: {
          sameVariant: true as const,
          sameEquipment: true as const,
          sameLoadConvention: true as const,
        },
        policyContract: 'session-repetition-preview-v1' as const,
      };
    expect(() =>
      repetitionPreview(f.c, f.source, p, {
        ...input,
        declaration: { sameVariant: true, sameEquipment: false } as never,
      }),
    ).toThrow('INVALID_COMMAND');
    for (const declaration of [
      { sameVariant: true, sameEquipment: true },
      { sameVariant: true, sameEquipment: true, sameLoadConvention: false },
    ]) {
      expect(() =>
        repetitionPreview(f.c, f.source, p, { ...input, declaration } as never),
      ).toThrow('INVALID_COMMAND');
    }
    f.c.history.sets[0].version++;
    expect(f.prepared().contextKey).not.toBe(p.contextKey);
    expect(() => repetitionPreview(f.c, f.source, f.prepared(), input)).toThrow(
      'INVALID_COMMAND',
    );
  });
});

describe('versioned comparable prescription evidence', () => {
  const prepareV2 = (f: ReturnType<typeof fixture>, cutoff = '2026-01-14') =>
    (
      prepareRepetitionContext as (
        ...args: unknown[]
      ) => ReturnType<typeof prepareRepetitionContext>
    )(
      f.c,
      f.source,
      cutoff,
      f.c.target.targets,
      undefined,
      'session-repetition-preview-v2',
    );
  const previewV2 = (f: ReturnType<typeof fixture>, cutoff?: string) => {
    const prepared = prepareV2(f, cutoff);
    return repetitionPreview(f.c, f.source, prepared, {
      source: { planDayId: 'day' },
      exerciseId: 'exercise',
      contextKey: prepared.contextKey!,
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
      policyContract: 'session-repetition-preview-v2',
    } as never);
  };
  it('uses captured comparable evidence across generated week prescription IDs without rewriting historical identities or relaxing v1', () => {
    const f = fixture();
    f.c.history.tasks.forEach((t, index) => {
      t.planExerciseId = 'prior-week-' + index;
    });
    const before = JSON.stringify(f.c);
    expect(prepareV2(f)).toMatchObject({
      ready: true,
      policyContract: 'session-repetition-preview-v2',
    });
    expect(previewV2(f)).toMatchObject({
      origin: 'CALCULATED',
      reps: 9,
      load: '80.000000',
      executionAuthorized: false,
    });
    expect(f.prepared()).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['NO_ELIGIBLE_HISTORY']),
    });
    expect(JSON.stringify(f.c)).toBe(before);
  });
  it.each([
    ['minimum', 'MINIMUM_NOT_REACHED'],
    ['targets', 'HISTORICAL_TARGETS_DIFFER'],
    ['partial', 'SESSION_NOT_COMPLETED'],
    ['free', 'PRESCRIPTION_HISTORY_REQUIRED'],
    ['mixed', 'HISTORY_REPETITIONS_INCONSISTENT'],
    ['old', 'REFERENCE_OUTSIDE_PREVIEW_PERIOD'],
    ['zone', 'TIME_ZONE_MISMATCH'],
    ['substitution', 'SUBSTITUTION_NOT_COMPARABLE'],
    ['original', 'SUBSTITUTION_NOT_COMPARABLE'],
    ['unknown-target', 'HISTORICAL_TARGETS_DIFFER'],
  ])(
    'exposes the actual %s blocker before declarations and withholds a numeric draft',
    (mode, reason) => {
      const f = fixture();
      f.c.history.tasks.forEach((t) => {
        t.planExerciseId = 'prior-week';
      });
      if (mode === 'minimum') {
        f.c.history.tasks.shift();
        f.c.history.sets.shift();
      }
      if (mode === 'targets')
        f.c.history.tasks[1].adjustedTargets.targetRepsMax = 12;
      if (mode === 'partial')
        f.c.history.tasks[1].sessionStatus = 'IN_PROGRESS';
      if (mode === 'free') f.c.history.tasks[1].planExerciseId = null;
      if (mode === 'mixed') f.c.history.sets[1].repetitions = 9;
      if (mode === 'old') f.source.performedOn = '2026-03-15';
      if (mode === 'zone') f.c.history.tasks[1].timeZone = 'America/Bogota';
      if (mode === 'substitution')
        f.c.history.tasks[1].replacesWorkoutExerciseId = 'replaced';
      if (mode === 'original')
        f.c.history.tasks[1].originalExerciseId = 'other-exercise';
      if (mode === 'unknown-target')
        f.c.history.tasks[1].adjustedTargets.targetSets = null;
      expect(prepareV2(f)).toMatchObject({
        ready: false,
        reasons: expect.arrayContaining([reason]),
      });
      expect(previewV2(f)).toMatchObject({ load: null, reps: null });
    },
  );
  it('rejects ambiguous same-date references even when only one successful session is required', () => {
    const f = fixture();
    f.c.settings = [];
    f.c.history.tasks.forEach((t) => {
      t.planExerciseId = 'previous';
      t.performedOn = '2026-01-06';
    });
    expect(prepareV2(f)).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['INTRADAY_ORDER_UNKNOWN']),
    });
  });
  it('excludes records beyond read cutoff and preserves their identities in the fingerprint', () => {
    const f = fixture();
    f.c.settings = [];
    f.c.history.tasks.forEach((t) => {
      t.planExerciseId = 'prior-week';
    });
    f.c.history.sets[1].repetitions = 9;
    expect(previewV2(f, '2026-01-05')).toMatchObject({ reps: 9 });
    expect(prepareV2(f, '2026-01-05').tasks.map((t) => t.id)).toEqual(['a']);
    expect(previewV2(f, '2026-01-06')).toMatchObject({ reps: 10 });
  });
});
