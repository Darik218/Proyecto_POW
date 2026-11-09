import { Decimal } from '@prisma/client/runtime/client';
import { WorkoutSession } from '../../models/workout-sessions/workout-session.model';
import { WorkoutSessionsPresenter } from './workout-sessions.presenter';
import {
  workoutAttributes,
  workoutExerciseAttributes,
  setAttributes,
} from '../../../test/fixtures/workout.fixture';
const presenter = new WorkoutSessionsPresenter();
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('Workout JSON representations', () => {
  it('preserves exact nested JSON, dates and separate original, adjusted and actual values', () => {
    const model = new WorkoutSession({
      ...workoutAttributes,
      exercises: [workoutExerciseAttributes],
    });
    expect(json(presenter.detail(model))).toEqual({
      id: '71000000-0000-4000-8000-000000000001',
      status: 'IN_PROGRESS',
      startedAt: '2026-01-01T10:00:00.123Z',
      finishedAt: null,
      createdAt: '2026-01-01T09:00:00.456Z',
      updatedAt: '2026-01-01T10:00:00.123Z',
      notes: null,
      trainingPlan: null,
      planWeek: null,
      exerciseCount: 1,
      version: 3,
      name: 'Entrenamiento MVC4',
      sourceSnapshot: {
        kind: 'FREE',
        plan: null,
        week: null,
        day: null,
        session: null,
      },
      exercises: [
        {
          id: '73000000-0000-4000-8000-000000000001',
          orderInSession: 1,
          notes: null,
          isOmitted: false,
          replacesWorkoutExerciseId: null,
          exercise: {
            id: '72000000-0000-4000-8000-000000000001',
            name: 'Press histórico',
            equipment: 'Barra',
            muscleGroup: 'Pectorales',
          },
          original: {
            source: { kind: 'FREE', id: null },
            exercise: {
              id: '72000000-0000-4000-8000-000000000001',
              name: 'Press histórico',
              equipment: 'Barra',
              muscleGroup: 'Pectorales',
            },
            targets: {
              targetSets: 3,
              targetRepsMin: 6,
              targetRepsMax: 8,
              targetLoad: '80',
              targetLoadUnit: 'KG',
              targetRpe: 7.5,
            },
            position: 1,
            notes: null,
          },
          targets: {
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetLoad: '77.125',
            targetLoadUnit: 'KG',
            targetRpe: 8.5,
          },
          sets: [
            {
              id: '74000000-0000-4000-8000-000000000001',
              setNumber: 1,
              load: '75.125',
              loadKg: '75.125',
              loadUnit: 'KG',
              repetitions: 7,
              rpe: 9.5,
              kind: 'WORK',
              status: 'INCOMPLETE',
              isCompleted: false,
              notes: '',
              recordedAt: '2026-01-01T10:15:00.789Z',
              version: 1,
            },
          ],
          prescription: null,
        },
      ],
    });
    expect(model.attributes.exercises[0]!.targets!.targetLoad).toBeInstanceOf(
      Decimal,
    );
    expect(model.attributes.exercises[0]!.sets![0]!.rpe).toBeInstanceOf(
      Decimal,
    );
  });
  it('preserves pagination, supplied ordering, absent fields and empty history', () => {
    const {
      sourceSnapshot: _snapshot,
      version: _version,
      name: _name,
      ...old
    } = workoutAttributes;
    const summary = presenter.summary(new WorkoutSession(old));
    expect(summary).not.toHaveProperty('sourceSnapshot');
    expect(summary).not.toHaveProperty('version');
    expect(
      presenter.page({
        items: [new WorkoutSession(old)],
        total: 21,
        limit: 1,
        offset: 20,
      }),
    ).toEqual({ items: [summary], total: 21, limit: 1, offset: 20 });
    expect(
      presenter.page({ items: [], total: 0, limit: 20, offset: 0 }),
    ).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    const {
      original: _original,
      targets: _targets,
      sets: _sets,
      ...legacy
    } = workoutExerciseAttributes;
    const response = presenter.detail(
      new WorkoutSession({
        ...old,
        exercises: [legacy, { ...legacy, id: 'later' }],
      }),
    );
    expect(response.exercises.map((row) => row.id)).toEqual([
      legacy.id,
      'later',
    ]);
    expect(response.exercises[0]).not.toHaveProperty('original');
    expect(response.exercises[0]).not.toHaveProperty('targets');
    expect(response.exercises[0]).not.toHaveProperty('sets');
  });
  it('keeps null, zero, unknown units and unclassified historical series unchanged', () => {
    const result = presenter.set({
      ...setAttributes,
      load: new Decimal(0),
      loadKg: null,
      loadUnit: null,
      repetitions: 0,
      rpe: new Decimal(0),
      kind: null,
      status: null,
      isCompleted: false,
    });
    expect(result).toMatchObject({
      load: '0',
      loadKg: null,
      loadUnit: null,
      repetitions: 0,
      rpe: 0,
      kind: null,
      status: null,
      isCompleted: false,
    });
    expect(
      presenter.set({ ...setAttributes, load: null, rpe: null }).load,
    ).toBeNull();
    expect(
      presenter.set({
        ...setAttributes,
        load: new Decimal('99999.999'),
        loadKg: new Decimal('45359.236546'),
      }),
    ).toMatchObject({ load: '99999.999', loadKg: '45359.236546' });
  });
  it('allowlists model data and both historical JSON snapshots without exposing nested private fields', () => {
    const secret = {
      athleteId: 'private-athlete',
      ownerId: 'private-owner',
      passwordHash: 'private-hash',
      creationRequestHash: 'private-request',
      importOperations: ['private-import'],
      token: 'private-token',
    };
    const original = workoutExerciseAttributes.original;
    const model = new WorkoutSession({
      ...workoutAttributes,
      ...secret,
      sourceSnapshot: { ...workoutAttributes.sourceSnapshot, ...secret },
      exercises: [
        {
          ...workoutExerciseAttributes,
          ...secret,
          exercise: { ...workoutExerciseAttributes.exercise, ...secret },
          targets: { ...workoutExerciseAttributes.targets, ...secret },
          sets: [{ ...setAttributes, ...secret }],
          original: {
            ...original,
            ...secret,
            source: { ...original.source, ...secret },
            exercise: { ...original.exercise, ...secret },
            targets: { ...original.targets, ...secret },
          },
        },
      ],
    });
    expect(JSON.stringify(presenter.detail(model))).not.toContain('private-');
  });
  it('preserves legacy prescription numeric values and optional ranges without inventing snapshots', () => {
    const prescription = {
      id: 'old',
      targetSets: 3,
      targetReps: 8,
      targetRpe: new Decimal('7.5'),
      targetLoad: new Decimal('42.125'),
      notes: null,
    };
    const response = presenter.detail(
      new WorkoutSession({
        ...workoutAttributes,
        exercises: [
          { ...workoutExerciseAttributes, original: null, prescription },
        ],
      }),
    );
    expect(response.exercises[0]!.original).toBeNull();
    expect(response.exercises[0]!.prescription).toEqual({
      id: 'old',
      targetSets: 3,
      targetReps: 8,
      targetRpe: 7.5,
      targetLoad: 42.125,
      notes: null,
    });
  });
  it('preserves suggestions and saved-day acknowledgements with explicit fields only', () => {
    const result = {
      performedOn: '2026-01-01',
      timeZone: 'UTC',
      resolution: 'NONE' as const,
      candidates: [],
      secret: 'private',
    };
    expect(presenter.suggestions(result)).toEqual({
      performedOn: '2026-01-01',
      timeZone: 'UTC',
      resolution: 'NONE',
      candidates: [],
    });
    expect(
      presenter.savedDay({
        id: 'day',
        name: 'Push',
        planWeekId: 'week',
        trainingPlanId: 'plan',
      }),
    ).toEqual({
      id: 'day',
      name: 'Push',
      planWeekId: 'week',
      trainingPlanId: 'plan',
    });
  });
});
