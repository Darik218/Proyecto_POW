import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AthletesModule } from '../src/athletes/athletes.module';
import { PrismaService } from '../src/database/prisma.service';

const DATABASE_NAME = 'proyecto_pow_dev';
const ORIGIN = process.env.CORS_ORIGINS?.split(',')[0]?.trim();
const RUN_ID = randomUUID().slice(0, 12);
const PASSWORD = 'athlete-e2e-password-123';

type RegistrationBody = { user: { id: string }; accessToken: string };
type Fixture = { email: string; userId?: string; registrationAttempted: boolean };

describe('Athlete profile and measurements (PostgreSQL E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const fixtures: Fixture[] = [];
  const cleanupErrors: string[] = [];

  beforeAll(async () => {
    const connection = process.env.DATABASE_URL;
    if (!connection || decodeURIComponent(new URL(connection).pathname.slice(1)) !== DATABASE_NAME) {
      throw new Error(`Athlete E2E tests require ${DATABASE_NAME}; refusing other databases.`);
    }
    if (!ORIGIN) throw new Error('CORS_ORIGINS must be set for athlete E2E tests.');
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, AthletesModule],
    }).compile();
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
    if (target[0]?.database !== DATABASE_NAME) throw new Error('PostgreSQL database safety check failed.');
  });

  afterAll(async () => {
    if (prisma) {
      for (const fixture of fixtures) {
        if (!fixture.registrationAttempted) continue;
        try {
          const user = await prisma.user.findUnique({
            where: { email: fixture.email },
            select: { id: true },
          });
          if (!user) continue;
          if (fixture.userId && fixture.userId !== user.id) {
            cleanupErrors.push(`${fixture.email} (ownership mismatch)`);
            continue;
          }
          await prisma.$transaction(async (tx) => {
            const athlete = await tx.athlete.findUnique({
              where: { userId: user.id },
              select: { id: true },
            });
            if (athlete) {
              await tx.bodyMeasurement.deleteMany({ where: { athleteId: athlete.id } });
            }
            const sessions = await tx.authSession.findMany({
              where: { userId: user.id },
              select: { id: true },
            });
            const ids = sessions.map(({ id }) => id);
            if (ids.length) {
              await tx.authSessionToken.deleteMany({ where: { sessionId: { in: ids } } });
              await tx.authSession.deleteMany({ where: { id: { in: ids }, userId: user.id } });
            }
            await tx.athlete.deleteMany({ where: { userId: user.id } });
            await tx.user.deleteMany({ where: { id: user.id, email: fixture.email } });
          });
          if (await prisma.user.findUnique({ where: { email: fixture.email }, select: { id: true } })) {
            cleanupErrors.push(`${fixture.email} (still present)`);
          }
        } catch {
          cleanupErrors.push(`${fixture.email} (${fixture.userId ?? 'ID unavailable'})`);
        }
      }
    }
    if (app) await app.close();
    if (cleanupErrors.length) throw new Error(`Athlete fixture cleanup failed: ${cleanupErrors.join(', ')}`);
  });

  async function createTestUser(label: string): Promise<{ email: string; id: string; token: string }> {
    const email = `ath-${RUN_ID}-${label}-${randomUUID().slice(0, 12)}@example.com`;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new Error('Generated athlete test email already exists; refusing to use it.');
    }
    const fixture: Fixture = { email, registrationAttempted: true };
    fixtures.push(fixture);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN!)
      .send({ email, password: PASSWORD })
      .expect(201);
    const body = response.body as RegistrationBody;
    fixture.userId = body.user.id;
    return { email, id: body.user.id, token: body.accessToken };
  }

  it('authenticates owners, validates profile edits and measurements, and isolates history', async () => {
    const owner = await createTestUser('owner');
    const other = await createTestUser('other');
    const own = () => request(app.getHttpServer());

    await request(app.getHttpServer()).get('/api/v1/athletes/me').expect(401);
    const initial = await own().get('/api/v1/athletes/me')
      .set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(initial.body).toEqual(expect.objectContaining({ preferredUnit: 'KG', birthDate: null }));
    expect(initial.body).not.toHaveProperty('userId');
    expect(initial.body).not.toHaveProperty('passwordHash');

    const updated = await own().patch('/api/v1/athletes/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ preferredUnit: 'LB', birthDate: '1995-06-15' }).expect(200);
    expect(updated.body.preferredUnit).toBe('LB');
    expect(updated.body.birthDate).toContain('1995-06-15');
    await own().patch('/api/v1/athletes/me').set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: other.id }).expect(400);
    await own().patch('/api/v1/athletes/me').set('Authorization', `Bearer ${owner.token}`)
      .send({ athleteId: 'forged' }).expect(400);
    await own().patch('/api/v1/athletes/me').set('Authorization', `Bearer ${owner.token}`)
      .send({}).expect(400);
    const unchanged = await own().get('/api/v1/athletes/me')
      .set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(unchanged.body.preferredUnit).toBe('LB');

    const first = await own().post('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bodyWeight: 70.25, measuredAt: '2026-01-01T10:00:00.000Z', notes: 'first' })
      .expect(201);
    const second = await own().post('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bodyWeight: 69.8, measuredAt: '2026-02-01T10:00:00.000Z' })
      .expect(201);
    expect(first.body).not.toHaveProperty('athleteId');
    expect(await prisma.bodyMeasurement.count({ where: { athleteId: initial.body.id } })).toBe(2);
    await own().post('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bodyWeight: -1, measuredAt: 'not-a-date' }).expect(400);
    await own().post('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bodyWeight: 70, measuredAt: '2026-03-01T10:00:00.000Z', athleteId: other.id }).expect(400);

    const history = await own().get('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].id).toBe(second.body.id);
    expect(history.body[1].id).toBe(first.body.id);
    expect(history.body[0]).not.toHaveProperty('athleteId');
    const otherHistory = await request(app.getHttpServer())
      .get('/api/v1/athletes/me/measurements')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(otherHistory.body).toEqual([]);
    const otherProfile = await request(app.getHttpServer())
      .get('/api/v1/athletes/me')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(otherProfile.body.id).not.toBe(initial.body.id);
  });
});
