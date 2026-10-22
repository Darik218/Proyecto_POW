import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decode } from 'jsonwebtoken';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AuthConfig } from '../../src/auth/auth.config';
import { AuthModule } from '../../src/auth/auth.module';
import { hashRefreshToken } from '../../src/auth/security/cookie.utils';
import { PrismaService } from '../../src/database/prisma.service';

const EXPECTED_DATABASE = 'proyecto_pow_dev';
const RUN_ID = randomUUID();
const PASSWORD = 'integration-test-password-123';
const REGISTER_PATH = '/api/v1/auth/register';
const LOGIN_PATH = '/api/v1/auth/login';
const REFRESH_PATH = '/api/v1/auth/refresh';
const LOGOUT_PATH = '/api/v1/auth/logout';
const LOGOUT_ALL_PATH = '/api/v1/auth/logout-all';

type AuthBody = {
  user: { id: string; email: string };
  accessToken: string;
  csrfToken: string;
  accessTokenExpiresAt: string;
};

type AuthResult = {
  body: AuthBody;
  refreshCookie: string;
};

type Fixture = {
  email: string;
  wasAbsentBeforeRegistration: boolean;
  registrationStarted: boolean;
  userId?: string;
};

function origin(): string {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(',') ?? [];
  const selected = configuredOrigins.map((item) => item.trim()).find(Boolean);
  if (!selected) throw new Error('CORS_ORIGINS must be configured for integration tests.');
  return selected;
}

function uniqueEmail(label: string): string {
  return `pi-${RUN_ID.slice(0, 12)}-${label.slice(0, 8)}-${randomUUID()}@example.com`;
}

function cookieValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const setCookie = headers['set-cookie'];
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const entry = values.find((value) => value.startsWith(`${name}=`));
  if (!entry) throw new Error(`Expected ${name} cookie in authentication response.`);
  return entry.split(';', 1)[0]!;
}

function sessionId(auth: AuthResult): string {
  const claims = decode(auth.body.accessToken);
  if (!claims || typeof claims === 'string' || typeof claims.sid !== 'string') {
    throw new Error('Access token did not contain a session identifier.');
  }
  return claims.sid;
}

function cookieHeader(refreshCookie: string, csrfToken: string): string {
  return `${refreshCookie}; pow_csrf=${encodeURIComponent(csrfToken)}`;
}

describe('Authentication PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: AuthConfig;
  let allowedOrigin: string;
  const fixtures: Fixture[] = [];
  const cleanupFailures: string[] = [];

  beforeAll(async () => {
    const configuredUrl = process.env.DATABASE_URL;
    if (!configuredUrl) throw new Error('DATABASE_URL is not configured.');
    const configuredDatabase = decodeURIComponent(new URL(configuredUrl).pathname.slice(1));
    if (configuredDatabase !== EXPECTED_DATABASE) {
      throw new Error(
        `Integration tests require ${EXPECTED_DATABASE}; refusing database ${configuredDatabase}.`,
      );
    }
    allowedOrigin = origin();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
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

    prisma = app.get(PrismaService);
    config = app.get(AuthConfig);
    const databaseCheck = await prisma.$queryRaw<
      { database: string; readOnly: string }[]
    >`SELECT current_database() AS database,
             current_setting('transaction_read_only') AS "readOnly"`;
    if (
      databaseCheck[0]?.database !== EXPECTED_DATABASE ||
      databaseCheck[0]?.readOnly !== 'off'
    ) {
      await app.close();
      throw new Error('Connected PostgreSQL target did not match the writable test target.');
    }
    const tables = await prisma.$queryRaw<
      { users: string | null; athletes: string | null; sessions: string | null; consumed: string | null }[]
    >`SELECT to_regclass('public.users')::text AS users,
             to_regclass('public.athletes')::text AS athletes,
             to_regclass('public.auth_sessions')::text AS sessions,
             to_regclass('public.auth_session_tokens')::text AS consumed`;
    if (
      !tables[0]?.users ||
      !tables[0]?.athletes ||
      !tables[0]?.sessions ||
      !tables[0]?.consumed
    ) {
      await app.close();
      throw new Error('Required authentication tables are missing; no test writes were made.');
    }
  });

  afterAll(async () => {
    if (prisma) {
      for (const fixture of fixtures) {
        if (!fixture.registrationStarted || !fixture.wasAbsentBeforeRegistration) continue;
        try {
          const user = await prisma.user.findUnique({
            where: { email: fixture.email },
            select: { id: true },
          });
          if (!user) continue;
          if (fixture.userId && fixture.userId !== user.id) {
            cleanupFailures.push(`${fixture.email} (ownership ID mismatch)`);
            continue;
          }

          await prisma.$transaction(async (tx) => {
            const sessions = await tx.authSession.findMany({
              where: { userId: user.id },
              select: { id: true },
            });
            const sessionIds = sessions.map((session) => session.id);
            if (sessionIds.length > 0) {
              await tx.authSessionToken.deleteMany({
                where: { sessionId: { in: sessionIds } },
              });
              await tx.authSession.deleteMany({
                where: { id: { in: sessionIds }, userId: user.id },
              });
            }
            await tx.athlete.deleteMany({ where: { userId: user.id } });
            await tx.user.deleteMany({ where: { id: user.id, email: fixture.email } });
          });
          const remaining = await prisma.user.findUnique({
            where: { email: fixture.email },
            select: { id: true },
          });
          if (remaining) cleanupFailures.push(`${fixture.email} (${remaining.id})`);
        } catch {
          cleanupFailures.push(`${fixture.email} (${fixture.userId ?? 'ID not returned'})`);
        }
      }
      if (cleanupFailures.length > 0) {
        console.error(`Authentication test fixtures pending cleanup: ${cleanupFailures.join(', ')}`);
      }
    }
    if (app) await app.close();
    if (cleanupFailures.length > 0) {
      throw new Error(`Authentication test fixture cleanup failed for ${cleanupFailures.length} record(s).`);
    }
  });

  async function register(label: string): Promise<{ email: string; auth: AuthResult }> {
    const email = uniqueEmail(label);
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) throw new Error('Generated integration email already exists; refusing to use it.');
    const fixture: Fixture = {
      email,
      wasAbsentBeforeRegistration: true,
      registrationStarted: true,
    };
    fixtures.push(fixture);

    const response = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .set('Origin', allowedOrigin)
      .send({ email, password: PASSWORD });
    if (response.status !== 201) {
      throw new Error(
        `Integration registration returned ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    const body = response.body as AuthBody;
    fixture.userId = body.user.id;
    return {
      email,
      auth: {
        body,
        refreshCookie: cookieValue(response.headers, config.refreshCookieName),
      },
    };
  }

  async function login(email: string): Promise<AuthResult> {
    const response = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .set('Origin', allowedOrigin)
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      body: response.body as AuthBody,
      refreshCookie: cookieValue(response.headers, config.refreshCookieName),
    };
  }

  function refresh(auth: AuthResult, csrfToken = auth.body.csrfToken) {
    return request(app.getHttpServer())
      .post(REFRESH_PATH)
      .set('Origin', allowedOrigin)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', cookieHeader(auth.refreshCookie, csrfToken));
  }

  async function session(sessionIdentifier: string) {
    return prisma.authSession.findUniqueOrThrow({
      where: { id: sessionIdentifier },
    });
  }

  it('persists the registered user and athlete together and rejects a normalized duplicate', async () => {
    const { email, auth } = await register('atomic');
    const created = await prisma.user.findUniqueOrThrow({
      where: { id: auth.body.user.id },
      include: { athlete: true },
    });
    expect(created.email).toBe(email);
    expect(created.athlete?.userId).toBe(created.id);
    expect(created.passwordHash).not.toBe(PASSWORD);

    await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .set('Origin', allowedOrigin)
      .send({ email: `  ${email.toUpperCase()}  `, password: PASSWORD })
      .expect(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.athlete.count({ where: { userId: created.id } })).toBe(1);
  });

  it('creates independent PostgreSQL sessions on separate logins', async () => {
    const { email, auth: registration } = await register('sessions');
    const firstLogin = await login(email);
    const secondLogin = await login(email);
    const ids = [sessionId(registration), sessionId(firstLogin), sessionId(secondLogin)];
    expect(new Set(ids).size).toBe(3);
    expect(await prisma.authSession.count({ where: { userId: registration.body.user.id } })).toBe(3);
  });

  it('rotates refresh tokens and records the old token as consumed', async () => {
    const { auth } = await register('rotation');
    const oldHash = hashRefreshToken(
      decodeURIComponent(auth.refreshCookie.slice(auth.refreshCookie.indexOf('=') + 1)),
      config.refreshTokenPepper,
    );
    const response = await refresh(auth).expect(200);
    const nextCookie = cookieValue(response.headers, config.refreshCookieName);
    const nextToken = decodeURIComponent(nextCookie.slice(nextCookie.indexOf('=') + 1));
    expect(nextToken).not.toBe(auth.refreshCookie.slice(auth.refreshCookie.indexOf('=') + 1));
    const oldTokenRow = await prisma.authSessionToken.findUniqueOrThrow({
      where: { tokenHash: oldHash },
    });
    const current = await session(sessionId({ ...auth, body: response.body as AuthBody }));
    expect(oldTokenRow.sessionId).toBe(current.id);
    expect(current.generation).toBe(1);
    expect(current.refreshTokenHash).not.toBe(oldHash);
  });

  it('revokes only a reused token session and preserves another device session', async () => {
    const { email, auth: first } = await register('reuse');
    const second = await login(email);
    const firstSessionId = sessionId(first);
    const secondSessionId = sessionId(second);
    const rotated = await refresh(first).expect(200);
    const rotatedAuth: AuthResult = {
      body: rotated.body as AuthBody,
      refreshCookie: cookieValue(rotated.headers, config.refreshCookieName),
    };

    await refresh(first, rotatedAuth.body.csrfToken).expect(401);
    expect((await session(firstSessionId)).revokedAt).not.toBeNull();
    expect((await session(secondSessionId)).revokedAt).toBeNull();
    await refresh(second).expect(200);
  });

  it('serializes simultaneous refreshes in PostgreSQL and does not issue two valid rotations', async () => {
    const { auth } = await register('concurrent');
    const outcomes = await Promise.all([
      refresh(auth),
      refresh(auth),
    ]);
    const statuses = outcomes
      .map((outcome) => outcome.status)
      .sort((left, right) => left - right);
    expect(statuses).toEqual([200, 401]);

    const stored = await session(sessionId(auth));
    expect(stored.generation).toBe(1);
    expect(stored.revokedAt).not.toBeNull();
    expect(await prisma.authSessionToken.count({ where: { sessionId: stored.id } })).toBe(1);
  });

  it('enforces the seven-day idle lifetime and revokes an idle-expired session', async () => {
    const { auth } = await register('idle-expiry');
    const id = sessionId(auth);
    const stored = await session(id);
    expect(
      Math.abs(
        stored.expiresAt.getTime() -
          stored.createdAt.getTime() -
          7 * 24 * 60 * 60 * 1000,
      ),
    ).toBeLessThan(1000);
    await prisma.authSession.update({
      where: { id },
      data: {
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await refresh(auth).expect(401);
    expect((await session(id)).revokedAt).not.toBeNull();
  });

  it('caps refresh at the absolute deadline and rejects a session beyond that deadline', async () => {
    const { auth } = await register('absolute-expiry');
    const id = sessionId(auth);
    const nearDeadline = new Date(Date.now() + 60_000);
    await prisma.authSession.update({
      where: { id },
      data: { absoluteExpiresAt: nearDeadline },
    });
    const rotated = await refresh(auth).expect(200);
    const rotatedCookie = cookieValue(rotated.headers, config.refreshCookieName);
    const rotatedAuth: AuthResult = {
      body: rotated.body as AuthBody,
      refreshCookie: rotatedCookie,
    };
    const current = await session(id);
    expect(current.expiresAt.getTime()).toBeLessThanOrEqual(
      current.absoluteExpiresAt.getTime(),
    );
    expect(current.absoluteExpiresAt.getTime()).toBe(nearDeadline.getTime());

    const pastDeadline = new Date(Date.now() - 1000);
    await prisma.authSession.update({
      where: { id },
      data: {
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        absoluteExpiresAt: pastDeadline,
        expiresAt: new Date(Date.now() + 30_000),
      },
    });
    await refresh(rotatedAuth).expect(401);
    expect((await session(id)).revokedAt).not.toBeNull();
  });

  it('persists current-session logout without revoking another session', async () => {
    const { email, auth: current } = await register('logout-current');
    const other = await login(email);
    const currentId = sessionId(current);
    const otherId = sessionId(other);
    await request(app.getHttpServer())
      .post(LOGOUT_PATH)
      .set('Origin', allowedOrigin)
      .set('X-CSRF-Token', current.body.csrfToken)
      .set('Cookie', cookieHeader(current.refreshCookie, current.body.csrfToken))
      .expect(204);
    expect((await session(currentId)).revokedAt).not.toBeNull();
    expect((await session(otherId)).revokedAt).toBeNull();
  });

  it('persists logout-all for only the integration account', async () => {
    const { email, auth: current } = await register('logout-all');
    const other = await login(email);
    const ids = [sessionId(current), sessionId(other)];
    await request(app.getHttpServer())
      .post(LOGOUT_ALL_PATH)
      .set('Authorization', `Bearer ${current.body.accessToken}`)
      .set('Origin', allowedOrigin)
      .set('X-CSRF-Token', current.body.csrfToken)
      .set('Cookie', cookieHeader(current.refreshCookie, current.body.csrfToken))
      .expect(204);
    for (const id of ids) expect((await session(id)).revokedAt).not.toBeNull();
  });
});
