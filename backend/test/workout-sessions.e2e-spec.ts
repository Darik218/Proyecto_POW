import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { ExercisesModule } from '../src/exercises/exercises.module';
import { PrismaService } from '../src/database/prisma.service';

const isolated = process.env.F06_TEST_DATABASE_URL ? describe : describe.skip;
type Actor = { userId: string; athleteId: string; token: string };
isolated('F06 isolated PostgreSQL and HTTP integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Actor;
  let other: Actor;
  let exerciseId: string;
  let inactiveId: string;
  let ownId: string;
  let privateId: string;
  const url = '/api/v1/workout-sessions';
  const intentDate = { performedOn: '2026-01-01', timeZone: 'UTC', recordingMode: 'RETROSPECTIVE' };
  const revision = async (id: string) => (await prisma.workoutSession.findUniqueOrThrow({ where: { id } })).version;
  const auth = (actor = owner) => `Bearer ${actor.token}`;
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.F06_TEST_DATABASE_URL || new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test') {
      throw new Error('F06 tests require the isolated pulso_f06_test database; development writes are forbidden.');
    }
    const module = await Test.createTestingModule({ imports: [WorkoutSessionsModule, TrainingPlansModule, ExercisesModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const database = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (database[0]?.name !== 'pulso_f06_test') throw new Error('Isolated target verification failed.');
    async function register(): Promise<Actor> {
      const registered = await request(app.getHttpServer()).post('/api/v1/auth/register').set('Origin', 'http://localhost:5173')
        .send({ email: `f06-${randomUUID()}@example.test`, password: 'isolated-workout-password-123' }).expect(201);
      const athlete = await prisma.athlete.findUniqueOrThrow({ where: { userId: registered.body.user.id }, select: { id: true } });
      return { userId: registered.body.user.id as string, athleteId: athlete.id, token: registered.body.accessToken as string };
    }
    owner = await register(); other = await register();
    const group = await prisma.muscleGroup.create({ data: { key: `f06-${randomUUID()}`, name: `F06 ${randomUUID()}` } });
    async function exercise(active: boolean, userId?: string) {
      return (await prisma.exercise.create({ data: { name: `F06 ${randomUUID()}`, primaryMuscleGroupId: group.id, equipment: 'Barra', equipmentType: 'BARBELL', isActive: active, ...(userId ? { origin: 'PERSONAL', ownerId: userId } : {}) } })).id;
    }
    exerciseId = await exercise(true); inactiveId = await exercise(false); ownId = await exercise(true, owner.userId); privateId = await exercise(true, other.userId);
  }, 20000);
  afterAll(async () => { if (app) await app.close(); });
  async function plan(actor = owner, source = exerciseId) {
    const result = await prisma.trainingPlan.create({ data: { athleteId: actor.athleteId, name: `F06 ${randomUUID()}`, startsOn: new Date('2026-11-01'), weeks: { create: { weekNumber: 1, planExercises: { create: { exerciseId: source, position: 1, targetSets: 3, targetReps: 8, targetRpe: 7.5, targetLoad: 42.125 } } } } }, include: { weeks: { include: { planExercises: true } } } });
    const day = await prisma.planDay.create({ data: { planWeekId: result.weeks[0].id, name: 'F06 routine', position: 1 } });
    await prisma.planExercise.updateMany({ where: { planWeekId: result.weeks[0].id }, data: { planDayId: day.id } });
    return { ...result, dayId: day.id };
  }
  async function create(actor = owner, extra: Record<string, unknown> = {}) {
    const day = typeof extra.planWeekId === 'string' ? await prisma.planDay.findFirst({ where: { planWeekId: extra.planWeekId } }) : null;
    const created = await request(app.getHttpServer()).post(url).set('Authorization', auth(actor)).send({ ...intentDate, id: randomUUID(), ...intentDate, ...(day ? { planDayId: day.id } : {}), ...extra }).expect(201);
    return request(app.getHttpServer()).post(`${url}/${created.body.id}/start`).set('Authorization', auth(actor)).send({ expectedVersion: created.body.version }).expect(200);
  }

  it('creates sessions idempotently under concurrency and isolates lists and details', async () => {
    const id = randomUUID();
    const responses = await Promise.all([create(owner, { id, notes: 'Inicio' }), create(owner, { id, notes: 'Inicio' })]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[0].body.status).toBe('IN_PROGRESS');
    expect(responses[0].body.startedAt).not.toBeNull();
    expect(await prisma.workoutSession.count({ where: { id } })).toBe(1);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id, notes: 'Different intent' }).expect(409);
    const otherSession = await create(other);
    const list = await request(app.getHttpServer()).get(`${url}?limit=100&offset=0`).set('Authorization', auth()).expect(200);
    expect(list.body.items.some((row: { id: string }) => row.id === id)).toBe(true);
    expect(list.body.items.some((row: { id: string }) => row.id === otherSession.body.id)).toBe(false);
    expect(list.body.items[0]).not.toHaveProperty('athleteId');
    await request(app.getHttpServer()).get(`${url}/${id}`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).post(`${url}/${id}/complete`).set('Authorization', auth(other)).send({ expectedVersion: 0 }).expect(404);
    const distinct = await Promise.all([create(), create()]);
    expect(distinct[0].body.id).not.toBe(distinct[1].body.id);
    const firstPage = await request(app.getHttpServer()).get(`${url}?limit=1&offset=0&status=IN_PROGRESS`).set('Authorization', auth()).expect(200);
    const secondPage = await request(app.getHttpServer()).get(`${url}?limit=1&offset=1&status=IN_PROGRESS`).set('Authorization', auth()).expect(200);
    expect(firstPage.body.items[0].id).not.toBe(secondPage.body.items[0].id);
  });

  it('copies authorized plan references atomically without modifying prescriptions', async () => {
    const source = await plan(); const foreign = await plan(other);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), trainingPlanId: source.id }).expect(400);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), trainingPlanId: foreign.id, planWeekId: foreign.weeks[0].id, planDayId: foreign.dayId }).expect(404);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), trainingPlanId: source.id, planWeekId: foreign.weeks[0].id, planDayId: foreign.dayId }).expect(404);
    const response = await create(owner, { trainingPlanId: source.id, planWeekId: source.weeks[0].id });
    expect(response.body.exercises).toHaveLength(1);
    expect(response.body.exercises[0].original).toMatchObject({ source: { id: source.weeks[0].planExercises[0].id }, targets: { targetSets: 3, targetLoad: '42.125' } });
    await request(app.getHttpServer()).patch(`/api/v1/training-plans/${source.id}/weeks/${source.weeks[0].id}/days/${source.dayId}/exercises/${source.weeks[0].planExercises[0].id}`)
      .set('Authorization', auth()).send({ targetSets: 9 }).expect(409);
    expect((await prisma.planExercise.findUniqueOrThrow({ where: { id: source.weeks[0].planExercises[0].id } })).targetSets).toBe(3);
    const unavailable = await plan(owner, inactiveId); const rejectedId = randomUUID();
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: rejectedId, trainingPlanId: unavailable.id, planWeekId: unavailable.weeks[0].id, planDayId: unavailable.dayId }).expect(409);
    expect(await prisma.workoutSession.count({ where: { id: rejectedId } })).toBe(0);
    const hidden = await plan(owner, privateId);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), trainingPlanId: hidden.id, planWeekId: hidden.weeks[0].id, planDayId: hidden.dayId }).expect(409);
    await prisma.trainingPlan.update({ where: { id: unavailable.id }, data: { status: 'ARCHIVED' } });
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), trainingPlanId: unavailable.id, planWeekId: unavailable.weeks[0].id, planDayId: unavailable.dayId }).expect(409);
  });

  it('serializes plan edits with reference capture so history remains stable', async () => {
    const source = await plan(); const week = source.weeks[0]; const prescription = week.planExercises[0];
    const [started, edited] = await Promise.all([
      create(owner, { trainingPlanId: source.id, planWeekId: week.id }),
      request(app.getHttpServer()).patch(`/api/v1/training-plans/${source.id}/weeks/${week.id}/days/${source.dayId}/exercises/${prescription.id}`).set('Authorization', auth()).send({ targetSets: 4 }),
    ]);
    expect([200, 409]).toContain(edited.status);
    expect(started.body.exercises[0].original.targets.targetSets).toBe(edited.status === 200 ? 4 : 3);
    await request(app.getHttpServer()).patch(`/api/v1/training-plans/${source.id}/weeks/${week.id}/days/${source.dayId}/exercises/${prescription.id}`).set('Authorization', auth()).send({ targetSets: 5 }).expect(409);
  });

  it('adds visible exercises once, assigns distinct orders and rejects foreign or inactive ones', async () => {
    const created = await create(); const id = created.body.id as string; const operation = randomUUID();
    const add = async (body: Record<string, unknown>) => request(app.getHttpServer()).post(`${url}/${id}/exercises`).set('Authorization', auth()).send({ expectedVersion: await revision(id), ...body });
    expect((await add({ id: randomUUID(), exerciseId: privateId })).status).toBe(404);
    expect((await add({ id: randomUUID(), exerciseId: inactiveId })).status).toBe(404);
    const duplicates = await Promise.all([add({ id: operation, exerciseId: ownId }), add({ id: operation, exerciseId: ownId })]);
    expect(duplicates.map(row => row.status)).toEqual([201, 201]);
    expect(await prisma.workoutExercise.count({ where: { sessionId: id } })).toBe(1);
    const inputs = [{ id: randomUUID(), exerciseId }, { id: randomUUID(), exerciseId }];
    const additions = await Promise.all(inputs.map(input => add(input)));
    expect(additions.every(row => [201,409].includes(row.status))).toBe(true);
    for (const [index, result] of additions.entries()) if (result.status === 409) expect((await add(inputs[index])).status).toBe(201);
    const detail = await request(app.getHttpServer()).get(`${url}/${id}`).set('Authorization', auth()).expect(200);
    expect(detail.body.exercises.map((row: { orderInSession: number }) => row.orderInSession)).toEqual([1, 2, 3]);
    await request(app.getHttpServer()).patch(`/api/v1/exercises/${ownId}`).set('Authorization', auth()).send({ name: 'History rewrite' }).expect(409);
  });

  it('completes once, rejects empty or closed modifications and resolves add/complete races coherently', async () => {
    const created = await create(); const id = created.body.id as string;
    await request(app.getHttpServer()).post(`${url}/${id}/complete`).set('Authorization', auth()).send({ expectedVersion: 0 }).expect(409);
    const addId = randomUUID();
    await request(app.getHttpServer()).post(`${url}/${id}/exercises`).set('Authorization', auth()).send({ id: addId, exerciseId, expectedVersion: await revision(id) }).expect(201);
    const complete = async () => request(app.getHttpServer()).post(`${url}/${id}/complete`).set('Authorization', auth()).send({ expectedVersion: await revision(id), confirmWithoutResults: true });
    const [first, second] = await Promise.all([complete(), complete()]);
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(first.body.finishedAt).toBe(second.body.finishedAt);
    await request(app.getHttpServer()).post(`${url}/${id}/exercises`).set('Authorization', auth()).send({ id: randomUUID(), exerciseId, expectedVersion: await revision(id) }).expect(409);
    const replay = await request(app.getHttpServer()).post(`${url}/${id}/exercises`).set('Authorization', auth()).send({ id: addId, exerciseId, expectedVersion: await revision(id) }).expect(201);
    expect(replay.body.exercises).toHaveLength(1);
    await request(app.getHttpServer()).post(`${url}/${id}/start`).set('Authorization', auth()).send({ expectedVersion: 0 }).expect(409);
    const race = await create(); const raceId = race.body.id as string;
    await request(app.getHttpServer()).post(`${url}/${raceId}/exercises`).set('Authorization', auth()).send({ id: randomUUID(), exerciseId, expectedVersion: await revision(raceId) }).expect(201);
    const [added, ended] = await Promise.all([
      request(app.getHttpServer()).post(`${url}/${raceId}/exercises`).set('Authorization', auth()).send({ id: randomUUID(), exerciseId, expectedVersion: await revision(raceId) }),
      request(app.getHttpServer()).post(`${url}/${raceId}/complete`).set('Authorization', auth()).send({ expectedVersion: await revision(raceId), confirmWithoutResults: true }),
    ]);
    expect([200,409]).toContain(ended.status); expect([201, 409]).toContain(added.status);
    const final = ended.status === 200 ? ended : await request(app.getHttpServer()).post(`${url}/${raceId}/complete`).set('Authorization',auth()).send({expectedVersion: await revision(raceId),confirmWithoutResults:true}).expect(200);
    expect(final.body.exercises).toHaveLength(added.status === 201 ? 2 : 1);
    expect(await prisma.setRecord.count({ where: { workoutExercise: { sessionId: { in: [id, raceId] } } } })).toBe(0);
  });

  it('handles legacy planned/cancelled states and rejects invalid HTTP input', async () => {
    const planned = await prisma.workoutSession.create({ data: { athleteId: owner.athleteId, status: 'PLANNED' } });
    const start = () => request(app.getHttpServer()).post(`${url}/${planned.id}/start`).set('Authorization', auth()).send({ expectedVersion: 0 });
    const starts = await Promise.all([start(), start()]);
    expect(starts.every(result => result.status === 200)).toBe(true); expect(starts[0].body.startedAt).toBe(starts[1].body.startedAt);
    const cancelled = await prisma.workoutSession.create({ data: { athleteId: owner.athleteId, status: 'CANCELLED' } });
    await request(app.getHttpServer()).post(`${url}/${cancelled.id}/start`).set('Authorization', auth()).send({ expectedVersion: 0 }).expect(409);
    const inactivePlanned = await prisma.workoutSession.create({ data: { athleteId: owner.athleteId, status: 'PLANNED', exercises: { create: { exerciseId: inactiveId, orderInSession: 1 } } } });
    await request(app.getHttpServer()).post(`${url}/${inactivePlanned.id}/start`).set('Authorization', auth()).send({ expectedVersion: 0 }).expect(409);
    const invalidPrivateLink = await prisma.workoutSession.create({ data: { athleteId: owner.athleteId, status: 'PLANNED', exercises: { create: { exerciseId: privateId, orderInSession: 1 } } } });
    await request(app.getHttpServer()).get(`${url}/${invalidPrivateLink.id}`).set('Authorization', auth()).expect(404);
    await request(app.getHttpServer()).post(`${url}/${invalidPrivateLink.id}/start`).set('Authorization', auth()).send({ expectedVersion: 0 }).expect(404);
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get(`${url}/invalid`).set('Authorization', auth()).expect(400);
    await request(app.getHttpServer()).get(`${url}?limit=101&offset=-1`).set('Authorization', auth()).expect(400);
    await request(app.getHttpServer()).post(url).set('Authorization', auth()).send({ ...intentDate, id: randomUUID(), athleteId: other.athleteId }).expect(400);
    await request(app.getHttpServer()).post(`${url}/${planned.id}/complete`).set('Authorization', auth()).send({ status: 'COMPLETED' }).expect(400);
    await request(app.getHttpServer()).post(`${url}/${planned.id}/exercises`).set('Authorization', auth()).send({ id: randomUUID(), exerciseId, load: 50, rpe: 8 }).expect(400);
  });

  it('runs the actual Vue services and composables over HTTP with PostgreSQL', async () => {
    await app.listen(0, '127.0.0.1');
    const address: unknown = app.getHttpServer().address();
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('Missing isolated HTTP port.');
    const source = await plan();
    const output = await new Promise<string>((accept, reject) => {
      const child = execFile(process.execPath, ['--experimental-strip-types', '--experimental-loader', './tests/typescript-loader.mjs', './tests/workout-sessions.http.mjs'], { cwd: resolve(process.cwd(), '../frontend'), timeout: 15000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`Frontend workout flow failed: ${stderr.split('\n').find(line => line.startsWith('{"workoutHttpFlow"')) ?? error.code}`));
        else accept(stdout);
      });
      child.stdin?.end(JSON.stringify({ baseURL: `http://127.0.0.1:${String(address.port)}/api/v1`, token: owner.token, exerciseId, trainingPlanId: source.id, planWeekId: source.weeks[0].id, planDayId: source.dayId }));
    });
    expect((JSON.parse(output) as { workoutHttpFlow: string }).workoutHttpFlow).toBe('passed');
  }, 20000);
});
