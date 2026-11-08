import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ExercisesModule } from '../src/exercises/exercises.module';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { PrismaService } from '../src/database/prisma.service';
import { seedCatalog } from '../prisma/seed-catalog';
import { exercises } from '../prisma/exercise-catalog.seed';
import { exerciseAliases } from '../prisma/exercise-aliases.seed';
import { Prisma } from '../src/generated/prisma/client';
import { exerciseSearchQuery } from '../src/exercises/exercise-search.query';
const isolated = process.env.UX_TEST_DATABASE_URL ? describe : describe.skip;
isolated('Intelligent exercise search with isolated PostgreSQL', () => {
  let catalogSummary: object;
  let app: INestApplication,
    prisma: PrismaService,
    token: string,
    other: string;
  const get = (search: string, scope = '', t = token, extra = '') =>
    request(app.getHttpServer())
      .get(
        `/api/v1/exercises${scope}?search=${encodeURIComponent(search)}&limit=20&offset=0${extra}`,
      )
      .set('Authorization', `Bearer ${t}`);
  const post = (path: string, body: object, t = token) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Authorization', `Bearer ${t}`)
      .send(body);
  beforeAll(async () => {
    if (
      process.env.UX_TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL!).pathname !== '/pulso_f06_test'
    )
      throw new Error('Disposable database required.');
    const module = await Test.createTestingModule({
      imports: [ExercisesModule, WorkoutSessionsModule],
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
            email: `search-${randomUUID()}@example.test`,
            password: 'isolated-search-pass-123',
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
  it('seeds additively twice with stable IDs, valid aliases and no metadata rewrites', async () => {
    expect(
      Object.keys(exerciseAliases).every((key) =>
        exercises.some((e) => e.catalogKey === key),
      ),
    ).toBe(true);
    const expansion = new Set([
      'press-banca-floor-press-barra',
      'press-banca-floor-press-mancuernas',
      'press-banca-unilateral-polea-de-pie',
      'curl-biceps-bayesiano',
      'curl-biceps-spider',
      'curl-biceps-zottman',
      'sentadilla-zercher',
      'sentadilla-landmine',
      'remo-horizontal-seal-mancuernas',
      'remo-horizontal-meadows',
      'remo-horizontal-pecho-apoyado-polea',
      'flexion-rodilla-nordico-asistido',
      'extension-triceps-katana',
      'extension-triceps-tate',
      'elevacion-lateral-polea-tumbado',
      'cadera-abduccion-adduccion-copenhague',
      'bisagra-cadera-rumano-b-stance',
      'estabilidad-rotacional-pallof-rodillas',
      'antebrazo-pronacion-mancuerna',
      'antebrazo-supinacion-mancuerna',
    ]);
    const baseline = await seedCatalog(
      prisma,
      exercises.filter((row) => !expansion.has(row.catalogKey)),
    );
    expect(baseline.count).toBe(230);
    const originalIds = await prisma.exercise.findMany({
      where: {
        catalogKey: {
          in: exercises
            .filter((row) => !expansion.has(row.catalogKey))
            .map((row) => row.catalogKey),
        },
      },
      select: { id: true, catalogKey: true },
      orderBy: { id: 'asc' },
    });
    const privateFixture = (
      await post(
        '/exercises',
        {
          name: 'Privado previo al seed',
          equipment: 'Mancuerna',
          equipmentType: 'DUMBBELL',
          primaryMuscleGroupKey: 'biceps',
          secondaryMuscleGroupKeys: [],
          aliases: ['Alias privado previo'],
        },
        other,
      ).expect(201)
    ).body;
    const first = await seedCatalog(prisma);
    expect(first.inserted).toBe(20);
    expect(
      await prisma.exercise.findMany({
        where: { id: { in: originalIds.map((row) => row.id) } },
        select: { id: true, catalogKey: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(originalIds);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/exercises/' + privateFixture.id)
          .set('Authorization', `Bearer ${other}`)
          .expect(200)
      ).body,
    ).toEqual(privateFixture);

    expect(first.count).toBe(exercises.length);
    const before = await prisma.exercise.findMany({
      where: { catalogKey: { in: exercises.map((e) => e.catalogKey) } },
      select: { id: true, catalogKey: true },
      orderBy: { id: 'asc' },
    });
    const preserved = before[0]!;
    await prisma.exercise.update({
      where: { id: preserved.id },
      data: { description: 'Existing historical metadata' },
    });
    const metadata = await prisma.exercise.findMany({
      where: { catalogKey: { in: exercises.map((row) => row.catalogKey) } },
      orderBy: { id: 'asc' },
    });
    const aliasIds = await prisma.exerciseAlias.findMany({
      orderBy: { id: 'asc' },
    });
    const second = await seedCatalog(prisma);
    expect(
      await prisma.exercise.findMany({
        where: { catalogKey: { in: exercises.map((row) => row.catalogKey) } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(metadata);
    expect(
      await prisma.exerciseAlias.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(aliasIds);
    expect(second.inserted).toBe(0);
    catalogSummary = {
      initial: baseline.count,
      newExercises: first.inserted,
      final: second.count,
      aliases: second.aliases,
      repeatInserted: second.inserted,
    };
    expect(second.count).toBe(first.count);
    expect(second.aliases).toBe(first.aliases);
    expect(
      await prisma.exercise.findUniqueOrThrow({ where: { id: preserved.id } }),
    ).toMatchObject({ description: 'Existing historical metadata' });
    expect(
      await prisma.exercise.findMany({
        where: { catalogKey: { in: exercises.map((e) => e.catalogKey) } },
        select: { id: true, catalogKey: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    console.log(
      JSON.stringify({
        catalogSeed: {
          globalExercises: second.count,
          aliases: second.aliases,
          secondRunInserted: second.inserted,
        },
      }),
    );
  });
  it('refuses ambiguous legacy matches without reassigning or deleting their IDs', async () => {
    const definition = {
      ...exercises[0],
      catalogKey: `fixture-${randomUUID()}`,
      name: `Legacy ambiguity ${randomUUID()}`,
    };
    const group = await prisma.muscleGroup.findUniqueOrThrow({
      where: { key: definition.primaryMuscleGroupKey },
    });
    const {
      catalogKey: _key,
      aliases: _aliases,
      featuredRank: _featured,
      primaryMuscleGroupKey: _primary,
      secondaryMuscleGroupKeys: _secondary,
      ...fields
    } = definition;
    const first = await prisma.exercise.create({
        data: { ...fields, primaryMuscleGroupId: group.id },
      }),
      second = await prisma.exercise.create({
        data: { ...fields, primaryMuscleGroupId: group.id },
      });
    await expect(seedCatalog(prisma, [definition])).rejects.toThrow(
      'Ambiguous legacy catalog identity',
    );
    expect(
      await prisma.exercise.count({
        where: { id: { in: [first.id, second.id] }, catalogKey: null },
      }),
    ).toBe(2);
  });
  it.each([
    ['sentadila', 'Sentadilla'],
    ['dominads', 'Dominada'],
    ['bench press', 'Press de banca'],
    ['press banca', 'Press de banca'],
    ['jalon', 'Jalón'],
    ['remo mancu', 'Remo'],
    ['RDL', 'Peso muerto rumano'],
  ])(
    'finds %s by names, aliases, terms or moderate spelling errors',
    async (search, expected) => {
      const result = await get(search).expect(200);
      expect(result.body.items.length).toBeGreaterThan(0);
      expect(
        result.body.items.some((e: { name: string }) =>
          e.name.includes(expected),
        ),
      ).toBe(true);
    },
  );
  it('ignores accents and term order, ranks exact aliases before partial/fuzzy matches and never duplicates IDs', async () => {
    const plain = await get('biceps').expect(200),
      accented = await get('bíceps').expect(200);
    expect(plain.body).toEqual(accented.body);
    const exact = await get('bench press').expect(200);
    expect(exact.body.items[0].name).toBe(
      'Press de banca plano con barra olímpica',
    );
    expect(
      new Set(exact.body.items.map((e: { id: string }) => e.id)).size,
    ).toBe(exact.body.items.length);
    const ordered = await get('remo mancu').expect(200),
      reordered = await get('mancu remo').expect(200);
    expect(
      new Set(ordered.body.items.map((e: { id: string }) => e.id)),
    ).toEqual(new Set(reordered.body.items.map((e: { id: string }) => e.id)));
  });
  it('retains description-only search as a lower-priority match', async () => {
    const result = await get('Existing historical metadata').expect(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    expect(result.body.items[0].description).toBe(
      'Existing historical metadata',
    );
  });
  it('filters and paginates deterministically, bounds queries and handles empty pages', async () => {
    const path =
      '/api/v1/exercises?search=press&equipmentType=BARBELL&limit=5&offset=';
    const a = await request(app.getHttpServer())
        .get(path + '0')
        .expect(200),
      b = await request(app.getHttpServer())
        .get(path + '5')
        .expect(200);
    expect(a.body.items).toHaveLength(5);
    expect(
      a.body.items.every(
        (e: { equipmentType: string }) => e.equipmentType === 'BARBELL',
      ),
    ).toBe(true);
    expect(
      a.body.items.some((e: { id: string }) =>
        b.body.items.some((o: { id: string }) => o.id === e.id),
      ),
    ).toBe(false);
    expect(
      (
        await request(app.getHttpServer())
          .get(path + '1000000')
          .expect(200)
      ).body.items,
    ).toEqual([]);
    await get('x'.repeat(101)).expect(400);
    await get('', '', token, '&selection=INVALID').expect(400);
    await get("x' OR 1=1 --").expect(200);
  });
  it('isolates private aliases, validates normalized uniqueness and keeps private creation available', async () => {
    const input = {
      name: 'Ejercicio secreto aislado',
      equipment: 'Mancuerna',
      equipmentType: 'DUMBBELL',
      primaryMuscleGroupKey: 'biceps',
      secondaryMuscleGroupKeys: [],
      aliases: ['private-alias-ux'],
    };
    const created = await post('/exercises', input, other).expect(201);
    expect(created.body.isOwner).toBe(true);
    expect((await get('private-alias-ux').expect(200)).body.items).toEqual([]);
    expect(
      (await get('private-alias-ux', '/visible').expect(200)).body.items,
    ).toEqual([]);
    expect(
      (await get('private-alias-ux', '/visible', other).expect(200)).body
        .items[0].id,
    ).toBe(created.body.id);
    await post('/exercises', {
      ...input,
      aliases: ['Bíceps', 'biceps'],
    }).expect(400);
    await post('/exercises',{...input,aliases:['Press Æ','Press AE']}).expect(400);
    await post('/exercises', { ...input, ownerId: randomUUID() }).expect(400);
    const alias = await prisma.exerciseAlias.findFirstOrThrow({
      where: { exerciseId: created.body.id },
    });
    await expect(
      prisma.exerciseAlias.create({
        data: { exerciseId: created.body.id, name: alias.name.toUpperCase() },
      }),
    ).rejects.toBeDefined();
  });
  it('uses editorial featured selection and recent actual executions rather than planned targets', async () => {
    const featured = await get(
      '',
      '/visible',
      token,
      '&selection=FEATURED',
    ).expect(200);
    expect(featured.body.items.length).toBeGreaterThan(0);
    expect(
      featured.body.items.every(
        (e: { origin: string }) => e.origin === 'GLOBAL',
      ),
    ).toBe(true);
    expect(
      (await get('', '/visible', token, '&selection=RECENT').expect(200)).body
        .items,
    ).toEqual([]);
    const workout = (
      await post('/workout-sessions', {
        id: randomUUID(),
        performedOn: '2026-01-01',
        timeZone: 'UTC',
        recordingMode: 'RETROSPECTIVE',
      }).expect(201)
    ).body;
    const added = (
      await post(`/workout-sessions/${workout.id}/exercises`, {
        id: randomUUID(),
        exerciseId: featured.body.items[0].id,
        expectedVersion: 0,
      }).expect(201)
    ).body;
    expect(
      (await get('', '/visible', token, '&selection=RECENT').expect(200)).body
        .items,
    ).toEqual([]);
    const started = (
      await post(`/workout-sessions/${workout.id}/start`, {
        expectedVersion: added.version,
      }).expect(200)
    ).body;
    await post(
      `/workout-sessions/${workout.id}/exercises/${added.exercises[0].id}/sets`,
      {
        id: randomUUID(),
        expectedVersion: started.version,
        setNumber: 1,
        repetitions: 8,
        load: '20.5',
        loadUnit: 'KG',
        kind: 'WORK',
        status: 'COMPLETED',
      },
    ).expect(201);
    expect(
      (await get('', '/visible', token, '&selection=RECENT').expect(200)).body
        .items[0].id,
    ).toBe(featured.body.items[0].id);
    expect(
      (await get('', '/visible', other, '&selection=RECENT').expect(200)).body
        .items,
    ).toEqual([]);
  });
  it('verifies stored normalization triggers, usable GIN indices and measures actual query times', async () => {
    const functions = await prisma.$queryRaw<
      { provolatile: string }[]
    >`SELECT provolatile::text AS provolatile FROM pg_proc WHERE proname='pulso_search_normalize'`;
    expect(functions[0].provolatile).toBe('s');
    const timings: number[] = [];
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      await get(i % 2 ? 'sentadila' : 'bench press').expect(200);
      timings.push(performance.now() - start);
    }
    const sql = exerciseSearchQuery(
      { search: 'sentadila', limit: 20, offset: 0 },
      'GLOBAL',
    );
    const explain = await prisma.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.ids}`,
    );
    const indexed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan=off`;
      return tx.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${sql.ids}`);
    });
    expect(JSON.stringify(indexed)).toContain('exercises_search_name_gin');
    const plan = (
      explain as Array<Record<string, Array<Record<string, unknown>>>>
    )[0]?.['QUERY PLAN']?.[0];
    if (process.env.UX_MEASUREMENTS_FILE)
      await writeFile(
        process.env.UX_MEASUREMENTS_FILE,
        JSON.stringify({
          catalog: catalogSummary,
          search: {
            rows: exercises.length,
            httpMs: timings.map((n) => Number(n.toFixed(2))),
            planningMs: plan?.['Planning Time'],
            executionMs: plan?.['Execution Time'],
            ginIndexUsable: true,
          },
        }),
      );
    console.log(
      JSON.stringify({
        searchPerformance: {
          rows: exercises.length,
          httpMs: timings.map((n) => Number(n.toFixed(2))),
          planningMs: plan?.['Planning Time'],
          executionMs: plan?.['Execution Time'],
          ginIndexUsable: true,
        },
      }),
    );
  });
});
