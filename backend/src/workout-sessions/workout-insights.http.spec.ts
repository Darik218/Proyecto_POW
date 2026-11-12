import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { Test } from '@nestjs/testing';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/services/auth.service';
import { PrismaService } from '../database/prisma.service';
import { ATHLETES_REPOSITORY } from '../athletes/athletes.repository';
import { WORKOUT_SESSIONS_REPOSITORY } from './workout-sessions.repository';
import { WorkoutSessionsModule } from './workout-sessions.module';
import { WorkoutSession } from '../models/workout-sessions/workout-session.model';
import { insightFixture } from '../../test/fixtures/workout-insights.fixture';

// Execute the real Express/Nest HTTP handler with HTTP request/response objects.
// The duplex only collects bytes: no TCP listener, database or network socket.
async function get(app: INestApplication, path: string, token?: string) {
  const chunks: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, next) {
      chunks.push(Buffer.from(chunk));
      next();
    },
  });
  const req = new IncomingMessage(stream as Socket);
  req.method = 'GET';
  req.url = '/api/v1' + path;
  req.headers = {
    host: 'localhost',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const res = new ServerResponse(req);
  res.assignSocket(stream as Socket);
  await new Promise<void>((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
    app.getHttpAdapter().getInstance().handle(req, res);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  const body = JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4)) as Record<
    string,
    unknown
  >;
  stream.destroy();
  return { status: res.statusCode, body };
}

describe('Workout insights registered HTTP path without sockets', () => {
  let app: INestApplication;
  let session = insightFixture();
  const accountId = '50000000-0000-4000-8000-000000000001';
  const athleteId = '60000000-0000-4000-8000-000000000001';
  const sessionId = session.attributes.id;
  const exerciseId = session.attributes.exercises[0].exercise.id;
  const workoutExerciseId = session.attributes.exercises[0].id;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [WorkoutSessionsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthConfig)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({
        authenticate(token: string) {
          if (!['owner', 'other'].includes(token))
            throw new UnauthorizedException();
          return {
            account: { id: token === 'owner' ? accountId : 'other-account' },
            sessionId: accountId,
          };
        },
      })
      .overrideProvider(ATHLETES_REPOSITORY)
      .useValue({
        findProfileByUserId(id: string) {
          return { id: id === accountId ? athleteId : 'other-athlete' };
        },
      })
      .overrideProvider(WORKOUT_SESSIONS_REPOSITORY)
      .useValue({
        get(owner: string, id: string) {
          return owner === athleteId && id === sessionId ? session : null;
        },
        lastExerciseReference() {
          return null;
        },
      })
      .compile();
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
  });
  beforeEach(() => {
    session = insightFixture();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('requires the existing access guard and hides foreign sessions', async () => {
    expect(
      (await get(app, `/workout-sessions/${sessionId}/insights`)).status,
    ).toBe(401);
    expect(
      (await get(app, `/workout-sessions/${sessionId}/insights`, 'invalid'))
        .status,
    ).toBe(401);
    expect(
      (await get(app, `/workout-sessions/${sessionId}/insights`, 'other'))
        .status,
    ).toBe(404);
  });
  it('runs the real presenter, literal estimates and read-only declaration through HTTP', async () => {
    const result = await get(
      app,
      `/workout-sessions/${sessionId}/insights?externalTotalExerciseId=${workoutExerciseId}`,
      'owner',
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      sessionId,
      exercises: [
        {
          actualSets: [{ load: '60', loadUnit: 'KG', repetitions: 8, rpe: 8 }],
          loadMeaning: 'EXTERNAL_TOTAL',
          oneRm: [
            {
              calculation: {
                estimates: [
                  { estimatedOneRm: '76.000000' },
                  { estimatedOneRm: '74.482759' },
                ],
              },
            },
          ],
        },
      ],
    });
    const undeclared = await get(
      app,
      `/workout-sessions/${sessionId}/insights`,
      'owner',
    );
    expect(undeclared.body).toMatchObject({
      exercises: [{ loadMeaning: 'UNKNOWN', oneRm: [{ calculation: null }] }],
    });
  });
  it('validates UUIDs, declaration scope, unknown fields and completed status', async () => {
    expect(
      (await get(app, '/workout-sessions/invalid/insights', 'owner')).status,
    ).toBe(400);
    expect(
      (
        await get(
          app,
          `/workout-sessions/${sessionId}/insights?externalTotalExerciseId=invalid`,
          'owner',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await get(
          app,
          `/workout-sessions/${sessionId}/insights?externalTotalExerciseId=${exerciseId}`,
          'owner',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await get(
          app,
          `/workout-sessions/${sessionId}/insights?athleteId=${athleteId}`,
          'owner',
        )
      ).status,
    ).toBe(400);
    session = new WorkoutSession({
      ...session.attributes,
      status: 'IN_PROGRESS',
    });
    expect(
      (await get(app, `/workout-sessions/${sessionId}/insights`, 'owner'))
        .status,
    ).toBe(409);
  });
  it('registers the static reference route before the generic session route and validates dates', async () => {
    expect(
      await get(
        app,
        `/workout-sessions/exercise-reference?exerciseId=${exerciseId}`,
        'owner',
      ),
    ).toEqual({ status: 200, body: { exerciseId, reference: null } });
    expect(
      (
        await get(
          app,
          `/workout-sessions/exercise-reference?exerciseId=${exerciseId}&before=2026-02-30`,
          'owner',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await get(
          app,
          '/workout-sessions/exercise-reference?exerciseId=invalid',
          'owner',
        )
      ).status,
    ).toBe(400);
  });
});
