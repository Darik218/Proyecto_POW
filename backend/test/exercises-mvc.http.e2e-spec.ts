import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExercisesController } from '../src/controllers/exercises/exercises.controller';
import { ExercisesPresenter } from '../src/views/exercises/exercises.presenter';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../src/exercises/optional-access-token.guard';
import { Exercise } from '../src/models/exercises/exercise.model';
import type { ExerciseAttributes } from '../src/models/exercises/exercise.model';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ExercisesModule } from '../src/exercises/exercises.module';
import { EXERCISES_REPOSITORY } from '../src/exercises/exercises.repository';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/auth/services/auth.service';
import { ExercisesService } from '../src/exercises/exercises.service';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';

const id = '20000000-0000-4000-8000-000000000001';
const personalId = '20000000-0000-4000-8000-000000000002';
const ownerId = '30000000-0000-4000-8000-000000000001';
const attrs: ExerciseAttributes = {
  id,
  name: 'Press de banca',
  aliases: ['Bench press'],
  description: null,
  equipment: 'Barra',
  equipmentType: 'BARBELL',
  machineType: null,
  resistanceType: 'FREE_WEIGHT',
  movementType: 'COMPOUND',
  movementPattern: 'HORIZONTAL_PUSH',
  grip: 'PRONATED',
  gripWidth: 'SHOULDER_WIDTH',
  bodyPosition: 'SUPINE',
  laterality: 'BILATERAL',
  movementPlane: 'TRANSVERSE',
  difficulty: 'BEGINNER',
  oneRmSuitability: 'SUITABLE',
  instructions: null,
  origin: 'GLOBAL',
  ownerId: null,
  isActive: true,
  primaryMuscleGroup: { key: 'pectorales', name: 'Pectorales' },
  secondaryMuscleGroups: [{ key: 'triceps', name: 'Tríceps' }],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
const identity = (userId = ownerId): AuthenticatedIdentity => ({
  account: {
    id: userId,
    email: 'mvc@example.test',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  sessionId: '40000000-0000-4000-8000-000000000001',
});
const expected = (personal = false) => ({
  ...attrs,
  id: personal ? personalId : id,
  origin: personal ? 'PERSONAL' : 'GLOBAL',
  ownerId: undefined,
  isActive: undefined,
  isOwner: personal,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
// Real HTTP, Nest module registration, validation, access guards and service; only auth lookup and persistence are replaced.
describe('Exercises HTTP contract without PostgreSQL', () => {
  let app: INestApplication;
  const authenticate =
    jest.fn<(token: string) => Promise<AuthenticatedIdentity>>();
  const repository = {
    listGlobal: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    listMine: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    listVisible: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findVisibleById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    listMuscleGroups: jest.fn<() => Promise<unknown>>(),
    createPersonal: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    updatePersonal: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    deactivatePersonal: jest.fn<(...args: unknown[]) => Promise<boolean>>(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ExercisesModule],
    })
      .overrideProvider(EXERCISES_REPOSITORY)
      .useValue(repository)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({ authenticate })
      .compile();
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
    expect(app.get(ExercisesService)).toBeInstanceOf(ExercisesService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    authenticate.mockImplementation(async (token) => {
      if (token === 'owner') return identity();
      if (token === 'other')
        return identity('30000000-0000-4000-8000-000000000002');
      throw new UnauthorizedException('Authentication required.');
    });
    repository.listGlobal.mockResolvedValue({
      items: [new Exercise(attrs)],
      total: 41,
    });
    repository.listVisible.mockResolvedValue({
      items: [new Exercise(attrs)],
      total: 1,
    });
    repository.listMine.mockResolvedValue({
      items: [
        new Exercise({ ...attrs, id: personalId, origin: 'PERSONAL', ownerId }),
      ],
      total: 1,
    });
    repository.findVisibleById.mockImplementation(async (id, user) =>
      id === attrs.id
        ? new Exercise(attrs)
        : id === personalId && user === ownerId
          ? new Exercise({
              ...attrs,
              id: personalId,
              origin: 'PERSONAL',
              ownerId,
            })
          : null,
    );
    repository.listMuscleGroups.mockResolvedValue([
      { key: 'pectorales', name: 'Pectorales', description: null },
    ]);
    repository.createPersonal.mockResolvedValue({
      kind: 'created',
      exercise: new Exercise({
        ...attrs,
        id: personalId,
        origin: 'PERSONAL',
        ownerId,
      }),
    });
    repository.updatePersonal.mockResolvedValue({
      kind: 'updated',
      exercise: new Exercise({
        ...attrs,
        id: personalId,
        origin: 'PERSONAL',
        ownerId,
      }),
    });
    repository.deactivatePersonal.mockResolvedValue(true);
  });
  it('registers exactly one MVC controller and uses the public presenter with domain models', async () => {
    const registered = [...app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .filter((wrapper) => wrapper.metatype === ExercisesController);
    expect(registered).toHaveLength(1);
    const presenter = app.get(ExercisesPresenter),
      view = jest.spyOn(presenter, 'exercise');
    await request(app.getHttpServer())
      .get('/api/v1/exercises/' + id)
      .expect(200);
    expect(view).toHaveBeenCalledWith(expect.any(Exercise), undefined);
    view.mockRestore();
    for (const method of [
      'listMine',
      'listVisible',
      'create',
      'update',
      'deactivate',
    ] as const)
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          ExercisesController.prototype[method],
        ),
      ).toEqual([AccessTokenGuard]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        Object.getOwnPropertyDescriptor(
          ExercisesController.prototype,
          'getById',
        )?.value,
      ),
    ).toEqual([OptionalAccessTokenGuard]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        Object.getOwnPropertyDescriptor(
          ExercisesController.prototype,
          'listGlobal',
        )?.value,
      ),
    ).toBeUndefined();
  });
  it('preserves exact list, detail and muscle-group JSON contracts', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/exercises?limit=10&offset=20')
      .expect(200);
    expect(list.body).toEqual({
      items: [JSON.parse(JSON.stringify(expected()))],
      total: 41,
      limit: 10,
      offset: 20,
    });
    expect(repository.listGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/exercises/' + id)
          .expect(200)
      ).body,
    ).toEqual(JSON.parse(JSON.stringify(expected())));
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/exercises/muscle-groups')
          .expect(200)
      ).body,
    ).toEqual([{ key: 'pectorales', name: 'Pectorales', description: null }]);
  });
  it.each(['bench press', 'biceps', 'bíceps', 'sentadila', 'RDL'])(
    'forwards search %s, filters and pagination without changing their meaning',
    async (search) => {
      await request(app.getHttpServer())
        .get('/api/v1/exercises')
        .query({
          search,
          limit: 5,
          offset: 10,
          primaryMuscleGroupKey: 'pectorales',
          equipmentType: 'BARBELL',
          selection: 'FEATURED',
        })
        .expect(200);
      expect(repository.listGlobal).toHaveBeenCalledWith(
        expect.objectContaining({
          search,
          limit: 5,
          offset: 10,
          primaryMuscleGroupKey: 'pectorales',
          equipmentType: 'BARBELL',
          selection: 'FEATURED',
        }),
      );
    },
  );
  it('preserves empty pages and request validation', async () => {
    repository.listGlobal.mockResolvedValueOnce({ items: [], total: 0 });
    expect(
      (await request(app.getHttpServer()).get('/api/v1/exercises').expect(200))
        .body,
    ).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { equipmentType: 'INVALID' },
      { selection: 'INVALID' },
      { userId: ownerId },
      { search: 'x'.repeat(101) },
    ])
      await request(app.getHttpServer())
        .get('/api/v1/exercises')
        .query(query)
        .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/not-a-uuid')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/20000000-0000-4000-8000-000000000009')
      .expect(404);
  });
  it('keeps native guards and private visibility with owner-derived context', async () => {
    for (const path of ['mine', 'visible'])
      await request(app.getHttpServer())
        .get('/api/v1/exercises/' + path)
        .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/' + personalId)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/' + personalId)
      .set('Authorization', 'Bearer other')
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/exercises/' + personalId)
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual(JSON.parse(JSON.stringify(expected(true))));
    await request(app.getHttpServer())
      .get('/api/v1/exercises/' + id)
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/exercises/mine')
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(repository.listMine).toHaveBeenCalledWith(
      ownerId,
      expect.anything(),
    );
    await request(app.getHttpServer())
      .get('/api/v1/exercises/visible?selection=RECENT')
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(repository.listVisible).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ selection: 'RECENT' }),
    );
  });
  it('preserves writes, alias validation, ownership, protected history and deactivation', async () => {
    const input = {
      name: 'Press personal',
      equipment: 'Barra',
      equipmentType: 'BARBELL',
      primaryMuscleGroupKey: 'pectorales',
      aliases: ['Bench personal'],
    };
    await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .send(input)
      .expect(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/v1/exercises')
          .set('Authorization', 'Bearer owner')
          .send(input)
          .expect(201)
      ).body,
    ).toEqual(JSON.parse(JSON.stringify(expected(true))));
    expect(repository.createPersonal).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining(input),
    );
    await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', 'Bearer owner')
      .send({ ...input, ownerId })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/exercises')
      .set('Authorization', 'Bearer owner')
      .send({ ...input, aliases: ['Bíceps', 'biceps'] })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/exercises/' + personalId)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Cambio' })
      .expect(200);
    expect(repository.updatePersonal).toHaveBeenCalledWith(
      ownerId,
      personalId,
      expect.objectContaining({ name: 'Cambio' }),
    );
    repository.updatePersonal.mockResolvedValueOnce({
      kind: 'historical-reference',
    });
    await request(app.getHttpServer())
      .patch('/api/v1/exercises/' + personalId)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Cambio' })
      .expect(409);
    repository.updatePersonal.mockResolvedValueOnce({ kind: 'not-found' });
    await request(app.getHttpServer())
      .patch('/api/v1/exercises/' + id)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Cambio' })
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .delete('/api/v1/exercises/' + personalId)
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual({ deactivated: true });
    expect(repository.deactivatePersonal).toHaveBeenCalledWith(
      ownerId,
      personalId,
    );
  });
  it('serves the actual Vue Axios/Zod exercise client over HTTP without PostgreSQL', async () => {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const code = `
      import assert from 'node:assert/strict';
      import {api,installAuthInterceptors} from './src/services/api.ts';
      import {exercisesService} from './src/services/exercises.service.ts';
      let raw='';for await(const chunk of process.stdin)raw+=chunk;
      const input=JSON.parse(raw);api.defaults.baseURL=input.baseURL;
      installAuthInterceptors({getAccessToken:()=> 'owner',refreshSession:async()=>{throw new Error('Unexpected refresh')},clearSession:()=>{}});
      const page=await exercisesService.list({search:'bench press',limit:5,offset:0},'visible');assert.equal(page.items[0].id,input.id);assert.deepEqual(page.items[0].aliases,['Bench press']);assert.equal('ownerId' in page.items[0],false);
      assert.equal((await exercisesService.getById(input.personalId)).isOwner,true);
      assert.equal((await exercisesService.listMuscleGroups())[0].key,'pectorales');
      const created=await exercisesService.create({name:'Propio',equipment:'Barra',equipmentType:'BARBELL',primaryMuscleGroupKey:'pectorales',secondaryMuscleGroupKeys:[],aliases:['Bench personal']});assert.equal(created.origin,'PERSONAL');assert.equal(created.isOwner,true);
      assert.equal((await exercisesService.update(input.personalId,{name:'Cambio'})).id,input.personalId);
      assert.deepEqual(await exercisesService.deactivate(input.personalId),{deactivated:true});
      console.log('MVC frontend HTTP contract passed');
    `;
    const output = await new Promise<string>((accept, reject) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          '--input-type=module',
          '-e',
          code,
        ],
        { cwd: resolve(process.cwd(), '../frontend'), timeout: 10000 },
        (error, stdout) => {
          if (error)
            reject(new Error('Vue HTTP contract verification failed.'));
          else accept(stdout);
        },
      );
      child.stdin?.end(
        JSON.stringify({
          baseURL: `http://127.0.0.1:${address.port}/api/v1`,
          id,
          personalId,
        }),
      );
    });
    expect(output).toContain('MVC frontend HTTP contract passed');
  });
});
