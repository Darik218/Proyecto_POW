import {
  analyzeEffort,
  reviewMetrics,
  persistentSignals,
} from './effort-analysis.policy';
import {
  assessPrescriptions,
  validateAssessmentOptions,
} from './prescription-assessment.policy';
import { countSatisfactoryTasks } from './satisfactory-tasks.policy';
import {
  task,
  set,
  analysis,
  policy,
} from '../../../test/helpers/assessment-fixtures';
import type {
  SignalPolicy,
  CountPolicy,
} from '../../models/progression/prescription-assessment.model';
const signal: SignalPolicy = {
  id: 'explicit-experimental',
  basis: 'ADJUSTED',
  rpeComparison: 'MATCHED_LOAD_DESCRIPTIVE',
  referenceSize: 1,
  rpeThreshold: '1',
  performanceThresholdPercent: '10',
  minimumRpeCoveragePercent: '100',
};
const pair = (reps = 8, rpe: string | null = '9') =>
  analysis(
    [task('a'), task('b', '2026-01-02')],
    [
      { ...set('a'), repetitions: 10, rpe: '7' },
      { ...set('b'), repetitions: reps, rpe },
    ],
  );
const evaluate = (a = pair(), p = signal) =>
  analyzeEffort(
    a,
    assessPrescriptions(a, { compliance: policy(a.tasks.map((t) => t.id)) }),
    p,
  )[0];

describe('PROG-3B explicit effort/output signals', () => {
  it('describes higher declared effort and lower output only with explicit experimental policy', () => {
    const s = evaluate();
    expect(s).toMatchObject({
      status: 'AVAILABLE',
      reviewSignal: true,
      deltaRpe: '2.000000',
      deltaPerformancePercent: '-20.000000',
      coveragePercent: '100.000000',
      positions: [1],
    });
    expect(s.reasons).toContain('DESCRIPTIVE_RPE_WITH_CHANGED_REPETITIONS');
  });
  it('retains strict PROG-2 RPE restrictions', () => {
    expect(
      evaluate(pair(), { ...signal, rpeComparison: 'STRICT_PROG2' }),
    ).toMatchObject({ status: 'NOT_EVALUABLE', reviewSignal: null });
    expect(pair().comparisons[0].sets[0].rpe.delta).toBeNull();
  });
  it.each([
    [10, '9'],
    [8, '7'],
    [11, '6'],
  ] as const)(
    'does not signal reps=%s/RPE=%s without both changes',
    (reps, rpe) => {
      expect(evaluate(pair(reps, rpe)).reviewSignal).toBe(false);
    },
  );
  it('never replaces absent RPE by zero', () => {
    expect(evaluate(pair(8, null))).toMatchObject({
      status: 'NOT_EVALUABLE',
      reviewSignal: null,
      coveragePercent: '0.000000',
    });
  });
  it('does not activate thresholds when configuration is absent', () => {
    const a = pair();
    expect(
      analyzeEffort(a, assessPrescriptions(a, {}), undefined)[0].status,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('requires a complete explicit reference size', () => {
    expect(evaluate(pair(), { ...signal, referenceSize: 2 }).reasons).toContain(
      'REFERENCE_SIZE_MISMATCH',
    );
  });
  it.each(['protocolKey', 'equipmentKey'] as const)(
    'does not compare changed %s',
    (key) => {
      const a = pair();
      a.tasks[1].context = { ...a.tasks[1].context!, [key]: 'different' };
      expect(evaluate(a).reviewSignal).toBeNull();
    },
  );
  it('does not compare changed targets or actual loads', () => {
    const a = pair();
    a.tasks[1].adjustedTargets.targetRepsMax = 12;
    expect(evaluate(a).reasons).toContain('TARGETS_NOT_COMPARABLE');
    const b = pair();
    b.tasks[1].sets[0] = {
      ...b.tasks[1].sets[0],
      record: { ...b.tasks[1].sets[0].record, loadKg: '90' },
    };
    expect(evaluate(b).reasons).toContain('LOAD_CHANGED');
  });
  it('does not infer intraday order or sporting date from recordedAt', () => {
    const a = pair();
    a.tasks[1].performedOn = a.tasks[0].performedOn;
    expect(evaluate(a).reasons).toContain('INTRADAY_ORDER_UNKNOWN');
    a.tasks[1].performedOn = null;
    expect(evaluate(a).reasons).toContain('DATE_UNKNOWN');
  });
  it('never emits a full signal from truncated evidence', () => {
    const a = pair();
    a.coverage.truncated.sets = true;
    expect(evaluate(a).reviewSignal).toBeNull();
    expect(evaluate(a).reasons).toContain('READ_LIMIT_REACHED');
  });
  it('does not compare medians from different RPE positions', () => {
    const tasks = [task('a'), task('b', '2026-01-02')].map((t) => ({
      ...t,
      availableSets: 2,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 2 },
    }));
    const a = analysis(tasks, [
      { ...set('a'), rpe: '7' },
      { ...set('a'), id: 'a2', setNumber: 2, rpe: null },
      { ...set('b'), rpe: null },
      { ...set('b'), id: 'b2', setNumber: 2, rpe: '9' },
    ]);
    const cp = {
      ...policy(['a', 'b']),
      slots: ['a', 'b'].map((taskId) => ({
        taskId,
        original: [1],
        originalLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjustedLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjusted: [1, 2],
      })),
    };
    const s = analyzeEffort(a, assessPrescriptions(a, { compliance: cp }), {
      ...signal,
      minimumRpeCoveragePercent: '50',
    })[0];
    expect(s.reviewSignal).toBeNull();
    expect(s.positions).toEqual([]);
  });
  it('reports reference zero as not evaluable without division', () => {
    expect(reviewMetrics('9', '7', '1', '0', signal)).toMatchObject({
      deltaPerformancePercent: null,
      reviewSignal: null,
      reasons: ['REFERENCE_PERFORMANCE_ZERO'],
    });
  });
  it('uses decimal medians, exact thresholds and no binary rounding', () => {
    expect(
      reviewMetrics('8.1', '8', '9', '10', { ...signal, rpeThreshold: '0.1' }),
    ).toMatchObject({
      deltaRpe: '0.100000',
      deltaPerformancePercent: '-10.000000',
      reviewSignal: true,
    });
  });
  it.each([
    { ...signal, rpeThreshold: '0' },
    { ...signal, minimumRpeCoveragePercent: '101' },
    { ...signal, referenceSize: 0 },
  ])('rejects malformed thresholds', (p) => {
    expect(() => validateAssessmentOptions({ signal: p })).toThrow(
      'INVALID_POLICY',
    );
  });
  it('uses an explicit reference size and median per matched reference position', () => {
    const a = analysis(
      [task('a'), task('b', '2026-01-02'), task('c', '2026-01-03')],
      [
        { ...set('a'), repetitions: 10, rpe: '7' },
        { ...set('b'), repetitions: 8, rpe: '8' },
        { ...set('c'), repetitions: 7, rpe: '9' },
      ],
    );
    const s = analyzeEffort(
      a,
      assessPrescriptions(a, { compliance: policy(['a', 'b', 'c']) }),
      { ...signal, referenceSize: 2 },
    )[0];
    expect(s).toMatchObject({
      referencePerformance: '9',
      referenceRpe: '7.5',
      currentPerformance: '7',
      deltaPerformancePercent: '-22.222222',
      deltaRpe: '1.500000',
      reviewSignal: true,
    });
    expect(s.referenceTaskIds).toEqual(['a', 'b']);
  });
  it('does not count several tasks in the same reference session as separate reference sessions', () => {
    const a = analysis(
      [
        task('a'),
        { ...task('b', '2026-01-02'), sessionId: 'session-a' },
        task('c', '2026-01-03'),
      ],
      [set('a'), set('b'), set('c')],
    );
    const s = analyzeEffort(
      a,
      assessPrescriptions(a, { compliance: policy(['a', 'b', 'c']) }),
      { ...signal, referenceSize: 2 },
    )[0];
    expect(s.reviewSignal).toBeNull();
    expect(s.reasons).toContain('REFERENCE_SESSIONS_NOT_DISTINCT');
  });
  it('keeps signal populations paired when an explicit partial coverage threshold is used', () => {
    const tasks = [task('a'), task('b', '2026-01-02')].map((t) => ({
      ...t,
      availableSets: 2,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 2 },
    }));
    const a = analysis(tasks, [
      { ...set('a'), repetitions: 10 },
      { ...set('a'), id: 'a2', setNumber: 2, rpe: null },
      { ...set('b'), repetitions: 8, rpe: '9' },
      { ...set('b'), id: 'b2', setNumber: 2, rpe: null },
    ]);
    const cp = {
      ...policy(['a', 'b']),
      slots: ['a', 'b'].map((taskId) => ({
        taskId,
        original: [1],
        originalLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjustedLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjusted: [1, 2],
      })),
    };
    const s = analyzeEffort(a, assessPrescriptions(a, { compliance: cp }), {
      ...signal,
      minimumRpeCoveragePercent: '50',
    })[0];
    expect(s).toMatchObject({
      coveragePercent: '50.000000',
      positions: [1],
      referencePerformance: '10',
      currentPerformance: '8',
      reviewSignal: true,
    });
  });

  it('compares unrounded coverage against high precision thresholds', () => {
    const tasks = [task('a'), task('b', '2026-01-02')].map((t) => ({
      ...t,
      availableSets: 3,
      adjustedTargets: { ...t.adjustedTargets, targetSets: 3 },
    }));
    const sets = tasks.flatMap((t) =>
      [1, 2, 3].map((n) => ({
        ...set(t.id),
        id: t.id + n,
        setNumber: n,
        repetitions: t.id === 'a' ? 10 : 8,
        rpe: n === 3 ? null : t.id === 'a' ? '7' : '9',
      })),
    );
    const a = analysis(tasks, sets);
    const cp = {
      ...policy(['a', 'b']),
      slots: ['a', 'b'].map((taskId) => ({
        taskId,
        original: [1],
        originalLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjustedLoadMeaning: 'EXTERNAL_TOTAL' as const,
        adjusted: [1, 2, 3],
      })),
    };
    const s = analyzeEffort(a, assessPrescriptions(a, { compliance: cp }), {
      ...signal,
      minimumRpeCoveragePercent: '66.6666668',
    })[0];
    expect(s.coveragePercent).toBe('66.666667');
    expect(s.reviewSignal).toBeNull();
    expect(s.reasons).toContain('RPE_COVERAGE_INSUFFICIENT');
  });
});
const count: CountPolicy = {
  id: 'explicit-count',
  basis: 'ADJUSTED',
  criterion: 'BASIC',
  mode: 'ACCUMULATED',
  sameDate: 'DISTINCT_SESSIONS',
  minimumSessions: 2,
  anchorTaskId: 'b',
};
function counted(a = pair(6, '7'), p = count) {
  return countSatisfactoryTasks(
    a,
    assessPrescriptions(a, { compliance: policy(a.tasks.map((t) => t.id)) }),
    p,
  );
}
describe('satisfactory task counts and temporal review', () => {
  it('counts distinct sessions rather than sets or estimate formulas', () => {
    expect(counted()).toMatchObject({
      status: 'AVAILABLE',
      evaluatedTasks: 2,
      distinctSessions: 2,
      satisfactorySessions: 2,
      meetsMinimum: true,
    });
  });
  it('does not silently select a counting policy', () => {
    const a = pair();
    expect(
      countSatisfactoryTasks(a, assessPrescriptions(a, {}), undefined).status,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('does not count different exercises in one exercise cohort', () => {
    const a = pair();
    a.tasks[0].exerciseId = 'other';
    expect(counted(a).distinctSessions).toBe(1);
  });
  it('does not count missing or incompatible target evidence', () => {
    const a = pair();
    a.tasks[0].adjustedTargets.targetLoad = '90';
    expect(counted(a).distinctSessions).toBe(1);
  });
  it('does not fabricate consecutive chronology within a date', () => {
    const a = pair();
    a.tasks[1].performedOn = a.tasks[0].performedOn;
    expect(counted(a, { ...count, mode: 'CONSECUTIVE' }).status).toBe(
      'NOT_EVALUABLE',
    );
    expect(counted(a).distinctSessions).toBe(2);
    expect(
      counted(a, { ...count, sameDate: 'DISTINCT_DATES' }).qualifyingCount,
    ).toBe(1);
  });
  it('multiple tasks in a session do not inflate successful sessions', () => {
    const a = pair();
    a.tasks[0].sessionId = a.tasks[1].sessionId;
    expect(counted(a).distinctSessions).toBe(1);
    expect(counted(a).meetsMinimum).toBe(false);
  });
  it('consecutive counts stop at an unknown latest observation', () => {
    const a = pair();
    a.tasks[1].sets[0] = {
      ...a.tasks[1].sets[0],
      record: { ...a.tasks[1].sets[0].record, status: null },
      validRepetitions: false,
    };
    expect(counted(a, { ...count, mode: 'CONSECUTIVE' })).toMatchObject({
      qualifyingCount: 0,
      meetsMinimum: null,
    });
  });
  it('truncation cannot prove minimum or temporal persistence', () => {
    const a = pair();
    a.coverage.truncated.tasks = true;
    expect(counted(a).meetsMinimum).toBeNull();
    expect(persistentSignals([], a, { id: 'p', k: 1, m: 1 }).status).toBe(
      'NOT_EVALUABLE',
    );
  });
  it('requires explicit k/m and enough distinct comparable observations', () => {
    const a = pair();
    const observations = [evaluate(a)];
    expect(persistentSignals(observations, a, undefined).status).toBe(
      'CONFIGURATION_REQUIRED',
    );
    expect(
      persistentSignals(observations, a, { id: 'p', k: 2, m: 2 }).status,
    ).toBe('NOT_EVALUABLE');
    expect(
      persistentSignals(observations, a, { id: 'p', k: 1, m: 1 }),
    ).toMatchObject({ status: 'AVAILABLE', persistentReviewSignal: true });
  });
  it('does not skip a latest cancelled task to fabricate a consecutive streak', () => {
    const a = pair();
    a.tasks[1].sessionStatus = 'CANCELLED';
    expect(counted(a, { ...count, mode: 'CONSECUTIVE' }).meetsMinimum).not.toBe(
      true,
    );
  });
  it('does not fabricate a consecutive streak by skipping an unplaceable observation', () => {
    const a = pair();
    a.tasks[0].performedOn = null;
    expect(
      counted(a, { ...count, mode: 'CONSECUTIVE', minimumSessions: 1 })
        .meetsMinimum,
    ).toBeNull();
  });
  it('uses all required tasks in a session rather than selecting its successful task', () => {
    const a = pair();
    a.tasks[0].sessionId = a.tasks[1].sessionId;
    a.tasks[0].sets[0] = {
      ...a.tasks[0].sets[0],
      record: { ...a.tasks[0].sets[0].record, repetitions: 2 },
    };
    expect(counted(a, { ...count, minimumSessions: 1 }).meetsMinimum).toBe(
      false,
    );
  });
  it('does not count duplicate observations as temporal persistence', () => {
    const a = pair(),
      s = evaluate(a);
    expect(
      persistentSignals([s, s], a, { id: 'p', k: 2, m: 2 })
        .persistentReviewSignal,
    ).toBeNull();
  });

  it('a cancelled latest task cannot be skipped even when the anchor is a previous valid task', () => {
    const a = pair();
    a.tasks[1].sessionStatus = 'CANCELLED';
    expect(
      counted(a, {
        ...count,
        anchorTaskId: 'a',
        mode: 'CONSECUTIVE',
        minimumSessions: 1,
      }).meetsMinimum,
    ).toBeNull();
  });
  it('unplaced temporal evidence cannot be sorted away before selecting latest m', () => {
    const a = pair(),
      s = evaluate(a);
    const unplaced = {
      ...s,
      currentTaskId: 'unknown',
      sessionId: 'unknown-session',
      performedOn: null,
    };
    expect(
      persistentSignals([unplaced, s], a, { id: 'p', k: 1, m: 1 })
        .persistentReviewSignal,
    ).toBeNull();
  });
  it('evaluates k-of-m on distinct sporting dates without generating recommendations', () => {
    const a = analysis(
      [task('a'), task('b', '2026-01-02'), task('c', '2026-01-03')],
      [
        { ...set('a'), repetitions: 10, rpe: '7' },
        { ...set('b'), repetitions: 8, rpe: '9' },
        { ...set('c'), repetitions: 7, rpe: '9' },
      ],
      false,
      [
        { previousTaskId: 'a', currentTaskId: 'b' },
        { previousTaskId: 'a', currentTaskId: 'c' },
      ],
    );
    const observations = analyzeEffort(
      a,
      assessPrescriptions(a, { compliance: policy(['a', 'b', 'c']) }),
      signal,
    );
    expect(
      persistentSignals(observations, a, { id: 'temporal', k: 2, m: 2 }),
    ).toMatchObject({
      status: 'AVAILABLE',
      evaluated: 2,
      signals: 2,
      persistentReviewSignal: true,
    });
  });

  it('does not combine temporal signals generated under different policies', () => {
    const a = pair(),
      b = evaluate(a),
      c = {
        ...b,
        currentTaskId: 'c',
        sessionId: 'session-c',
        performedOn: '2026-01-03',
        policyKey: 'different-policy',
      };
    expect(
      persistentSignals([b, c], a, { id: 'p', k: 2, m: 2 })
        .persistentReviewSignal,
    ).toBeNull();
    expect(
      persistentSignals([b, c], a, { id: 'p', k: 2, m: 2 }).reasons,
    ).toContain('SIGNAL_POLICY_MISMATCH');
  });
});
