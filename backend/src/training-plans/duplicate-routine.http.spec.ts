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
import { TRAINING_PLANS_REPOSITORY } from './training-plans.repository';
import { PrismaFlexiblePlanningRepository } from './prisma-flexible-planning.repository';
import { TrainingPlansModule } from './training-plans.module';
import { PlanningError } from './daily-planning.policy';

const sourceId = '10000000-0000-4000-8000-000000000001';
const targetId = '20000000-0000-4000-8000-000000000001';
const command = {
  id: targetId,
  expectedVersion: 4,
  name: 'Copia independiente',
};
async function post(
  app: INestApplication,
  path: string,
  body: object,
  token?: string,
) {
  const chunks: Buffer[] = [];
  const bytes = Buffer.from(JSON.stringify(body));
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, next) {
      chunks.push(Buffer.from(chunk));
      next();
    },
  });
  const req = new IncomingMessage(stream as Socket);
  req.method = 'POST';
  req.url = '/api/v1' + path;
  req.headers = {
    host: 'localhost',
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const res = new ServerResponse(req);
  res.assignSocket(stream as Socket);
  await new Promise<void>((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
    app.getHttpAdapter().getInstance().handle(req, res);
    req.complete = true;
    req.push(bytes);
    req.push(null);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  stream.destroy();
  return {
    status: res.statusCode,
    body: JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4)) as unknown,
  };
}
describe('Whole routine duplicate registered HTTP path without sockets', () => {
  let app: INestApplication;
  const received: unknown[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TrainingPlansModule],
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
          return { account: { id: token }, sessionId: 'authenticated-session' };
        },
      })
      .overrideProvider(TRAINING_PLANS_REPOSITORY)
      .useValue({
        findAthleteId(account: string) {
          return account + '-athlete';
        },
      })
      .overrideProvider(PrismaFlexiblePlanningRepository)
      .useValue({
        duplicate(athlete: string, source: string, input: typeof command) {
          if (athlete !== 'owner-athlete' || source !== sourceId)
            throw new PlanningError('missing', 'Source plan not found.');
          if (input.expectedVersion !== 4)
            throw new PlanningError('conflict', 'The source plan changed.');
          received.push({ athlete, source, input });
          return { id: input.id, internal: 'must be removed by presenter' };
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
  afterAll(async () => {
    await app?.close();
  });
  it('executes the registered controller, authenticated service and existing JSON presenter', async () => {
    expect(
      await post(
        app,
        `/routine/plans/${sourceId}/duplicate`,
        { ...command, name: '  Copia independiente  ' },
        'owner',
      ),
    ).toEqual({ status: 201, body: { id: targetId } });
    expect(received).toContainEqual({
      athlete: 'owner-athlete',
      source: sourceId,
      input: command,
    });
  });
  it('retains authentication, ownership and stale-source errors', async () => {
    expect(
      (await post(app, `/routine/plans/${sourceId}/duplicate`, command)).status,
    ).toBe(401);
    expect(
      (
        await post(
          app,
          `/routine/plans/${sourceId}/duplicate`,
          command,
          'other',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          app,
          `/routine/plans/${sourceId}/duplicate`,
          { ...command, expectedVersion: 3 },
          'owner',
        )
      ).status,
    ).toBe(409);
  });
  it('validates UUIDs, explicit names, source versions and rejects copied scheduling fields', async () => {
    for (const body of [
      { ...command, id: 'invalid' },
      { ...command, name: '  ' },
      { ...command, expectedVersion: -1 },
      { ...command, startsOn: '2026-11-12' },
      { ...command, athleteId: 'foreign' },
    ])
      expect(
        (await post(app, `/routine/plans/${sourceId}/duplicate`, body, 'owner'))
          .status,
      ).toBe(400);
    expect(
      (await post(app, '/routine/plans/invalid/duplicate', command, 'owner'))
        .status,
    ).toBe(400);
  });
});
