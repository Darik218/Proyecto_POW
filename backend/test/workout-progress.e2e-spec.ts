import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { prepareEstimates } from '../src/domain/progression/estimate-evidence.policy';
import { Prisma } from '../src/generated/prisma/client';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaWorkoutProgressRepository } from '../src/workout-sessions/prisma-workout-progress.repository';
import { WORKOUT_PROGRESS_REPOSITORY } from '../src/workout-sessions/workout-progress.repository';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('Owned actual progress with disposable PostgreSQL', () => {
  let app: INestApplication,
    prisma: PrismaService,
    owner: {
      token: string;
      userId: string;
      athleteId: string;
      sessionId: string;
    },
    other: typeof owner;
  const exercise = randomUUID(),
    bodyweight = randomUUID(),
    foreign = randomUUID();
  const date = (ago: number) =>
    new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
  const get = (path: string, token = owner?.token ?? '') =>
    request(app.getHttpServer())
      .get('/api/v1/workout-sessions/progress' + path)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    if (
      process.env.PROG1B_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_prog1b_test' ||
      !process.env.PROG1B_TEST_DATA_DIRECTORY?.startsWith(
        join(tmpdir(), 'pulso-prog1b-'),
      )
    )
      throw Error('Use verified disposable progression runner.');
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
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const [target] = await prisma.$queryRaw<
      { database: string; directory: string }[]
    >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
    if (
      target?.database !== 'pulso_prog1b_test' ||
      target.directory !== process.env.PROG1B_TEST_DATA_DIRECTORY
    )
      throw Error('Cluster mismatch; refusing writes.');
    async function actor() {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({
          email: `ux5-progress-${randomUUID()}@example.test`,
          password: 'isolated-progress-password-123',
        })
        .expect(201);
      const userId = response.body.user.id as string;
      const athlete = await prisma.athlete.findUniqueOrThrow({
        where: { userId },
      });
      const session = await prisma.authSession.findFirstOrThrow({
        where: { userId },
      });
      return {
        token: response.body.accessToken as string,
        userId,
        athleteId: athlete.id,
        sessionId: session.id,
      };
    }
    owner = await actor();
    other = await actor();
    const group = await prisma.muscleGroup.create({
      data: { key: 'ux5-' + randomUUID(), name: 'Progress test' },
    });
    await prisma.exercise.createMany({
      data: [
        {
          id: exercise,
          name: 'Nominal machine',
          equipment: 'Machine',
          primaryMuscleGroupId: group.id,
          oneRmSuitability: 'NOT_SUITABLE',
          resistanceType: 'WEIGHT_STACK',
        },
        {
          id: bodyweight,
          name: 'Bodyweight',
          equipment: 'None',
          primaryMuscleGroupId: group.id,
          oneRmSuitability: 'NOT_SUITABLE',
          resistanceType: 'BODYWEIGHT',
        },
        {
          id: foreign,
          name: 'Foreign private',
          equipment: 'Bar',
          primaryMuscleGroupId: group.id,
          origin: 'PERSONAL',
          ownerId: other.userId,
        },
      ],
    });
    async function session(
      athleteId: string,
      ago: number | null,
      reps: number,
      status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
      exerciseId = exercise,
      load: string | null = '40',
      unit: 'KG' | 'LB' | null = 'KG',
    ) {
      return prisma.workoutSession.create({
        data: {
          athleteId,
          status,
          performedOn: ago === null ? null : new Date(date(ago)),
          timeZone: ago === null ? null : 'America/Bogota',
          exercises: {
            create: {
              exerciseId,
              orderInSession: 1,
              sets: {
                create: {
                  setNumber: 1,
                  status: 'COMPLETED',
                  kind: 'WORK',
                  isCompleted: true,
                  load,
                  loadUnit: unit,
                  loadKg: unit === 'KG' ? load : null,
                  repetitions: reps,
                  rpe: null,
                },
              },
            },
          },
        },
      });
    }
    await session(owner.athleteId, 8, 8);
    await session(owner.athleteId, 1, 10);
    await session(other.athleteId, 1, 99);
    await session(owner.athleteId, 2, 88, 'IN_PROGRESS');
    await session(owner.athleteId, null, 77);
    // Current actual-set schema stores bodyweight repetition work as zero added load.
    await session(owner.athleteId, 1, 12, 'COMPLETED', bodyweight, '0', 'KG');
  });
  afterAll(async () => {
    await app?.close();
  });
  it('reads only owned dated completed results, compares without effort/1RM and leaves history and proposals unchanged', async () => {
    const before = await Promise.all([
      prisma.workoutSession.count(),
      prisma.setRecord.count(),
      prisma.oneRmEstimate.count(),
      prisma.progressionRecommendation.count(),
    ]);
    const response = await get(`?period=all&exerciseId=${exercise}`).expect(
      200,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      completedSessions: 3,
      metadata: { undatedSessions: 1 },
      estimates: [],
      series: [
        {
          load: '40',
          unit: 'KG',
          comparison: { state: 'COMPARED', repetitionsDelta: 2 },
          points: [{ repetitions: 8 }, { repetitions: 10 }],
        },
      ],
    });
    expect(
      response.body.series[0].points.map(
        (p: { performedOn: string }) => p.performedOn,
      ),
    ).toEqual([date(8), date(1)]);
    expect(JSON.stringify(response.body)).not.toMatch(/athleteId|userId|rpe/);
    expect(
      await Promise.all([
        prisma.workoutSession.count(),
        prisma.setRecord.count(),
        prisma.oneRmEstimate.count(),
        prisma.progressionRecommendation.count(),
      ]),
    ).toEqual(before);
  });
  it('applies date periods, returns an honest first baseline and supports bodyweight reps', async () => {
    const recent = await get(`?period=7&exerciseId=${exercise}`).expect(200);
    expect(recent.body).toMatchObject({
      completedSessions: 2,
      series: [
        {
          comparison: { state: 'BASELINE', repetitionsDelta: null },
          points: [{ repetitions: 10 }],
        },
      ],
    });
    const body = await get(`?period=all&exerciseId=${bodyweight}`).expect(200);
    expect(body.body.series[0]).toMatchObject({
      kind: 'BODYWEIGHT_REPETITIONS',
      load: null,
      unit: null,
      points: [{ repetitions: 12 }],
    });
    expect(body.body.duration.status).toBe('UNSUPPORTED');
  });
  it('uses the real guard and hides another user personal exercise', async () => {
    await get('', 'invalid').expect(401);
    await get(`?exerciseId=${foreign}`).expect(404);
    const otherResult = await get(
      `?period=all&exerciseId=${exercise}`,
      other.token,
    ).expect(200);
    expect(otherResult.body.completedSessions).toBe(1);
    expect(otherResult.body.series[0].points[0].repetitions).toBe(99);
  });
  it('shows only persisted declared 1RM with valid source provenance and suppresses changed source versions', async () => {
    const repo = app.get<PrismaWorkoutProgressRepository>(
      WORKOUT_PROGRESS_REPOSITORY,
    );
    const window = { period: 'all' as const, from: null, to: date(0) };
    // Fixture explicitly models an approved external-total exercise; no production metadata is inferred.
    await prisma.exercise.update({
      where: { id: exercise },
      data: { oneRmSuitability: 'SUITABLE' },
    });
    const read = await repo.read(
        owner.userId,
        owner.sessionId,
        window,
        exercise,
      ),
      history = read.history!;
    const task = history.tasks.at(-1)!,
      set = history.sets.find((s) => s.workoutExerciseId === task.id)!;
    const drafts = prepareEstimates(
      {
        userId: owner.userId,
        athleteId: owner.athleteId,
        exerciseId: exercise,
        sessionId: task.sessionId,
        workoutExerciseId: task.id,
        sourceSetId: set.id,
        sourceSetVersion: set.version,
        sessionVersion: task.sessionVersion,
        sessionStatus: task.sessionStatus,
        status: set.status,
        kind: set.kind,
        isCompleted: set.isCompleted,
        isOmitted: task.isOmitted,
        load: set.load,
        loadUnit: set.loadUnit,
        loadKg: set.loadKg,
        repetitions: set.repetitions,
        rpe: set.rpe,
        oneRmSuitability: 'SUITABLE',
        recordedAt: set.recordedAt,
        performedOn: task.performedOn,
        timeZone: task.timeZone,
      },
      {
        sourceSetId: set.id,
        expectedSetVersion: set.version,
        formulas: ['EPLEY', 'BRZYCKI'],
        interpretation: {
          meaning: 'EXTERNAL_TOTAL',
          source: 'OWNER_DECLARATION_AFTER_RECORDING',
        },
      },
    );
    try {
      await prisma.oneRmEstimate.createMany({
        data: drafts.map((d) => ({
          ...d,
          snapshot: d.snapshot as Prisma.InputJsonObject,
        })),
      });
      const valid = await get(`?period=all&exerciseId=${exercise}`).expect(200);
      expect(valid.body.estimates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            formula: 'EPLEY',
            algorithmVersion: 'prog-1a-literal-v1',
            eligibilityVersion: 'prog-1a-series-v1',
            numericPolicyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
            value: '50.666667',
            unit: 'KG',
          }),
          expect.objectContaining({
            formula: 'BRZYCKI',
            value: '49.655172',
            unit: 'KG',
          }),
        ]),
      );
      await prisma.setRecord.update({
        where: { id: set.id },
        data: { version: { increment: 1 } },
      });
      const stale = await get(`?period=all&exerciseId=${exercise}`).expect(200);
      expect(stale.body.estimates).toEqual([]);
      expect(stale.body.series).toHaveLength(1);
    } finally {
      // Immutable persisted evidence stays in the disposable cluster until runner cleanup.
      await prisma.setRecord.update({
        where: { id: set.id },
        data: { version: set.version },
      });
      await prisma.exercise.update({
        where: { id: exercise },
        data: { oneRmSuitability: 'NOT_SUITABLE' },
      });
    }
  });
  it('scopes plan-day progress by real owned relationships and keeps free sessions in the general view', async () => {
    const plan = await prisma.trainingPlan.create({
      data: {
        athleteId: owner.athleteId,
        name: 'UX6 Legs',
        status: 'ACTIVE',
        weeks: {
          create: {
            weekNumber: 1,
            days: { create: { name: 'Legs A', position: 1 } },
          },
        },
      },
      include: { weeks: { include: { days: true } } },
    });
    const week = plan.weeks[0]!,
      day = week.days[0]!;
    await prisma.planExercise.create({
      data: {
        planDayId: day.id,
        planWeekId: week.id,
        exerciseId: exercise,
        position: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      },
    });
    const nextDate = new Date(new Date(date(0)).getTime() + 7 * 86400000);
    const upcoming = await prisma.scheduledActivity.create({
      data: {
        athleteId: owner.athleteId,
        planWeekId: week.id,
        planDayId: day.id,
        originalPlanDayId: day.id,
        originalOn: nextDate,
        scheduledOn: nextDate,
        timeZone: 'America/Bogota',
        title: 'Próximo Legs',
        status: 'PLANNED',
      },
    });
    const session = await prisma.workoutSession.create({
      data: {
        athleteId: owner.athleteId,
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: day.id,
        status: 'COMPLETED',
        performedOn: new Date(date(2)),
        timeZone: 'America/Bogota',
        exercises: {
          create: {
            exerciseId: exercise,
            orderInSession: 1,
            sets: {
              create: {
                setNumber: 1,
                status: 'COMPLETED',
                kind: 'WORK',
                isCompleted: true,
                load: '40',
                loadUnit: 'KG',
                loadKg: '40',
                repetitions: 9,
              },
            },
          },
        },
      },
    });
    const scoped = await get(
      `?period=all&exerciseId=${exercise}&planDayId=${day.id}`,
    ).expect(200);
    expect(scoped.body.selectedPlanDayId).toBe(day.id);
    expect(scoped.body.planDays).toContainEqual({
      id: day.id,
      name: 'Legs A',
      planName: 'UX6 Legs',
      planId: plan.id,
      weekId: week.id,
      weekNumber: 1,
    });
    expect(scoped.body.completedSessions).toBe(1);
    expect(scoped.body.selectedPlanId).toBe(plan.id);
    expect(scoped.body.plans).toContainEqual({
      id: plan.id,
      name: plan.name,
      status: 'ACTIVE',
    });
    expect(scoped.body.nextSession).toMatchObject({
      activityId: upcoming.id,
      planDayId: day.id,
      planId: plan.id,
      performedOn: nextDate.toISOString().slice(0, 10),
    });
    const plannedOnly = await prisma.planDay.create({
      data: { planWeekId: week.id, name: 'Legs B', position: 2 },
    });
    await prisma.planExercise.create({
      data: {
        planDayId: plannedOnly.id,
        planWeekId: week.id,
        exerciseId: bodyweight,
        position: 1,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
      },
    });
    await prisma.scheduledActivity.create({
      data: {
        athleteId: owner.athleteId,
        planWeekId: week.id,
        planDayId: plannedOnly.id,
        originalPlanDayId: plannedOnly.id,
        originalOn: nextDate,
        scheduledOn: nextDate,
        timeZone: 'America/Bogota',
        title: 'Nuevo Legs',
        status: 'PLANNED',
      },
    });
    const emptyDay = await get(
      `?period=all&planId=${plan.id}&planDayId=${plannedOnly.id}`,
    ).expect(200);
    expect(emptyDay.body.completedSessions).toBe(0);
    expect(emptyDay.body.exercises).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bodyweight })]),
    );
    expect(emptyDay.body.nextSession.planDayId).toBe(plannedOnly.id);
    const nextOtherDay = await get(
      `?period=all&planId=${plan.id}&planDayId=${day.id}&exerciseId=${bodyweight}`,
    ).expect(200);
    expect(nextOtherDay.body.selectedPlanDayId).toBe(day.id);
    expect(nextOtherDay.body.nextSession.planDayId).toBe(plannedOnly.id);
    await get(`?planId=${plan.id}`, other.token).expect(404);
    await get(`?planId=${randomUUID()}&planDayId=${day.id}`).expect(404);
    expect(
      scoped.body.series[0].points.map(
        (point: { sessionId: string }) => point.sessionId,
      ),
    ).toEqual([session.id]);
    const general = await get(`?period=all&exerciseId=${exercise}`).expect(200);
    expect(general.body.completedSessions).toBeGreaterThan(
      scoped.body.completedSessions,
    );
    await get(`?period=all&planDayId=${day.id}`, other.token).expect(404);
    await get('?planDayId=invalid').expect(400);
  });
  it('rechecks absolute expiry and revocation in the repository before result reads', async () => {
    const repo = app.get<PrismaWorkoutProgressRepository>(
        WORKOUT_PROGRESS_REPOSITORY,
      ),
      window = { period: 'all' as const, from: null, to: date(0) };
    // Authentication expires against PostgreSQL's clock, independent of the runner process clock.
    await prisma.$executeRaw`UPDATE auth_sessions SET created_at=clock_timestamp()-interval '2 days', absolute_expires_at=clock_timestamp()-interval '1 second' WHERE id=${other.sessionId}::uuid`;
    await expect(
      repo.read(other.userId, other.sessionId, window),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await prisma.authSession.update({
      where: { id: other.sessionId },
      data: {
        absoluteExpiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
      },
    });
    await expect(
      repo.read(other.userId, other.sessionId, window),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
});
