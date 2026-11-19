import 'dotenv/config';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ExercisesModule } from '../src/exercises/exercises.module';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import type { AuthRequest } from '../src/auth/guards/auth-request';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';
import { PrismaService } from '../src/database/prisma.service';
import { OptionalAccessTokenGuard } from '../src/exercises/optional-access-token.guard';

const DATABASE_NAME = 'proyecto_pow_dev';
const RUN_ID = randomUUID();
const PREFIX = `ZZ PULSO ${RUN_ID.slice(0, 12)}`;

describe('Exercise catalog and personal exercises E2E (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  let athleteAId: string;
  let muscleGroupId: string;
  const fixtureExerciseIds: string[] = [];
  const fixturePlanIds: string[] = [];
  const fixtureUserIds: string[] = [];
  let fixtureAthleteIds: string[] = [];
  let fixtureMuscleGroupIds: string[] = [];
  const identities = new Map<string, AuthenticatedIdentity>();

  beforeAll(async () => {
    const connection = process.env.DATABASE_URL;
    if (!connection || decodeURIComponent(new URL(connection).pathname.slice(1)) !== DATABASE_NAME) {
      throw new Error(`Exercise E2E requires ${DATABASE_NAME}; refusing other databases.`);
    }

    const identityGuard = {
      canActivate: (context: { switchToHttp: () => { getRequest: () => AuthRequest } }) => {
        const request = context.switchToHttp().getRequest();
        const bearer = request.headers.authorization?.replace(/^Bearer\s+/, '');
        const identity = bearer ? identities.get(bearer) : undefined;
        if (!identity) throw new UnauthorizedException('Authentication required.');
        request.authIdentity = identity;
        return true;
      },
    };
    const optionalIdentityGuard = {
      canActivate: (context: { switchToHttp: () => { getRequest: () => AuthRequest } }) => {
        const request = context.switchToHttp().getRequest();
        if (request.headers.authorization === undefined) return true;
        return identityGuard.canActivate(context);
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [ExercisesModule] })
      .overrideGuard(AccessTokenGuard)
      .useValue(identityGuard)
      .overrideGuard(OptionalAccessTokenGuard)
      .useValue(optionalIdentityGuard)
      .compile();
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
    if (target[0]?.database !== DATABASE_NAME) throw new Error('Exercise E2E database safety check failed.');

    const suffix = RUN_ID.replaceAll('-', '').slice(0, 20);
    const group = await prisma.muscleGroup.create({
      data: { key: `test-${suffix}`, name: `Test ${suffix}`, description: 'Isolated exercise fixture.' },
      select: { id: true },
    });
    muscleGroupId = group.id;
    fixtureMuscleGroupIds.push(group.id);

    for (const [label, email] of [
      ['owner-a', `exercise-a-${RUN_ID}@example.test`],
      ['owner-b', `exercise-b-${RUN_ID}@example.test`],
    ] as const) {
      const user = await prisma.user.create({
        data: { email, passwordHash: 'fixture-only-not-a-valid-credential' },
        select: { id: true, email: true, status: true, createdAt: true, updatedAt: true },
      });
      fixtureUserIds.push(user.id);
      identities.set(label, { account: user, sessionId: randomUUID() });
      if (label === 'owner-a') userAId = user.id;
      else userBId = user.id;
    }
    const athlete = await prisma.athlete.create({ data: { userId: userAId }, select: { id: true } });
    athleteAId = athlete.id;
    fixtureAthleteIds.push(athlete.id);

    for (const [index, name] of [`${PREFIX} A`, `${PREFIX} B`, `${PREFIX} Inactive`].entries()) {
      const exercise = await prisma.exercise.create({
        data: {
          origin: 'GLOBAL',
          name,
          description: 'Isolated fixture for catalog tests.',
          equipment: 'Fixture',
          equipmentType: 'OTHER',
          movementType: 'COMPOUND',
          primaryMuscleGroupId: muscleGroupId,
          isActive: index !== 2,
        },
        select: { id: true },
      });
      fixtureExerciseIds.push(exercise.id);
    }
  });

  afterAll(async () => {
    if (prisma) {
      const exerciseIds = fixtureExerciseIds;
      if (fixturePlanIds.length) {
        await prisma.planExercise.deleteMany({ where: { planWeek: { trainingPlanId: { in: fixturePlanIds } } } });
        await prisma.planWeek.deleteMany({ where: { trainingPlanId: { in: fixturePlanIds } } });
        await prisma.trainingPlan.deleteMany({ where: { id: { in: fixturePlanIds } } });
      }
      if (exerciseIds.length) {
        await prisma.exerciseSecondaryMuscleGroup.deleteMany({ where: { exerciseId: { in: exerciseIds } } });
        await prisma.exercise.deleteMany({ where: { id: { in: exerciseIds } } });
        const remaining = await prisma.exercise.count({ where: { id: { in: exerciseIds } } });
        if (remaining) throw new Error(`Exercise test cleanup left exercise IDs: ${exerciseIds.join(', ')}`);
      }
      if (fixtureAthleteIds.length) await prisma.athlete.deleteMany({ where: { id: { in: fixtureAthleteIds } } });
      if (fixtureUserIds.length) await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
      if (fixtureMuscleGroupIds.length) await prisma.muscleGroup.deleteMany({ where: { id: { in: fixtureMuscleGroupIds } } });
    }
    if (app) await app.close();
  });

  it('lists global active entries in stable pages, applies filters, and excludes private entries', async () => {
    const global = await request(app.getHttpServer())
      .get(`/api/v1/exercises?search=${encodeURIComponent(PREFIX)}&limit=1&offset=0`)
      .expect(200);
    expect(global.body.total).toBe(2);
    expect(global.body.items).toHaveLength(1);
    expect(global.body.items[0].name).toBe(`${PREFIX} A`);
    expect(global.body.items[0]).not.toHaveProperty('ownerId');
    expect(global.body.items[0]).not.toHaveProperty('isActive');
    expect(global.body.items[0].primaryMuscleGroup.key).toMatch(/^test-/);

    const secondPage = await request(app.getHttpServer())
      .get(`/api/v1/exercises?search=${encodeURIComponent(PREFIX)}&limit=1&offset=1`)
      .expect(200);
    expect(secondPage.body.items[0].name).toBe(`${PREFIX} B`);

    await request(app.getHttpServer())
      .get(`/api/v1/exercises?primaryMuscleGroupKey=test-${RUN_ID.replaceAll('-', '').slice(0, 20)}`)
      .expect(200)
      .expect((response) => expect(response.body.items.map((item: { name: string }) => item.name)).toEqual(
        expect.arrayContaining([`${PREFIX} A`, `${PREFIX} B`]),
      ));
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/exercises?search=${encodeURIComponent(PREFIX)}&equipmentType=OTHER&movementType=COMPOUND`)
      .expect(200);
    expect(filtered.body.total).toBe(2);
    await request(app.getHttpServer())
      .get(`/api/v1/exercises?search=${encodeURIComponent(PREFIX)}&equipmentType=DUMBBELL`)
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
    await request(app.getHttpServer()).get('/api/v1/exercises?limit=0').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?offset=-1').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?unknownFilter=yes').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?equipmentType=imaginary').expect(400);
  });

  it('supports public detail and hides inactive, missing, invalid, or other-owner entries', async () => {
    await request(app.getHttpServer()).get(`/api/v1/exercises/${fixtureExerciseIds[0]}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/exercises/${fixtureExerciseIds[2]}`).expect(404);
    await request(app.getHttpServer()).get('/api/v1/exercises/10000000-0000-4000-8000-000000000001').expect(404);
    await request(app.getHttpServer()).get('/api/v1/exercises/not-a-uuid').expect(400);
  });

  it('creates and lists private exercises only for their owner and validates writes', async () => {
    const payload = {
      name: `${PREFIX} Personal`,
      primaryMuscleGroupKey: `test-${RUN_ID.replaceAll('-', '').slice(0, 20)}`,
      secondaryMuscleGroupKeys: [],
      equipment: 'Mancuerna de prueba',
      equipmentType: 'DUMBBELL',
      resistanceType: 'FREE_WEIGHT',
      movementType: 'ISOLATION',
      movementPattern: 'ELBOW_FLEXION',
      oneRmSuitability: 'NOT_SUITABLE',
    };
    await request(app.getHttpServer()).post('/api/v1/exercises').send(payload).expect(401);
    await request(app.getHttpServer()).post('/api/v1/exercises').set('Authorization', 'Bearer owner-a').send({ ...payload, userId: userBId }).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${fixtureExerciseIds[0]}`)
      .set('Authorization', 'Bearer owner-a')
      .send({ name: 'No editar global' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/exercises/${fixtureExerciseIds[0]}`)
      .set('Authorization', 'Bearer owner-a')
      .expect(404);

    const created = await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', 'Bearer owner-a')
      .send(payload)
      .expect(201);
    fixtureExerciseIds.push(created.body.id as string);
    expect(created.body.origin).toBe('PERSONAL');
    expect(created.body.isOwner).toBe(true);
    expect(created.body).not.toHaveProperty('ownerId');

    const mineA = await request(app.getHttpServer()).get('/api/v1/exercises/mine').set('Authorization', 'Bearer owner-a').expect(200);
    expect(mineA.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id);
    const mineB = await request(app.getHttpServer()).get('/api/v1/exercises/mine').set('Authorization', 'Bearer owner-b').expect(200);
    expect(mineB.body.items).toHaveLength(0);
    const global = await request(app.getHttpServer()).get(`/api/v1/exercises?search=${encodeURIComponent(PREFIX)}&limit=100`).expect(200);
    expect(global.body.items.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
    await request(app.getHttpServer()).get(`/api/v1/exercises/${created.body.id}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/exercises/${created.body.id}`).set('Authorization', 'Bearer owner-b').expect(404);
    await request(app.getHttpServer()).get(`/api/v1/exercises/${created.body.id}`).set('Authorization', 'Bearer owner-a').expect(200);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${created.body.id}`)
      .set('Authorization', 'Bearer owner-a')
      .send({ name: `${PREFIX} Personal actualizado` })
      .expect(200);
    expect(updated.body.name).toBe(`${PREFIX} Personal actualizado`);
    await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${created.body.id}`)
      .set('Authorization', 'Bearer owner-b')
      .send({ name: 'No permitido' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${created.body.id}`)
      .set('Authorization', 'Bearer owner-a')
      .send({ ownerId: userBId })
      .expect(400);
  });

  it('blocks edits that would rewrite a referenced exercise and retires without deleting history', async () => {
    const customId = fixtureExerciseIds[fixtureExerciseIds.length - 1];
    const createdExercise = await prisma.exercise.update({
      where: { id: customId },
      data: {
        origin: 'PERSONAL',
        ownerId: userAId,
        catalogKey: null,
        isActive: true,
        primaryMuscleGroupId: muscleGroupId,
      },
      select: { id: true },
    });
    const plan = await prisma.trainingPlan.create({
      data: { athleteId: athleteAId, name: `${PREFIX} Plan`, startsOn: new Date('2026-01-01T00:00:00.000Z') },
      select: { id: true },
    });
    fixturePlanIds.push(plan.id);
    const week = await prisma.planWeek.create({
      data: { trainingPlanId: plan.id, weekNumber: 1 },
      select: { id: true },
    });
    await prisma.planExercise.create({
      data: { planWeekId: week.id, exerciseId: createdExercise.id, position: 1, targetSets: 3, targetReps: 8 },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/exercises/${createdExercise.id}`)
      .set('Authorization', 'Bearer owner-a')
      .send({ name: 'No debe alterar un plan histórico' })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/exercises/${createdExercise.id}`)
      .set('Authorization', 'Bearer owner-a')
      .expect(200, { deactivated: true });
    expect(await prisma.planExercise.count({ where: { exerciseId: createdExercise.id } })).toBe(1);
    expect(await prisma.exercise.findUnique({ where: { id: createdExercise.id }, select: { isActive: true } })).toEqual({ isActive: false });
    await request(app.getHttpServer()).get(`/api/v1/exercises/${createdExercise.id}`).set('Authorization', 'Bearer owner-a').expect(404);
  });
});
