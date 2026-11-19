import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordHasher } from '../src/auth/security/password-hasher';
import { AuthRateLimiter } from '../src/auth/security/auth-rate-limiter';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-6B real HTTP and PostgreSQL pending request management', () => {
  let app: INestApplication,
    db: PrismaService,
    hasher: PasswordHasher,
    limiter: AuthRateLimiter;
  const origin = 'http://localhost:5173',
    root = '/api/v1/progression/automation-consents';
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
      password = 'Consent-fixture-only-2026!';
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
  const post = (f: F, path: string, body: object) =>
      request(app.getHttpServer())
        .post(root + path)
        .set('Authorization', 'Bearer ' + f.token)
        .set('Origin', origin)
        .send(body),
    get = (f: F, path: string) =>
      request(app.getHttpServer())
        .get(root + path)
        .set('Authorization', 'Bearer ' + f.token);
  const create = async (f: F) => {
    const input = { intentId: randomUUID(), contract: f.contract },
      r = await post(f, '', input).expect(201);
    return { input, event: r.body, id: r.body.consentId as string };
  };
  async function unchanged(f: F) {
    return JSON.stringify({
      plan: await db.trainingPlan.findUnique({
        where: { id: f.target.plan.id },
      }),
      p: await db.planExercise.findUnique({ where: { id: f.target.p.id } }),
      tasks: await db.workoutExercise.findMany({
        where: { id: { in: f.tasks.map((t) => t.id) } },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
    });
  }
  it('runs preview/create/list/detail/revise/revoke/audit without acceptance or historical changes', async () => {
    const f = await fixture(),
      before = await unchanged(f),
      q = `/candidates?exerciseId=${f.e.id}&unit=KG`;
    const c = await get(f, q).expect(200);
    expect(c.body.items).toContainEqual(
      expect.objectContaining({
        prescriptionId: f.target.p.id,
        load: '80.000',
      }),
    );
    expect(c.body.futureApplicabilityVerified).toBe(false);
    const preview = await post(f, '/preview', { contract: f.contract }).expect(
      200,
    );
    expect(preview.body.executionAuthorized).toBe(false);
    const x = await create(f);
    expect(x.event).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      version: 1,
      snapshot: { humanAcceptance: 'NOT_RECORDED' },
    });
    let v = (await get(f, '/' + x.id).expect(200)).body;
    expect(v.acceptance.available).toBe(true);
    expect(v.acceptance.humanAcceptance).toBe('NOT_RECORDED');
    expect(v.executionAuthorized).toBe(false);
    expect(v.currentConfiguration).toBe('MATCH');
    expect(
      (await get(f, '').expect(200)).body.items.some(
        (i: { id: string }) => i.id === x.id,
      ),
    ).toBe(true);
    const contract = {
      ...f.contract,
      limits: { ...f.contract.limits, maximumLoad: '190.000001' },
    };
    await post(f, `/${x.id}/revisions`, {
      intentId: randomUUID(),
      expectedVersion: 1,
      contract,
    }).expect(201);
    await post(f, `/${x.id}/revocations`, {
      intentId: randomUUID(),
      expectedVersion: 2,
      reason: 'OWNER_REQUEST',
    }).expect(201);
    v = (await get(f, '/' + x.id).expect(200)).body;
    expect(v).toMatchObject({
      state: 'REVOKED',
      version: 3,
      executionAuthorized: false,
    });
    expect(v.events.map((e: { version: number }) => e.version)).toEqual([
      1, 2, 3,
    ]);
    expect(v.events[0].snapshot.contract.limits.maximumLoad).toBe('200');
    expect(v.events[1].snapshot.contract.limits.maximumLoad).toBe('190.000001');
    expect((await get(f, `/${x.id}/events`).expect(200)).body.items).toEqual(
      v.events,
    );
    expect(await unchanged(f)).toBe(before);
    expect(
      await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
    for (const key of [
      'athleteId',
      'actorUserId',
      'requestKey',
      'contractKey',
      'configurationKey',
      'autoApplyAuthorized',
      'refreshToken',
    ])
      expect(JSON.stringify(v)).not.toContain(key);
    expect(preview.headers['cache-control']).toBe('no-store');
  });
  it('recovers CREATE after response loss by intent and keeps revocation terminal on old retries', async () => {
    const f = await fixture(),
      x = await create(f),
      op = await get(f, `/operations/${x.input.intentId}`).expect(200);
    expect(op.body.id).toBe(x.event.id);
    const revoke = {
      intentId: randomUUID(),
      expectedVersion: 1,
      reason: 'OWNER_REQUEST',
    };
    await post(f, `/${x.id}/revocations`, revoke).expect(201);
    expect((await post(f, '', x.input).expect(201)).body.state).toBe(
      'PENDING_CONFIRMATION',
    );
    expect((await get(f, '/' + x.id).expect(200)).body.state).toBe('REVOKED');
    await post(f, `/${x.id}/revocations`, revoke).expect(201);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: x.id },
      }),
    ).toBe(2);
  });
  it('serializes concurrent identical requests and revocations', async () => {
    const f = await fixture(),
      input = { intentId: randomUUID(), contract: f.contract },
      created = await Promise.all([post(f, '', input), post(f, '', input)]);
    expect(created.map((r) => r.status)).toEqual([201, 201]);
    expect(created[0].body.id).toBe(created[1].body.id);
    const id = created[0].body.consentId,
      body = {
        intentId: randomUUID(),
        expectedVersion: 1,
        reason: 'OWNER_REQUEST',
      },
      revoked = await Promise.all([
        post(f, `/${id}/revocations`, body),
        post(f, `/${id}/revocations`, body),
      ]);
    expect(revoked.map((r) => r.status)).toEqual([201, 201]);
    expect(revoked[0].body.id).toBe(revoked[1].body.id);
  });
  it('rejects overlaps, stale revisions, intent misuse and revival', async () => {
    const f = await fixture(),
      x = await create(f);
    await post(f, '', { intentId: randomUUID(), contract: f.contract }).expect(
      409,
    );
    await post(f, `/${x.id}/revisions`, {
      intentId: randomUUID(),
      expectedVersion: 2,
      contract: f.contract,
    }).expect(409);
    await post(f, '', {
      ...x.input,
      contract: { ...f.contract, termsVersion: 'different' },
    }).expect(409);
    await post(f, `/${x.id}/revocations`, {
      intentId: randomUUID(),
      expectedVersion: 1,
      reason: 'OWNER_REQUEST',
    }).expect(201);
    await post(f, `/${x.id}/revisions`, {
      intentId: randomUUID(),
      expectedVersion: 2,
      contract: f.contract,
    }).expect(409);
  });
  it('reports current configuration changes without rewriting original conditions', async () => {
    const f = await fixture(),
      x = await create(f);
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '3' },
    });
    const v = (await get(f, '/' + x.id).expect(200)).body;
    expect(v.currentConfiguration).toBe('CHANGED');
    expect(v.conditionChanges).toContain('EFFECTIVE_SETTINGS_CHANGED');
    expect(v.snapshot.bindings[0].selected.incrementAbsolute).toBe('2.500');
    expect(v.currentSnapshot.bindings[0].selected.incrementAbsolute).toBe(
      '3.000',
    );
    expect(v.version).toBe(1);
  });
  it('rejects alien resources and keeps both intentions and events private', async () => {
    const f = await fixture(),
      g = await fixture(),
      x = await create(f);
    for (const path of [
      '/' + x.id,
      `/${x.id}/events`,
      `/operations/${x.input.intentId}`,
    ])
      await get(g, path).expect(404);
    await post(g, '/preview', { contract: f.contract }).expect(404);
    await get(
      g,
      `/candidates?exerciseId=${g.e.id}&unit=KG&trainingPlanId=${f.target.plan.id}`,
    ).expect(404);
    await db.exercise.update({
      where: { id: f.e.id },
      data: { origin: 'PERSONAL', ownerId: f.identity.account.id },
    });
    await get(g, `/candidates?exerciseId=${f.e.id}&unit=KG`).expect(404);
    await post(g, `/${x.id}/revocations`, {
      intentId: randomUUID(),
      expectedVersion: 1,
      reason: 'OWNER_REQUEST',
    }).expect(404);
  });
  it.each(['ACTIVE', 'COMPLETED', 'ARCHIVED'])(
    'does not offer or accept %s plan targets',
    async (status) => {
      const f = await fixture();
      await db.trainingPlan.update({
        where: { id: f.target.plan.id },
        data: { status: status as 'ACTIVE' },
      });
      expect(
        (await get(f, `/candidates?exerciseId=${f.e.id}&unit=KG`).expect(200))
          .body.items,
      ).toEqual([]);
      await post(f, '/preview', { contract: f.contract }).expect(422);
    },
  );
  it('rejects missing config, unknown unit, invalid validity, limits and arbitrary state/snapshot', async () => {
    const f = await fixture();
    for (const extra of [
      { state: 'ACTIVE' },
      { snapshot: {} },
      { athleteId: f.athleteId },
      { acceptance: true },
    ])
      await post(f, '', {
        intentId: randomUUID(),
        contract: f.contract,
        ...extra,
      }).expect(400);
    await post(f, '/preview', {
      contract: {
        ...f.contract,
        validity: {
          ...f.contract.validity,
          endsAt: f.contract.validity.startsAt,
        },
      },
    }).expect(422);
    await post(f, '/preview', {
      contract: {
        ...f.contract,
        limits: { ...f.contract.limits, maximumLoad: '0' },
      },
    }).expect(422);
    await post(f, '/preview', {
      contract: {
        ...f.contract,
        limits: { ...f.contract.limits, unit: 'UNKNOWN' },
      },
    }).expect(400);
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    await post(f, '/preview', { contract: f.contract }).expect(422);
  });
  it.each(['none', 'origin', 'revoked', 'expired', 'suspended'])(
    'enforces %s authentication boundary',
    async (kind) => {
      const f = await fixture();
      if (kind === 'none') {
        await request(app.getHttpServer())
          .post(root)
          .set('Origin', origin)
          .send({ intentId: randomUUID(), contract: f.contract })
          .expect(401);
        return;
      }
      if (kind === 'origin') {
        await request(app.getHttpServer())
          .post(root)
          .set('Authorization', 'Bearer ' + f.token)
          .set('Origin', 'https://foreign.test')
          .send({ intentId: randomUUID(), contract: f.contract })
          .expect(403);
        return;
      }
      if (kind === 'suspended')
        await db.user.update({
          where: { id: f.identity.account.id },
          data: { status: 'SUSPENDED' },
        });
      else if (kind === 'revoked')
        await db.authSession.updateMany({
          where: { userId: f.identity.account.id },
          data: { revokedAt: new Date() },
        });
      else
        await db.$executeRaw`UPDATE auth_sessions SET created_at='2019-01-01Z',last_used_at='2019-01-01Z',expires_at='2020-01-01Z' WHERE user_id=${f.identity.account.id}::uuid`;
      await get(f, '').expect(401);
    },
  );
  it('uses the real Vue Axios/Zod service through HTTP and persists its exact contracts', async () => {
    const f = await fixture();
    await new Promise<void>((ok, fail) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          'tests/automation-consent.http.mjs',
        ],
        { cwd: resolve('../frontend'), timeout: 30000 },
        (error, stdout, stderr) =>
          error ? fail(new Error(stderr || stdout)) : ok(),
      );
      child.stdin!.end(
        JSON.stringify({
          url: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`,
          token: f.token,
          origin,
          contract: f.contract,
        }),
      );
    });
    expect(
      await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it('lets exactly one concurrent revision consume an expected version', async () => {
    const f = await fixture(),
      x = await create(f),
      responses = await Promise.all([
        post(f, `/${x.id}/revisions`, {
          intentId: randomUUID(),
          expectedVersion: 1,
          contract: { ...f.contract, termsVersion: 'v2a' },
        }),
        post(f, `/${x.id}/revisions`, {
          intentId: randomUUID(),
          expectedVersion: 1,
          contract: { ...f.contract, termsVersion: 'v2b' },
        }),
      ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: x.id },
      }),
    ).toBe(2);
  });
  it('rolls back aggregate and event if the event write fails', async () => {
    const f = await fixture();
    await db.$executeRawUnsafe(
      "CREATE FUNCTION prog6b_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated failure'; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER prog6b_fail_event BEFORE INSERT ON progression_automation_consent_events FOR EACH ROW EXECUTE FUNCTION prog6b_fail_event()',
    );
    try {
      const r = await post(f, '', {
        intentId: randomUUID(),
        contract: f.contract,
      }).expect(500);
      expect(r.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(r.body)).not.toMatch(/isolated failure|SQL|Prisma/);
      expect(
        await db.progressionAutomationConsent.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER prog6b_fail_event ON progression_automation_consent_events',
      );
      await db.$executeRawUnsafe('DROP FUNCTION prog6b_fail_event()');
    }
  });
  async function acceptanceFixture() {
    const f = await fixture(),
      created = await create(f),
      c = (
        await post(f, `/${created.id}/acceptance-challenges`, {
          expectedVersion: 1,
        }).expect(201)
      ).body;
    return {
      ...f,
      created,
      c,
      input: {
        intentId: randomUUID(),
        challengeId: c.id,
        expectedVersion: c.version,
        expectedState: c.state,
        contractKey: c.contractKey,
        conditionsKey: c.conditionsKey,
        contextKey: c.contextKey,
        termsVersion: c.termsVersion,
        presentationVersion: c.presentationVersion,
        conditionsPresented: true,
        acknowledgments: {
          policy: true,
          limits: true,
          destinations: true,
          validity: true,
          revocation: true,
        },
      },
    };
  }
  it('binds an issued challenge, accepts inactive, exposes exact audit and preserves snapshot', async () => {
    const f = await acceptanceFixture(),
      before = await unchanged(f);
    expect(f.c.requiredAcknowledgments).toEqual([
      'policy',
      'limits',
      'destinations',
      'validity',
      'revocation',
    ]);
    const accepted = (
      await post(f, `/${f.created.id}/acceptances`, f.input).expect(201)
    ).body;
    expect(accepted.state).toBe('ACCEPTED_INACTIVE');
    expect(accepted.snapshot).toEqual(f.created.event.snapshot);
    expect(accepted.acceptanceEvidence.acceptedVersion).toBe(1);
    expect(JSON.stringify(accepted)).not.toMatch(
      /actorSessionId|actorUserId|refreshToken|passwordHash/,
    );
    const detail = (await get(f, '/' + f.created.id).expect(200)).body;
    expect(detail.acceptance).toMatchObject({
      available: false,
      humanAcceptance: 'RECORDED',
      recordedEventId: accepted.id,
    });
    expect(detail.executionAuthorized).toBe(false);
    expect(
      (await post(f, `/${f.created.id}/acceptances`, f.input).expect(201)).body,
    ).toEqual(accepted);
    expect(await unchanged(f)).toBe(before);
    expect(
      await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it('requires every acknowledgment and rejects injected authority before writing', async () => {
    const f = await acceptanceFixture();
    for (const k of Object.keys(f.input.acknowledgments)) {
      await post(f, `/${f.created.id}/acceptances`, {
        ...f.input,
        acknowledgments: { ...f.input.acknowledgments, [k]: false },
      }).expect(400);
    }
    await post(f, `/${f.created.id}/acceptances`, {
      ...f.input,
      conditionsPresented: false,
    }).expect(400);
    await post(f, `/${f.created.id}/acceptances`, {
      ...f.input,
      state: 'ACCEPTED_INACTIVE',
    }).expect(400);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: f.created.id },
      }),
    ).toBe(1);
  });
  it('protects challenge and acceptance origin, ownership and revoked sessions', async () => {
    const f = await acceptanceFixture(),
      other = await fixture();
    await request(app.getHttpServer())
      .post(root + `/${f.created.id}/acceptance-challenges`)
      .set('Authorization', 'Bearer ' + f.token)
      .set('Origin', 'https://attacker.example')
      .send({ expectedVersion: 1 })
      .expect(403);
    await post(other, `/${f.created.id}/acceptance-challenges`, {
      expectedVersion: 1,
    }).expect(404);
    await post(f, `/${f.created.id}/acceptances`, {
      ...f.input,
      challengeId: randomUUID(),
    }).expect(409);
    await db.authSession.updateMany({
      where: { userId: f.identity.account.id },
      data: { revokedAt: new Date() },
    });
    await post(f, `/${f.created.id}/acceptances`, f.input).expect(401);
  });
  it('recovers a committed acceptance through its original intention and current revoked state', async () => {
    const f = await acceptanceFixture();
    const a = (
      await post(f, `/${f.created.id}/acceptances`, f.input).expect(201)
    ).body;
    await post(f, `/${f.created.id}/revocations`, {
      intentId: randomUUID(),
      expectedVersion: 2,
      reason: 'OWNER_REQUEST',
    }).expect(201);
    expect(
      (await get(f, '/operations/' + f.input.intentId).expect(200)).body,
    ).toEqual(a);
    expect((await get(f, '/' + f.created.id).expect(200)).body.state).toBe(
      'REVOKED',
    );
    await post(f, `/${f.created.id}/acceptances`, {
      ...f.input,
      intentId: randomUUID(),
    }).expect(409);
  });
});
