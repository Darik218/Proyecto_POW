import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/database/prisma.service';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';

const DATABASE_NAME = 'proyecto_pow_dev';
const ORIGIN = process.env.CORS_ORIGINS?.split(',')[0]?.trim();
const RUN_ID = randomUUID().slice(0, 12);
const PASSWORD = 'training-plan-e2e-password-123';

type RegisteredUser = { user: { id: string }; accessToken: string };
type UserFixture = {
  email: string;
  userId?: string;
  athleteId?: string;
  registrationAttempted: boolean;
};

describe('Training plans (PostgreSQL E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const users: UserFixture[] = [];
  const exerciseIds: string[] = [];
  const planNames = new Map<string, Set<string>>();
  const createdPlanIdsByEmail = new Map<string, Set<string>>();
  const cleanupErrors: string[] = [];

  beforeAll(async () => {
    const connection = process.env.DATABASE_URL;
    if (!connection || decodeURIComponent(new URL(connection).pathname.slice(1)) !== DATABASE_NAME) {
      throw new Error(`Training plan E2E requires ${DATABASE_NAME}; refusing other databases.`);
    }
    if (!ORIGIN) throw new Error('CORS_ORIGINS must be set for training plan E2E tests.');
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, TrainingPlansModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }));
    await app.init();
    prisma = app.get(PrismaService);
    const target = await prisma.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    if (target[0]?.database !== DATABASE_NAME) throw new Error('Training plan E2E database safety check failed.');
  });

  afterAll(async () => {
    if (prisma) {
      for (const fixture of users) {
        if (!fixture.registrationAttempted) continue;
        if (!fixture.userId) {
          cleanupErrors.push(`${fixture.email} (registration outcome not verified; records were not deleted)`);
          continue;
        }
        let cleanupStage = 'load user';
        try {
          cleanupStage = 'lookup fixture user';
          const account = await prisma.user.findUnique({
            where: { email: fixture.email },
            select: { id: true },
          });
          if (!account) continue;
          if (account.id !== fixture.userId) {
            cleanupErrors.push(`${fixture.email} (user ownership mismatch; records were not deleted)`);
            continue;
          }
          const athlete = await prisma.athlete.findUnique({
            where: { userId: account.id },
            select: { id: true },
          });
          if (!athlete) {
            cleanupErrors.push(`${fixture.email} (owned athlete profile missing)`);
            continue;
          }
          const names = [...(planNames.get(fixture.email) ?? [])];
          const createdPlanIds = [...(createdPlanIdsByEmail.get(fixture.email) ?? [])];
          const filters = [
            ...(names.length ? [{ name: { in: names } }] : []),
            ...(createdPlanIds.length ? [{ id: { in: createdPlanIds } }] : []),
          ];
          cleanupStage = 'lookup fixture plans';
          const plans = filters.length
            ? await prisma.trainingPlan.findMany({
              where: { athleteId: athlete.id, OR: filters },
              select: { id: true },
            })
            : [];
          const planIds = plans.map(({ id }) => id);
          cleanupStage = 'lookup fixture sessions';
          const sessionRows = planIds.length
            ? await prisma.workoutSession.findMany({
              where: { athleteId: athlete.id, trainingPlanId: { in: planIds } },
              select: { id: true },
            })
            : [];
          const sessionIds = sessionRows.map(({ id }) => id);

          await prisma.$transaction(async (tx) => {
            if (sessionIds.length) {
              cleanupStage = 'delete fixture workout exercises';
              await tx.workoutExercise.deleteMany({ where: { sessionId: { in: sessionIds } } });
              cleanupStage = 'delete fixture workout sessions';
              await tx.workoutSession.deleteMany({ where: { id: { in: sessionIds }, athleteId: athlete.id } });
            }
            if (planIds.length) {
              cleanupStage = 'delete fixture plan exercises';
              await tx.planExercise.deleteMany({ where: { planWeek: { trainingPlanId: { in: planIds } } } });
              cleanupStage = 'delete fixture plan weeks';
              await tx.planWeek.deleteMany({ where: { trainingPlanId: { in: planIds } } });
              cleanupStage = 'delete fixture plans';
              await tx.trainingPlan.deleteMany({ where: { id: { in: planIds }, athleteId: athlete.id } });
            }
            cleanupStage = 'load fixture auth sessions';
            const sessions = await tx.authSession.findMany({
              where: { userId: account.id },
              select: { id: true },
            });
            const sessionRecordIds = sessions.map(({ id }) => id);
            if (sessionRecordIds.length) {
              cleanupStage = 'delete fixture auth tokens';
              await tx.authSessionToken.deleteMany({ where: { sessionId: { in: sessionRecordIds } } });
              cleanupStage = 'delete fixture auth sessions';
              await tx.authSession.deleteMany({ where: { id: { in: sessionRecordIds }, userId: account.id } });
            }
            cleanupStage = 'delete fixture athlete';
            await tx.athlete.deleteMany({ where: { id: athlete.id, userId: account.id } });
            cleanupStage = 'delete fixture user';
            await tx.user.deleteMany({ where: { id: account.id, email: fixture.email } });
          });

          const remainingPlanCount = planIds.length
            ? await prisma.trainingPlan.count({ where: { id: { in: planIds } } })
            : 0;
          const remainingUser = await prisma.user.findUnique({ where: { id: account.id }, select: { id: true } });
          if (remainingPlanCount || remainingUser) {
            cleanupErrors.push(`${fixture.email} (owned fixture rows remain)`);
          }
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'unknown';
          const errorName = error instanceof Error ? error.name : typeof error;
          cleanupErrors.push(`${fixture.email} (${fixture.userId}; ${cleanupStage}; cleanup error ${errorName}/${code})`);
        }
      }

      if (exerciseIds.length) {
        try {
          await prisma.exercise.deleteMany({ where: { id: { in: exerciseIds } } });
          const remaining = await prisma.exercise.count({ where: { id: { in: exerciseIds } } });
          if (remaining) cleanupErrors.push(`${remaining} test exercise fixture(s) remain`);
        } catch {
          cleanupErrors.push(`${exerciseIds.length} test exercise fixture(s) could not be cleaned`);
        }
      }
    }
    if (app) await app.close();
    if (cleanupErrors.length) throw new Error(`Training plan fixture cleanup failed: ${cleanupErrors.join(', ')}`);
  });

  async function register(label: string): Promise<{ fixture: UserFixture; token: string }> {
    const email = `plan-${RUN_ID}-${label}-${randomUUID().slice(0, 8)}@example.com`;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new Error('Generated training plan test email already exists; refusing to use it.');
    }
    const fixture: UserFixture = { email, registrationAttempted: true };
    users.push(fixture);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN!)
      .send({ email, password: PASSWORD })
      .expect(201);
    const body = response.body as RegisteredUser;
    fixture.userId = body.user.id;
    const athlete = await prisma.athlete.findUnique({ where: { userId: fixture.userId }, select: { id: true } });
    if (!athlete) throw new Error('Training plan fixture registration did not create its athlete profile.');
    fixture.athleteId = athlete.id;
    return { fixture, token: body.accessToken };
  }

  async function createPlan(token: string, fixture: UserFixture, name: string) {
    const athleteId = fixture.athleteId;
    if (!athleteId) throw new Error('Training plan fixture does not have a verified athlete owner.');
    if (await prisma.trainingPlan.findFirst({ where: { athleteId, name }, select: { id: true } })) {
      throw new Error('Generated training plan fixture name already exists; refusing to use it.');
    }
    const names = planNames.get(fixture.email) ?? new Set<string>();
    names.add(name);
    planNames.set(fixture.email, names);
    const response = await request(app.getHttpServer())
      .post('/api/v1/training-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, startsOn: '2026-11-01', endsOn: '2026-12-01' })
      .expect(201);
    const ids = createdPlanIdsByEmail.get(fixture.email) ?? new Set<string>();
    ids.add(response.body.id as string);
    createdPlanIdsByEmail.set(fixture.email, ids);
    return response;
  }

  async function createExercise(active: boolean): Promise<string> {
    const name = `Plan E2E ${RUN_ID} ${active ? 'Active' : 'Inactive'} ${randomUUID().slice(0, 8)}`;
    if (await prisma.exercise.findFirst({ where: { name }, select: { id: true } })) {
      throw new Error('Generated test exercise name already exists; refusing to use it.');
    }
    const exercise = await prisma.exercise.create({
      data: { name, muscleGroup: 'E2E fixture', equipment: 'Test barbell', isActive: active },
      select: { id: true },
    });
    exerciseIds.push(exercise.id);
    return exercise.id;
  }

  it('creates, isolates and manages draft plans, weeks and prescriptions while preserving history', async () => {
    await request(app.getHttpServer()).get('/api/v1/training-plans').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/training-plans')
      .send({ name: 'Unauthenticated', startsOn: '2026-11-01' })
      .expect(401);

    const owner = await register('owner');
    const other = await register('other');
    const activeExerciseId = await createExercise(true);
    const inactiveExerciseId = await createExercise(false);
    const planName = `E2E ${RUN_ID} owned plan`;
    const createdPlanResponse = await createPlan(owner.token, owner.fixture, planName);
    const planId = createdPlanResponse.body.id as string;
    expect(createdPlanResponse.body.status).toBe('DRAFT');
    expect(createdPlanResponse.body).not.toHaveProperty('athleteId');
    expect(createdPlanResponse.body).not.toHaveProperty('userId');
    expect(await prisma.trainingPlan.findUnique({ where: { id: planId }, select: { athleteId: true } }))
      .toEqual({ athleteId: owner.fixture.athleteId });

    const otherPlanName = `E2E ${RUN_ID} other plan`;
    const otherPlan = await createPlan(other.token, other.fixture, otherPlanName);
    const ownerList = await request(app.getHttpServer())
      .get('/api/v1/training-plans')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(ownerList.body.map((plan: { id: string }) => plan.id)).toContain(planId);
    expect(ownerList.body.map((plan: { id: string }) => plan.id)).not.toContain(otherPlan.body.id);
    const otherList = await request(app.getHttpServer())
      .get('/api/v1/training-plans')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(otherList.body.map((plan: { id: string }) => plan.id)).toEqual([otherPlan.body.id]);

    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'forged owner edit' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.weeks).toEqual([]);
        expect(body).not.toHaveProperty('athleteId');
      });

    const updatedPlan = await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Updated plan', endsOn: '2026-12-15' })
      .expect(200);
    expect(updatedPlan.body.name).toBe('Updated plan');
    expect(updatedPlan.body.startsOn).toContain('2026-11-01');
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ athleteId: other.fixture.athleteId })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ startsOn: '2026-12-20', endsOn: '2026-12-01' })
      .expect(400);

    const weekResponse = await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekNumber: 1, objective: 'Foundation block' })
      .expect(201);
    const weekId = weekResponse.body.id as string;
    const secondWeek = await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekNumber: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekNumber: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ objective: 'Unauthorized' })
      .expect(404);
    const updatedWeek = await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${secondWeek.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ objective: 'Build capacity' })
      .expect(200);
    expect(updatedWeek.body.objective).toBe('Build capacity');

    const prescriptionResponse = await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: activeExerciseId, position: 1, targetSets: 3, targetReps: 8, targetRpe: 7.5, targetLoad: 42.5 })
      .expect(201);
    const prescriptionId = prescriptionResponse.body.id as string;
    expect(prescriptionResponse.body.exercise.id).toBe(activeExerciseId);
    expect(prescriptionResponse.body.targetRpe).toBe(7.5);
    expect(prescriptionResponse.body).not.toHaveProperty('planWeekId');
    expect(await prisma.planExercise.findUnique({ where: { id: prescriptionId }, select: { planWeekId: true, exerciseId: true } }))
      .toEqual({ planWeekId: weekId, exerciseId: activeExerciseId });

    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: inactiveExerciseId, position: 2, targetSets: 3, targetReps: 8 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: '50000000-0000-4000-8000-000000000001', position: 2, targetSets: 3, targetReps: 8 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: activeExerciseId, position: 1, targetSets: 3, targetReps: 8 })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: activeExerciseId, position: 2, targetSets: 0, targetReps: 8 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: activeExerciseId, position: 2, targetSets: 3, targetReps: 8, seriesCompleted: 3 })
      .expect(400);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(history.body.weeks.map((week: { id: string }) => week.id)).toEqual([weekId, secondWeek.body.id]);
    expect(history.body.weeks[0].exercises[0].id).toBe(prescriptionId);
    const weekExercises = await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(weekExercises.body).toHaveLength(1);
    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}/weeks/${secondWeek.body.id}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}/weeks/not-a-uuid/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);

    const updatedPrescription = await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ targetSets: 4, targetReps: 6, targetRpe: 8, notes: 'Controlled eccentric' })
      .expect(200);
    expect(updatedPrescription.body.targetSets).toBe(4);
    expect(updatedPrescription.body.targetLoad).toBe(42.5);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: inactiveExerciseId })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ targetRpe: 10.5 })
      .expect(400);

    const removable = await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ exerciseId: activeExerciseId, position: 2, targetSets: 2, targetReps: 12 })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${removable.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200, { deleted: true });
    await request(app.getHttpServer())
      .get(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${removable.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);

    const workout = await prisma.workoutSession.create({
      data: {
        athleteId: owner.fixture.athleteId!,
        trainingPlanId: planId,
        planWeekId: weekId,
        exercises: {
          create: { exerciseId: activeExerciseId, planExerciseId: prescriptionId, orderInSession: 1 },
        },
      },
      select: { id: true },
    });
    expect(await prisma.workoutExercise.count({ where: { sessionId: workout.id, planExerciseId: prescriptionId } })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Historical plan rewrite' })
      .expect(409);
    expect((await prisma.trainingPlan.findUnique({ where: { id: planId }, select: { name: true } }))?.name)
      .toBe('Updated plan');
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ targetSets: 5 })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${planId}/weeks/${weekId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekNumber: 3 })
      .expect(409);

    await prisma.trainingPlan.update({ where: { id: otherPlan.body.id }, data: { status: 'ACTIVE' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/training-plans/${otherPlan.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'Active plan edit' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/training-plans/${otherPlan.body.id}/weeks`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ weekNumber: 1 })
      .expect(409);

    await request(app.getHttpServer()).get('/api/v1/training-plans/not-a-uuid')
      .set('Authorization', `Bearer ${owner.token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/training-plans/60000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${owner.token}`).expect(404);
  });
});
