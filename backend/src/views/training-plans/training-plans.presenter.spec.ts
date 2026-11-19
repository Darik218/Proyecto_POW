import { Decimal } from '@prisma/client/runtime/client';
import { TrainingPlan } from '../../models/training-plans/training-plan.model';
import { TrainingPlansPresenter } from './training-plans.presenter';
import {
  planAttributes,
  weekAttributes,
  prescriptionAttributes,
} from '../../../test/fixtures/planning.fixture';

const presenter = new TrainingPlansPresenter();
const profile = {
  id: '51000000-0000-4000-8000-000000000001',
  name: 'Plan MVC',
  startsOn: '2027-01-04T00:00:00.000Z',
  endsOn: null,
  status: 'DRAFT',
  version: 4,
  createdAt: '2026-11-01T10:30:00.123Z',
  updatedAt: '2026-11-02T11:45:00.456Z',
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
describe('Training plans public representations', () => {
  it('preserves summaries, absent versions, nullable dates and unpaginated arrays', () => {
    expect(json(presenter.list([new TrainingPlan(planAttributes)]))).toEqual([
      profile,
    ]);
    const { version: _version, ...old } = planAttributes;
    const { version: _publicVersion, ...expected } = profile;
    expect(
      json(presenter.summary(new TrainingPlan({ ...old, startsOn: null }))),
    ).toEqual({ ...expected, startsOn: null });
    expect(presenter.list([])).toEqual([]);
  });
  it('preserves nested week and prescription order, nullable objectives and exact numeric JSON', () => {
    const plan = new TrainingPlan({
      ...planAttributes,
      weeks: [{ ...weekAttributes, exercises: [prescriptionAttributes] }],
    });
    expect(json(presenter.detail(plan))).toEqual({
      ...profile,
      weeks: [
        {
          id: '52000000-0000-4000-8000-000000000001',
          weekNumber: 1,
          startsOn: null,
          objective: null,
          exercises: [
            {
              id: '53000000-0000-4000-8000-000000000001',
              position: 1,
              targetSets: 3,
              targetReps: 8,
              targetRepsMin: 8,
              targetRepsMax: 8,
              targetLoad: 77.125,
              targetLoadUnit: null,
              targetRpe: 7.5,
              notes: null,
              exercise: {
                id: '54000000-0000-4000-8000-000000000001',
                name: 'Press banca',
                muscleGroup: 'Pectorales',
                equipment: 'Barra',
                description: null,
              },
            },
          ],
        },
      ],
    });
    expect(plan.attributes.weeks[0]!.exercises[0]!.targetLoad).toBeInstanceOf(
      Decimal,
    );
    const order = new TrainingPlan({
      ...planAttributes,
      weeks: [
        { ...weekAttributes, id: 'second', weekNumber: 2, exercises: [] },
        { ...weekAttributes, id: 'first', exercises: [] },
      ],
    });
    expect(presenter.detail(order).weeks.map((week) => week.id)).toEqual([
      'second',
      'first',
    ]);
  });
  it('distinguishes zero, null and omitted targets and preserves legacy write muscle relations', () => {
    const {
      targetRepsMin: _min,
      targetRepsMax: _max,
      targetLoadUnit: _unit,
      ...old
    } = prescriptionAttributes;
    const value = presenter.prescription({
      ...old,
      targetLoad: new Decimal(0),
      targetRpe: null,
      exercise: { ...old.exercise, primaryMuscleGroup: { name: 'Pectorales' } },
    });
    expect(value.targetLoad).toBe(0);
    expect(value.targetRpe).toBeNull();
    expect(value).not.toHaveProperty('targetRepsMin');
    expect(value).not.toHaveProperty('targetLoadUnit');
    expect(value.exercise).toHaveProperty('primaryMuscleGroup', {
      name: 'Pectorales',
    });
    expect(
      presenter.prescription({ ...prescriptionAttributes, targetLoad: null })
        .targetLoad,
    ).toBeNull();
    expect(presenter.deleted()).toEqual({ deleted: true });
  });
  it('excludes internal fields at plan, week, prescription and exercise boundaries', () => {
    const internal = {
      athleteId: 'private-athlete',
      userId: 'private-user',
      creationRequestHash: 'private-hash',
      passwordHash: 'private-secret',
      workouts: [{ id: 'private-workout' }],
    };
    const model = new TrainingPlan({
      ...planAttributes,
      ...internal,
      weeks: [
        {
          ...weekAttributes,
          ...internal,
          exercises: [
            {
              ...prescriptionAttributes,
              ...internal,
              exercise: { ...prescriptionAttributes.exercise, ...internal },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(presenter.detail(model))).not.toContain('private-');
    expect(Object.keys(presenter.summary(model)).sort()).toEqual(
      Object.keys(profile).sort(),
    );
  });
});
