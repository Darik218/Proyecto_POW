import { Decimal } from '@prisma/client/runtime/client';
import type {
  PerformanceHistory,
  PerformanceSet,
  PerformanceTask,
  ValidatedPerformanceQuery,
  HistoricalEstimate,
} from '../../models/progression/performance-analysis.model';
import { evidenceIdentity, prepareEstimates } from './estimate-evidence.policy';
import { analyzePerformance } from './performance';

const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const targets = {
  targetSets: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetLoad: null,
  targetLoadUnit: null,
  targetRpe: null,
};
const task = (n = 10, date = '2026-01-01'): PerformanceTask => ({
  id: id(n),
  athleteId: id(2),
  exerciseId: id(1),
  sessionId: id(n + 100),
  sessionVersion: 0,
  sessionStatus: 'COMPLETED',
  orderInSession: 1,
  isOmitted: false,
  performedOn: date,
  timeZone: 'America/Bogota',
  availableSets: 1,
  originalTargets: null,
  adjustedTargets: targets,
});
const set = (n = 10): PerformanceSet => ({
  id: id(n + 1000),
  workoutExerciseId: id(n),
  setNumber: 1,
  version: 0,
  status: 'COMPLETED',
  kind: 'WORK',
  isCompleted: true,
  load: '100',
  loadUnit: 'KG',
  loadKg: '100.000000',
  repetitions: 5,
  rpe: null,
  recordedAt: '2026-01-01T12:00:00.000Z',
});
const history = (
  sets: readonly PerformanceSet[] = [set()],
): PerformanceHistory => ({
  athleteId: id(2),
  userId: id(3),
  exerciseId: id(1),
  exerciseIsActive: true,
  tasks: [task()],
  sets,
  estimates: [],
  truncated: { tasks: false, sets: false, estimates: false },
});
const query = (
  tasks: readonly PerformanceTask[] = [task()],
): ValidatedPerformanceQuery => ({
  exerciseId: id(1),
  from: '2026-01-01',
  to: '2026-01-31',
  timeZone: 'America/Bogota',
  limit: 20,
  contexts: tasks.map((t) => ({
    workoutExerciseId: t.id,
    loadMeaning: 'EXTERNAL_TOTAL',
    protocolKey: 'explicit-protocol',
    equipmentKey: 'explicit-equipment',
    source: 'OWNER_DECLARATION_FOR_ANALYSIS',
  })),
  comparisons:
    tasks.length === 2
      ? [{ previousTaskId: tasks[0].id, currentTaskId: tasks[1].id }]
      : [],
});
function estimates(h: PerformanceHistory, index = 0): HistoricalEstimate[] {
  const t = h.tasks[index],
    s = h.sets.find((v) => v.workoutExerciseId === t.id)!;
  return prepareEstimates(
    {
      userId: h.userId,
      athleteId: h.athleteId,
      exerciseId: h.exerciseId,
      sessionId: t.sessionId,
      workoutExerciseId: t.id,
      sourceSetId: s.id,
      sourceSetVersion: s.version,
      sessionVersion: t.sessionVersion,
      sessionStatus: t.sessionStatus,
      status: s.status,
      kind: s.kind,
      isCompleted: s.isCompleted,
      isOmitted: t.isOmitted,
      load: s.load,
      loadUnit: s.loadUnit,
      loadKg: s.loadKg,
      repetitions: s.repetitions,
      rpe: s.rpe,
      oneRmSuitability: 'SUITABLE',
      recordedAt: s.recordedAt,
      performedOn: t.performedOn,
      timeZone: t.timeZone,
    },
    {
      sourceSetId: s.id,
      expectedSetVersion: s.version,
      formulas: ['EPLEY', 'BRZYCKI'],
      interpretation: {
        meaning: 'EXTERNAL_TOTAL',
        source: 'OWNER_DECLARATION_AFTER_RECORDING',
      },
    },
  ).map((d, i) => ({
    ...d,
    id: id(index * 10 + 2000 + i),
    result: d.estimatedOneRm,
    calculatedAt: '2026-02-01T00:00:00.000Z',
  }));
}

describe('descriptive historical performance', () => {
  it('reports actual repetitions and external volume, preserving missing original targets', () => {
    expect(analyzePerformance(history(), query())).toMatchObject({
      tasks: [
        {
          originalTargets: null,
          groups: [
            {
              kind: 'WORK',
              status: 'COMPLETED',
              recordedRepetitions: 5,
              volumeKgRepetitions: '500.000000',
              coverage: { included: 1, reviewed: 1 },
            },
          ],
        },
      ],
    });
  });
  it('counts distinct identical sets but deduplicates repeated references', () => {
    const s = { ...set(), id: id(1050), setNumber: 2 };
    expect(
      analyzePerformance(
        { ...history([set(), s]), tasks: [{ ...task(), availableSets: 2 }] },
        query(),
      ),
    ).toMatchObject({
      tasks: [
        {
          groups: [
            { recordedRepetitions: 10, volumeKgRepetitions: '1000.000000' },
          ],
        },
      ],
    });
    expect(analyzePerformance(history([set(), set()]), query())).toMatchObject({
      tasks: [{ groups: [{ volumeKgRepetitions: '500.000000' }] }],
      coverage: { duplicateSetReferences: 1 },
    });
  });
  it('does not choose arbitrarily between conflicting references to the same set', () => {
    expect(
      analyzePerformance(
        history([set(), { ...set(), repetitions: 6 }]),
        query(),
      ),
    ).toMatchObject({
      tasks: [
        {
          sets: [
            {
              volumeKgRepetitions: null,
              reasons: ['CONFLICTING_SET_REFERENCE'],
            },
          ],
        },
      ],
    });
  });
  it.each([
    [
      { status: 'INCOMPLETE', isCompleted: false, repetitions: 3 },
      'WORK',
      'INCOMPLETE',
      3,
      '300.000000',
    ],
    [{ kind: 'WARMUP' }, 'WARMUP', 'COMPLETED', 5, '500.000000'],
    [
      { status: 'FAILED', isCompleted: false, repetitions: 0 },
      'WORK',
      'FAILED',
      0,
      '0.000000',
    ],
    [
      {
        status: 'PENDING',
        isCompleted: false,
        repetitions: null,
        load: null,
        loadKg: null,
        loadUnit: null,
      },
      'WORK',
      'PENDING',
      null,
      null,
    ],
    [
      {
        status: 'SKIPPED',
        isCompleted: false,
        repetitions: null,
        load: null,
        loadKg: null,
        loadUnit: null,
      },
      'WORK',
      'SKIPPED',
      null,
      null,
    ],
    [
      {
        status: null,
        kind: null,
        isCompleted: false,
        loadUnit: null,
        loadKg: null,
      },
      null,
      null,
      null,
      null,
    ],
  ] satisfies Array<
    [
      Partial<PerformanceSet>,
      string | null,
      string | null,
      number | null,
      string | null,
    ]
  >)(
    'preserves separate category %j',
    (change, kind, status, repetitions, volume) => {
      expect(
        analyzePerformance(history([{ ...set(), ...change }]), query()),
      ).toMatchObject({
        tasks: [
          {
            groups: [
              {
                kind,
                status,
                recordedRepetitions: repetitions,
                volumeKgRepetitions: volume,
              },
            ],
          },
        ],
      });
    },
  );
  it.each([
    [{ loadUnit: null }, 'UNIT_UNKNOWN'],
    [{ loadKg: null }, 'CANONICAL_LOAD_MISSING'],
    [{ loadKg: '99' }, 'CANONICAL_LOAD_INCONSISTENT'],
    [{ load: '-1' }, 'LOAD_NOT_POSITIVE'],
  ] satisfies Array<[Partial<PerformanceSet>, string]>)(
    'keeps repetitions descriptive when volume is not evaluable (%s)',
    (change, reason) => {
      expect(
        analyzePerformance(history([{ ...set(), ...change }]), query()),
      ).toMatchObject({
        tasks: [
          {
            sets: [{ reasons: expect.arrayContaining([reason]) }],
            groups: [{ recordedRepetitions: 5, volumeKgRepetitions: null }],
          },
        ],
      });
    },
  );
  it('does not infer load meaning without a declaration or persisted evidence', () => {
    expect(
      analyzePerformance(history(), { ...query(), contexts: [] }),
    ).toMatchObject({
      status: 'PARTIAL',
      tasks: [
        {
          sets: [
            {
              volumeStatus: 'NOT_EVALUABLE',
              reasons: expect.arrayContaining(['LOAD_MEANING_UNKNOWN']),
            },
          ],
        },
      ],
    });
    const h = history();
    expect(
      analyzePerformance(
        { ...h, estimates: estimates(h) },
        { ...query(), contexts: [] },
      ),
    ).toMatchObject({
      tasks: [
        {
          sets: [
            {
              meaningSource: 'PERSISTED_OWNER_DECLARATION',
              volumeKgRepetitions: '500.000000',
            },
          ],
        },
      ],
    });
  });
  it('marks partial sums and loaded-vs-available coverage', () => {
    const h = {
      ...history([
        set(),
        { ...set(), id: id(1050), setNumber: 2, loadUnit: null },
      ]),
      tasks: [{ ...task(), availableSets: 3 }],
      truncated: { tasks: false, sets: true, estimates: false },
    };
    expect(analyzePerformance(h, query())).toMatchObject({
      status: 'PARTIAL',
      tasks: [
        {
          coverage: { reviewedSets: 2, availableSets: 3 },
          groups: [
            {
              volumeKgRepetitions: '500.000000',
              coverage: { reviewed: 2, included: 1, notEvaluable: 1 },
            },
          ],
        },
      ],
      warnings: expect.arrayContaining(['READ_LIMIT_REACHED']),
    });
  });
  it.each([
    [{ repetitions: 6 }, 1, '0.000000', 'MORE_REPETITIONS_AT_SAME_LOAD'],
    [
      { load: '102.5', loadKg: '102.500000' },
      null,
      '2.500000',
      'HIGHER_LOAD_AT_SAME_REPETITIONS',
    ],
    [
      { load: '110', loadKg: '110.000000', repetitions: 4 },
      null,
      '10.000000',
      'MIXED_OUTPUT_CHANGE',
    ],
  ] satisfies Array<[Partial<PerformanceSet>, number | null, string, string]>)(
    'describes changes without assuming a general performance gain',
    (change, deltaRepetitions, deltaLoadKg, outcome) => {
      const h = {
        ...history(),
        tasks: [task(), task(11, '2026-01-08')],
        sets: [set(), { ...set(11), ...change }],
      };
      expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
        comparisons: [{ sets: [{ deltaRepetitions, deltaLoadKg, outcome }] }],
      });
    },
  );
  it('handles zero reference load without dividing by zero', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [{ ...set(), load: '0', loadKg: '0.000000' }, set(11)],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      comparisons: [
        {
          sets: [
            {
              deltaLoadKg: '100.000000',
              deltaLoadPercent: null,
              reasons: expect.arrayContaining(['REFERENCE_LOAD_ZERO']),
            },
          ],
        },
      ],
    });
  });
  it.each([null, '0', '10'])('preserves RPE %s without deriving RIR', (rpe) => {
    const result = analyzePerformance(history([{ ...set(), rpe }]), query());
    expect(result).toMatchObject({ tasks: [{ sets: [{ rpe }] }] });
    expect(JSON.stringify(result)).not.toContain('rir');
  });
  it('compares RPE only at the same load, reps and position', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [
        { ...set(), rpe: '8' },
        { ...set(11), rpe: '9' },
      ],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      comparisons: [
        {
          sets: [
            { rpe: { delta: '1.0', description: 'HIGHER_DECLARED_EFFORT' } },
          ],
        },
      ],
    });
    expect(
      analyzePerformance(
        { ...h, sets: [h.sets[0], { ...h.sets[1], repetitions: 6 }] },
        query(h.tasks),
      ),
    ).toMatchObject({
      comparisons: [
        {
          sets: [
            {
              rpe: {
                delta: null,
                reasons: expect.arrayContaining(['REPETITIONS_CHANGED']),
              },
            },
          ],
        },
      ],
    });
  });
  it('keeps multiple same-date sessions without inventing intraday ordering', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11)],
      sets: [set(), set(11)],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      coverage: { uniqueSessions: 2 },
      comparisons: [
        {
          reasons: expect.arrayContaining(['INTRADAY_ORDER_UNKNOWN']),
          sets: [],
        },
      ],
    });
  });
  it('does not use recordedAt as the sporting date or convert different zones implicitly', () => {
    const h = {
      ...history(),
      tasks: [task(), { ...task(11, '2026-01-08'), timeZone: 'UTC' }],
      sets: [set(), set(11)],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      comparisons: [
        { reasons: expect.arrayContaining(['TIME_ZONE_MISMATCH']) },
      ],
    });
    expect(
      analyzePerformance(
        { ...history(), tasks: [{ ...task(), performedOn: null }] },
        query(),
      ),
    ).toMatchObject({
      tasks: [
        {
          performedOn: null,
          reasons: expect.arrayContaining(['DATE_UNKNOWN']),
        },
      ],
    });
  });
  it('keeps formulas and versions separate, without multiplying recorded volume', () => {
    const base = history();
    const h = { ...base, estimates: estimates(base) };
    const result = analyzePerformance(h, query());
    expect(result).toMatchObject({
      estimates: { groups: [{ formula: 'BRZYCKI' }, { formula: 'EPLEY' }] },
      coverage: { uniqueSessions: 1 },
      tasks: [{ groups: [{ volumeKgRepetitions: '500.000000' }] }],
    });
    expect(JSON.stringify(result)).not.toContain(
      'OWNER_DECLARATION_AFTER_RECORDING',
    ); // Full snapshots are not returned.
    expect(result.estimates.groups[0].points[0]).toMatchObject({
      performedOn: '2026-01-01',
      calculatedAt: '2026-02-01T00:00:00.000Z',
    });
  });
  it('retains legacy estimates as unexplained values rather than assuming units', () => {
    const h = history(),
      [modern] = estimates(h);
    const legacy = {
      ...modern,
      id: id(3000),
      estimateKind: null,
      resultUnit: null,
      calculationKey: null,
      snapshot: null,
    };
    expect(
      analyzePerformance({ ...h, estimates: [legacy] }, query()),
    ).toMatchObject({
      estimates: {
        groups: [],
        excluded: [
          {
            id: legacy.id,
            unit: null,
            reasons: ['LEGACY_ESTIMATE_UNVERIFIABLE'],
          },
        ],
      },
    });
  });
  it('returns insufficient data for an empty selection', () => {
    expect(
      analyzePerformance(
        { ...history([]), tasks: [] },
        { ...query(), contexts: [] },
      ),
    ).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      tasks: [],
      coverage: { uniqueSessions: 0 },
    });
  });
  it('is independent of query row order and global decimal precision', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [set(), { ...set(11), load: '102.5', loadKg: '102.500000' }],
    };
    const expected = analyzePerformance(h, query(h.tasks));
    const precision = Decimal.precision;
    try {
      Decimal.set({ precision: 3 });
      expect(
        analyzePerformance(
          { ...h, tasks: [...h.tasks].reverse(), sets: [...h.sets].reverse() },
          query(h.tasks),
        ),
      ).toEqual(expected);
    } finally {
      Decimal.set({ precision });
    }
  });
  it('marks a pair partial when matching loaded sets do not cover its recorded tasks', () => {
    const h = {
      ...history(),
      tasks: [
        { ...task(), availableSets: 2 },
        { ...task(11, '2026-01-08'), availableSets: 2 },
      ],
      sets: [set(), set(11)],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      comparisons: [
        {
          status: 'PARTIAL',
          reasons: expect.arrayContaining(['READ_LIMIT_REACHED']),
          sets: [{ deltaLoadKg: '0.000000' }],
        },
      ],
    });
  });
  it('never selects a conflicting estimate by incidental row order', () => {
    const h = history(),
      [first] = estimates(h);
    const conflict = { ...first, result: '1.000000' };
    const a = analyzePerformance(
      { ...h, estimates: [first, conflict] },
      query(),
    );
    const b = analyzePerformance(
      { ...h, estimates: [conflict, first] },
      query(),
    );
    expect(a).toEqual(b);
    expect(a.estimates.groups).toEqual([]);
    expect(
      a.estimates.excluded.every((v) =>
        v.reasons.includes('CONFLICTING_ESTIMATE_REFERENCE'),
      ),
    ).toBe(true);
  });
  it('keeps versions separate when comparing individual estimates', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [set(), set(11)],
    };
    const before = estimates(h),
      after = estimates(h, 1).map((row) => {
        const snapshot = {
          ...(row.snapshot as {
            [
              key: string
            ]: import('../../models/progression/one-rm-estimate.model').EvidenceValue;
          }),
          calculationVersion: 'future-fixture',
        };
        return {
          ...row,
          snapshot,
          algorithmVersion: 'future-fixture',
          calculationKey: evidenceIdentity(snapshot),
        };
      });
    expect(
      analyzePerformance(
        { ...h, estimates: [...before, ...after] },
        query(h.tasks),
      ),
    ).toMatchObject({
      comparisons: [
        {
          estimates: {
            differences: [],
            reasons: expect.arrayContaining(['ALGORITHM_VERSION_MISMATCH']),
          },
        },
      ],
    });
  });
  it('does not compare Epley to Brzycki or aggregate them', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [set(), set(11)],
    };
    expect(
      analyzePerformance(
        { ...h, estimates: [estimates(h)[0], estimates(h, 1)[1]] },
        query(h.tasks),
      ),
    ).toMatchObject({
      comparisons: [
        {
          estimates: {
            differences: [],
            reasons: expect.arrayContaining(['MIXED_FORMULAS']),
          },
        },
      ],
    });
  });
  it('compares known KG and LB only through equal coherent canonical loads', () => {
    const h = {
      ...history(),
      tasks: [task(), task(11, '2026-01-08')],
      sets: [
        { ...set(), load: '100', loadUnit: 'LB' as const, loadKg: '45.359237' },
        { ...set(11), load: '45.359237', loadKg: '45.359237' },
      ],
    };
    expect(analyzePerformance(h, query(h.tasks))).toMatchObject({
      comparisons: [
        { sets: [{ deltaLoadKg: '0.000000', deltaRepetitions: 0 }] },
      ],
    });
  });
  it('does not infer effort trends from different RPE subsets', () => {
    const h = {
      ...history(),
      tasks: [
        { ...task(), availableSets: 2 },
        { ...task(11, '2026-01-08'), availableSets: 2 },
      ],
      sets: [
        { ...set(), rpe: '8' },
        { ...set(), id: id(1050), setNumber: 2 },
        set(11),
        { ...set(11), id: id(1051), setNumber: 2, rpe: '9' },
      ],
    };
    expect(
      analyzePerformance(h, query(h.tasks)).comparisons[0].sets.map(
        (s) => s.rpe,
      ),
    ).toEqual([
      { delta: null, description: null, reasons: ['RPE_MISSING'] },
      { delta: null, description: null, reasons: ['RPE_MISSING'] },
    ]);
  });
  it.each(['-1', '10.1', 'invalid'])(
    'reports invalid RPE %s without deleting valid recorded volume',
    (rpe) => {
      expect(
        analyzePerformance(history([{ ...set(), rpe }]), query()),
      ).toMatchObject({
        status: 'PARTIAL',
        tasks: [
          {
            sets: [
              { rpe: null, reasons: expect.arrayContaining(['RPE_INVALID']) },
            ],
            groups: [{ volumeKgRepetitions: '500.000000' }],
          },
        ],
      });
    },
  );
  it('describes execution in a cancelled session without calling it a successful session', () => {
    expect(
      analyzePerformance(
        { ...history(), tasks: [{ ...task(), sessionStatus: 'CANCELLED' }] },
        query(),
      ),
    ).toMatchObject({
      status: 'PARTIAL',
      tasks: [
        {
          groups: [{ volumeKgRepetitions: '500.000000' }],
          reasons: ['SESSION_NOT_COMPLETED'],
        },
      ],
    });
  });
  it('does not include results of omitted exercises in interpretable volume', () => {
    expect(
      analyzePerformance(
        { ...history(), tasks: [{ ...task(), isOmitted: true }] },
        query(),
      ),
    ).toMatchObject({
      tasks: [
        {
          groups: [{ volumeKgRepetitions: null }],
          sets: [
            {
              volumeStatus: 'EXCLUDED',
              reasons: expect.arrayContaining(['EXERCISE_OMITTED']),
            },
          ],
        },
      ],
    });
  });
  it('rejects cross-owner or cross-exercise raw data and out-of-scope context references', () => {
    expect(() =>
      analyzePerformance(
        { ...history(), tasks: [{ ...task(), athleteId: id(999) }] },
        query(),
      ),
    ).toThrow('SOURCE_NOT_FOUND');
    expect(() =>
      analyzePerformance(history(), {
        ...query(),
        contexts: [{ ...query().contexts[0], workoutExerciseId: id(999) }],
      }),
    ).toThrow('TASK_NOT_IN_SELECTION');
  });
  it('rejects modern evidence that drops its required effort warning', () => {
    const h = history(),
      [row] = estimates(h);
    const snapshot = {
      ...(row.snapshot as {
        [
          key: string
        ]: import('../../models/progression/one-rm-estimate.model').EvidenceValue;
      }),
      eligibility: {
        status: 'ELIGIBLE_WITH_WARNINGS',
        reasons: [],
        warnings: [],
      },
    };
    const changed = {
      ...row,
      snapshot,
      calculationKey: evidenceIdentity(snapshot),
    };
    expect(
      analyzePerformance({ ...h, estimates: [changed] }, query()),
    ).toMatchObject({
      estimates: {
        groups: [],
        excluded: [
          { reasons: expect.arrayContaining(['ESTIMATE_PROVENANCE_INVALID']) },
        ],
      },
    });
  });
});
