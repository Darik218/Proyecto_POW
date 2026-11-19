import { ScheduledActivity } from '../../models/training-plans/scheduled-activity.model';
import { FlexiblePlanningPresenter } from './flexible-planning.presenter';

const presenter = new FlexiblePlanningPresenter();
const attributes = {
  id: '61000000-0000-4000-8000-000000000001',
  planWeekId: null,
  planDayId: null,
  originalPlanDayId: null,
  originalOn: new Date('2027-01-04T00:00:00.000Z'),
  scheduledOn: new Date('2027-01-06T00:00:00.000Z'),
  timeZone: 'America/Bogota',
  title: 'Entrenamiento adicional',
  status: 'RESCHEDULED' as const,
  version: 0,
  workouts: [
    {
      id: '62000000-0000-4000-8000-000000000001',
      status: 'COMPLETED' as const,
      performedOn: new Date('2027-01-06T00:00:00.000Z'),
    },
  ],
};
describe('Routine and calendar public representations', () => {
  it('preserves original and rescheduled dates, zone, nullable references and execution descriptors independently', () => {
    const model = new ScheduledActivity(attributes);
    expect(JSON.parse(JSON.stringify(presenter.activity(model)))).toEqual({
      id: '61000000-0000-4000-8000-000000000001',
      planWeekId: null,
      planDayId: null,
      originalPlanDayId: null,
      originalOn: '2027-01-04T00:00:00.000Z',
      scheduledOn: '2027-01-06T00:00:00.000Z',
      timeZone: 'America/Bogota',
      title: 'Entrenamiento adicional',
      status: 'RESCHEDULED',
      version: 0,
      workouts: [
        {
          id: '62000000-0000-4000-8000-000000000001',
          status: 'COMPLETED',
          performedOn: '2027-01-06T00:00:00.000Z',
        },
      ],
    });
    expect(model.attributes.status).toBe('RESCHEDULED');
    expect(model.attributes.scheduledOn).toBe(attributes.scheduledOn);
  });
  it('preserves every calendar state, empty arrays, null execution dates and supplied ordering', () => {
    const states = [
      'PLANNED',
      'RESCHEDULED',
      'OMITTED',
      'WITHDRAWN',
      'REST',
    ] as const;
    const models = states.map(
      (status) =>
        new ScheduledActivity({
          ...attributes,
          status,
          workouts: [{ ...attributes.workouts[0]!, performedOn: null }],
        }),
    );
    expect(presenter.activities(models).map((row) => row.status)).toEqual(
      states,
    );
    expect(
      presenter.activities(models)[0]!.workouts[0]!.performedOn,
    ).toBeNull();
    expect(presenter.activities([])).toEqual([]);
  });
  it('excludes owner, idempotency and private workout fields from calendar responses', () => {
    const internal = {
      athleteId: 'private-athlete',
      creationRequestHash: 'private-hash',
      sourceSnapshot: 'private-snapshot',
      notes: 'private-notes',
      feedback: { notes: 'private-feedback' },
      accessToken: 'private-token',
    };
    const model = new ScheduledActivity({
      ...attributes,
      ...internal,
      workouts: [{ ...attributes.workouts[0]!, ...internal }],
    });
    expect(JSON.stringify(presenter.activity(model))).not.toContain('private-');
    expect(Object.keys(presenter.activity(model)).sort()).toEqual(
      Object.keys(attributes).sort(),
    );
    expect(Object.keys(presenter.activity(model).workouts[0]!).sort()).toEqual([
      'id',
      'performedOn',
      'status',
    ]);
  });
  it('keeps operation acknowledgements exact without adding empty fields or exposing persisted metadata', () => {
    expect(presenter.created({ id: 'plan' })).toEqual({ id: 'plan' });
    expect(presenter.changed({ planId: 'plan' })).toEqual({ planId: 'plan' });
    expect(presenter.changed({ planId: 'plan', dayIds: [] })).toEqual({
      planId: 'plan',
      dayIds: [],
    });
    const data = {
      planId: 'plan',
      dayIds: ['b', 'a'],
      requestHash: 'private-hash',
      athleteId: 'private-athlete',
    };
    expect(presenter.changed(data)).toEqual({
      planId: 'plan',
      dayIds: ['b', 'a'],
    });
    expect(data.dayIds).toEqual(['b', 'a']);
  });
});
