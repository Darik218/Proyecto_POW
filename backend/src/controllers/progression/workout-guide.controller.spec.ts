import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { WorkoutGuideController } from './workout-guide.controller';
import { WorkoutGuidePresenter } from '../../views/progression/workout-guide.presenter';
import { WorkoutGuideService } from '../../progression/workout-guide.service';
import {
  WORKOUT_GUIDE_REPOSITORY,
  type WorkoutGuideRepository,
} from '../../progression/workout-guide.repository';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthService } from '../../auth/services/auth.service';
import { AuthConfig } from '../../auth/auth.config';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import type { WorkoutGuideSnapshot } from '../../models/progression/workout-guide.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
const owned = '00000000-0000-4000-8000-000000000001',
  foreign = '00000000-0000-4000-8000-000000000002';
const snapshot: WorkoutGuideSnapshot = {
  source: {
    kind: 'ACTIVITY',
    id: owned,
    activityId: owned,
    sessionId: null,
    trainingPlanId: 'plan',
    planWeekId: 'week',
    planDayId: 'day',
    performedOn: '2026-01-05',
    timeZone: 'America/Bogota',
    status: 'RESCHEDULED',
    title: 'Pierna',
  },
  status: 'TRAINABLE',
  historyCutoffOn: '2026-01-05',
  now: new Date('2026-01-05'),
  exercises: [
    {
      id: 'prescription',
      exerciseId: 'exercise',
      prescriptionId: 'prescription',
      name: 'Sentadilla',
      position: 1,
      isOmitted: false,
      target: {
        targetSets: 3,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetLoad: '80.000',
        targetLoadUnit: 'KG',
        targetRpe: '8.0',
      },
      originalTarget: null,
      history: [],
      historyTruncated: false,
      candidates: [],
    },
  ],
};
const repository: WorkoutGuideRepository = {
  read: async (userId, _sessionId, query) => {
    if (userId !== owned || query.activityId !== owned)
      throw new RecommendationError('SOURCE_NOT_FOUND');
    return structuredClone(snapshot);
  },
};
describe('daily guide HTTP contract', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkoutGuideController],
      providers: [
        WorkoutGuideService,
        WorkoutGuidePresenter,
        AccessTokenGuard,
        AuthOriginGuard,
        {
          provide: AuthConfig,
          useValue: { allowedOrigins: ['http://localhost:5173'] },
        },
        ProgressionHttpFilter,
        ProgressionPrivateResponse,
        { provide: WORKOUT_GUIDE_REPOSITORY, useValue: repository },
        {
          provide: AuthService,
          useValue: {
            authenticate: async (token: string) => {
              if (token !== 'owned') throw new UnauthorizedException();
              return { account: { id: owned }, sessionId: owned };
            },
          },
        },
      ],
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
  });
  afterAll(async () => {
    await app?.close();
  });
  it('returns exact prescription and actual schedule without granting execution', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/progression/workout-guide')
      .query({ activityId: owned, performedOn: '2026-02-01', timeZone: 'UTC' })
      .set('Authorization', 'Bearer owned')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      executionAuthorized: false,
      source: {
        performedOn: '2026-01-05',
        timeZone: 'America/Bogota',
        trainingPlanId: 'plan',
        planWeekId: 'week',
      },
      exercises: [
        {
          target: {
            targetLoad: '80.000',
            targetLoadUnit: 'KG',
            targetRpe: '8.0',
          },
          guidance: { state: 'FIRST_BASELINE' },
          proposal: null,
        },
      ],
    });
    expect(snapshot.exercises[0].history).toEqual([]);
  });
  it('protects authentication and owned sources', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/progression/workout-guide')
      .query({ activityId: owned })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/progression/workout-guide')
      .query({ activityId: foreign })
      .set('Authorization', 'Bearer owned')
      .expect(404);
  });
  it('accepts the voluntary read-only preview body and rejects undeclared or invalid analysis inputs', async () => {
    const body = {
      source: { activityId: owned },
      exerciseId: owned,
      contextKey: 'a'.repeat(64),
      gridStep: '2.5',
      incrementMode: 'ABSOLUTE',
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        externalTotal: true,
      },
      policyContract: 'session-readiness-preview-v1',
    };
    await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/preview')
      .set('Authorization', 'Bearer owned')
      .send(body)
      .expect(403);
    const response = await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/preview')
      .set('Authorization', 'Bearer owned')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.executionAuthorized).toBe(false);
    await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/preview')
      .set('Authorization', 'Bearer owned')
      .set('Origin', 'http://localhost:5173')
      .send({ ...body, policyContract: 'session-load-compliance-preview-v1' })
      .expect(200);
    for (const invalid of [
      { ...body, declaration: { ...body.declaration, externalTotal: false } },
      { ...body, automatic: true },
      { ...body, policyContract: 'unapproved' },
      { ...body, gridStep: '0' },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/progression/workout-guide/preview')
        .set('Authorization', 'Bearer owned')
        .set('Origin', 'http://localhost:5173')
        .send(invalid)
        .expect((r) => expect([400, 422]).toContain(r.status));
    await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/preview')
      .send(body)
      .expect(401);
  });
  it('strictly validates the separate no-effort repetition route and protects origin and identity', async () => {
    const body = {
      source: { activityId: owned },
      exerciseId: owned,
      contextKey: 'a'.repeat(64),
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
      policyContract: 'session-repetition-preview-v1',
    };
    const send = (payload: unknown) =>
      request(app.getHttpServer())
        .post('/api/v1/progression/workout-guide/repetition-preview')
        .set('Authorization', 'Bearer owned')
        .set('Origin', 'http://localhost:5173')
        .send(payload as object);
    await send({
      ...body,
      policyContract: 'session-repetition-preview-v2',
    }).expect(200);
    const response = await send(body).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.executionAuthorized).toBe(false);
    for (const invalid of [
      { ...body, gridStep: '2.5' },
      { ...body, declaration: { sameVariant: true, sameEquipment: true } },
      {
        ...body,
        declaration: { ...body.declaration, sameLoadConvention: false },
      },
      { ...body, automatic: true },
      { ...body, declaration: { sameVariant: true, sameEquipment: false } },
      { ...body, declaration: { ...body.declaration, externalTotal: true } },
      { ...body, policyContract: 'session-readiness-preview-v1' },
    ])
      await send(invalid).expect((r) => expect([400, 422]).toContain(r.status));
    await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/repetition-preview')
      .set('Authorization', 'Bearer owned')
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/progression/workout-guide/repetition-preview')
      .send(body)
      .expect(401);
  });
  it('rejects ambiguous sources, invalid sporting dates and undeclared policy parameters', async () => {
    for (const query of [
      { activityId: owned, sessionId: foreign },
      { planDayId: owned, performedOn: '2026-02-30', timeZone: 'UTC' },
      { activityId: owned, incrementPercent: '10' },
    ])
      await request(app.getHttpServer())
        .get('/api/v1/progression/workout-guide')
        .query(query)
        .set('Authorization', 'Bearer owned')
        .expect((response) => expect([400, 422]).toContain(response.status));
  });
});
