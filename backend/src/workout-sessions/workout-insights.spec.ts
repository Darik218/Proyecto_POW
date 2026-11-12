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
    const view = presenter.insights(
      workoutInsights(session, new Map(), session.attributes.exercises[0].id),
    );
    const item = view.exercises[0];
    expect(item.loadMeaningSource).toBe('REQUEST_DECLARATION');
    expect(item.oneRm[0].calculation).toMatchObject({
      estimates: [
        { formula: 'EPLEY', estimatedOneRm: '76.000000', unit: 'KG' },
        { formula: 'BRZYCKI', estimatedOneRm: '74.482759', unit: 'KG' },
      ],
      warnings: ['EFFORT_UNVERIFIED'],
    });
    expect(JSON.stringify(view)).not.toMatch(
      /fatigue|rir|increment|athleteId|ownerId/i,
    );
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
