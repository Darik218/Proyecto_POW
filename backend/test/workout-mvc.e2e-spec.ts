import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/client';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { PrismaService } from '../src/database/prisma.service';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import { WorkoutSessionsController } from '../src/controllers/workout-sessions/workout-sessions.controller';
import { WorkoutSession } from '../src/models/workout-sessions/workout-session.model';
import { WorkoutSessionsPresenter } from '../src/views/workout-sessions/workout-sessions.presenter';

const isolated = process.env.MVC4_TEST_DATABASE_URL ? describe : describe.skip;
isolated('MVC-4 workout contracts with isolated PostgreSQL', () => {
  let app: INestApplication, prisma: PrismaService;
  let owner: { token: string; athleteId: string }, other: typeof owner;
  const ids = {
    plan: randomUUID(),
    week: randomUUID(),
    prescription: randomUUID(),
    workout: randomUUID(),
    exercise: randomUUID(),
    workoutExercise: randomUUID(),
    set: randomUUID(),
  };
  const groupName = 'MVC4 ' + randomUUID();
  const stamp = new Date('2026-01-01T10:00:00.123Z');
  const finished = new Date('2026-01-01T11:00:00.456Z');
  const post = (path: string, body: object, actor = owner?.token ?? '') =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const get = (path: string, actor = owner?.token ?? '') =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${actor}`);
  const patch = (path: string, body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1' + path)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body);
  const expectedSummary = () => ({
    scheduledActivityId: null,
    sourceSnapshot: null,
    id: ids.workout,
    performedOn: null,
    timeZone: null,
    recordingMode: null,
    name: null,
    version: 0,
    completedAt: null,
    planDay: null,
    status: 'COMPLETED',
    startedAt: '2026-01-01T10:00:00.123Z',
    finishedAt: '2026-01-01T11:00:00.456Z',
    notes: 'Histórica',
    createdAt: '2026-01-01T10:00:00.123Z',
    updatedAt: '2026-01-01T10:00:00.123Z',
    trainingPlan: { id: ids.plan, name: 'Plan histórico MVC4' },
    planWeek: { id: ids.week, weekNumber: 1 },
    exerciseCount: 1,
    actualSetCount: 1,
    completedSetCount: 0,
  });
  const expectedExercise = () => ({
    id: ids.workoutExercise,
    orderInSession: 1,
    notes: null,
    isOmitted: false,
    replacesWorkoutExerciseId: null,
    sets: [
      {
        id: ids.set,
        setNumber: 1,
        load: '42.125',
        loadUnit: null,
        loadKg: null,
        repetitions: 8,
        rpe: 7.5,
        kind: null,
        status: null,
        isCompleted: false,
        notes: '',
        recordedAt: '2026-01-01T10:10:00.000Z',
        version: 0,
      },
    ],
    original: null,
    targets: {
      targetSets: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetLoad: null,
      targetLoadUnit: null,
      targetRpe: null,
    },
    exercise: {
      id: ids.exercise,
      name: 'Sentadilla histórica',
      equipment: 'Barra',
      muscleGroup: groupName,
    },
    prescription: {
      id: ids.prescription,
      targetSets: 3,
      targetReps: 8,
      targetRepsMin: null,
      targetRepsMax: null,
      targetLoadUnit: null,
      targetRpe: 8.5,
      targetLoad: 55.555,
      notes: null,
    },
  });
  beforeAll(async () => {
    if (
      process.env.MVC4_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test' ||
      !process.env.MVC4_TEST_DATA_DIRECTORY?.startsWith(
        join(tmpdir(), 'pulso-mvc4-'),
      )
    )
      throw new Error('Use the verified disposable MVC-4 runner.');
    const module = await Test.createTestingModule({
      imports: [WorkoutSessionsModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const [target] = await prisma.$queryRaw<
      { database: string; directory: string }[]
    >`SELECT current_database() AS database, current_setting('data_directory') AS directory`;
    if (
      target?.database !== 'pulso_f06_test' ||
      target.directory !== process.env.MVC4_TEST_DATA_DIRECTORY
    )
      throw new Error('Cluster mismatch; refusing fixture writes.');
    async function actor() {
      const response = await post(
        '/auth/register',
        {
          email: `mvc4-${randomUUID()}@example.test`,
          password: 'isolated-mvc4-password-123',
        },
        '',
      )
        .set('Origin', 'http://localhost:5173')
        .expect(201);
      const athlete = await prisma.athlete.findUniqueOrThrow({
        where: { userId: response.body.user.id as string },
      });
      return {
        token: response.body.accessToken as string,
        athleteId: athlete.id,
      };
    }
    owner = await actor();
    other = await actor();
    const group = await prisma.muscleGroup.create({
      data: { key: 'mvc4-' + randomUUID(), name: groupName },
    });
    await prisma.exercise.create({
      data: {
        id: ids.exercise,
        primaryMuscleGroupId: group.id,
        name: 'Sentadilla histórica',
        equipment: 'Barra',
      },
    });
    await prisma.trainingPlan.create({
      data: {
        id: ids.plan,
        athleteId: owner.athleteId,
        name: 'Plan histórico MVC4',
        weeks: {
          create: {
            id: ids.week,
            weekNumber: 1,
            planExercises: {
              create: {
                id: ids.prescription,
                exerciseId: ids.exercise,
                position: 1,
                targetSets: 3,
                targetReps: 8,
                targetLoad: '55.555',
                targetRpe: '8.5',
              },
            },
          },
        },
      },
    });
    await prisma.workoutSession.create({
      data: {
        id: ids.workout,
        athleteId: owner.athleteId,
        trainingPlanId: ids.plan,
        planWeekId: ids.week,
        status: 'COMPLETED',
        startedAt: stamp,
        finishedAt: finished,
        notes: 'Histórica',
        createdAt: stamp,
        updatedAt: stamp,
        exercises: {
          create: {
            id: ids.workoutExercise,
            exerciseId: ids.exercise,
            planExerciseId: ids.prescription,
            orderInSession: 1,
            sets: {
              create: {
                id: ids.set,
                setNumber: 1,
                load: '42.125',
                repetitions: 8,
                rpe: '7.5',
                status: null,
                kind: null,
                isCompleted: false,
                notes: '',
                recordedAt: new Date('2026-01-01T10:10:00.000Z'),
              },
            },
          },
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  it('preserves exact legacy detail, unknown units and unclassified series without inventing original targets', async () => {
    const response = await get('/workout-sessions/' + ids.workout).expect(200);
    expect(response.body).toEqual({
      ...expectedSummary(),
      exercises: [expectedExercise()],
    });
  });
  it('preserves history pagination, filters, counts and empty pages without counting objectives as results', async () => {
    const page = await get(
      '/workout-sessions?limit=1&offset=0&status=COMPLETED',
    ).expect(200);
    expect(page.body).toEqual({
      items: [expectedSummary()],
      total: 1,
      limit: 1,
      offset: 0,
    });
    expect(
      (
        await get('/workout-sessions?limit=1&offset=1&status=COMPLETED').expect(
          200,
        )
      ).body,
    ).toEqual({ items: [], total: 1, limit: 1, offset: 1 });
    expect(
      (
        await get(
          '/workout-sessions/suggestions?performedOn=2026-01-01&timeZone=UTC',
        ).expect(200)
      ).body,
    ).toEqual({
      performedOn: '2026-01-01',
      timeZone: 'UTC',
      resolution: 'NONE',
      candidates: [],
    });
  });
  it('retains native authentication, ownership, UUID validation and bounded query parameters', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/workout-sessions')
      .expect(401);
    await get('/workout-sessions/' + ids.workout, other.token).expect(404);
    expect(
      (await get('/workout-sessions', other.token).expect(200)).body,
    ).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    await get('/workout-sessions/invalid').expect(400);
    await get('/workout-sessions?limit=101').expect(400);
    await post('/workout-sessions', {
      id: randomUUID(),
      performedOn: '2026-01-01',
      timeZone: 'UTC',
      athleteId: other.athleteId,
    }).expect(400);
  });
  it('registers one guarded controller and carries raw Decimal models through the real detail and history views', async () => {
    const controllers = [...app.get(ModulesContainer).values()].flatMap(
      (module) => [...module.controllers.values()],
    );
    expect(
      controllers.filter(
        (wrapper) => wrapper.metatype === WorkoutSessionsController,
      ),
    ).toHaveLength(1);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WorkoutSessionsController),
    ).toEqual([AccessTokenGuard]);
    const presenter = app.get(WorkoutSessionsPresenter);
    const view = jest.spyOn(presenter, 'detail'),
      page = jest.spyOn(presenter, 'page');
    try {
      await get('/workout-sessions/' + ids.workout).expect(200);
      const model = view.mock.calls[0]![0];
      expect(model).toBeInstanceOf(WorkoutSession);
      const set = model.attributes.exercises[0]!.sets![0]!;
      expect(set.load).toBeInstanceOf(Decimal);
      expect(set.rpe).toBeInstanceOf(Decimal);
      expect(set.load?.toString()).toBe('42.125');
      expect(
        model.attributes.exercises[0]!.prescription!.targetLoad,
      ).toBeInstanceOf(Decimal);
      expect(set.status).toBeNull();
      expect(set.isCompleted).toBe(false);
      await get('/workout-sessions').expect(200);
      expect(
        page.mock.calls[0]![0].items.every(
          (item) => item instanceof WorkoutSession,
        ),
      ).toBe(true);
    } finally {
      view.mockRestore();
      page.mockRestore();
    }
  });
  it('keeps captured identity and original goals independent from adjusted goals and later source changes', async () => {
    const group = await prisma.exercise.findUniqueOrThrow({
      where: { id: ids.exercise },
      select: { primaryMuscleGroupId: true },
    });
    const exercise = await prisma.exercise.create({
      data: {
        primaryMuscleGroupId: group.primaryMuscleGroupId,
        name: 'Identidad capturada',
        equipment: 'Mancuernas',
      },
    });
    const day = await prisma.planDay.create({
      data: { planWeekId: ids.week, name: 'Push capturado', position: 1 },
    });
    const prescribed = await prisma.planExercise.create({
      data: {
        planWeekId: ids.week,
        planDayId: day.id,
        exerciseId: exercise.id,
        position: 1,
        targetSets: 3,
        targetReps: 8,
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetLoad: '80',
        targetLoadUnit: 'KG',
        targetRpe: '7.5',
      },
    });
    const id = randomUUID();
    const created = (
      await post('/workout-sessions', {
        id,
        performedOn: '2026-01-01',
        timeZone: 'UTC',
        recordingMode: 'RETROSPECTIVE',
        trainingPlanId: ids.plan,
        planWeekId: ids.week,
        planDayId: day.id,
      }).expect(201)
    ).body;
    const original = created.exercises[0].original;
    expect(original.targets).toEqual({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 8,
      targetLoad: '80',
      targetLoadUnit: 'KG',
      targetRpe: 7.5,
    });
    const adjusted = (
      await patch(
        `/workout-sessions/${id}/exercises/${created.exercises[0].id}`,
        { expectedVersion: created.version, targetLoad: '77.125' },
      ).expect(200)
    ).body;
    expect(adjusted.exercises[0].original).toEqual(original);
    expect(adjusted.exercises[0].targets.targetLoad).toBe('77.125');
    // Controlled fixture changes simulate later source metadata; execution snapshots are never rewritten.
    await prisma.exercise.update({
      where: { id: exercise.id },
      data: { name: 'Nombre posterior' },
    });
    await prisma.planExercise.update({
      where: { id: prescribed.id },
      data: { targetLoad: '900' },
    });
    const history = (await get('/workout-sessions/' + id).expect(200)).body;
    expect(history.exercises[0].exercise.name).toBe('Identidad capturada');
    expect(history.exercises[0].original).toEqual(original);
    expect(history.exercises[0].targets.targetLoad).toBe('77.125');
    expect(history.exercises[0].prescription).toBeNull();
    const stored = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: created.exercises[0].id },
    });
    expect(stored.originalSnapshot).toEqual(original);
    expect(stored.targetLoad?.toString()).toBe('77.125');
  });
  it('preserves real set writes and retries, completion, repetition and export using objectives instead of actual loads', async () => {
    const id = randomUUID();
    let current = (
      await post('/workout-sessions', {
        id,
        performedOn: '2026-01-01',
        timeZone: 'UTC',
        recordingMode: 'RETROSPECTIVE',
      }).expect(201)
    ).body;
    current = (
      await post(`/workout-sessions/${id}/exercises`, {
        id: randomUUID(),
        exerciseId: ids.exercise,
        expectedVersion: current.version,
        targetSets: 2,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetLoad: '80',
        targetLoadUnit: 'LB',
      }).expect(201)
    ).body;
    const exerciseId = current.exercises[0].id;
    const original = current.exercises[0].original;
    current = (
      await post(`/workout-sessions/${id}/start`, {
        expectedVersion: current.version,
      }).expect(200)
    ).body;
    const setId = randomUUID();
    const input = {
      id: setId,
      expectedVersion: current.version,
      setNumber: 1,
      status: 'COMPLETED',
      kind: 'WORK',
      load: '165.347',
      loadUnit: 'LB',
      repetitions: 8,
      rpe: 8.5,
    };
    current = (
      await post(
        `/workout-sessions/${id}/exercises/${exerciseId}/sets`,
        input,
      ).expect(201)
    ).body;
    expect(current.exercises[0].sets[0]).toMatchObject({
      load: '165.347',
      loadUnit: 'LB',
      loadKg: '75.000138',
      repetitions: 8,
      rpe: 8.5,
    });
    const replay = (
      await post(
        `/workout-sessions/${id}/exercises/${exerciseId}/sets`,
        input,
      ).expect(201)
    ).body;
    expect(replay).toEqual(current);
    expect(
      await prisma.setRecord.count({
        where: { workoutExerciseId: exerciseId },
      }),
    ).toBe(1);
    current = (
      await patch(
        `/workout-sessions/${id}/exercises/${exerciseId}/sets/${setId}`,
        {
          expectedVersion: current.version,
          expectedSetVersion: 0,
          setNumber: 1,
          status: 'INCOMPLETE',
          kind: 'WORK',
          load: '160.5',
          loadUnit: 'LB',
          repetitions: 7,
          rpe: 9,
        },
      ).expect(200)
    ).body;
    expect(current.exercises[0].original).toEqual(original);
    expect(current.exercises[0].targets.targetLoad).toBe('80');
    const version = current.version;
    current = (
      await post(`/workout-sessions/${id}/complete`, {
        expectedVersion: version,
      }).expect(200)
    ).body;
    expect(current).toMatchObject({
      status: 'COMPLETED',
      actualSetCount: 1,
      completedSetCount: 0,
    });
    expect(
      (
        await post(`/workout-sessions/${id}/complete`, {
          expectedVersion: version,
        }).expect(200)
      ).body,
    ).toEqual(current);
    await patch('/workout-sessions/' + id, {
      expectedVersion: current.version,
      notes: 'No permitido',
    }).expect(409);
    const repeated = (
      await post('/workout-sessions', {
        id: randomUUID(),
        repeatFromId: id,
        performedOn: '2026-01-02',
        timeZone: 'UTC',
        recordingMode: 'RETROSPECTIVE',
      }).expect(201)
    ).body;
    expect(repeated.id).not.toBe(id);
    expect(repeated.exercises[0].id).not.toBe(exerciseId);
    expect(repeated.exercises[0].sets).toEqual([]);
    expect(repeated.exercises[0].targets.targetLoad).toBe('80');
    const destination = await prisma.trainingPlan.create({
      data: {
        athleteId: owner.athleteId,
        name: 'Destino MVC4',
        weeks: { create: { weekNumber: 1 } },
      },
      include: { weeks: true },
    });
    const dayId = randomUUID();
    const saved = (
      await post(`/workout-sessions/${id}/save-as-plan-day`, {
        id: dayId,
        trainingPlanId: destination.id,
        planWeekId: destination.weeks[0]!.id,
        name: 'Rutina guardada',
        position: 1,
      }).expect(201)
    ).body;
    expect(saved).toEqual({
      id: dayId,
      name: 'Rutina guardada',
      planWeekId: destination.weeks[0]!.id,
      trainingPlanId: destination.id,
    });
    const prescription = await prisma.planExercise.findFirstOrThrow({
      where: { planDayId: dayId },
    });
    expect(prescription.targetLoad?.toString()).toBe('80');
    expect(prescription.targetLoadUnit).toBe('LB');
    expect((await get('/workout-sessions/' + id).expect(200)).body).toEqual(
      current,
    );
  });
});
