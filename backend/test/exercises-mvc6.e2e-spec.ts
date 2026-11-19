import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ExercisesPresenter } from '../src/views/exercises/exercises.presenter';
import { Exercise } from '../src/models/exercises/exercise.model';
import {
  isolated,
  mvcHarness,
  vueHttp,
  type MvcHarness,
  type Actor,
} from './helpers/mvc6';

isolated('MVC-6 exercises with real PostgreSQL', () => {
  let h: MvcHarness, owner: Actor, other: Actor;
  let primary: { id: string; key: string; name: string },
    secondary: typeof primary;
  const marker = randomUUID();
  const ids = {
    press: randomUUID(),
    squat: randomUUID(),
    inactive: randomUUID(),
  };
  const stamp = new Date('2026-01-02T03:04:05.123Z');
  beforeAll(async () => {
    h = await mvcHarness();
    owner = await h.actor();
    other = await h.actor();
    primary = await h.group();
    secondary = await h.group();
    for (const [id, name, aliases, active] of [
      [
        ids.press,
        'Press de banca MVC6 ' + marker,
        ['Bench press MVC6 ' + marker, 'Pecho MVC6 ' + marker],
        true,
      ],
      [ids.squat, 'Sentadilla MVC6 ' + marker, ['Squat MVC6 ' + marker], true],
      [ids.inactive, 'Ejercicio retirado MVC6 ' + marker, [], false],
    ] as const) {
      await h.prisma.exercise.create({
        data: {
          id,
          name,
          origin: 'GLOBAL',
          catalogKey: 'mvc6-' + id,
          isActive: active,
          primaryMuscleGroupId: primary.id,
          equipment: 'Barra',
          equipmentType: 'BARBELL',
          movementType: 'COMPOUND',
          description: null,
          featuredRank: id === ids.press ? 1 : null,
          aliases: { create: aliases.map((name) => ({ name })) },
          secondaryMuscleGroups: { create: { muscleGroupId: secondary.id } },
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
    }
  });
  afterAll(async () => {
    await h?.app.close();
  });
  const input = () => ({
    name: 'Privado MVC6 ' + randomUUID(),
    equipment: 'Mancuernas',
    equipmentType: 'DUMBBELL',
    primaryMuscleGroupKey: primary.key,
    secondaryMuscleGroupKeys: [secondary.key],
    aliases: ['Privado alias ' + randomUUID()],
  });
  const list = (query: object, scope = '', actor?: Actor) =>
    h.get('/exercises' + scope, actor).query(query);

  it('requires the real search extensions, normalization function and GIN indexes', async () => {
    const extensions = await h.prisma.$queryRaw<
      { name: string }[]
    >`SELECT extname AS name FROM pg_extension`;
    expect(extensions.map((row) => row.name)).toEqual(
      expect.arrayContaining(['unaccent', 'pg_trgm']),
    );
    const [normalized] = await h.prisma.$queryRaw<
      { value: string }[]
    >`SELECT pulso_search_normalize('  Bíceps ÁÉ  ') AS value`;
    expect(normalized?.value).toBe('biceps ae');
    const indexes = await h.prisma.$queryRaw<
      { name: string; definition: string }[]
    >`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname='public'
      AND tablename IN ('exercises','exercise_aliases')`;
    expect(
      indexes.filter((row) => row.definition.includes('gin_trgm_ops')).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('runs SQL search/pagination through the model and presenter with exact public fields', async () => {
    const presenter = h.app.get(ExercisesPresenter);
    const spy = jest.spyOn(presenter, 'catalog');
    try {
      const first = await list({
        primaryMuscleGroupKey: primary.key,
        limit: 1,
        offset: 0,
      }).expect(200);
      const second = await list({
        primaryMuscleGroupKey: primary.key,
        limit: 1,
        offset: 1,
      }).expect(200);
      expect(first.body).toMatchObject({ total: 2, limit: 1, offset: 0 });
      expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
      expect(first.body.items[0].name < second.body.items[0].name).toBe(true);
      expect(spy.mock.calls[0]![0].items[0]).toBeInstanceOf(Exercise);
      expect(first.body.items[0]).toEqual({
        id: ids.press,
        aliases: ['Bench press MVC6 ' + marker, 'Pecho MVC6 ' + marker],
        name: 'Press de banca MVC6 ' + marker,
        description: null,
        equipment: 'Barra',
        equipmentType: 'BARBELL',
        machineType: null,
        resistanceType: null,
        movementType: 'COMPOUND',
        movementPattern: null,
        grip: null,
        gripWidth: null,
        bodyPosition: null,
        laterality: null,
        movementPlane: null,
        difficulty: null,
        oneRmSuitability: 'UNDETERMINED',
        instructions: null,
        origin: 'GLOBAL',
        primaryMuscleGroup: { key: primary.key, name: primary.name },
        secondaryMuscleGroups: [{ key: secondary.key, name: secondary.name }],
        createdAt: '2026-01-02T03:04:05.123Z',
        updatedAt: '2026-01-02T03:04:05.123Z',
        isOwner: false,
      });
      expect(
        (
          await list({
            primaryMuscleGroupKey: primary.key,
            offset: 100,
          }).expect(200)
        ).body.items,
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('matches names, aliases, accent-free terms and spelling errors without duplicate IDs', async () => {
    for (const [search, id] of [
      ['bench press', ids.press],
      ['pecho', ids.press],
      ['sentadila', ids.squat],
      ['squat', ids.squat],
    ] as const) {
      const result = await list({
        search,
        primaryMuscleGroupKey: primary.key,
      }).expect(200);
      expect(
        result.body.items.map((item: { id: string }) => item.id),
      ).toContain(id);
      const ids = result.body.items.map((item: { id: string }) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const accented = await list({
      search: 'Pécho',
      primaryMuscleGroupKey: primary.key,
    }).expect(200);
    const plain = await list({
      search: 'pecho',
      primaryMuscleGroupKey: primary.key,
    }).expect(200);
    expect(accented.body).toEqual(plain.body);
    expect(
      (await list({ search: 'Bench press MVC6 ' + marker }).expect(200)).body
        .items[0].id,
    ).toBe(ids.press);
    await list({
      search: "x' OR 1=1 --",
      primaryMuscleGroupKey: primary.key,
    }).expect(200);
  });

  it('filters actual muscle relationships, equipment, movement and featured selection', async () => {
    expect(
      (
        await list({
          primaryMuscleGroupKey: primary.key,
          secondaryMuscleGroupKey: secondary.key,
          equipmentType: 'BARBELL',
          movementType: 'COMPOUND',
        }).expect(200)
      ).body.total,
    ).toBe(2);
    expect(
      (
        await list({
          primaryMuscleGroupKey: primary.key,
          equipmentType: 'CABLE',
        }).expect(200)
      ).body.total,
    ).toBe(0);
    expect(
      (
        await list({
          primaryMuscleGroupKey: primary.key,
          selection: 'FEATURED',
        }).expect(200)
      ).body.items.map((item: { id: string }) => item.id),
    ).toEqual([ids.press]);
    expect(
      (
        await list({
          primaryMuscleGroupKey: primary.key,
          selection: 'RECENT',
        }).expect(200)
      ).body.items,
    ).toEqual([]);
  });

  it('creates and edits only own private exercises and keeps aliases private in SQL searches', async () => {
    const payload = input();
    const created = await h
      .send('post', '/exercises', payload, owner)
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.isOwner).toBe(true);
    const stored = await h.prisma.exercise.findUniqueOrThrow({ where: { id } });
    expect(stored.ownerId).toBe(owner.id);
    expect(stored.origin).toBe('PERSONAL');
    expect(
      (await list({ search: payload.aliases[0] }).expect(200)).body.items,
    ).toEqual([]);
    expect(
      (
        await list({ search: payload.aliases[0] }, '/visible', other).expect(
          200,
        )
      ).body.items,
    ).toEqual([]);
    expect(
      (await list({ search: payload.aliases[0] }, '/mine', owner).expect(200))
        .body.items[0].id,
    ).toBe(id);
    await h.get('/exercises/' + id).expect(404);
    await h.get('/exercises/' + id, other).expect(404);
    await h.get('/exercises/' + id, owner).expect(200);
    await h
      .send('patch', '/exercises/' + id, { name: 'Ajeno' }, other)
      .expect(404);
    await h.send('delete', '/exercises/' + id, {}, other).expect(404);
    const changed = await h
      .send(
        'patch',
        '/exercises/' + id,
        { description: '', aliases: ['Alias actualizado ' + randomUUID()] },
        owner,
      )
      .expect(200);
    expect(changed.body.description).toBe('');
    expect(changed.body.ownerId).toBeUndefined();
    await h
      .send('delete', '/exercises/' + id, {}, owner)
      .expect(200)
      .expect({ deactivated: true });
    expect(
      (await h.prisma.exercise.findUniqueOrThrow({ where: { id } })).isActive,
    ).toBe(false);
    await h.get('/exercises/' + id, owner).expect(404);
  });

  it('rejects invalid filters/UUIDs/enums/aliases/ownership fields and unavailable exercises', async () => {
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { equipmentType: 'UNKNOWN' },
      { search: 'x'.repeat(101) },
      { ownerId: owner.id },
    ])
      await list(query).expect(400);
    await h.get('/exercises/not-a-uuid').expect(400);
    await h.get('/exercises/' + randomUUID()).expect(404);
    await h.get('/exercises/' + ids.inactive).expect(404);
    await h.get('/exercises/mine').expect(401);
    await h.http().post('/api/v1/exercises').send(input()).expect(401);
    for (const extra of [
      { ownerId: other.id },
      { equipmentType: 'UNKNOWN' },
      { primaryMuscleGroupKey: 'missing-group' },
      { secondaryMuscleGroupKeys: [primary.key] },
      { aliases: ['Bíceps', 'biceps'] },
    ])
      await h
        .send('post', '/exercises', { ...input(), ...extra }, owner)
        .expect(400);
    await h
      .send(
        'patch',
        '/exercises/' + ids.press,
        { name: 'Global cambiado' },
        owner,
      )
      .expect(404);
    await h.send('delete', '/exercises/' + ids.press, {}, owner).expect(404);
  });

  it('blocks editing referenced exercises and soft-retirement preserves historical IDs and prescriptions', async () => {
    const created = await h
      .send('post', '/exercises', input(), owner)
      .expect(201);
    const id = created.body.id as string;
    const plan = await h
      .send(
        'post',
        '/training-plans',
        { name: 'Referencia MVC6', startsOn: '2026-01-01' },
        owner,
      )
      .expect(201);
    const week = await h
      .send(
        'post',
        `/training-plans/${plan.body.id}/weeks`,
        { weekNumber: 1 },
        owner,
      )
      .expect(201);
    const prescription = await h
      .send(
        'post',
        `/training-plans/${plan.body.id}/weeks/${week.body.id}/exercises`,
        { exerciseId: id, position: 1, targetSets: 3, targetReps: 8 },
        owner,
      )
      .expect(201);
    await h
      .send('patch', '/exercises/' + id, { name: 'Cambio prohibido' }, owner)
      .expect(409);
    await h.send('delete', '/exercises/' + id, {}, owner).expect(200);
    expect(
      (
        await h.prisma.planExercise.findUniqueOrThrow({
          where: { id: prescription.body.id },
        })
      ).exerciseId,
    ).toBe(id);
    expect(
      (await h.prisma.exercise.findUniqueOrThrow({ where: { id } })).name,
    ).toBe(created.body.name);
  });

  it('validates actual PostgreSQL responses with the unchanged Vue Axios/Zod exercise service', async () => {
    const output = await vueHttp(
      h.app,
      `
      import assert from 'node:assert/strict';
      import {api} from './src/services/api.ts';
      import {exercisesService} from './src/services/exercises.service.ts';
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL,key,id}=JSON.parse(raw);api.defaults.baseURL=baseURL;
      const page=await exercisesService.list({primaryMuscleGroupKey:key});
      assert.equal(page.total,2);assert.equal(page.items.length,2);
      const detail=await exercisesService.getById(id);assert.equal(detail.id,id);assert.equal(detail.isOwner,false);
      assert.equal((await exercisesService.listMuscleGroups()).some(g=>g.key===key),true);
      console.log('Exercises Vue PostgreSQL passed');
    `,
      { key: primary.key, id: ids.press },
    );
    expect(output).toContain('Exercises Vue PostgreSQL passed');
  });
});
