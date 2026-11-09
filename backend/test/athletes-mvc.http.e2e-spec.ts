import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Decimal } from '@prisma/client/runtime/client';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AthletesModule } from '../src/athletes/athletes.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/auth/services/auth.service';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import { AthletesController } from '../src/controllers/athletes/athletes.controller';
import { AthletesPresenter } from '../src/views/athletes/athletes.presenter';
import { Athlete } from '../src/models/athletes/athlete.model';
import { BodyMeasurement } from '../src/models/athletes/body-measurement.model';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';
import {
  athleteUserId,
  otherAthleteUserId,
  athleteId,
  otherAthleteId,
  profileAttributes,
  measurementAttributes,
} from './fixtures/athlete.fixture';

const expectedProfile = {
  id: athleteId,
  birthDate: null,
  preferredUnit: 'KG',
  createdAt: '2026-01-01T00:00:00.123Z',
  updatedAt: '2026-01-02T00:00:00.456Z',
};
const expectedMeasurement = {
  id: measurementAttributes.id,
  bodyWeight: 72.125,
  measuredAt: '2026-02-01T04:30:00.789Z',
  notes: null,
};
type ProfileRow = Omit<typeof profileAttributes, 'preferredUnit'> & {
  preferredUnit: 'KG' | 'LB';
};
type MeasurementRow = typeof measurementAttributes & { athleteId: string };

// Real module, controller, service, Prisma repository, guard and validation.
// Only the PostgreSQL boundary and authentication lookup are replaced; all writes are in memory.
describe('Athletes MVC HTTP contracts without PostgreSQL', () => {
  let app: INestApplication;
  let profiles: Map<string, ProfileRow>;
  let measurements: MeasurementRow[];
  const authenticate =
    jest.fn<(token: string) => Promise<AuthenticatedIdentity>>();
  const prisma = {
    athlete: {
      findUnique: jest.fn<(...args: any[]) => Promise<ProfileRow | null>>(),
      update: jest.fn<(...args: any[]) => Promise<ProfileRow>>(),
    },
    bodyMeasurement: {
      findMany:
        jest.fn<
          (...args: any[]) => Promise<(typeof measurementAttributes)[]>
        >(),
      create:
        jest.fn<(...args: any[]) => Promise<typeof measurementAttributes>>(),
    },
  };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AthletesModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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
        validationError: { target: false, value: false },
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    profiles = new Map([
      [athleteUserId, { ...profileAttributes }],
      [
        otherAthleteUserId,
        { ...profileAttributes, id: otherAthleteId, preferredUnit: 'LB' },
      ],
    ]);
    measurements = [{ ...measurementAttributes, athleteId }];
    authenticate.mockImplementation(async (token) => {
      const userId =
        token === 'owner'
          ? athleteUserId
          : token === 'other'
            ? otherAthleteUserId
            : null;
      if (!userId) throw new UnauthorizedException('Authentication required.');
      return {
        account: {
          id: userId,
          email: 'mvc2@example.test',
          status: 'ACTIVE',
          createdAt: profileAttributes.createdAt,
          updatedAt: profileAttributes.updatedAt,
        },
        sessionId: '51000000-0000-4000-8000-000000000001',
      };
    });
    prisma.athlete.findUnique.mockImplementation(
      async ({ where }) => profiles.get(where.userId) ?? null,
    );
    prisma.athlete.update.mockImplementation(async ({ where, data }) => {
      const profile = profiles.get(where.userId);
      if (!profile) throw { code: 'P2025' };
      const updated = { ...profile, ...data } as ProfileRow;
      profiles.set(where.userId, updated);
      return updated;
    });
    prisma.bodyMeasurement.findMany.mockImplementation(async ({ where }) =>
      measurements
        .filter((measurement) => measurement.athleteId === where.athleteId)
        .sort(
          (a, b) =>
            b.measuredAt.getTime() - a.measuredAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .map(({ athleteId: _owner, ...row }) => row),
    );
    prisma.bodyMeasurement.create.mockImplementation(async ({ data }) => {
      const row = {
        ...measurementAttributes,
        ...data,
        id: '41000000-0000-4000-8000-000000000002',
        bodyWeight: new Decimal(data.bodyWeight),
        notes: data.notes ?? null,
      };
      measurements.push(row);
      const { athleteId: _owner, ...selected } = row;
      return selected;
    });
  });
  it('preserves exact profile and measurement JSON, numeric weight and ISO timestamps', async () => {
    expect(
      (
        await http()
          .get('/api/v1/athletes/me')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual(expectedProfile);
    expect(
      (
        await http()
          .get('/api/v1/athletes/me/measurements')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual([expectedMeasurement]);
  });
  it('registers one controller with the native guard and presents actual repository domain models', async () => {
    const controllers = [...app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .filter((wrapper) => wrapper.metatype === AthletesController);
    expect(controllers).toHaveLength(1);
    expect(Reflect.getMetadata(GUARDS_METADATA, AthletesController)).toEqual([
      AccessTokenGuard,
    ]);
    const presenter = app.get(AthletesPresenter);
    const profile = jest.spyOn(presenter, 'profile');
    const measurement = jest.spyOn(presenter, 'measurement');
    try {
      await http()
        .get('/api/v1/athletes/me')
        .set('Authorization', 'Bearer owner')
        .expect(200);
      await http()
        .patch('/api/v1/athletes/me')
        .set('Authorization', 'Bearer owner')
        .send({ preferredUnit: 'LB' })
        .expect(200);
      await http()
        .get('/api/v1/athletes/me/measurements')
        .set('Authorization', 'Bearer owner')
        .expect(200);
      await http()
        .post('/api/v1/athletes/me/measurements')
        .set('Authorization', 'Bearer owner')
        .send({ bodyWeight: 80.125, measuredAt: '2026-03-01' })
        .expect(201);
      expect(profile).toHaveBeenCalledTimes(2);
      expect(
        profile.mock.calls.every(([model]) => model instanceof Athlete),
      ).toBe(true);
      expect(measurement).toHaveBeenCalledTimes(2);
      expect(
        measurement.mock.calls.every(
          ([model]) =>
            model instanceof BodyMeasurement &&
            model.attributes.bodyWeight instanceof Decimal,
        ),
      ).toBe(true);
    } finally {
      profile.mockRestore();
      measurement.mockRestore();
    }
  });
  it('updates only supplied fields, supports null birth dates and does not convert measurements when units change', async () => {
    const result = await http()
      .patch('/api/v1/athletes/me')
      .set('Authorization', 'Bearer owner')
      .send({ birthDate: '1995-06-15', preferredUnit: 'LB' })
      .expect(200);
    expect(result.body).toEqual({
      ...expectedProfile,
      birthDate: '1995-06-15T00:00:00.000Z',
      preferredUnit: 'LB',
    });
    const cleared = await http()
      .patch('/api/v1/athletes/me')
      .set('Authorization', 'Bearer owner')
      .send({ birthDate: null })
      .expect(200);
    expect(cleared.body).toEqual({ ...expectedProfile, preferredUnit: 'LB' });
    expect(
      (
        await http()
          .get('/api/v1/athletes/me/measurements')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual([expectedMeasurement]);
  });
  it('keeps history ordered and appends a measurement with offset date, numeric-string input and optional notes', async () => {
    const created = await http()
      .post('/api/v1/athletes/me/measurements')
      .set('Authorization', 'Bearer owner')
      .send({
        bodyWeight: '70.001',
        measuredAt: '2026-03-01T01:30:00-05:00',
        notes: 'Nueva medición',
      })
      .expect(201);
    expect(created.body).toEqual({
      id: '41000000-0000-4000-8000-000000000002',
      bodyWeight: 70.001,
      measuredAt: '2026-03-01T06:30:00.000Z',
      notes: 'Nueva medición',
    });
    expect(
      (
        await http()
          .get('/api/v1/athletes/me/measurements')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual([created.body, expectedMeasurement]);
    expect(prisma.bodyMeasurement.findMany).toHaveBeenCalledWith({
      where: { athleteId },
      orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, bodyWeight: true, measuredAt: true, notes: true },
    });
  });
  it('rejects unauthenticated or invalid-token access to all four operations before accessing persistence', async () => {
    for (const token of [undefined, 'invalid']) {
      for (const method of ['get', 'patch'] as const) {
        const req = http()[method]('/api/v1/athletes/me');
        if (token) req.set('Authorization', 'Bearer ' + token);
        await req.expect(401);
      }
      for (const method of ['get', 'post'] as const) {
        const req = http()[method]('/api/v1/athletes/me/measurements');
        if (token) req.set('Authorization', 'Bearer ' + token);
        await req.expect(401);
      }
    }
    expect(prisma.athlete.findUnique).not.toHaveBeenCalled();
    expect(prisma.bodyMeasurement.create).not.toHaveBeenCalled();
  });
  it('isolates profiles and measurement reads/writes between two authenticated users', async () => {
    expect(
      (
        await http()
          .get('/api/v1/athletes/me')
          .set('Authorization', 'Bearer other')
          .expect(200)
      ).body,
    ).toEqual({ ...expectedProfile, id: otherAthleteId, preferredUnit: 'LB' });
    expect(
      (
        await http()
          .get('/api/v1/athletes/me/measurements')
          .set('Authorization', 'Bearer other')
          .expect(200)
      ).body,
    ).toEqual([]);
    await http()
      .patch('/api/v1/athletes/me')
      .set('Authorization', 'Bearer other')
      .send({ birthDate: '1990-01-01' })
      .expect(200);
    await http()
      .post('/api/v1/athletes/me/measurements')
      .set('Authorization', 'Bearer other')
      .send({ bodyWeight: 99, measuredAt: '2026-03-01' })
      .expect(201);
    expect(
      (
        await http()
          .get('/api/v1/athletes/me')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual(expectedProfile);
    expect(
      (
        await http()
          .get('/api/v1/athletes/me/measurements')
          .set('Authorization', 'Bearer owner')
          .expect(200)
      ).body,
    ).toEqual([expectedMeasurement]);
    expect(measurements[1]!.athleteId).toBe(otherAthleteId);
    await http()
      .get('/api/v1/athletes/' + otherAthleteId)
      .set('Authorization', 'Bearer owner')
      .expect(404);
  });
  it('preserves 400 validation and forbids owner/internal fields', async () => {
    for (const body of [
      {},
      { preferredUnit: 'STONE' },
      { birthDate: '2026-02-30' },
      { userId: otherAthleteUserId },
      { athleteId: otherAthleteId },
      { id: athleteId },
      { createdAt: '2026-01-01' },
      { updatedAt: '2026-01-01' },
    ]) {
      await http()
        .patch('/api/v1/athletes/me')
        .set('Authorization', 'Bearer owner')
        .send(body)
        .expect(400);
    }
    await http()
      .post('/api/v1/athletes/me/measurements')
      .set('Authorization', 'Bearer owner')
      .send({})
      .expect(400);
    for (const body of [
      { bodyWeight: -1 },
      { bodyWeight: 0 },
      { bodyWeight: 10000 },
      { bodyWeight: 72.1234 },
      { bodyWeight: 'not-a-number' },
      { measuredAt: '2026-02-30' },
      { athleteId: otherAthleteId },
      { userId: otherAthleteUserId },
      { notes: 'x'.repeat(1001) },
    ]) {
      await http()
        .post('/api/v1/athletes/me/measurements')
        .set('Authorization', 'Bearer owner')
        .send({ bodyWeight: 72, measuredAt: '2026-01-01', ...body })
        .expect(400);
    }
    expect(prisma.athlete.update).not.toHaveBeenCalled();
    expect(prisma.bodyMeasurement.create).not.toHaveBeenCalled();
  });
  it('returns controlled 404 for missing profiles without silently recreating them', async () => {
    profiles.delete(athleteUserId);
    await http()
      .get('/api/v1/athletes/me')
      .set('Authorization', 'Bearer owner')
      .expect(404);
    await http()
      .patch('/api/v1/athletes/me')
      .set('Authorization', 'Bearer owner')
      .send({ preferredUnit: 'LB' })
      .expect(404);
    await http()
      .get('/api/v1/athletes/me/measurements')
      .set('Authorization', 'Bearer owner')
      .expect(404);
    await http()
      .post('/api/v1/athletes/me/measurements')
      .set('Authorization', 'Bearer owner')
      .send({ bodyWeight: 72, measuredAt: '2026-01-01' })
      .expect(404);
    expect(prisma.bodyMeasurement.findMany).not.toHaveBeenCalled();
    expect(prisma.bodyMeasurement.create).not.toHaveBeenCalled();
  });
  it('keeps public contracts accepted by the unchanged Vue Axios/Zod service over HTTP', async () => {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const code = `
      import assert from 'node:assert/strict';
      import {api,installAuthInterceptors} from './src/services/api.ts';
      import {athletesService} from './src/services/athletes.service.ts';
      let raw='';for await(const chunk of process.stdin)raw+=chunk;
      const {baseURL,id}=JSON.parse(raw);api.defaults.baseURL=baseURL;
      installAuthInterceptors({getAccessToken:()=> 'owner',refreshSession:async()=>{throw new Error('Unexpected refresh')},clearSession:()=>{}});
      assert.equal((await athletesService.getProfile()).id,id);
      assert.equal((await athletesService.updateProfile({birthDate:'1995-06-15',preferredUnit:'LB'})).preferredUnit,'LB');
      assert.equal((await athletesService.getMeasurements())[0].bodyWeight,72.125);
      const measurement=await athletesService.addMeasurement({bodyWeight:70.001,measuredAt:'2026-03-01'});
      assert.equal(measurement.bodyWeight,70.001);assert.equal(measurement.notes,null);
      assert.equal((await athletesService.getMeasurements()).length,2);
      console.log('Athletes Vue HTTP contract passed');
    `;
    const stdout = await new Promise<string>((accept, reject) => {
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
        (error, output, stderr) => {
          if (error)
            reject(
              new Error('Athletes Vue HTTP verification failed: ' + stderr),
            );
          else accept(output);
        },
      );
      child.stdin?.end(
        JSON.stringify({
          baseURL: `http://127.0.0.1:${address.port}/api/v1`,
          id: athleteId,
        }),
      );
    });
    expect(stdout).toContain('Athletes Vue HTTP contract passed');
  });
});
