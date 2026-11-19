import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/client';
import request from 'supertest';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { TrainingPlansController } from '../src/controllers/training-plans/training-plans.controller';
import { DailyPlanningController } from '../src/controllers/training-plans/daily-planning.controller';
import { FlexiblePlanningController } from '../src/controllers/training-plans/flexible-planning.controller';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import { PrismaService } from '../src/database/prisma.service';
import { TrainingPlan } from '../src/models/training-plans/training-plan.model';
import { ScheduledActivity } from '../src/models/training-plans/scheduled-activity.model';
import { TrainingPlansPresenter } from '../src/views/training-plans/training-plans.presenter';
import { DailyPlanningPresenter } from '../src/views/training-plans/daily-planning.presenter';
import { FlexiblePlanningPresenter } from '../src/views/training-plans/flexible-planning.presenter';

const isolated = process.env.MVC3_TEST_DATABASE_URL ? describe : describe.skip;
isolated('MVC-3 HTTP with isolated PostgreSQL', () => {
  let app: INestApplication,
    prisma: PrismaService,
    token: string,
    other: string,
    exerciseId: string;
  const post = (path: string, body: object, actor = token) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const get = (path: string, actor = token) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${actor}`);
  const patch = (path: string, body: object, actor = token) =>
    request(app.getHttpServer())
      .patch('/api/v1' + path)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const generate = async () => {
    const id = randomUUID();
    await post('/routine/plans', {
      id,
      name: 'MVC-3',
      durationWeeks: 1,
      frequency: 2,
      startsOn: '2027-01-04',
      timeZone: 'America/Bogota',
      days: [
        { name: 'Push', weekday: 1 },
        { name: 'Pull', weekday: null },
      ],
    }).expect(201);
    const plan = await prisma.trainingPlan.findUniqueOrThrow({
      where: { id },
      include: {
        weeks: { include: { days: { orderBy: { position: 'asc' } } } },
      },
    });
    return {
      plan,
      week: plan.weeks[0]!,
      push: plan.weeks[0]!.days[0]!,
      pull: plan.weeks[0]!.days[1]!,
    };
  };
  beforeAll(async () => {
    if (
      process.env.MVC3_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test' ||
      !process.env.MVC3_TEST_DATA_DIRECTORY?.startsWith(
        join(tmpdir(), 'pulso-mvc3-'),
      )
    )
      throw new Error('Use the verified MVC-3 disposable cluster runner.');
    const module = await Test.createTestingModule({
      imports: [TrainingPlansModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const [target] = await prisma.$queryRaw<
      { database: string; directory: string }[]
    >`SELECT current_database() AS database, current_setting('data_directory') AS directory`;
    if (
      target?.database !== 'pulso_f06_test' ||
      target.directory !== process.env.MVC3_TEST_DATA_DIRECTORY
    )
      throw new Error('Cluster identity mismatch; no fixture writes allowed.');
    async function actor() {
      const response = await post(
        '/auth/register',
        {
          email: `mvc3-${randomUUID()}@example.test`,
          password: 'isolated-mvc3-password-123',
        },
        '',
      )
        .set('Origin', 'http://localhost:5173')
        .expect(201);
      return response.body.accessToken as string;
    }
    token = await actor();
    other = await actor();
    const group = await prisma.muscleGroup.create({
      data: { key: 'mvc3-' + randomUUID(), name: 'MVC3 ' + randomUUID() },
    });
    exerciseId = (
      await prisma.exercise.create({
        data: {
          name: 'MVC3 bench',
          equipment: 'Barra',
          primaryMuscleGroupId: group.id,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('registers each MVC controller once with its native guard and connected presenters', () => {
    const registered = [...app.get(ModulesContainer).values()].flatMap(
      (module) => [...module.controllers.values()],
    );
    for (const controller of [
      TrainingPlansController,
      DailyPlanningController,
      FlexiblePlanningController,
    ]) {
      expect(
        registered.filter((wrapper) => wrapper.metatype === controller),
      ).toHaveLength(1);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        AccessTokenGuard,
      ]);
    }
    expect(app.get(TrainingPlansPresenter)).toBeInstanceOf(
      TrainingPlansPresenter,
    );
    expect(app.get(DailyPlanningPresenter)).toBeInstanceOf(
      DailyPlanningPresenter,
    );
    expect(app.get(FlexiblePlanningPresenter)).toBeInstanceOf(
      FlexiblePlanningPresenter,
    );
  });
  it('passes real plan aggregates and Decimal targets through presenters while preserving public contracts', async () => {
    const { plan, week, push, pull } = await generate();
    const summary = jest.spyOn(app.get(TrainingPlansPresenter), 'summary');
    const daily = jest.spyOn(app.get(DailyPlanningPresenter), 'planning');
    try {
      const details = (await get('/training-plans/' + plan.id).expect(200))
        .body;
      expect(Object.keys(details).sort()).toEqual([
        'createdAt',
        'endsOn',
        'id',
        'name',
        'startsOn',
        'status',
        'updatedAt',
        'version',
        'weeks',
      ]);
      expect(details.startsOn).toBe('2027-01-04T00:00:00.000Z');
      expect(summary).toHaveBeenCalledWith(expect.any(TrainingPlan));
      const created = (
        await post(`/training-plans/${plan.id}/weeks/${week.id}/exercises`, {
          exerciseId,
          position: 1,
          targetSets: 3,
          targetReps: 8,
          targetRpe: 0,
          targetLoad: 77.125,
        }).expect(201)
      ).body;
      expect(created).toMatchObject({ targetRpe: 0, targetLoad: 77.125 });
      expect(created).not.toHaveProperty('targetLoadUnit');
      expect(created.exercise).toHaveProperty('primaryMuscleGroup');
      const response = (
        await get(`/training-plans/${plan.id}/planning`).expect(200)
      ).body;
      expect(
        response.weeks[0].days.map(
          (day: { name: string; weekday: number | null }) => [
            day.name,
            day.weekday,
          ],
        ),
      ).toEqual([
        ['Push', 1],
        ['Pull', null],
      ]);
      expect(response.weeks[0].pendingExercises[0]).toMatchObject({
        id: created.id,
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetLoad: 77.125,
        targetLoadUnit: null,
        hasHistory: false,
      });
      const model = daily.mock.calls[0]![0];
      expect(model).toBeInstanceOf(TrainingPlan);
      expect(
        model.attributes.weeks[0]!.pendingExercises[0]!.targetLoad,
      ).toBeInstanceOf(Decimal);
      expect(
        model.attributes.weeks[0]!.pendingExercises[0]!.targetLoad?.toString(),
      ).toBe('77.125');
      const withExercise = (
        await post(
          `/training-plans/${plan.id}/weeks/${week.id}/days/${push.id}/exercises`,
          {
            exerciseId,
            position: 1,
            targetSets: 2,
            targetRepsMin: 6,
            targetRepsMax: 10,
            targetLoad: 0,
            targetLoadUnit: 'KG',
          },
        ).expect(201)
      ).body;
      expect(withExercise.weeks[0].days[0].exercises[0]).toMatchObject({
        targetReps: null,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetLoad: 0,
        targetLoadUnit: 'KG',
      });
      expect(
        withExercise.weeks[0].days.find(
          (day: { id: string }) => day.id === pull.id,
        ).exercises,
      ).toEqual([]);
      expect(JSON.stringify(withExercise)).not.toMatch(
        /athleteId|creationRequestHash|ownerId|passwordHash|_count/,
      );
    } finally {
      summary.mockRestore();
      daily.mockRestore();
    }
  });
  it('preserves stored idempotency results and fresh identifiers without persisting model wrappers', async () => {
    const { plan, week } = await generate();
    const input = {
      id: randomUUID(),
      expectedVersion: plan.version,
      weekId: week.id,
      name: 'Extra',
      position: 3,
      weekday: null,
    };
    const first = (
      await post(`/routine/plans/${plan.id}/days`, input).expect(201)
    ).body;
    const replay = (
      await post(`/routine/plans/${plan.id}/days`, input).expect(201)
    ).body;
    expect(first).toEqual(replay);
    expect(Object.keys(first).sort()).toEqual(['dayIds', 'planId']);
    expect(first.dayIds).toHaveLength(1);
    const operation = await prisma.planningOperation.findUniqueOrThrow({
      where: { id: input.id },
    });
    expect(operation.result).toEqual(first);
    expect(operation.result).not.toHaveProperty('attributes');
    expect(await prisma.planDay.count({ where: { planWeekId: week.id } })).toBe(
      3,
    );
  });
  it('preserves calendar identity and original dates on rescheduling, excludes private fields and never creates execution', async () => {
    const presenter = app.get(FlexiblePlanningPresenter);
    const view = jest.spyOn(presenter, 'activity');
    try {
      const id = randomUUID();
      const created = (
        await post('/routine/activities', {
          id,
          scheduledOn: '2027-01-04',
          timeZone: 'America/Bogota',
          title: 'Descanso MVC',
          status: 'REST',
        }).expect(201)
      ).body;
      expect(created).toEqual({
        id,
        planWeekId: null,
        planDayId: null,
        originalPlanDayId: null,
        originalOn: '2027-01-04T00:00:00.000Z',
        scheduledOn: '2027-01-04T00:00:00.000Z',
        timeZone: 'America/Bogota',
        title: 'Descanso MVC',
        status: 'REST',
        version: 0,
        workouts: [],
      });
      expect(view).toHaveBeenCalledWith(expect.any(ScheduledActivity));
      const updated = (
        await patch('/routine/activities/' + id, {
          expectedVersion: 0,
          scheduledOn: '2027-01-06',
        }).expect(200)
      ).body;
      expect(updated).toEqual({
        ...created,
        scheduledOn: '2027-01-06T00:00:00.000Z',
        version: 1,
      });
      await patch(
        '/routine/activities/' + id,
        { expectedVersion: 1, scheduledOn: '2027-01-07' },
        other,
      ).expect(404);
      const foreign = await get(
        '/routine/activities?from=2027-01-01&to=2027-01-31&timeZone=America%2FBogota',
        other,
      ).expect(200);
      expect(foreign.body).toEqual([]);
      const own = await prisma.scheduledActivity.findUniqueOrThrow({
        where: { id },
        select: { athleteId: true },
      });
      expect(
        await prisma.workoutSession.count({
          where: { athleteId: own.athleteId },
        }),
      ).toBe(0);
      expect(JSON.stringify(updated)).not.toMatch(
        /athleteId|creationRequestHash|passwordHash/,
      );
    } finally {
      view.mockRestore();
    }
  });
});
