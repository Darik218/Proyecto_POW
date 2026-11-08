import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AthletesService } from '../athletes/athletes.service';
import type { AthletesRepository } from '../athletes/athletes.repository';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WorkoutRepositoryError } from './workout-sessions.repository';
import type {
  WorkoutDetail,
  WorkoutSessionsRepository,
} from './workout-sessions.repository';
import {
  AddWorkoutExerciseDto,
  CreateWorkoutSessionDto,
  EmptyWorkoutBodyPipe,
  ListWorkoutSessionsDto,
} from './dto/workout-session.dto';
import { sessionTransition } from './workout-session.policy';

const id = '10000000-0000-4000-8000-000000000001';
const intent = {
  id,
  performedOn: '2026-01-01',
  timeZone: 'UTC',
  recordingMode: 'RETROSPECTIVE' as const,
};
const athleteId = '20000000-0000-4000-8000-000000000001';
const now = new Date('2026-11-05T12:00:00.000Z');
const identity = {
  account: {
    id,
    email: 'fixture@example.test',
    status: 'ACTIVE' as const,
    createdAt: now,
    updatedAt: now,
  },
  sessionId: id,
};
const workout: WorkoutDetail = {
  id,
  status: 'IN_PROGRESS',
  startedAt: now,
  finishedAt: null,
  createdAt: now,
  updatedAt: now,
  notes: null,
  trainingPlan: null,
  planWeek: null,
  exerciseCount: 0,
  exercises: [],
};
const repository = {
  prepare: jest.fn<WorkoutSessionsRepository['prepare']>(),
  associate: jest.fn<WorkoutSessionsRepository['associate']>(),
  suggestions: jest.fn<WorkoutSessionsRepository['suggestions']>(),
  saveDay: jest.fn<WorkoutSessionsRepository['saveDay']>(),
  recordSet: jest.fn<WorkoutSessionsRepository['recordSet']>(),
  cancel: jest.fn<WorkoutSessionsRepository['cancel']>(),
  list: jest.fn<WorkoutSessionsRepository['list']>(),
  get: jest.fn<WorkoutSessionsRepository['get']>(),
  create: jest.fn<WorkoutSessionsRepository['create']>(),
  addExercise: jest.fn<WorkoutSessionsRepository['addExercise']>(),
  start: jest.fn<WorkoutSessionsRepository['start']>(),
  complete: jest.fn<WorkoutSessionsRepository['complete']>(),
};
const findProfile = jest
  .fn<AthletesRepository['findProfileByUserId']>()
  .mockResolvedValue({
    id: athleteId,
    birthDate: null,
    preferredUnit: 'KG',
    createdAt: now,
    updatedAt: now,
  });
const athletesRepository: AthletesRepository = {
  findProfileByUserId: findProfile,
  updateProfile: jest.fn<AthletesRepository['updateProfile']>(),
  findMeasurements: jest.fn<AthletesRepository['findMeasurements']>(),
  createMeasurement: jest.fn<AthletesRepository['createMeasurement']>(),
};
const service = new WorkoutSessionsService(
  repository,
  new AthletesService(athletesRepository),
);

describe('Workout session service and lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());
  it('resolves ownership through the existing athlete service for creation and reads', async () => {
    repository.create.mockResolvedValue(workout);
    repository.get.mockResolvedValue(workout);
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    await expect(service.create(identity, intent)).resolves.toEqual(workout);
    await service.get(identity, id);
    await service.list(identity, { limit: 20, offset: 0 });
    expect(findProfile).toHaveBeenCalledWith(identity.account.id);
    expect(repository.create).toHaveBeenCalledWith(athleteId, intent);
    expect(repository.get).toHaveBeenCalledWith(athleteId, id);
    expect(repository.list).toHaveBeenCalledWith(athleteId, {
      limit: 20,
      offset: 0,
    });
  });
  it('rejects incomplete plan associations before creating anything', async () => {
    expect(() =>
      service.create(identity, { ...intent, trainingPlanId: id }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.create(identity, { ...intent, planWeekId: id }),
    ).toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('hides missing and foreign sessions and translates domain conflicts', async () => {
    repository.get.mockResolvedValue(null);
    await expect(service.get(identity, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    repository.addExercise.mockRejectedValue(
      new WorkoutRepositoryError('missing', 'Unavailable'),
    );
    await expect(
      service.addExercise(identity, id, {
        id,
        exerciseId: id,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    repository.complete.mockRejectedValue(
      new WorkoutRepositoryError('conflict', 'Closed'),
    );
    await expect(service.complete(identity, id, 0)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('sanitizes persistence races without leaking PostgreSQL details', async () => {
    repository.create.mockRejectedValue({ code: 'P2002', internal: 'secret' });
    await expect(service.create(identity, intent)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('starts PLANNED sessions and preserves repeated start and completion timestamps', () => {
    expect(
      sessionTransition(
        { status: 'PLANNED', startedAt: null, finishedAt: null },
        'start',
        0,
        now,
      ),
    ).toEqual({ status: 'IN_PROGRESS', startedAt: now });
    expect(sessionTransition(workout, 'start', 0, now)).toBeNull();
    const update = sessionTransition(workout, 'complete', 1, now);
    expect(update).toEqual({ status: 'COMPLETED', finishedAt: now });
    expect(
      sessionTransition(
        { ...workout, status: 'COMPLETED', finishedAt: now },
        'complete',
        1,
        new Date(now.getTime() + 1000),
      ),
    ).toBeNull();
  });
  it.each(['PLANNED', 'CANCELLED'] as const)(
    'rejects completion from %s',
    (status) => {
      expect(() =>
        sessionTransition({ ...workout, status }, 'complete', 1, now),
      ).toThrow(WorkoutRepositoryError);
    },
  );
  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'rejects restarting %s',
    (status) => {
      expect(() =>
        sessionTransition(
          { ...workout, status, finishedAt: now },
          'start',
          1,
          now,
        ),
      ).toThrow(WorkoutRepositoryError);
    },
  );
  it('rejects empty sessions and inconsistent timestamps', () => {
    expect(() => sessionTransition(workout, 'complete', 0, now)).toThrow(
      WorkoutRepositoryError,
    );
    expect(() =>
      sessionTransition({ ...workout, startedAt: null }, 'complete', 1, now),
    ).toThrow(WorkoutRepositoryError);
    expect(() =>
      sessionTransition({ ...workout, finishedAt: now }, 'complete', 1, now),
    ).toThrow(WorkoutRepositoryError);
  });
});

describe('Workout DTO validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  it('accepts the minimal creation intent and bounded pagination', async () => {
    await expect(
      pipe.transform(intent, {
        type: 'body',
        metatype: CreateWorkoutSessionDto,
      }),
    ).resolves.toMatchObject({ id });
    await expect(
      pipe.transform(
        { limit: '100', offset: '0' },
        { type: 'query', metatype: ListWorkoutSessionsDto },
      ),
    ).resolves.toMatchObject({ limit: 100, offset: 0 });
  });
  it.each([
    { athleteId },
    { status: 'COMPLETED' },
    { startedAt: now.toISOString() },
    { repetitions: 5 },
  ])('rejects ownership, lifecycle and F07 fields: %p', async (fields) => {
    await expect(
      pipe.transform(
        { ...intent, ...fields },
        { type: 'body', metatype: CreateWorkoutSessionDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects invalid IDs, notes, list limits and executed-set input', async () => {
    await expect(
      pipe.transform(
        { id: 'invalid' },
        { type: 'body', metatype: CreateWorkoutSessionDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { id, exerciseId: id, notes: 'x'.repeat(4001) },
        { type: 'body', metatype: AddWorkoutExerciseDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { id, exerciseId: id, load: 50 },
        { type: 'body', metatype: AddWorkoutExerciseDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { limit: 0, offset: -1, status: 'PAUSED' },
        { type: 'query', metatype: ListWorkoutSessionsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not accept arbitrary fields on lifecycle actions', () => {
    const empty = new EmptyWorkoutBodyPipe();
    expect(empty.transform({})).toEqual({});
    expect(() => empty.transform({ status: 'COMPLETED' })).toThrow(
      BadRequestException,
    );
    expect(() => empty.transform([])).toThrow(BadRequestException);
  });
});
