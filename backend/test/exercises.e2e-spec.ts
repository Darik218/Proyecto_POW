import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ExercisesModule } from '../src/exercises/exercises.module';
import { PrismaService } from '../src/database/prisma.service';

const DATABASE_NAME = 'proyecto_pow_dev';
const RUN_ID = randomUUID();

describe('Exercise catalog E2E (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    const connection = process.env.DATABASE_URL;
    if (!connection || decodeURIComponent(new URL(connection).pathname.slice(1)) !== DATABASE_NAME) {
      throw new Error(`Exercise E2E requires ${DATABASE_NAME}; refusing other databases.`);
    }
    const moduleRef = await Test.createTestingModule({ imports: [ExercisesModule] }).compile();
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
  });

  afterAll(async () => {
    if (prisma && fixtureIds.length) {
      await prisma.exercise.deleteMany({ where: { id: { in: fixtureIds } } });
      const remaining = await prisma.exercise.count({ where: { id: { in: fixtureIds } } });
      if (remaining) throw new Error(`Exercise test cleanup left ${remaining} fixture record(s).`);
    }
    if (app) await app.close();
  });

  it('lists active exercises with stable pagination and returns only public fields', async () => {
    const suffix = RUN_ID.slice(0, 12);
    const names = [`ZZ Test ${suffix} A`, `ZZ Test ${suffix} B`];
    for (const name of names) {
      const existing = await prisma.exercise.findFirst({ where: { name }, select: { id: true } });
      if (existing) throw new Error('Generated test exercise name already exists; refusing to use it.');
      const created = await prisma.exercise.create({
        data: {
          name,
          muscleGroup: 'Test muscle group',
          equipment: 'Test equipment',
          description: 'Fixture for catalog integration tests',
          isActive: true,
        },
        select: { id: true },
      });
      fixtureIds.push(created.id);
    }
    const inactive = await prisma.exercise.create({
      data: {
        name: `ZZ Test ${suffix} Inactive`,
        muscleGroup: 'Test muscle group',
        equipment: 'Test equipment',
        isActive: false,
      },
      select: { id: true },
    });
    fixtureIds.push(inactive.id);

    const list = await request(app.getHttpServer())
      .get('/api/v1/exercises?limit=100&offset=0')
      .expect(200);
    const returnedNames = (list.body as { name: string }[]).map(({ name }) => name);
    const expectedOrder = await prisma.exercise.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    expect((list.body as { id: string }[]).map(({ id }) => id)).toEqual(
      expectedOrder.map(({ id }) => id),
    );
    expect(returnedNames).toEqual(expect.arrayContaining(names));
    expect(returnedNames).not.toContain(`ZZ Test ${suffix} Inactive`);
    expect(list.body[0]).not.toHaveProperty('isActive');
    expect(list.body[0]).not.toHaveProperty('createdAt');
    expect(list.body[0]).not.toHaveProperty('updatedAt');

    const index = await prisma.exercise.count({
      where: { isActive: true, name: { lt: names[0] } },
    });
    const page = await request(app.getHttpServer())
      .get(`/api/v1/exercises?limit=1&offset=${index}`)
      .expect(200);
    expect(page.body).toHaveLength(1);
    expect(page.body[0].id).toBe(fixtureIds[0]);
  });

  it('looks up active exercises and hides inactive or missing records', async () => {
    const active = await prisma.exercise.create({
      data: {
        name: `Lookup ${RUN_ID}`,
        muscleGroup: 'Test group',
        equipment: 'Test equipment',
        isActive: true,
      },
      select: { id: true },
    });
    fixtureIds.push(active.id);
    const inactive = await prisma.exercise.create({
      data: {
        name: `Inactive ${RUN_ID}`,
        muscleGroup: 'Test group',
        equipment: 'Test equipment',
        isActive: false,
      },
      select: { id: true },
    });
    fixtureIds.push(inactive.id);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/exercises/${active.id}`)
      .expect(200);
    expect(response.body).toEqual(expect.objectContaining({ id: active.id }));
    expect(response.body).not.toHaveProperty('isActive');
    await request(app.getHttpServer()).get(`/api/v1/exercises/${inactive.id}`).expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/10000000-0000-4000-8000-000000000001')
      .expect(404);
    await request(app.getHttpServer()).get('/api/v1/exercises/not-a-uuid').expect(400);
  });

  it('validates pagination and does not require an account for the read-only catalog', async () => {
    await request(app.getHttpServer()).get('/api/v1/exercises?limit=0').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?offset=-1').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?isActive=false').expect(400);
    await request(app.getHttpServer()).get('/api/v1/exercises?limit=1').expect(200);
  });
});
