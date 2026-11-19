import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { ProgressionModule } from '../src/progression/progression.module';
import { PasswordHasher } from '../src/auth/security/password-hasher';
import { AuthRateLimiter } from '../src/auth/security/auth-rate-limiter';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
const p = () => ({
  minSuccessfulSessions: 3,
  targetRpeMin: '6',
  targetRpeMax: '8',
  incrementAbsolute: '2.5',
  incrementPercent: null,
  maxIncrementPercent: '5',
  maxLoad: null,
});
isolated('SETTINGS-1 real HTTP and PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    hasher: PasswordHasher,
    limiter: AuthRateLimiter;
  const root = '/api/v1/progression/settings',
    origin = 'http://localhost:5173';
  beforeAll(async () => {
    await progressionIsolation();
    const m = await Test.createTestingModule({
      imports: [ProgressionModule],
    }).compile();
    app = m.createNestApplication();
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
    await app.listen(0, '127.0.0.1');
    db = m.get(PrismaService);
    hasher = m.get(PasswordHasher);
    limiter = m.get(AuthRateLimiter);
  });
  afterAll(() => app?.close());
  async function fixture() {
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1'])
      limiter.reset(
        createHash('sha256')
          .update('login-ip\u0000' + ip)
          .digest('hex'),
      );
    const f = await automationConsentFixture(db),
      password = 'Settings-fixture-only-2026!';
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    await db.user.update({
      where: { id: f.identity.account.id },
      data: { passwordHash: await hasher.hash(password) },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: f.identity.account.email, password })
      .expect(200);
    return { ...f, token: login.body.accessToken as string };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const get = (f: F, path = '') =>
      request(app.getHttpServer())
        .get(root + path)
        .set('Authorization', 'Bearer ' + f.token),
    post = (f: F, path: string, b: object) =>
      request(app.getHttpServer())
        .post(root + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + f.token)
        .send(b),
    put = (f: F, id: string, b: object) =>
      request(app.getHttpServer())
        .put(root + '/' + id)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + f.token)
        .send(b);
  const create = async (f: F) => {
    const input = {
      intentId: randomUUID(),
      scope: { exerciseId: null, trainingPlanId: null },
      parameters: p(),
    };
    return { input, receipt: (await post(f, '', input).expect(201)).body };
  };
  it('lists, creates, resolves provenance and replaces a complete owned row with private responses', async () => {
    const f = await fixture();
    expect((await get(f).expect(200)).body.total).toBe(0);
    const { receipt: a } = await create(f);
    expect(a.result.provenance.unit).toBe('NOT_STORED_IN_SETTING');
    expect(a.result.parameterSources.minSuccessfulSessions.settingId).toBe(
      a.settingId,
    );
    expect(JSON.stringify(a)).not.toMatch(
      /athleteId|actorSessionId|passwordHash|refreshToken|requestKey/,
    );
    const e = await post(f, '/effective', {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    }).expect(200);
    expect(e.headers['cache-control']).toBe('no-store');
    expect(e.body.scope).toBe('ATHLETE');
    expect(e.body.externalRequirements).toContain('POLICY_PROVENANCE_REQUIRED');
    const impact = (
      await post(f, `/${a.settingId}/impact`, {
        expectedRevision: a.revision,
        parameters: { ...p(), incrementAbsolute: '1.25' },
      }).expect(200)
    ).body;
    expect(impact.executionAuthorized).toBe(false);
    const b = (
      await put(f, a.settingId, {
        intentId: randomUUID(),
        expectedRevision: a.revision,
        parameters: { ...p(), incrementAbsolute: '1.25' },
        confirmImpact: true,
      }).expect(200)
    ).body;
    expect(b.result.parameters.incrementAbsolute).toBe('1.250');
    expect(b.revision).not.toBe(a.revision);
    expect((await get(f, '/' + a.settingId).expect(200)).body.revision).toBe(
      b.revision,
    );
  });
  it('rejects unknown authority, missing nullable fields and unconfirmed replacement', async () => {
    const f = await fixture(),
      { receipt: a, input } = await create(f);
    const { maxLoad: _maxLoad, ...missing } = p();
    await post(f, '', {
      ...input,
      intentId: randomUUID(),
      parameters: missing,
    }).expect(400);
    await put(f, a.settingId, {
      intentId: randomUUID(),
      expectedRevision: a.revision,
      parameters: p(),
      confirmImpact: false,
    }).expect(400);
    await put(f, a.settingId, {
      intentId: randomUUID(),
      expectedRevision: a.revision,
      parameters: p(),
      confirmImpact: true,
      scope: { exerciseId: f.e.id, trainingPlanId: null },
    }).expect(400);
    await put(f, a.settingId, {
      intentId: randomUUID(),
      expectedRevision: a.revision,
      parameters: { ...p(), autoApplyAuthorized: true },
      confirmImpact: true,
    }).expect(400);
    await request(app.getHttpServer())
      .delete(root + '/' + a.settingId)
      .set('Authorization', 'Bearer ' + f.token)
      .expect(404);
  });
  it('returns typed conflicts for duplicate scope, stale edits and reused intentions', async () => {
    const f = await fixture(),
      { receipt: a, input } = await create(f);
    expect(
      (await post(f, '', { ...input, intentId: randomUUID() }).expect(409)).body
        .code,
    ).toBe('SETTING_SCOPE_EXISTS');
    expect(
      (
        await post(f, '', {
          ...input,
          parameters: { ...p(), maxLoad: '99' },
        }).expect(409)
      ).body.code,
    ).toBe('INTENT_REUSED');
    const body = {
      intentId: randomUUID(),
      expectedRevision: a.revision,
      parameters: p(),
      confirmImpact: true,
    };
    await put(f, a.settingId, body).expect(200);
    expect(
      (
        await put(f, a.settingId, { ...body, intentId: randomUUID() }).expect(
          409,
        )
      ).body.code,
    ).toBe('STALE_SETTING');
  });
  it.each([
    { incrementAbsolute: '1.2345' },
    { targetRpeMax: '11' },
    { maxLoad: '100000' },
    { incrementPercent: '6' },
  ])('rejects exact invalid values without rounding %p', async (change) => {
    const f = await fixture();
    expect(
      (
        await post(f, '', {
          intentId: randomUUID(),
          scope: { exerciseId: null, trainingPlanId: null },
          parameters: { ...p(), ...change },
        }).expect(422)
      ).body.code,
    ).toBe('INVALID_SETTING');
    expect(
      await db.progressionSetting.count({ where: { athleteId: f.athleteId } }),
    ).toBe(0);
  });
  it('enforces bearer/origin/ownership and persisted revoked sessions', async () => {
    const f = await fixture(),
      g = await fixture(),
      { receipt: a, input } = await create(f);
    await request(app.getHttpServer()).get(root).expect(401);
    await request(app.getHttpServer())
      .post(root)
      .set('Authorization', 'Bearer ' + f.token)
      .set('Origin', 'https://attacker.example')
      .send(input)
      .expect(403);
    await get(g, '/' + a.settingId).expect(404);
    await get(g, '/operations/' + input.intentId).expect(404);
    await post(g, '/effective', {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    }).expect(404);
    await db.authSession.updateMany({
      where: { userId: f.identity.account.id },
      data: { revokedAt: new Date() },
    });
    await get(f).expect(401);
  });
  it('recovers a prior mutation but returns the current row separately after later edits', async () => {
    const f = await fixture(),
      { receipt: a, input } = await create(f);
    const b = (
      await put(f, a.settingId, {
        intentId: randomUUID(),
        expectedRevision: a.revision,
        parameters: { ...p(), incrementAbsolute: '1.25' },
        confirmImpact: true,
      }).expect(200)
    ).body;
    expect(
      (await get(f, '/operations/' + input.intentId).expect(200)).body,
    ).toEqual(a);
    expect((await get(f, '/' + a.settingId).expect(200)).body.revision).toBe(
      b.revision,
    );
    expect((await post(f, '', input).expect(201)).body).toEqual(a);
  });
  it('uses the real Axios service and Zod against the listening backend', async () => {
    const f = await fixture(),
      address = app.getHttpServer().address();
    if (!address || typeof address === 'string')
      throw Error('Expected ephemeral localhost listener');
    await new Promise<void>((ok, reject) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          'tests/progression-settings.http.mjs',
        ],
        { cwd: resolve('../frontend'), timeout: 30000, maxBuffer: 1 << 20 },
        (error, stdout) => {
          if (error)
            reject(Error('Typed settings HTTP client failed: ' + stdout));
          else ok();
        },
      );
      child.stdin!.end(
        JSON.stringify({
          url: `http://127.0.0.1:${address.port}`,
          origin,
          token: f.token,
          exerciseId: f.e.id,
          planId: f.target.plan.id,
        }),
      );
    });
  });
});
