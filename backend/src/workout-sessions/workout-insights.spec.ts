import { Decimal } from '@prisma/client/runtime/client';
import { workoutInsights } from '../domain/workout-sessions/workout-insights.policy';
import { WorkoutInsightsPresenter } from '../views/workout-sessions/workout-insights.presenter';
import { insightFixture } from '../../test/fixtures/workout-insights.fixture';

describe('Immediate workout insights', () => {
  const presenter = new WorkoutInsightsPresenter();
  it('makes the first completed session useful without inferring historical load meaning', () => {
    const view = presenter.insights(
      workoutInsights(insightFixture(), new Map()),
    );
    expect(view.exercises[0]).toMatchObject({
      loadMeaning: 'UNKNOWN',
      loadMeaningSource: 'UNKNOWN',
      reference: null,
      actualSets: [{ load: '60', loadUnit: 'KG', repetitions: 8, rpe: 8 }],
      oneRm: [
        {
          calculation: null,
          eligibility: { reasons: ['LOAD_MEANING_UNKNOWN'] },
        },
      ],
      orientation: { action: 'REPEAT_REFERENCE' },
    });
  });
  it('reuses literal Decimal Epley and Brzycki only after an explicit exercise declaration', () => {
    const session = insightFixture();
    session.attributes.exercises[0].sets![0].rir = '4_PLUS';
    const view = presenter.insights(
      workoutInsights(session, new Map(), session.attributes.exercises[0].id),
    );
    const item = view.exercises[0];
    expect(item.actualSets[0]).toMatchObject({ rir: '4_PLUS', rpe: 8 });
    expect(item.loadMeaningSource).toBe('REQUEST_DECLARATION');
    expect(item.oneRm[0].calculation).toMatchObject({
      estimates: [
        { formula: 'EPLEY', estimatedOneRm: '76.000000', unit: 'KG' },
        { formula: 'BRZYCKI', estimatedOneRm: '74.482759', unit: 'KG' },
      ],
      warnings: ['EFFORT_UNVERIFIED'],
    });
    expect(JSON.stringify(view)).not.toMatch(
      /fatigue|increment|athleteId|ownerId/i,
    );
    expect(JSON.stringify(view.exercises[0].oneRm)).not.toMatch(/rir/i);
  });
  it('preserves unknown units and declines estimates even when meaning is declared', () => {
    const session = insightFixture();
    session.attributes.exercises[0].sets![0].loadUnit = null;
    session.attributes.exercises[0].sets![0].loadKg = null;
    const view = presenter.insights(
      workoutInsights(session, new Map(), session.attributes.exercises[0].id),
    );
    expect(view.exercises[0].actualSets[0].loadUnit).toBeNull();
    expect(view.exercises[0].oneRm[0].calculation).toBeNull();
    expect(view.exercises[0].oneRm[0].eligibility.reasons).toContain(
      'UNIT_UNKNOWN',
    );
    expect(view.exercises[0].orientation.action).toBe('REVIEW_DATA');
  });
  it('does not elevate incomplete or warmup work into 1RM evidence', () => {
    const session = insightFixture();
    session.attributes.exercises[0].sets![0].status = 'INCOMPLETE';
    session.attributes.exercises[0].sets![0].isCompleted = false;
    session.attributes.exercises[0].sets![0].kind = 'WARMUP';
    const view = presenter.insights(
      workoutInsights(session, new Map(), session.attributes.exercises[0].id),
    );
    expect(view.exercises[0].oneRm[0].calculation).toBeNull();
    expect(view.exercises[0].oneRm[0].eligibility.reasons).toEqual(
      expect.arrayContaining(['SET_NOT_COMPLETED', 'SET_NOT_WORK']),
    );
  });
  it('keeps the previous reference in original units without applying the current declaration to it', () => {
    const current = insightFixture(),
      previous = insightFixture();
    previous.attributes.exercises[0].sets![0].load = new Decimal('132.277');
    previous.attributes.exercises[0].sets![0].loadUnit = 'LB';
    const references = new Map([
      [current.attributes.exercises[0].exercise.id, previous],
    ]);
    const view = presenter.insights(
      workoutInsights(current, references, current.attributes.exercises[0].id),
    );
    expect(view.exercises[0].reference).toMatchObject({
      sessionLabel: '2026-11-12',
      sets: [{ load: '132.277', loadUnit: 'LB' }],
    });
    expect(view.exercises[0].reference).not.toHaveProperty('oneRm');
  });
});

describe('Plain recorded-performance comparison', () => {
  function result(
    change?: (source: ReturnType<typeof insightFixture>) => void,
  ) {
    const previous = insightFixture(),
      current = insightFixture();
    change?.(current);
    return new WorkoutInsightsPresenter().insights(
      workoutInsights(
        current,
        new Map([[current.attributes.exercises[0].exercise.id, previous]]),
      ),
    ).exercises[0];
  }
  it('reports the observed repetition difference at the same original load without a strength claim', () => {
    const view = result((current) => {
      current.attributes.exercises[0].sets![0].repetitions = 10;
      current.attributes.exercises[0].sets![0].rpe = null;
    });
    expect(view.observedComparison).toMatchObject({
      state: 'SAME_LOAD',
      repetitionsDelta: 2,
    });
    expect(view.observedComparison.message).toContain('2 repeticiones más');
    expect(view.observedComparison.message).toContain('no demuestra');
  });
  it('keeps identical results and fewer repetitions descriptive', () => {
    expect(result().observedComparison.repetitionsDelta).toBe(0);
    expect(
      result((current) => {
        current.attributes.exercises[0].sets![0].repetitions = 7;
      }).observedComparison.repetitionsDelta,
    ).toBe(-1);
  });
  it('does not compare different or unknown units or incomplete sets', () => {
    for (const change of [
      (s: ReturnType<typeof insightFixture>) => {
        s.attributes.exercises[0].sets![0].loadUnit = 'LB';
      },
      (s: ReturnType<typeof insightFixture>) => {
        s.attributes.exercises[0].sets![0].loadUnit = null;
      },
      (s: ReturnType<typeof insightFixture>) => {
        s.attributes.exercises[0].sets![0].status = 'INCOMPLETE';
      },
    ])
      expect(result(change).observedComparison).toMatchObject({
        state: 'NOT_COMPARABLE',
        repetitionsDelta: null,
      });
  });
  it('distinguishes a changed load without claiming a universal improvement', () => {
    expect(
      result((s) => {
        s.attributes.exercises[0].sets![0].load = new Decimal('65');
      }).observedComparison,
    ).toMatchObject({ state: 'LOAD_CHANGED', repetitionsDelta: null });
  });
  it('withholds percentage progress without a previous comparable session', () => {
    const value = new WorkoutInsightsPresenter().insights(
      workoutInsights(insightFixture(), new Map()),
    ).exercises[0];
    expect(value.observedComparison).toMatchObject({
      state: 'NO_REFERENCE',
      repetitionsDelta: null,
    });
    expect(JSON.stringify(value.observedComparison)).not.toContain('%');
  });
});
