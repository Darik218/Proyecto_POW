import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { PrismaService } from '../src/database/prisma.service';

const isolated = process.env.R2_TEST_DATABASE_URL ? describe : describe.skip;
isolated('R2 daily training with isolated PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: { athleteId: string; token: string; userId: string };
  let other: typeof owner;
  let press: string;
  let row: string;
  const root = '/api/v1/workout-sessions';
  const date = {
    performedOn: '2026-01-08',
    timeZone: 'America/Bogota',
    recordingMode: 'RETROSPECTIVE',
  };
  const auth = (actor = owner) => `Bearer ${actor.token}`;
  const post = (path: string, body: object, actor = owner) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(actor))
      .send(body);
  const patch = (path: string, body: object, actor = owner) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', auth(actor))
      .send(body);
  const get = (path: string, actor = owner) =>
    request(app.getHttpServer()).get(path).set('Authorization', auth(actor));
  beforeAll(async () => {
    if (
      process.env.R2_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test'
    )
      throw new Error('R2 requires the disposable cluster.');
    const module = await Test.createTestingModule({
      imports: [WorkoutSessionsModule, TrainingPlansModule],
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
    if (
      (
        await prisma.$queryRaw<
          { name: string }[]
        >`SELECT current_database() AS name`
      )[0]?.name !== 'pulso_f06_test'
    )
      throw new Error('Unsafe database.');
    async function actor() {
      const result = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({
          email: `r2-${randomUUID()}@example.test`,
          password: 'isolated-r2-password-123',
        })
        .expect(201);
      const athlete = await prisma.athlete.findUniqueOrThrow({
        where: { userId: result.body.user.id },
      });
      return {
        athleteId: athlete.id,
        userId: athlete.userId,
        token: result.body.accessToken as string,
      };
    }
    owner = await actor();
    other = await actor();
    const group = await prisma.muscleGroup.create({
      data: { key: `r2-${randomUUID()}`, name: `R2 ${randomUUID()}` },
    });
    press = (
      await prisma.exercise.create({
        data: {
          name: 'R2 Press',
          equipment: 'Barra',
          primaryMuscleGroupId: group.id,
        },
      })
    ).id;
    row = (
      await prisma.exercise.create({
        data: {
          name: 'R2 Remo',
          equipment: 'Mancuernas',
          primaryMuscleGroupId: group.id,
        },
      })
    ).id;
  }, 20000);
  afterAll(async () => {
    if (app) await app.close();
  });
  async function planning(actor = owner, calendar = false) {
    const plan = await prisma.trainingPlan.create({
      data: {
        athleteId: actor.athleteId,
        name: 'R2 Plan',
        startsOn: new Date('2026-01-01'),
        weeks: {
          create: {
            weekNumber: 37,
            startsOn: calendar ? new Date('2026-01-05') : null,
          },
        },
      },
      include: { weeks: true },
    });
    const week = plan.weeks[0];
    const push = await prisma.planDay.create({
      data: {
        planWeekId: week.id,
        name: 'Push',
        position: 1,
        weekday: 1,
        exercises: {
          create: {
            exerciseId: press,
            position: 1,
            targetSets: 3,
            targetReps: 8,
            targetRepsMin: 8,
            targetRepsMax: 8,
            targetLoad: 80,
            targetLoadUnit: 'KG',
          },
        },
      },
    });
    const pull = await prisma.planDay.create({
      data: {
        planWeekId: week.id,
        name: 'Pull',
        position: 2,
        weekday: 2,
        exercises: {
          create: {
            exerciseId: row,
            position: 1,
            targetSets: 4,
            targetReps: 10,
            targetRepsMin: 10,
            targetRepsMax: 10,
          },
        },
      },
    });
    return { plan, week, push, pull };
  }
  async function create(extra: object = {}) {
    return post(root, { id: randomUUID(), ...date, ...extra }).expect(201);
  }
  describe('R2-A origin, association and safe calendar', () => {
    it('prepares independent Push and Pull sessions using exclusively the chosen day', async () => {
      const { plan, week, push, pull } = await planning();
      for (const [day, exerciseId] of [
        [push, press],
        [pull, row],
      ] as const) {
        const result = await create({
          trainingPlanId: plan.id,
          planWeekId: week.id,
          planDayId: day.id,
        });
        expect(result.body.status).toBe('PLANNED');
        expect(result.body.startedAt).toBeNull();
        expect(
          result.body.exercises.map(
            (item: { exercise: { id: string } }) => item.exercise.id,
          ),
        ).toEqual([exerciseId]);
        expect(result.body.performedOn).toBe('2026-01-08T00:00:00.000Z');
        expect(result.body.planDay.id).toBe(day.id);
      }
      await post(root, {
        id: randomUUID(),
        ...date,
        trainingPlanId: plan.id,
        planWeekId: week.id,
      }).expect(400);
    });
    it('allows free preparation and later association without replacing its exercises; rejects invalid hierarchies and owners', async () => {
      const { plan, week, push } = await planning();
      const foreign = await planning(other);
      const created = await create();
      const id = created.body.id as string;
      const added = await post(`${root}/${id}/exercises`, {
        id: randomUUID(),
        exerciseId: row,
      }).expect(201);
      const before = added.body.exercises.map(
        (item: { id: string }) => item.id,
      );
      await patch(`${root}/${id}/association`, {
        expectedVersion: added.body.version,
        trainingPlanId: plan.id,
        planWeekId: foreign.week.id,
        planDayId: push.id,
      }).expect(404);
      await patch(`${root}/${id}/association`, {
        expectedVersion: added.body.version,
        trainingPlanId: foreign.plan.id,
        planWeekId: foreign.week.id,
        planDayId: foreign.push.id,
      }).expect(404);
      const associated = await patch(`${root}/${id}/association`, {
        expectedVersion: added.body.version,
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: push.id,
      }).expect(200);
      expect(
        associated.body.exercises.map((item: { id: string }) => item.id),
      ).toEqual(before);
      await get(`${root}/${id}`, other).expect(404);
      await post(root, {
        id: randomUUID(),
        ...date,
        timeZone: 'Not/AZone',
      }).expect(400);
      await request(app.getHttpServer()).get(root).expect(401);
    });
    it('serializes duplicate creation intents and protects associated days even without source prescription references', async () => {
      const input = { id: randomUUID(), ...date };
      const results = await Promise.all([post(root, input), post(root, input)]);
      expect(results.map((item) => item.status)).toEqual([201, 201]);
      expect(results[0].body).toEqual(results[1].body);
      const { plan, week, push } = await planning();
      await patch(`${root}/${input.id}/association`, {
        expectedVersion: 0,
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: push.id,
      }).expect(200);
      await patch(
        `/api/v1/training-plans/${plan.id}/weeks/${week.id}/days/${push.id}`,
        { name: 'History rewrite' },
      ).expect(409);
      const privateExercise = await prisma.exercise.create({
        data: {
          name: 'Private R2',
          equipment: 'Barra',
          primaryMuscleGroupId: (
            await prisma.exercise.findUniqueOrThrow({ where: { id: press } })
          ).primaryMuscleGroupId,
          origin: 'PERSONAL',
          ownerId: other.userId,
        },
      });
      await post(`${root}/${input.id}/exercises`, {
        id: randomUUID(),
        exerciseId: privateExercise.id,
        expectedVersion: 1,
      }).expect(404);
    });
    it('suggests only explicitly dated weeks, never week order or flexible blocks, and exposes ambiguity without choosing', async () => {
      await planning(owner, false);
      const query = `${root}/suggestions?performedOn=2026-01-05&timeZone=America%2FBogota`;
      expect((await get(query).expect(200)).body).toMatchObject({
        resolution: 'NONE',
        candidates: [],
      });
      const { week, push } = await planning(owner, true);
      expect((await get(query).expect(200)).body).toMatchObject({
        resolution: 'SINGLE',
        candidates: [{ planDayId: push.id }],
      });
      await prisma.planDay.create({
        data: {
          planWeekId: week.id,
          position: 3,
          name: 'Flexible',
          weekday: null,
        },
      });
      expect((await get(query).expect(200)).body.resolution).toBe('SINGLE');
      await prisma.planDay.create({
        data: {
          planWeekId: week.id,
          position: 4,
          name: 'Otro bloque',
          weekday: 1,
        },
      });
      expect((await get(query).expect(200)).body.resolution).toBe('MULTIPLE');
      expect(
        await prisma.workoutSession.count({
          where: {
            athleteId: owner.athleteId,
            performedOn: new Date('2026-01-05'),
          },
        }),
      ).toBe(0);
    });
  });
  describe('R2-B preparation, immutable origins and reuse', () => {
    it('keeps original targets independent from adjusted targets and immutable creation intents', async () => {
      const { plan, week, push } = await planning();
      const input = {
        id: randomUUID(),
        ...date,
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: push.id,
      };
      const created = await post(root, input).expect(201);
      const id = created.body.id as string;
      const item = created.body.exercises[0];
      expect(item.original.targets.targetLoad).toBe('80');
      const edited = await patch(`${root}/${id}/exercises/${item.id}`, {
        expectedVersion: created.body.version,
        targetLoad: '77.5',
        targetLoadUnit: 'KG',
        notes: 'Adjusted for today',
      }).expect(200);
      expect(edited.body.exercises[0].targets.targetLoad).toBe('77.5');
      expect(edited.body.exercises[0].original.targets.targetLoad).toBe('80');
      const stored = await prisma.planExercise.findUniqueOrThrow({
        where: { id: item.original.source.id },
      });
      expect(stored.targetLoad?.toString()).toBe('80');
      await prisma.planExercise.update({
        where: { id: stored.id },
        data: { targetLoad: 85 },
      });
      expect(
        (await get(`${root}/${id}`).expect(200)).body.exercises[0].original
          .targets.targetLoad,
      ).toBe('80');
      const replay = await post(root, input).expect(201);
      expect(replay.body.exercises[0].targets.targetLoad).toBe('77.5');
      await post(root, { ...input, notes: 'Different creation intent' }).expect(
        409,
      );
      await patch(`${root}/${id}/exercises/${item.id}`, {
        expectedVersion: 0,
        targetSets: 9,
      }).expect(409);
    });
    it('omits/restores, reorders and traces replacement exercises while retrying additions safely', async () => {
      const created = await create();
      const id = created.body.id as string;
      const input = {
        id: randomUUID(),
        exerciseId: press,
        expectedVersion: created.body.version,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 8,
      };
      const added = await post(`${root}/${id}/exercises`, input).expect(201);
      const original = added.body.exercises[0];
      const edited = await patch(`${root}/${id}/exercises/${original.id}`, {
        expectedVersion: added.body.version,
        notes: 'Changed after creation',
        isOmitted: true,
      }).expect(200);
      const replay = await post(`${root}/${id}/exercises`, input).expect(201);
      expect(replay.body.exercises).toHaveLength(1);
      expect(replay.body.exercises[0].notes).toBe('Changed after creation');
      const replaced = await post(`${root}/${id}/exercises`, {
        id: randomUUID(),
        exerciseId: row,
        expectedVersion: edited.body.version,
        replacesWorkoutExerciseId: original.id,
      }).expect(201);
      const replacement = replaced.body.exercises[1];
      expect(replacement.replacesWorkoutExerciseId).toBe(original.id);
      const reordered = await patch(`${root}/${id}/exercises/order`, {
        expectedVersion: replaced.body.version,
        ids: [replacement.id, original.id],
      }).expect(200);
      const restored = await patch(`${root}/${id}/exercises/${original.id}`, {
        expectedVersion: reordered.body.version,
        isOmitted: false,
      }).expect(200);
      expect(restored.body.exercises[1].isOmitted).toBe(false);
      await patch(`${root}/${id}/exercises/order`, {
        expectedVersion: restored.body.version,
        ids: [original.id],
      }).expect(400);
    });
    it('repeats structure and adjusted goals with new IDs, never copying sets, feedback or dates', async () => {
      const { plan, week, push } = await planning();
      const created = await create({
        trainingPlanId: plan.id,
        planWeekId: week.id,
        planDayId: push.id,
      });
      const priorId = created.body.id as string;
      const started = await post(`${root}/${priorId}/start`, {
        expectedVersion: created.body.version,
      }).expect(200);
      await prisma.setRecord.create({
        data: {
          workoutExerciseId: created.body.exercises[0].id,
          setNumber: 1,
          load: 70,
          repetitions: 8,
        },
      });
      const ended = await post(`${root}/${priorId}/complete`, {
        expectedVersion: started.body.version,
      }).expect(200);
      await prisma.sessionFeedback.create({
        data: { sessionId: priorId, globalRpe: 8 },
      });
      const repeated = await create({
        repeatFromId: priorId,
        performedOn: '2026-01-09',
      });
      expect(repeated.body.status).toBe('PLANNED');
      expect(repeated.body.startedAt).toBeNull();
      expect(repeated.body.trainingPlan).toBeNull();
      expect(repeated.body.sourceSnapshot.session.id).toBe(priorId);
      expect(repeated.body.exercises[0].id).not.toBe(
        ended.body.exercises[0].id,
      );
      expect(repeated.body.exercises[0].targets.targetLoad).toBe('80');
      expect(
        await prisma.setRecord.count({
          where: { workoutExercise: { sessionId: repeated.body.id } },
        }),
      ).toBe(0);
      expect(
        await prisma.sessionFeedback.count({
          where: { sessionId: repeated.body.id },
        }),
      ).toBe(0);
      await create({ repeatFromId: priorId });
      await post(
        root,
        { id: randomUUID(), ...date, repeatFromId: priorId },
        other,
      ).expect(404);
    });
    it('exports verified objectives into an editable plan day and imports associated-day prescriptions only on request', async () => {
      const source = await planning();
      const target = await planning();
      const created = await create({
        trainingPlanId: source.plan.id,
        planWeekId: source.week.id,
        planDayId: source.push.id,
      });
      const started = await post(`${root}/${created.body.id}/start`, {
        expectedVersion: 0,
      }).expect(200);
      await post(`${root}/${created.body.id}/complete`, {
        expectedVersion: started.body.version,
        confirmWithoutResults: true,
      }).expect(200);
      const input = {
        id: randomUUID(),
        trainingPlanId: target.plan.id,
        planWeekId: target.week.id,
        name: 'Historical routine',
        position: 3,
      };
      const saved = await post(
        `${root}/${created.body.id}/save-as-plan-day`,
        input,
      ).expect(201);
      expect(saved.body.id).toBe(input.id);
      await post(`${root}/${created.body.id}/save-as-plan-day`, input).expect(
        201,
      );
      expect(
        await prisma.planExercise.count({ where: { planDayId: input.id } }),
      ).toBe(1);
      const detail = await get(
        `/api/v1/training-plans/${target.plan.id}/planning`,
      ).expect(200);
      expect(detail.body.weeks[0].days[2].exercises[0].targetLoad).toBe(80);
      const free = await create();
      const associated = await patch(`${root}/${free.body.id}/association`, {
        expectedVersion: 0,
        trainingPlanId: target.plan.id,
        planWeekId: target.week.id,
        planDayId: target.pull.id,
      }).expect(200);
      expect(associated.body.exercises).toHaveLength(0);
      const operation = {
        id: randomUUID(),
        planDayId: target.pull.id,
        expectedVersion: associated.body.version,
      };
      const imported = await post(
        `${root}/${free.body.id}/import-day`,
        operation,
      ).expect(201);
      await post(`${root}/${free.body.id}/import-day`, operation).expect(201);
      expect(
        imported.body.exercises.map(
          (item: { exercise: { id: string } }) => item.exercise.id,
        ),
      ).toEqual([row]);
      await prisma.trainingPlan.update({
        where: { id: target.plan.id },
        data: { status: 'ACTIVE' },
      });
      await post(`${root}/${created.body.id}/save-as-plan-day`, {
        ...input,
        id: randomUUID(),
        position: 4,
      }).expect(409);
      await post(`${root}/${created.body.id}/save-as-plan-day`, input).expect(
        201,
      );
    });
  });

  describe('R2-C actual sets and lifecycle', () => {
    async function ready() {
      const created = await create();
      const id = created.body.id as string;
      const added = await post(`${root}/${id}/exercises`, {
        id: randomUUID(),
        exerciseId: press,
        expectedVersion: 0,
      }).expect(201);
      const started = await post(`${root}/${id}/start`, {
        expectedVersion: added.body.version,
      }).expect(200);
      return {
        id,
        exerciseId: started.body.exercises[0].id as string,
        version: started.body.version as number,
      };
    }
    it('records different repetitions, loads and units, persists through reads, and freezes completed results', async () => {
      const session = await ready();
      const path = `${root}/${session.id}/exercises/${session.exerciseId}/sets`;
      let version = session.version;
      for (const [index, repetitions, load, loadUnit] of [
        [1, 8, '77.5', 'KG'],
        [2, 7, '77.5', 'KG'],
        [3, 6, '165.347', 'LB'],
      ] as const) {
        const result = await post(path, {
          id: randomUUID(),
          expectedVersion: version,
          setNumber: index,
          repetitions,
          load,
          loadUnit,
          status: 'COMPLETED',
          kind: 'WORK',
          rpe: 8,
        }).expect(201);
        version = result.body.version;
      }
      const result = await get(`${root}/${session.id}`).expect(200);
      expect(
        result.body.exercises[0].sets.map(
          (set: { repetitions: number }) => set.repetitions,
        ),
      ).toEqual([8, 7, 6]);
      expect(result.body.exercises[0].sets[2]).toMatchObject({
        load: '165.347',
        loadUnit: 'LB',
        loadKg: '75.000138',
      });
      const ended = await post(`${root}/${session.id}/complete`, {
        expectedVersion: version,
      }).expect(200);
      expect(ended.body.completedAt).toBe(ended.body.finishedAt);
      expect(ended.body.actualSetCount).toBe(3);
      await post(`${root}/${session.id}/complete`, {
        expectedVersion: version,
      }).expect(200);
      const set = ended.body.exercises[0].sets[0];
      await patch(`${path}/${set.id}`, {
        expectedVersion: ended.body.version,
        expectedSetVersion: set.version,
        setNumber: 1,
        repetitions: 9,
        load: '80',
        loadUnit: 'KG',
        status: 'COMPLETED',
        kind: 'WORK',
      }).expect(409);
      const repeated = await create({ repeatFromId: session.id });
      expect(repeated.body.exercises[0].sets).toEqual([]);
      const after = await get(`${root}/${session.id}`).expect(200);
      expect(after.body.exercises[0].sets).toEqual(
        ended.body.exercises[0].sets,
      );
    });
    it('distinguishes pending, skipped, incomplete and failed sets, with no fabricated results', async () => {
      const session = await ready();
      const path = `${root}/${session.id}/exercises/${session.exerciseId}/sets`;
      let version = session.version;
      for (const [index, status, results] of [
        [1, 'PENDING', {}],
        [2, 'SKIPPED', {}],
        [3, 'INCOMPLETE', { repetitions: 3, load: '80', loadUnit: 'KG' }],
        [4, 'FAILED', { repetitions: 0, load: '85', loadUnit: 'KG' }],
      ] as const) {
        const result = await post(path, {
          id: randomUUID(),
          expectedVersion: version,
          setNumber: index,
          status,
          kind: index === 1 ? 'WARMUP' : 'WORK',
          ...results,
        }).expect(201);
        version = result.body.version;
      }
      const result = await get(`${root}/${session.id}`).expect(200);
      expect(result.body.actualSetCount).toBe(2);
      expect(result.body.completedSetCount).toBe(0);
      expect(result.body.exercises[0].sets[0]).toMatchObject({
        load: null,
        repetitions: null,
        isCompleted: false,
      });
      for (const input of [
        { status: 'COMPLETED', repetitions: 0 },
        { status: 'FAILED', repetitions: 1 },
        { status: 'PENDING', repetitions: 8 },
        { status: 'COMPLETED', repetitions: 8, loadUnit: null },
      ])
        await post(path, {
          id: randomUUID(),
          expectedVersion: version,
          setNumber: 5,
          kind: 'WORK',
          load: '80',
          loadUnit: 'KG',
          ...input,
        }).expect(400);
      await patch(`${root}/${session.id}/exercises/${session.exerciseId}`, {
        expectedVersion: version,
        isOmitted: true,
      }).expect(409);
    });
    it('preserves creation idempotency after set editing and serializes concurrent writes', async () => {
      const session = await ready();
      const path = `${root}/${session.id}/exercises/${session.exerciseId}/sets`;
      const input = {
        id: randomUUID(),
        expectedVersion: session.version,
        setNumber: 1,
        repetitions: 8,
        load: '80',
        loadUnit: 'KG',
        status: 'COMPLETED',
        kind: 'WORK',
      };
      const duplicates = await Promise.all([
        post(path, input),
        post(path, input),
      ]);
      expect(duplicates.map((result) => result.status)).toEqual([201, 201]);
      const created = duplicates[0].body;
      const set = created.exercises[0].sets[0];
      const edited = await patch(`${path}/${set.id}`, {
        ...input,
        id: undefined,
        repetitions: 7,
        expectedVersion: created.version,
        expectedSetVersion: set.version,
      }).expect(200);
      const replay = await post(path, input).expect(201);
      expect(replay.body.exercises[0].sets[0].repetitions).toBe(7);
      const concurrent = await Promise.all([
        post(path, {
          ...input,
          id: randomUUID(),
          setNumber: 2,
          expectedVersion: edited.body.version,
        }),
        post(path, {
          ...input,
          id: randomUUID(),
          setNumber: 3,
          expectedVersion: edited.body.version,
        }),
      ]);
      expect(
        concurrent.map((result) => result.status).sort((a, b) => a - b),
      ).toEqual([201, 409]);
      await get(`${root}/${session.id}`, other).expect(404);
    });
    it('rejects recording before start and editing estimated sets, while cancellation preserves results', async () => {
      const created = await create();
      const added = await post(`${root}/${created.body.id}/exercises`, {
        id: randomUUID(),
        exerciseId: press,
        expectedVersion: 0,
      }).expect(201);
      const item = added.body.exercises[0];
      const path = `${root}/${created.body.id}/exercises/${item.id}/sets`;
      const payload = {
        id: randomUUID(),
        expectedVersion: added.body.version,
        setNumber: 1,
        status: 'COMPLETED',
        kind: 'WORK',
        load: '80',
        loadUnit: 'KG',
        repetitions: 8,
      };
      await post(path, payload).expect(409);
      const started = await post(`${root}/${created.body.id}/start`, {
        expectedVersion: added.body.version,
      }).expect(200);
      const stored = await post(path, {
        ...payload,
        expectedVersion: started.body.version,
      }).expect(201);
      const record = stored.body.exercises[0].sets[0];
      await prisma.oneRmEstimate.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId: press,
          sourceSetId: record.id,
          inputLoad: 80,
          inputReps: 8,
          estimatedOneRm: 100,
          formula: 'EPLEY',
          algorithmVersion: 'fixture-only',
        },
      });
      const rejected = await patch(`${path}/${record.id}`, {
        ...payload,
        id: undefined,
        expectedVersion: stored.body.version,
        expectedSetVersion: record.version,
      }).expect(409);
      expect(rejected.body.message).toContain('estimates');
      const cancelled = await post(`${root}/${created.body.id}/cancel`, {
        expectedVersion: stored.body.version,
      }).expect(200);
      expect(cancelled.body.exercises[0].sets).toEqual(
        stored.body.exercises[0].sets,
      );
      await post(`${root}/${created.body.id}/start`, {
        expectedVersion: cancelled.body.version,
      }).expect(409);
    });
    it('requires explicit confirmation for no-result completion, supports resumption and preserves legacy uncertainty', async () => {
      const created = await create();
      const started = await post(`${root}/${created.body.id}/start`, {
        expectedVersion: 0,
      }).expect(200);
      expect(
        (await get(`${root}/${created.body.id}`).expect(200)).body.status,
      ).toBe('IN_PROGRESS');
      await post(`${root}/${created.body.id}/complete`, {
        expectedVersion: started.body.version,
      }).expect(409);
      await post(`${root}/${created.body.id}/complete`, {
        expectedVersion: started.body.version,
        confirmWithoutResults: true,
      }).expect(200);
      const legacyPlan = await planning();
      const legacyPrescription = await prisma.planExercise.create({
        data: {
          planWeekId: legacyPlan.week.id,
          exerciseId: press,
          position: 1,
          targetSets: 3,
          targetReps: 8,
          targetLoad: 42.125,
        },
      });
      const old = await prisma.workoutSession.create({
        data: {
          athleteId: owner.athleteId,
          trainingPlanId: legacyPlan.plan.id,
          planWeekId: legacyPlan.week.id,
          status: 'COMPLETED',
          startedAt: new Date('2025-01-01T12:00:00Z'),
          finishedAt: new Date('2025-01-01T13:00:00Z'),
          exercises: {
            create: {
              exerciseId: press,
              planExerciseId: legacyPrescription.id,
              orderInSession: 1,
              sets: {
                create: {
                  setNumber: 1,
                  load: 42.125,
                  repetitions: 5,
                  isCompleted: false,
                },
              },
            },
          },
        },
      });
      const historical = await get(`${root}/${old.id}`).expect(200);
      expect(historical.body).toMatchObject({
        planDay: null,
        performedOn: null,
        timeZone: null,
        sourceSnapshot: null,
        completedAt: null,
      });
      expect(historical.body.exercises[0].original).toBeNull();
      expect(historical.body.exercises[0].sets[0]).toMatchObject({
        status: null,
        kind: null,
        load: '42.125',
        loadUnit: null,
        isCompleted: false,
      });
    });
  });

  describe('R2-D real frontend HTTP integration', () => {
    it('uses the actual Vue services and composables with NestJS and isolated PostgreSQL', async () => {
      await app.listen(0, '127.0.0.1');
      const address: unknown = app.getHttpServer().address();
      if (!address || typeof address !== 'object' || !('port' in address))
        throw new Error('No isolated HTTP listener.');
      const { plan, week, push, pull } = await planning();
      const output = await new Promise<string>((accept, reject) => {
        const child = execFile(
          process.execPath,
          [
            '--experimental-strip-types',
            '--experimental-loader',
            './tests/typescript-loader.mjs',
            './tests/workout-r2.http.mjs',
          ],
          { cwd: resolve(process.cwd(), '../frontend'), timeout: 15000 },
          (error, stdout, stderr) => {
            if (error)
              reject(
                new Error(
                  `R2 frontend flow failed: ${stderr.split('\n').find((line) => line.startsWith('{"workoutR2HttpFlow"')) ?? error.code}`,
                ),
              );
            else accept(stdout);
          },
        );
        child.stdin?.end(
          JSON.stringify({
            baseURL: `http://127.0.0.1:${String(address.port)}/api/v1`,
            token: owner.token,
            planId: plan.id,
            weekId: week.id,
            pushId: push.id,
            pullId: pull.id,
          }),
        );
      });
      expect(
        (JSON.parse(output) as { workoutR2HttpFlow: string }).workoutR2HttpFlow,
      ).toBe('passed');
    }, 20000);
  });
});
