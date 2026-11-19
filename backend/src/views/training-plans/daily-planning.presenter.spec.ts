import { Decimal } from '@prisma/client/runtime/client';
import { TrainingPlan } from '../../models/training-plans/training-plan.model';
import { DailyPlanningPresenter } from './daily-planning.presenter';
import {
  planAttributes,
  weekAttributes,
  prescriptionAttributes,
} from '../../../test/fixtures/planning.fixture';

const presenter = new DailyPlanningPresenter();
const prescription = { ...prescriptionAttributes, hasHistory: true };
const day = {
  id: '55000000-0000-4000-8000-000000000001',
  name: 'Push',
  position: 1,
  weekday: 1 as number | null,
  retiredAt: null as Date | null,
  retiredFromOn: null as Date | null,
  isEditableOverride: false,
  hasHistory: true,
  exercises: [prescription],
};
describe('Daily planning JSON views', () => {
  it('preserves fixed/flexible days, repeated weekdays and independent daily prescriptions', () => {
    const data = new TrainingPlan({
      ...planAttributes,
      weeks: [
        {
          ...weekAttributes,
          pendingExercises: [],
          days: [
            day,
            { ...day, id: 'pull', name: 'Pull', position: 2, exercises: [] },
            {
              ...day,
              id: 'flexible',
              position: 3,
              weekday: null,
              exercises: [],
            },
          ],
        },
      ],
    });
    const result = presenter.planning(data);
    expect(
      result.weeks[0]!.days.map((row) => [
        row.id,
        row.weekday,
        row.exercises.length,
      ]),
    ).toEqual([
      [day.id, 1, 1],
      ['pull', 1, 0],
      ['flexible', null, 0],
    ]);
    expect(result.weeks[0]!.pendingExercises).toEqual([]);
    expect(result.weeks[0]!.days[0]).toMatchObject({
      retiredAt: null,
      retiredFromOn: null,
      isEditableOverride: false,
      hasHistory: true,
    });
  });
  it('keeps pending historical prescriptions and legacy repetition fallback without inferring load units', () => {
    const legacy = {
      ...prescription,
      targetRepsMin: null,
      targetRepsMax: null,
    };
    const result = presenter.prescriptions([
      legacy,
      {
        ...legacy,
        id: 'range',
        targetReps: null,
        targetRepsMin: 6,
        targetRepsMax: 10,
      },
    ]);
    expect(
      result.map((row) => [
        row.targetReps,
        row.targetRepsMin,
        row.targetRepsMax,
        row.targetLoad,
        row.targetLoadUnit,
        row.hasHistory,
      ]),
    ).toEqual([
      [8, 8, 8, 77.125, null, true],
      [null, 6, 10, 77.125, null, true],
    ]);
    expect(legacy.targetLoad).toBeInstanceOf(Decimal);
    expect(legacy.targetRepsMin).toBeNull();
    expect(presenter.prescriptions([])).toEqual([]);
  });
  it('excludes persistence and owner data at every nested level, preserving retirement timestamps', () => {
    const internal = {
      athleteId: 'secret-owner',
      planWeekId: 'secret-week',
      _count: { workoutSessions: 9 },
      creationRequestHash: 'secret-hash',
    };
    const result = presenter.planning(
      new TrainingPlan({
        ...planAttributes,
        ...internal,
        weeks: [
          {
            ...weekAttributes,
            ...internal,
            days: [
              {
                ...day,
                ...internal,
                retiredAt: new Date('2027-01-10T12:30:00.000Z'),
                exercises: [
                  {
                    ...prescription,
                    ...internal,
                    exercise: {
                      ...prescription.exercise,
                      ownerId: 'secret-owner',
                    },
                  },
                ],
              },
            ],
            pendingExercises: [{ ...prescription, ...internal }],
          },
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(JSON.stringify(result)).not.toContain('_count');
    expect(result.weeks[0]!.days[0]!.retiredAt?.toISOString()).toBe(
      '2027-01-10T12:30:00.000Z',
    );
  });
});
