import {
  assessPrescriptions,
  validateAssessmentOptions,
} from './prescription-assessment.policy';
import {
  task,
  set,
  analysis,
  rule,
  policy,
} from '../../../test/helpers/assessment-fixtures';
const result = (t = task(), s = [set()], p = policy()) =>
  assessPrescriptions(analysis([t], s), { compliance: p }).tasks[0];
describe('PROG-3A independent targets and observed work', () => {
  it('meeting adjusted targets does not mean meeting original ones', () => {
    const a = result();
    expect(a.original.basic.result).toBe('NOT_MET');
    expect(a.adjusted.basic.result).toBe('SATISFIED');
    expect(a.adjusted.readiness.result).toBe('CONFIGURATION_REQUIRED');
    expect(a.original.slots[0]).toMatchObject({
      repetitions: 'BELOW_MINIMUM',
      load: 'BELOW_TARGET',
      loadDifferenceKg: '-20.000000',
    });
  });
  it('requires policy and slot mapping instead of approving completed tasks', () => {
    const a = assessPrescriptions(analysis(), {}).tasks[0];
    expect(a.adjusted.basic.result).toBe('CONFIGURATION_REQUIRED');
    expect(a.adjusted.reasons).toContain('WORK_SLOT_MAPPING_REQUIRED');
  });
  it('does not reconstruct original targets', () => {
    const a = result({ ...task(), originalTargets: null });
    expect(a.original.status).toBe('NOT_EVALUABLE');
    expect(a.adjusted.basic.result).toBe('SATISFIED');
  });
  it.each(['INCOMPLETE', 'FAILED', 'PENDING', 'SKIPPED'] as const)(
    'retains %s without counting completed work',
    (status) => {
      const a = result(task(), [
        {
          ...set(),
          status,
          isCompleted: false,
          repetitions:
            status === 'FAILED' ? 0 : status === 'INCOMPLETE' ? 3 : null,
          load: status === 'PENDING' || status === 'SKIPPED' ? null : '80',
          loadKg: status === 'PENDING' || status === 'SKIPPED' ? null : '80',
          rpe: null,
        },
      ]);
      expect(a.adjusted.basic.result).not.toBe('SATISFIED');
      expect(a.adjusted.slots[0].record?.status).toBe(status);
    },
  );
  it('retains incomplete positive repetitions', () => {
    const a = result(task(), [
      { ...set(), status: 'INCOMPLETE', isCompleted: false, repetitions: 3 },
    ]);
    expect(a.adjusted.slots[0].record?.repetitions).toBe(3);
    expect(a.adjusted.basic.result).toBe('NOT_MET');
  });
  it.each([null, 'WARMUP'] as const)(
    'does not count kind %s as WORK',
    (kind) => {
      expect(result(task(), [{ ...set(), kind }]).adjusted.basic.result).toBe(
        'NOT_EVALUABLE',
      );
    },
  );
  it('does not classify unknown legacy status as failure', () => {
    const a = result(task(), [{ ...set(), status: null, isCompleted: false }]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(a.adjusted.slots[0].reasons).toContain('SET_STATUS_UNKNOWN');
  });
  it('additional set cannot replace a missing required position', () => {
    const a = result(task(), [{ ...set(), setNumber: 2 }]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(a.adjusted.additionalSetIds).toEqual(['set-a']);
    expect(a.adjusted.slots[0].reasons).toContain('SET_UNRECORDED');
    expect(a.adjusted.basic.rpeChecks[0].state).toBe('MISSING');
  });
  it('uses explicit work mapping after warmup without renumbering', () => {
    const a = result(
      { ...task(), availableSets: 2 },
      [
        { ...set(), kind: 'WARMUP' },
        { ...set(), id: 'work', setNumber: 2 },
      ],
      {
        ...policy(),
        slots: [
          {
            taskId: 'a',
            original: [2],
            adjusted: [2],
            originalLoadMeaning: 'EXTERNAL_TOTAL' as const,
            adjustedLoadMeaning: 'EXTERNAL_TOTAL' as const,
          },
        ],
      },
    );
    expect(a.adjusted.basic.result).toBe('SATISFIED');
    expect(a.adjusted.slots[0].setNumber).toBe(2);
    expect(a.adjusted.additionalSetIds).toEqual(['set-a']);
  });
  it('rejects duplicate positions', () => {
    const a = result({ ...task(), availableSets: 2 }, [
      set(),
      { ...set(), id: 'other' },
    ]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(a.adjusted.slots[0].reasons).toContain('DUPLICATE_SET_POSITION');
  });
  it.each([
    [4, 'BELOW_MINIMUM'],
    [5, 'MINIMUM_REACHED'],
    [6, 'MAXIMUM_REACHED'],
    [7, 'ABOVE_MAXIMUM'],
  ] as const)('describes %s reps as %s', (repetitions, expected) => {
    const a = result(task(), [{ ...set(), repetitions }]);
    expect(a.adjusted.slots[0].repetitions).toBe(expected);
    expect(a.adjusted.basic.result).toBe(
      repetitions < 5 ? 'NOT_MET' : 'SATISFIED',
    );
  });
  it('readiness requires explicit additional criteria', () => {
    const a = result(task(), [{ ...set(), repetitions: 5 }], {
      ...policy(),
      readiness: { ...rule, repetitions: 'UPPER_BOUND' },
    });
    expect(a.adjusted.basic.result).toBe('SATISFIED');
    expect(a.adjusted.readiness.result).toBe('NOT_MET');
  });
  it.each(['targetSets', 'targetRepsMin', 'targetRepsMax'] as const)(
    'does not default unknown %s',
    (key) => {
      expect(
        result({
          ...task(),
          adjustedTargets: { ...task().adjustedTargets, [key]: null },
        }).adjusted.basic.result,
      ).not.toBe('SATISFIED');
    },
  );
  it('can ignore absent target load only under explicit rule', () => {
    const t = {
      ...task(),
      adjustedTargets: {
        ...task().adjustedTargets,
        targetLoad: null,
        targetLoadUnit: null,
      },
    };
    expect(result(t).adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(
      result(t, [set()], { ...policy(), basic: { ...rule, load: 'IGNORE' } })
        .adjusted.basic.result,
    ).toBe('SATISFIED');
  });
  it('compares equivalent LB and KG without replacing native values', () => {
    const t = {
      ...task(),
      adjustedTargets: {
        ...task().adjustedTargets,
        targetLoad: '100',
        targetLoadUnit: 'LB' as const,
      },
    };
    const a = result(t, [{ ...set(), load: '45.359237', loadKg: '45.359237' }]);
    expect(a.adjusted.slots[0].loadDifferenceKg).toBe('0.000000');
    expect(a.adjusted.targets?.targetLoad).toBe('100');
  });
  it('allows known zero load', () => {
    const t = {
      ...task(),
      adjustedTargets: { ...task().adjustedTargets, targetLoad: '0' },
    };
    expect(
      result(t, [{ ...set(), load: '0', loadKg: '0' }]).adjusted.basic.result,
    ).toBe('SATISFIED');
  });
  it('does not compare unknown units', () => {
    expect(
      result(task(), [{ ...set(), loadUnit: null }]).adjusted.basic.result,
    ).toBe('NOT_EVALUABLE');
  });
  it('does not compare unknown load meaning', () => {
    const a = analysis();
    a.tasks[0].context = null;
    expect(
      assessPrescriptions(a, { compliance: policy() }).tasks[0].adjusted
        .slots[0].load,
    ).toBe('NOT_COMPARABLE');
  });
  it.each([null, '0', '9'] as const)('preserves RPE %s', (rpe) => {
    const a = result(task(), [{ ...set(), rpe }]);
    expect(a.adjusted.slots[0].rpe).toBe(
      rpe === null ? 'MISSING' : rpe === '9' ? 'ABOVE_TARGET' : 'BELOW_TARGET',
    );
    expect(a.adjusted.rpeCoverage.valid).toBe(rpe === null ? 0 : 1);
  });
  it('lower RPE does not fail an at-most policy', () => {
    expect(
      result(task(), [set()], {
        ...policy(),
        basic: { ...rule, rpe: 'AT_MOST_TARGET' },
      }).adjusted.basic.result,
    ).toBe('SATISFIED');
  });
  it('does not approve omitted, cancelled or incompletely read work', () => {
    for (const t of [
      { ...task(), availableSets: 2 },
      { ...task(), isOmitted: true },
      { ...task(), sessionStatus: 'CANCELLED' as const },
    ])
      expect(result(t).adjusted.basic.result).not.toBe('SATISFIED');
  });
  it('propagates truncation without declaring a complete window', () => {
    const a = assessPrescriptions(analysis([task()], [set()], true), {
      compliance: policy(),
    });
    expect(a.status).toBe('PARTIAL');
    expect(a.reasons).toContain('READ_LIMIT_REACHED');
  });
  it('is deterministic and does not mutate evidence', () => {
    const a = analysis(),
      before = JSON.stringify(a);
    expect(assessPrescriptions(a, { compliance: policy() })).toEqual(
      assessPrescriptions(a, { compliance: policy() }),
    );
    expect(JSON.stringify(a)).toBe(before);
  });
  it.each([
    null,
    { compliance: null },
    {
      compliance: {
        ...policy(),
        slots: [{ taskId: 'a', original: [1, 1], adjusted: [1] }],
      },
    },
    {
      compliance: {
        ...policy(),
        basic: { ...rule, rpe: { minimum: '9', maximum: '8' } },
      },
    },
  ])('rejects malformed policies', (input) => {
    expect(() => validateAssessmentOptions(input as never)).toThrow(
      'INVALID_POLICY',
    );
  });
  it('does not credit contradictory completion flags as an accredited failed attempt', () => {
    const a = result(task(), [
      { ...set(), status: 'FAILED', isCompleted: true, repetitions: 0 },
    ]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(a.adjusted.slots[0].reasons).toContain('CONTRADICTORY_SET_STATE');
  });
  it('does not accredit invalid optional RPE even under a descriptive rule', () => {
    expect(
      result(task(), [{ ...set(), rpe: '11' }]).adjusted.basic.result,
    ).not.toBe('SATISFIED');
  });
  it('does not compare an original captured for a different catalog exercise', () => {
    const t = { ...task(), originalExerciseId: 'different-exercise' };
    expect(result(t).original.reasons).toContain('ORIGINAL_EXERCISE_MISMATCH');
    expect(result(t).adjusted.basic.result).toBe('SATISFIED');
  });
  it('allows an explicit RPE interval and keeps its comparison separate from the captured scalar', () => {
    const p = {
      ...policy(),
      basic: { ...rule, rpe: { minimum: '6', maximum: '8' } },
    };
    expect(result(task(), [set()], p).adjusted.basic.result).toBe('SATISFIED');
    expect(
      result(task(), [{ ...set(), rpe: '9' }], p).adjusted.basic.result,
    ).toBe('NOT_MET');
    expect(
      result(task(), [{ ...set(), rpe: null }], p).adjusted.basic.result,
    ).toBe('NOT_EVALUABLE');
  });
  it('exact load rule does not approve higher load simply because repetitions met the minimum', () => {
    const a = result(task(), [{ ...set(), load: '90', loadKg: '90' }], {
      ...policy(),
      basic: { ...rule, load: 'EXACT_TARGET' },
    });
    expect(a.adjusted.slots[0].load).toBe('ABOVE_TARGET');
    expect(a.adjusted.basic.result).toBe('NOT_MET');
  });
  it('does not approve conflicting duplicate source identities', () => {
    const a = result({ ...task(), availableSets: 2 }, [
      set(),
      { ...set(), repetitions: 20 },
    ]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
  });
  it('counts RPE coverage only within mapped WORK slots', () => {
    const a = result({ ...task(), availableSets: 2 }, [
      { ...set(), rpe: null },
      { ...set(), id: 'extra', setNumber: 2, rpe: '10' },
    ]);
    expect(a.adjusted.rpeCoverage).toMatchObject({
      valid: 0,
      missing: 1,
      percent: '0.000000',
    });
  });

  it('retains the exact source reasons and context when comparison is unavailable', () => {
    const a = result(task(), [{ ...set(), loadUnit: null, loadKg: null }]);
    expect(a.context?.source).toBe('OWNER_DECLARATION_FOR_ANALYSIS');
    expect(a.adjusted.slots[0].sourceAnalysis?.reasons).toContain(
      'UNIT_UNKNOWN',
    );
    expect(a.observedSets[0].record.loadUnit).toBeNull();
  });
  it('does not turn a contradictory record into accredited failure using another numeric dimension', () => {
    const a = result(task(), [
      {
        ...set(),
        status: 'FAILED',
        isCompleted: true,
        repetitions: 0,
        load: '70',
        loadKg: '70',
      },
    ]);
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
  });

  it('does not turn contradictory state plus high RPE into accredited failure', () => {
    const a = result(
      task(),
      [
        {
          ...set(),
          status: 'FAILED',
          isCompleted: true,
          repetitions: 0,
          rpe: '9',
        },
      ],
      { ...policy(), basic: { ...rule, rpe: 'AT_MOST_TARGET' } },
    );
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
  });
  it('does not infer target load interpretation from actual task context or KG', () => {
    const p = {
      ...policy(),
      slots: [{ taskId: 'a', original: [1], adjusted: [1] }],
    };
    const a = result(task(), [set()], p);
    expect(a.adjusted.slots[0].load).toBe('NOT_COMPARABLE');
    expect(a.adjusted.basic.result).toBe('NOT_EVALUABLE');
    expect(a.adjusted.slots[0].loadReasons).toContain(
      'TARGET_LOAD_MEANING_UNKNOWN',
    );
  });
  it.each([
    ['5', 'BELOW_INTERVAL'],
    ['7', 'WITHIN_INTERVAL'],
    ['9', 'ABOVE_INTERVAL'],
    [null, 'MISSING'],
  ] as const)(
    'explains RPE %s against the explicit interval as %s',
    (rpe, state) => {
      const a = result(task(), [{ ...set(), rpe }], {
        ...policy(),
        basic: { ...rule, rpe: { minimum: '6', maximum: '8' } },
      });
      expect(a.adjusted.basic.rpeChecks[0]).toMatchObject({
        setNumber: 1,
        state,
        minimum: '6',
        maximum: '8',
      });
    },
  );
});
