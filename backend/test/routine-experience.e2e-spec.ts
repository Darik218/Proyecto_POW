import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { localDate } from '../src/workout-sessions/workout-calendar.policy';
import { PrismaService } from '../src/database/prisma.service';
const isolated = process.env.UX_TEST_DATABASE_URL ? describe : describe.skip;
isolated('Flexible routine with isolated PostgreSQL', () => {
  let app: INestApplication,
    prisma: PrismaService,
    token: string,
    other: string;
  const post = (path: string, body: object, t = token) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Authorization', `Bearer ${t}`)
      .send(body);
  const get = (path: string, t = token) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${t}`);
  const patch = (path: string, body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1' + path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const tz = 'America/Bogota';
  beforeAll(async () => {
    if (
      process.env.UX_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test'
    )
      throw new Error('A disposable cluster is required.');
    const module = await Test.createTestingModule({
      imports: [TrainingPlansModule, WorkoutSessionsModule],
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
    async function actor() {
      return (
        await post(
          '/auth/register',
          {
            email: `ux-${randomUUID()}@example.test`,
            password: 'isolated-ux-password-123',
          },
          '',
        )
          .set('Origin', 'http://localhost:5173')
          .expect(201)
      ).body.accessToken as string;
    }
    token = await actor();
    other = await actor();
  });
  afterAll(async () => {
    await app?.close();
  });
  const generate = (more: object = {}) => ({
    id: randomUUID(),
    name: 'Rutina UX',
    durationWeeks: 8,
    frequency: 3,
    timeZone: tz,
    ...more,
  });
  it('generates 8 independent weeks and 24 fixed/flexible days atomically, with safe retries and no executions', async () => {
    const input = generate({
      startsOn: '2027-01-04',
      days: [
        { name: 'Push', weekday: 1 },
        { name: 'Pull', weekday: 3 },
        { name: 'Libre', weekday: null },
      ],
    });
    await post('/routine/plans', input).expect(201);
    await post('/routine/plans', input).expect(201);
    const plan = (await get(`/training-plans/${input.id}/planning`).expect(200))
      .body;
    expect(plan.weeks).toHaveLength(8);
    expect(plan.weeks.flatMap((w: { days: unknown[] }) => w.days)).toHaveLength(
      24,
    );
    expect(
      new Set(
        plan.weeks.flatMap((w: { days: { id: string }[] }) =>
          w.days.map((d) => d.id),
        ),
      ).size,
    ).toBe(24);
    expect(
      await prisma.workoutSession.count({
        where: { trainingPlanId: input.id },
      }),
    ).toBe(0);
    expect(
      await prisma.scheduledActivity.count({
        where: { week: { trainingPlanId: input.id } },
      }),
    ).toBe(16);
    await post('/routine/plans', { ...input, name: 'Different retry' }).expect(
      409,
    );
    await get(`/training-plans/${input.id}/planning`, other).expect(404);
  });
  it('accepts undated flexible plans and rejects inconsistent templates, unknown fields and time zones', async () => {
    const input = generate();
    await post('/routine/plans', input).expect(201);
    expect(
      (await get(`/training-plans/${input.id}/planning`)).body.startsOn,
    ).toBeNull();
    expect(
      await prisma.scheduledActivity.count({
        where: { week: { trainingPlanId: input.id } },
      }),
    ).toBe(0);
    await post('/routine/plans', generate({ days: [{ name: 'One' }] })).expect(
      400,
    );
    await post('/routine/plans', generate({ athleteId: randomUUID() })).expect(
      400,
    );
    await post('/routine/plans', generate({ timeZone: 'Invalid/Zone' })).expect(
      400,
    );
  });
  it('separates rescheduled, omitted, withdrawn, rest and unrecorded activities without creating results', async () => {
    const input = generate({
      durationWeeks: 1,
      frequency: 2,
      startsOn: '2027-01-04',
      days: [
        { name: 'Push', weekday: 1 },
        { name: 'Pull', weekday: 3 },
      ],
    });
    await post('/routine/plans', input).expect(201);
    const activities = (
      await get(
        `/routine/activities?from=2027-01-04&to=2027-01-10&timeZone=${tz}`,
      ).expect(200)
    ).body.filter((a: { planWeekId: string }) => a.planWeekId);
    const plan = (await get(`/training-plans/${input.id}/planning`)).body;
    const week = plan.weeks[0];
    const activity = activities.find(
      (a: { planDayId: string }) => a.planDayId === week.days[0].id,
    );
    await patch(`/routine/activities/${activity.id}`, {
      expectedVersion: 0,
      scheduledOn: '2027-01-05',
    }).expect(200);
    expect(
      (
        await get(
          '/workout-sessions/suggestions?performedOn=2027-01-04&timeZone=' + tz,
        )
      ).body.candidates.some(
        (c: { planDayId: string }) => c.planDayId === week.days[0].id,
      ),
    ).toBe(false);
    expect(
      (
        await get(
          '/workout-sessions/suggestions?performedOn=2027-01-05&timeZone=' + tz,
        )
      ).body.candidates.some(
        (c: { scheduledActivityId: string }) =>
          c.scheduledActivityId === activity.id,
      ),
    ).toBe(true);
    await patch(`/routine/activities/${activity.id}`, {
      expectedVersion: 0,
      status: 'OMITTED',
    }).expect(409);
    await patch(`/routine/activities/${activity.id}`, {
      expectedVersion: 1,
      status: 'OMITTED',
    }).expect(200);
    expect(
      (
        await get(
          '/workout-sessions/suggestions?performedOn=2027-01-05&timeZone=' + tz,
        )
      ).body.candidates.some(
        (c: { planDayId: string }) => c.planDayId === week.days[0].id,
      ),
    ).toBe(false);
    const rest = await post('/routine/activities', {
      id: randomUUID(),
      planWeekId: week.id,
      scheduledOn: '2027-01-06',
      timeZone: tz,
      title: 'Descanso voluntario',
      status: 'REST',
    }).expect(201);
    expect(rest.body.workouts).toEqual([]);
    await post('/routine/activities', {
      id: randomUUID(),
      planDayId: week.days[0].id,
      scheduledOn: '2027-01-06',
      timeZone: tz,
      title: 'Invalid hierarchy',
      status: 'PLANNED',
    }).expect(400);
  });
  it('copies active future programming with new IDs, protects original history and detects stale operations', async () => {
    const input = generate({ durationWeeks: 2, frequency: 1 });
    await post('/routine/plans', input).expect(201);
    let plan = (await get(`/training-plans/${input.id}/planning`)).body;
    const source = plan.weeks[0].days[0];
    await post(`/routine/plans/${input.id}/activate`, {
      id: randomUUID(),
      expectedVersion: 0,
    }).expect(201);
    const copy = await post(
      `/routine/plans/${input.id}/days/${source.id}/future-copy`,
      {
        id: randomUUID(),
        expectedVersion: 1,
        fromDate: '2027-01-04',
        timeZone: tz,
      },
    ).expect(201);
    expect(copy.body.dayIds[0]).not.toBe(source.id);
    plan = (await get(`/training-plans/${input.id}/planning`)).body;
    expect(
      plan.weeks[0].days.find((d: { id: string }) => d.id === source.id)
        .retiredAt,
    ).not.toBeNull();
    expect(
      plan.weeks[0].days.find(
        (d: { id: string }) => d.id === copy.body.dayIds[0],
      ).isEditableOverride,
    ).toBe(true);
    await post(`/routine/plans/${input.id}/copy`, {
      id: randomUUID(),
      expectedVersion: 1,
      sourceDayId: copy.body.dayIds[0],
      mode: 'NEW_DAY',
      weekIds: [plan.weeks[1].id],
    }).expect(409);
    const op = {
      id: randomUUID(),
      expectedVersion: 2,
      sourceDayId: copy.body.dayIds[0],
      mode: 'NEW_DAY',
      weekIds: [plan.weeks[1].id],
    };
    const first = await post(`/routine/plans/${input.id}/copy`, op).expect(201);
    expect(
      (await post(`/routine/plans/${input.id}/copy`, op).expect(201)).body,
    ).toEqual(first.body);
  });
  it('preserves performed history when future programming changes and serializes competing writes', async () => {
    const group = await prisma.muscleGroup.create({
      data: { key: `ux-${randomUUID()}`, name: `UX ${randomUUID()}` },
    });
    const exercise = await prisma.exercise.create({
      data: {
        name: 'UX history press',
        equipment: 'Barra',
        primaryMuscleGroupId: group.id,
      },
    });
    const input = generate({
      durationWeeks: 2,
      frequency: 2,
      startsOn: '2027-01-04',
      days: [
        { name: 'Push', weekday: 1 },
        { name: 'Pull', weekday: 2 },
      ],
    });
    await post('/routine/plans', input).expect(201);
    let plan = (await get(`/training-plans/${input.id}/planning`)).body;
    const week = plan.weeks[0],
      day = week.days[0];
    plan = (
      await post(
        `/training-plans/${input.id}/weeks/${week.id}/days/${day.id}/exercises`,
        {
          exerciseId: exercise.id,
          position: 1,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetLoad: 30,
          targetLoadUnit: 'KG',
          expectedVersion: 0,
        },
      ).expect(201)
    ).body;
    const prescription = plan.weeks[0].days[0].exercises[0];
    const prepared = (
      await post('/workout-sessions', {
        id: randomUUID(),
        performedOn: '2026-01-01',
        timeZone: tz,
        recordingMode: 'RETROSPECTIVE',
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: day.id,
      }).expect(201)
    ).body;
    const started = (
      await post(`/workout-sessions/${prepared.id}/start`, {
        expectedVersion: 0,
      }).expect(200)
    ).body;
    const recorded = (
      await post(
        `/workout-sessions/${prepared.id}/exercises/${prepared.exercises[0].id}/sets`,
        {
          id: randomUUID(),
          expectedVersion: started.version,
          setNumber: 1,
          load: '27.5',
          loadUnit: 'KG',
          repetitions: 8,
          kind: 'WORK',
          status: 'COMPLETED',
        },
      ).expect(201)
    ).body;
    const completed = (
      await post(`/workout-sessions/${prepared.id}/complete`, {
        expectedVersion: recorded.version,
      }).expect(200)
    ).body;
    await post(`/routine/plans/${plan.id}/activate`, {
      id: randomUUID(),
      expectedVersion: 1,
    }).expect(201);
    const future = (
      await post(`/routine/plans/${plan.id}/days/${day.id}/future-copy`, {
        id: randomUUID(),
        expectedVersion: 2,
        fromDate: localDate(tz),
        timeZone: tz,
      }).expect(201)
    ).body;
    const newDay = future.dayIds[0];
    let current = (await get(`/training-plans/${plan.id}/planning`)).body;
    const copy = current.weeks[0].days.find(
      (d: { id: string }) => d.id === newDay,
    );
    expect(copy.exercises[0].id).not.toBe(prescription.id);
    expect(copy.exercises[0].targetRepsMax).toBe(10);
    expect(current.weeks[1].days).toHaveLength(2);
    const path = `/training-plans/${plan.id}/weeks/${week.id}/days/${newDay}/exercises/${copy.exercises[0].id}`;
    const changes = await Promise.all([
      patch(path, { targetSets: 4, expectedVersion: 3 }),
      patch(path, { targetSets: 5, expectedVersion: 3 }),
    ]);
    expect(changes.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect((await get(`/workout-sessions/${prepared.id}`)).body).toEqual(
      completed,
    );
    expect(
      (
        await prisma.planExercise.findUniqueOrThrow({
          where: { id: prescription.id },
        })
      ).targetSets,
    ).toBe(3);
    expect(
      (
        await get(
          '/workout-sessions/suggestions?performedOn=2027-01-04&timeZone=' + tz,
        )
      ).body.candidates.some(
        (c: { planDayId: string }) => c.planDayId === newDay,
      ),
    ).toBe(true);
    await post('/workout-sessions', {
      id: randomUUID(),
      performedOn: localDate(tz),
      timeZone: tz,
      recordingMode: 'LIVE',
      trainingPlanId: plan.id,
      planWeekId: week.id,
      planDayId: day.id,
    }).expect(409);
    const activity = await prisma.scheduledActivity.findFirstOrThrow({
      where: { planDayId: newDay },
    });
    await expect(
      prisma.scheduledActivity.create({
        data: {
          athleteId: activity.athleteId,
          planWeekId: current.weeks[1].id,
          planDayId: newDay,
          originalOn: new Date('2027-01-04'),
          scheduledOn: new Date('2027-01-04'),
          timeZone: tz,
          title: 'Invalid hierarchy',
        },
      }),
    ).rejects.toBeDefined();
    const request = {
      id: randomUUID(),
      expectedVersion: 4,
      sourceDayId: newDay,
      mode: 'NEW_DAY',
      weekIds: [current.weeks[1].id],
    };
    const retries = await Promise.all([
      post(`/routine/plans/${plan.id}/copy`, request),
      post(`/routine/plans/${plan.id}/copy`, request),
    ]);
    expect(retries.map((r) => r.status)).toEqual([201, 201]);
    expect(retries[0].body).toEqual(retries[1].body);
  });

  it('integrates actual Vue routine, planning and execution services over HTTP with PostgreSQL', async () => {
    const group = await prisma.muscleGroup.create({
      data: { key: `ux-http-${randomUUID()}`, name: `UX HTTP ${randomUUID()}` },
    });
    const exercise = await prisma.exercise.create({
      data: {
        name: 'UX HTTP exercise',
        equipment: 'Mancuernas',
        primaryMuscleGroupId: group.id,
      },
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const output = await new Promise<string>((accept, reject) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          './tests/routine-experience.http.mjs',
        ],
        { cwd: resolve(process.cwd(), '../frontend'), timeout: 20000 },
        (error, stdout, stderr) => {
          if (error)
            reject(
              new Error(
                stderr
                  .split('\n')
                  .find((line) => line.startsWith('{"routineHttpFlow"')) ??
                  'Routine HTTP process failed.',
              ),
            );
          else accept(stdout);
        },
      );
      child.stdin?.end(
        JSON.stringify({
          baseURL: `http://127.0.0.1:${address.port}/api/v1`,
          token,
          exerciseId: exercise.id,
        }),
      );
    });
    expect(output).toContain('"routineHttpFlow":"passed"');
  });
  it('supports extra fixed blocks, independent copies and week duplication after future replacement', async () => {
    const input = generate({
      durationWeeks: 1,
      frequency: 2,
      startsOn: '2027-01-04',
      days: [
        { name: 'Mañana', weekday: 1 },
        { name: 'Tarde', weekday: 1 },
      ],
    });
    await post('/routine/plans', input).expect(201);
    let plan = (await get(`/training-plans/${input.id}/planning`)).body;
    const week = plan.weeks[0];
    await post(`/routine/plans/${plan.id}/days`, {
      id: randomUUID(),
      expectedVersion: 0,
      weekId: week.id,
      name: 'Extra',
      position: 3,
      weekday: 2,
      timeZone: tz,
    }).expect(201);
    await post(`/routine/plans/${plan.id}/copy`, {
      id: randomUUID(),
      expectedVersion: 1,
      sourceDayId: week.days[0].id,
      mode: 'NEW_DAY',
      weekIds: [week.id],
      timeZone: tz,
    }).expect(201);
    expect(
      await prisma.scheduledActivity.count({ where: { planWeekId: week.id } }),
    ).toBe(4);
    await post(
      `/routine/plans/${plan.id}/days/${week.days[0].id}/future-copy`,
      {
        id: randomUUID(),
        expectedVersion: 2,
        fromDate: '2027-01-04',
        timeZone: tz,
      },
    ).expect(201);
    plan = (
      await post(`/training-plans/${plan.id}/weeks/${week.id}/copy`, {
        weekNumber: 2,
        expectedVersion: 3,
      }).expect(201)
    ).body;
    expect(plan.weeks[1].days).toHaveLength(4);
    expect(plan.weeks[1].startsOn).toBeNull();
    expect(
      plan.weeks[1].days.every(
        (d: { retiredAt: string | null }) => !d.retiredAt,
      ),
    ).toBe(true);
    expect(
      await prisma.workoutSession.count({ where: { trainingPlanId: plan.id } }),
    ).toBe(0);
  });
});
