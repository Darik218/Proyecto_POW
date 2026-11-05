import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { PrismaService } from '../src/database/prisma.service';
const isolated = process.env.R1_TEST_DATABASE_URL ? describe : describe.skip;
isolated(
  'R1 daily planning: isolated PostgreSQL and authenticated HTTP',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let owner: { token: string; athleteId: string; userId: string };
    let other: typeof owner;
    let exerciseId: string;
    let foreignExerciseId: string;
    let inactiveId: string;
    beforeAll(async () => {
      if (
        process.env.R1_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
        new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test'
      )
        throw new Error('Only the disposable PostgreSQL runner is allowed.');
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
        throw new Error('Wrong target.');
      async function actor() {
        const result = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .set('Origin', 'http://localhost:5173')
          .send({
            email: `r1-${randomUUID()}@example.test`,
            password: 'isolated-planning-password-123',
          })
          .expect(201);
        const athlete = await prisma.athlete.findUniqueOrThrow({
          where: { userId: result.body.user.id },
        });
        return {
          token: result.body.accessToken as string,
          athleteId: athlete.id,
          userId: athlete.userId,
        };
      }
      owner = await actor();
      other = await actor();
      const group = await prisma.muscleGroup.create({
        data: { key: `r1-${randomUUID()}`, name: `R1 ${randomUUID()}` },
      });
      exerciseId = (
        await prisma.exercise.create({
          data: {
            name: 'R1 press',
            equipment: 'Barra',
            primaryMuscleGroupId: group.id,
          },
        })
      ).id;
      foreignExerciseId = (
        await prisma.exercise.create({
          data: {
            name: 'R1 private',
            equipment: 'Barra',
            primaryMuscleGroupId: group.id,
            origin: 'PERSONAL',
            ownerId: other.userId,
          },
        })
      ).id;
      inactiveId = (
        await prisma.exercise.create({
          data: {
            name: 'R1 inactive',
            equipment: 'Barra',
            primaryMuscleGroupId: group.id,
            isActive: false,
          },
        })
      ).id;
    }, 20000);
    afterAll(async () => {
      if (app) await app.close();
    });
    const auth = (actor = owner) => `Bearer ${actor.token}`;
    async function source() {
      const plan = await prisma.trainingPlan.create({
        data: {
          name: 'R1 plan',
          athleteId: owner.athleteId,
          startsOn: new Date('2026-11-01'),
          weeks: { create: { weekNumber: 1 } },
        },
        include: { weeks: true },
      });
      const week = plan.weeks[0];
      const base = `/api/v1/training-plans/${plan.id}/weeks/${week.id}`;
      return { plan, week, base };
    }
    const post = (path: string, data: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth())
        .send(data);
    const patch = (path: string, data: object) =>
      request(app.getHttpServer())
        .patch(path)
        .set('Authorization', auth())
        .send(data);
    async function day(
      base: string,
      position = 1,
      weekday: number | null = null,
    ) {
      const result = await post(base + '/days', {
        name: `Día ${position}`,
        position,
        weekday,
      }).expect(201);
      return result.body.weeks[0].days.find(
        (row: { position: number }) => row.position === position,
      ) as { id: string; position: number };
    }
    async function prescription(base: string, dayId: string, position = 1) {
      const result = await post(`${base}/days/${dayId}/exercises`, {
        exerciseId,
        position,
        targetSets: 3,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetLoad: 100,
        targetLoadUnit: 'LB',
        targetRpe: 7.5,
      }).expect(201);
      return result.body.weeks[0].days
        .find((row: { id: string }) => row.id === dayId)
        .exercises.find(
          (row: { position: number }) => row.position === position,
        ) as { id: string };
    }
    it('creates fixed and flexible days, allowing multiple blocks on Monday and stable daily reads', async () => {
      const { plan, base } = await source();
      const a = await day(base, 1, 1);
      await day(base, 2, 1);
      await day(base, 3);
      const result = await request(app.getHttpServer())
        .get(`/api/v1/training-plans/${plan.id}/planning`)
        .set('Authorization', auth())
        .expect(200);
      expect(
        result.body.weeks[0].days.map(
          (row: { weekday: number | null }) => row.weekday,
        ),
      ).toEqual([1, 1, null]);
      expect(result.body.weeks[0].pendingExercises).toEqual([]);
      expect(result.body).not.toHaveProperty('athleteId');
      await patch(`${base}/days/${a.id}`, {
        name: 'Flexible nuevo',
        weekday: null,
      }).expect(200);
      const listed = await request(app.getHttpServer())
        .get(base + '/days')
        .set('Authorization', auth())
        .expect(200);
      expect(listed.body[0]).toMatchObject({
        name: 'Flexible nuevo',
        weekday: null,
      });
    });
    it('validates parent ownership, identifiers, empty updates and unknown fields', async () => {
      const { plan, base } = await source();
      const d = await day(base);
      await request(app.getHttpServer())
        .get(`/api/v1/training-plans/${plan.id}/planning`)
        .expect(401);
      await request(app.getHttpServer())
        .get(base + '/days')
        .set('Authorization', auth(other))
        .expect(404);
      await request(app.getHttpServer())
        .post(base + '/days')
        .set('Authorization', auth(other))
        .send({ name: 'Intrusion', position: 2 })
        .expect(404);
      for (const body of [
        { position: 2 },
        { name: '', position: 2 },
        { name: null, position: 2 },
        { name: 'Bad', position: 0 },
        { name: 'Bad', position: 2, weekday: 8 },
        { name: 'Bad', position: 2, athleteId: other.athleteId },
      ])
        await post(base + '/days', body).expect(400);
      await patch(`${base}/days/${d.id}`, {}).expect(400);
      await patch(`${base}/days/${d.id}`, { name: null }).expect(400);
      await patch(`${base}/days/${d.id}`, { planWeekId: randomUUID() }).expect(
        400,
      );
      await patch(base + '/days/invalid', { name: 'X' }).expect(400);
      const foreign = await source();
      await patch(`${foreign.base}/days/${d.id}`, {
        name: 'Wrong parent',
      }).expect(404);
      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: { status: 'ACTIVE' },
      });
      await post(base + '/days', { name: 'No', position: 2 }).expect(409);
    });
    it('stores independent daily prescriptions and validates exact repetitions, ranges, loads and catalog visibility', async () => {
      const { base } = await source();
      const a = await day(base);
      const b = await day(base, 2);
      const p = await prescription(base, a.id);
      await prescription(base, b.id);
      expect(
        await prisma.planExercise.count({
          where: { planDayId: { in: [a.id, b.id] }, position: 1 },
        }),
      ).toBe(2);
      const path = `${base}/days/${a.id}/exercises`;
      for (const body of [
        { targetRepsMin: 10, targetRepsMax: 6 },
        { targetRepsMin: 6 },
        { targetReps: 8, targetRepsMin: 6, targetRepsMax: 10 },
        { targetLoad: 10 },
        { targetLoadUnit: 'LB' },
        { targetLoad: 10, targetLoadUnit: 'XX' },
        { targetSets: null },
        { targetRepsMin: 0, targetRepsMax: 8 },
        { exerciseId: foreignExerciseId },
        { exerciseId: inactiveId },
      ]) {
        const input = {
          exerciseId,
          position: 2,
          targetSets: 3,
          targetReps: 8,
          ...body,
        };
        if ('targetRepsMin' in body && !('targetReps' in body))
          delete (input as { targetReps?: number }).targetReps;
        await post(path, input).expect('exerciseId' in body ? 404 : 400);
      }
      await post(path, {
        exerciseId,
        position: 2,
        targetSets: 2,
        targetReps: 12,
        targetLoad: 20,
        targetLoadUnit: 'KG',
      }).expect(201);
      await patch(`${path}/${p.id}`, {
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetLoad: null,
      }).expect(200);
      expect(
        await prisma.planExercise.findUnique({ where: { id: p.id } }),
      ).toMatchObject({
        targetReps: 8,
        targetRepsMin: 8,
        targetRepsMax: 8,
        targetLoad: null,
        targetLoadUnit: null,
      });
      await patch(`${base}/days/${b.id}/exercises/${p.id}`, {
        notes: 'Wrong day',
      }).expect(404);
      await patch(`${path}/${p.id}`, {}).expect(400);
      // Deprecated weekly write routes cannot bypass the daily target/unit contract.
      await patch(`${base}/exercises/${p.id}`, { targetSets: 4 }).expect(404);
    });
    it('does not expose private exercise metadata through legacy inconsistent prescriptions', async () => {
      const { plan, week } = await source();
      await prisma.planExercise.create({
        data: {
          planWeekId: week.id,
          exerciseId: foreignExerciseId,
          position: 1,
          targetSets: 3,
          targetReps: 8,
        },
      });
      const result = await request(app.getHttpServer())
        .get(`/api/v1/training-plans/${plan.id}/planning`)
        .set('Authorization', auth())
        .expect(404);
      expect(JSON.stringify(result.body)).not.toContain('R1 private');
    });

    it('reorders without transient uniqueness errors and rejects incomplete or foreign permutations', async () => {
      const { base } = await source();
      const a = await day(base);
      const b = await day(base, 2);
      const c = await day(base, 3);
      const result = await patch(base + '/days/order', {
        ids: [c.id, a.id, b.id],
      }).expect(200);
      expect(
        result.body.weeks[0].days.map((row: { id: string }) => row.id),
      ).toEqual([c.id, a.id, b.id]);
      for (const ids of [
        [a.id],
        [a.id, a.id, b.id],
        [a.id, b.id, randomUUID()],
      ])
        await patch(base + '/days/order', { ids }).expect(400);
      const p = await prescription(base, a.id);
      const q = await prescription(base, a.id, 2);
      await patch(`${base}/days/${a.id}/exercises/order`, {
        ids: [q.id, p.id],
      }).expect(200);
      expect(
        (
          await prisma.planExercise.findMany({
            where: { planDayId: a.id },
            orderBy: { position: 'asc' },
          })
        ).map((row) => row.id),
      ).toEqual([q.id, p.id]);
      const race = await Promise.all([
        patch(base + '/days/order', { ids: [a.id, b.id, c.id] }),
        patch(base + '/days/order', { ids: [c.id, b.id, a.id] }),
      ]);
      expect(race.map((row) => row.status)).toEqual([200, 200]);
    });
    it('moves pending prescriptions without changing their identity, or copies them leaving the original intact', async () => {
      const { base, week } = await source();
      const d = await day(base);
      const pending = await prisma.planExercise.create({
        data: {
          planWeekId: week.id,
          exerciseId,
          position: 1,
          targetSets: 3,
          targetReps: 8,
          targetLoad: 42.125,
        },
      });
      const result = await post(
        `${base}/pending-exercises/${pending.id}/distribute`,
        { dayId: d.id, position: 1, copy: false },
      ).expect(201);
      expect(result.body.weeks[0].days[0].exercises[0]).toMatchObject({
        id: pending.id,
        targetLoad: 42.125,
        targetLoadUnit: null,
      });
      expect(result.body.weeks[0].pendingExercises).toHaveLength(0);
      await patch(`${base}/days/${d.id}/exercises/${pending.id}`, {
        notes: 'Keep unknown unit',
      }).expect(200);
      await patch(`${base}/days/${d.id}/exercises/${pending.id}`, {
        targetLoad: 43,
      }).expect(400);
      const another = await prisma.planExercise.create({
        data: {
          planWeekId: week.id,
          exerciseId,
          position: 1,
          targetSets: 3,
          targetReps: 8,
        },
      });
      await post(`${base}/pending-exercises/${another.id}/distribute`, {
        dayId: d.id,
        position: 2,
        copy: true,
      }).expect(201);
      expect(
        (
          await prisma.planExercise.findUniqueOrThrow({
            where: { id: another.id },
          })
        ).planDayId,
      ).toBeNull();
      const list = await request(app.getHttpServer())
        .get(base + '/pending-exercises')
        .set('Authorization', auth())
        .expect(200);
      expect(list.body[0].id).toBe(another.id);
    });
    it('copies days and whole weeks with new identities, never copying executed history', async () => {
      const { base, plan, week } = await source();
      const d = await day(base);
      const p = await prescription(base, d.id);
      const session = await prisma.workoutSession.create({
        data: {
          athleteId: owner.athleteId,
          trainingPlanId: plan.id,
          planWeekId: week.id,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          exercises: {
            create: { exerciseId, planExerciseId: p.id, orderInSession: 1 },
          },
        },
      });
      await patch(`${base}/days/${d.id}`, { name: 'Rewrite history' }).expect(
        409,
      );
      await patch(`${base}/days/${d.id}/exercises/${p.id}`, {
        targetSets: 5,
      }).expect(409);
      await request(app.getHttpServer())
        .delete(`${base}/days/${d.id}/exercises/${p.id}`)
        .set('Authorization', auth())
        .expect(409);
      const copied = await post(`${base}/days/${d.id}/copy`, {
        position: 2,
      }).expect(201);
      const copy = copied.body.weeks[0].days[1];
      expect(copy.id).not.toBe(d.id);
      expect(copy.exercises[0].id).not.toBe(p.id);
      expect(copy.hasHistory).toBe(false);
      await patch(`${base}/days/${copy.id}/exercises/${copy.exercises[0].id}`, {
        targetSets: 5,
      }).expect(200);
      const cloned = await post(base + '/copy', { weekNumber: 2 }).expect(201);
      expect(cloned.body.weeks[1].id).not.toBe(week.id);
      expect(cloned.body.weeks[1].days).toHaveLength(2);
      expect(
        cloned.body.weeks[1].days.every(
          (item: { hasHistory: boolean }) => !item.hasHistory,
        ),
      ).toBe(true);
      expect(
        await prisma.workoutSession.count({
          where: { trainingPlanId: plan.id },
        }),
      ).toBe(1);
      expect(
        await prisma.workoutExercise.count({
          where: { sessionId: session.id, planExerciseId: p.id },
        }),
      ).toBe(1);
      expect(
        (await prisma.planExercise.findUniqueOrThrow({ where: { id: p.id } }))
          .targetSets,
      ).toBe(3);
      await post(`${base}/days/${d.id}/copy`, { position: 2 }).expect(409);
      await post(base + '/copy', { weekNumber: 2 }).expect(409);
    });
    it('protects pending prescriptions referenced by workouts and recommendations, and offers copy distribution', async () => {
      const { base, plan, week } = await source();
      const d = await day(base);
      const p = await prisma.planExercise.create({
        data: {
          planWeekId: week.id,
          exerciseId,
          position: 1,
          targetSets: 3,
          targetReps: 8,
        },
      });
      const r = await prisma.progressionRecommendation.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId,
          planWeekId: week.id,
          planExerciseId: p.id,
          recommendedLoad: 50,
          justification: 'R1 fixture',
          algorithmVersion: 'fixture',
          effectiveSettings: {},
        },
      });
      await post(`${base}/pending-exercises/${p.id}/distribute`, {
        dayId: d.id,
        position: 1,
        copy: false,
      }).expect(409);
      await post(`${base}/pending-exercises/${p.id}/distribute`, {
        dayId: d.id,
        position: 1,
        copy: true,
      }).expect(201);
      expect(
        (
          await prisma.progressionRecommendation.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).planExerciseId,
      ).toBe(p.id);
      expect(
        (await prisma.planExercise.findUniqueOrThrow({ where: { id: p.id } }))
          .planDayId,
      ).toBeNull();
      const legacy = await request(app.getHttpServer())
        .get(`/api/v1/training-plans/${plan.id}`)
        .set('Authorization', auth())
        .expect(200);
      expect(legacy.body.weeks[0].exercises).toHaveLength(2);
      const copiedWeek = await post(base + '/copy', { weekNumber: 2 }).expect(
        201,
      );
      const pendingCopy = copiedWeek.body.weeks[1].pendingExercises[0];
      expect(pendingCopy.id).not.toBe(p.id);
      expect(pendingCopy.hasHistory).toBe(false);
      expect(
        await prisma.progressionRecommendation.count({
          where: { planWeekId: copiedWeek.body.weeks[1].id },
        }),
      ).toBe(0);
    });
    it('keeps F06 weekly creation functional with colliding daily positions and range prescriptions', async () => {
      const { base, plan, week } = await source();
      const a = await day(base);
      const b = await day(base, 2);
      const firstPrescription = await prescription(base, a.id);
      const secondPrescription = await prescription(base, b.id);
      const id = randomUUID();
      const result = await post('/api/v1/workout-sessions', {
        id,
        trainingPlanId: plan.id,
        planWeekId: week.id,
      }).expect(201);
      expect(
        result.body.exercises.map(
          (row: { orderInSession: number }) => row.orderInSession,
        ),
      ).toEqual([1, 2]);
      expect(
        result.body.exercises.map(
          (row: { prescription: { id: string } }) => row.prescription.id,
        ),
      ).toEqual([firstPrescription.id, secondPrescription.id]);
      const preview = await request(app.getHttpServer())
        .get(`/api/v1/training-plans/${plan.id}`)
        .set('Authorization', auth())
        .expect(200);
      expect(
        preview.body.weeks[0].exercises.map((row: { id: string }) => row.id),
      ).toEqual([firstPrescription.id, secondPrescription.id]);
      expect(result.body.exercises[0].prescription).toMatchObject({
        targetReps: null,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetLoadUnit: 'LB',
      });
      await post(`/api/v1/workout-sessions/${id}/complete`, {}).expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/workout-sessions/${id}`)
        .set('Authorization', auth())
        .expect(200);
    });
    it('serializes daily target changes with F06 reference capture so historical targets remain stable', async () => {
      const { base, plan, week } = await source();
      const d = await day(base);
      const p = await prescription(base, d.id);
      const [started, edited] = await Promise.all([
        post('/api/v1/workout-sessions', {
          id: randomUUID(),
          trainingPlanId: plan.id,
          planWeekId: week.id,
        }),
        patch(`${base}/days/${d.id}/exercises/${p.id}`, { targetSets: 9 }),
      ]);
      expect(started.status).toBe(201);
      expect([200, 409]).toContain(edited.status);
      expect(started.body.exercises[0].prescription.targetSets).toBe(
        edited.status === 200 ? 9 : 3,
      );
      await patch(`${base}/days/${d.id}/exercises/${p.id}`, {
        targetSets: 10,
      }).expect(409);
      expect(
        (await prisma.planExercise.findUniqueOrThrow({ where: { id: p.id } }))
          .targetSets,
      ).toBe(started.body.exercises[0].prescription.targetSets);
    });

    it('removes unreferenced daily prescriptions and serializes concurrent repeated creations', async () => {
      const { base } = await source();
      const d = await day(base);
      const p = await prescription(base, d.id);
      await request(app.getHttpServer())
        .delete(`${base}/days/${d.id}/exercises/${p.id}`)
        .set('Authorization', auth())
        .expect(200);
      expect(
        await prisma.planExercise.findUnique({ where: { id: p.id } }),
      ).toBeNull();
      const results = await Promise.all([
        post(base + '/days', { name: 'Retry', position: 2 }),
        post(base + '/days', { name: 'Retry', position: 2 }),
      ]);
      expect(results.map((row) => row.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
    });
    it('runs the actual frontend planning service and composable over HTTP with PostgreSQL', async () => {
      await app.listen(0, '127.0.0.1');
      const address: unknown = app.getHttpServer().address();
      if (!address || typeof address !== 'object' || !('port' in address))
        throw new Error('No isolated HTTP port.');
      const { plan, week } = await source();
      const output = await new Promise<string>((accept, reject) => {
        const child = execFile(
          process.execPath,
          [
            '--experimental-strip-types',
            '--experimental-loader',
            './tests/typescript-loader.mjs',
            './tests/daily-planning.http.mjs',
          ],
          { cwd: resolve(process.cwd(), '../frontend'), timeout: 15000 },
          (error, stdout, stderr) => {
            if (error)
              reject(
                new Error(
                  `Frontend daily planning flow failed: ${stderr.split('\n').find((line) => line.startsWith('{"dailyHttpFlow"')) ?? error.code}`,
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
            exerciseId,
          }),
        );
      });
      expect(
        (JSON.parse(output) as { dailyHttpFlow: string }).dailyHttpFlow,
      ).toBe('passed');
    }, 20000);
  },
);
