import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthRateLimiter } from '../src/auth/security/auth-rate-limiter';
import { PasswordHasher } from '../src/auth/security/password-hasher';
import {
  reviewFixture,
  plannedReviewTarget,
} from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-6A real HTTP/manual progression/PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    hasher: PasswordHasher,
    limiter: AuthRateLimiter;
  const origin = 'http://localhost:5173',
    root = '/api/v1/progression';
  beforeAll(async () => {
    await progressionIsolation();
    const module = await Test.createTestingModule({
      imports: [ProgressionModule],
    }).compile();
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
    await app.listen(0, '127.0.0.1');
    db = module.get(PrismaService);
    hasher = module.get(PasswordHasher);
    limiter = module.get(AuthRateLimiter);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    limiter.reset(
      createHash('sha256')
        .update('login-ip\u0000::ffff:127.0.0.1')
        .digest('hex'),
    );
    limiter.reset(
      createHash('sha256').update('login-ip\u0000127.0.0.1').digest('hex'),
    );
    const f = await reviewFixture(db),
      target = await plannedReviewTarget(db, f),
      password = 'Valid-fixture-password-2026!';
    await db.user.update({
      where: { id: f.identity.account.id },
      data: { passwordHash: await hasher.hash(password) },
    });
    const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: f.identity.account.email, password })
        .expect(200),
      [date] = await db.$queryRaw<
        { on: string }[]
      >`SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date+7)::text AS on`,
      activity = await db.scheduledActivity.create({
        data: {
          athleteId: f.athleteId,
          planWeekId: target.week.id,
          planDayId: target.day.id,
          originalOn: new Date(date.on),
          scheduledOn: new Date(date.on),
          timeZone: 'UTC',
          title: 'HTTP future fixture',
        },
      });
    return {
      ...f,
      target,
      activity,
      token: login.body.accessToken as string,
      login,
    };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const post = (f: F, path: string, body: object) =>
    request(app.getHttpServer())
      .post(root + path)
      .set('Authorization', 'Bearer ' + f.token)
      .set('Origin', origin)
      .send(body);
  const get = (f: F, path: string) =>
    request(app.getHttpServer())
      .get(root + path)
      .set('Authorization', 'Bearer ' + f.token);
  async function saved(f: F) {
    const preview = await post(f, '/preview', f.command).expect(200),
      p = await post(f, '/recommendations', {
        command: f.command,
        expectedSemanticKey: preview.body.semanticKey,
        expectedDependencyKeys: preview.body.dependencyKeys,
      }).expect(201);
    return { preview: preview.body, proposal: p.body };
  }
  async function approved(f: F) {
    const x = await saved(f),
      view = (
        await post(
          f,
          `/recommendations/${x.proposal.id}/inspection`,
          {},
        ).expect(200)
      ).body,
      event = (
        await post(f, `/recommendations/${x.proposal.id}/reviews`, {
          intentId: randomUUID(),
          action: 'APPROVE',
          expectedStatus: 'PENDING',
          expectedVersion: null,
          expectedSemanticKey: x.preview.semanticKey,
          expectedCycleKey: view.cycle.key,
          expectedDependencyKeys: x.preview.dependencyKeys,
          acceptance: {
            ...view.acceptanceChallenge,
            acceptPolicy: true,
            acceptEvidence: true,
          },
        }).expect(201)
      ).body;
    return { ...x, view, event };
  }
  async function ready(f: F) {
    const x = await approved(f),
      result = await post(
        f,
        `/recommendations/${x.proposal.id}/application-readiness`,
        { activityId: f.activity.id, intentId: randomUUID() },
      ).expect(200);
    expect(result.body.eligible).toBe(true);
    return { ...x, command: result.body.command };
  }
  async function history() {
    const result: Record<string, string> = {};
    for (const table of [
      'workout_sessions',
      'workout_exercises',
      'set_records',
      'one_rm_estimates',
      'scheduled_activities',
      'progression_automation_consents',
      'progression_automation_consent_events',
    ])
      result[table] = (
        await db.$queryRawUnsafe<{ h: string }[]>(
          `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS h FROM ${table} t`,
        )
      )[0].h;
    return result;
  }
  it('runs preview→save→read→inspect→human approval→separate application→receipt without historical changes', async () => {
    const f = await fixture(),
      before = await history(),
      x = await ready(f),
      id = x.proposal.id;
    expect(
      (await get(f, `/recommendations/${id}`).expect(200)).body.status,
    ).toBe('APPROVED');
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('80.000');
    const applied = await post(
        f,
        `/recommendations/${id}/application`,
        x.command,
      ).expect(201),
      receipt = await get(f, `/recommendations/${id}/application`).expect(200);
    expect(receipt.body).toEqual(applied.body);
    expect(applied.body).toMatchObject({
      status: 'APPLIED',
      previousLoad: '80.000000',
      appliedLoad: '82.500000',
      loadUnit: 'KG',
      destination: {
        prescriptionId: f.target.p.id,
        planVersionBefore: 0,
        planVersionAfter: 1,
      },
    });
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('82.500');
    expect(await history()).toEqual(before);
    const text = JSON.stringify(
      (await post(f, `/recommendations/${id}/inspection`, {}).expect(200)).body,
    );
    for (const forbidden of [
      'athleteId',
      'userId',
      'actorUserId',
      'requestKey',
      'payloadKey',
      'passwordHash',
      'refreshTokenHash',
    ])
      expect(text).not.toContain(forbidden);
    expect(receipt.headers['cache-control']).toBe('no-store');
    expect(
      (await get(f, '/recommendations').expect(200)).body.items.some(
        (r: { id: string }) => r.id === id,
      ),
    ).toBe(true);
  });
  it('recovers a discarded apply response with one receipt and one plan increment', async () => {
    const f = await fixture(),
      x = await ready(f),
      url = `/recommendations/${x.proposal.id}/application`;
    await post(f, url, x.command).expect(201);
    const retry = await post(f, url, x.command).expect(201),
      result = await get(f, url).expect(200);
    expect(retry.body).toEqual(result.body);
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: x.proposal.id },
      }),
    ).toBe(1);
  });
  it('coalesces concurrent HTTP applications with the original intention', async () => {
    const f = await fixture(),
      x = await ready(f),
      r = await Promise.all([
        post(f, `/recommendations/${x.proposal.id}/application`, x.command),
        post(f, `/recommendations/${x.proposal.id}/application`, x.command),
      ]);
    expect(r.map((v) => v.status)).toEqual([201, 201]);
    expect(r[0].body.id).toBe(r[1].body.id);
  });
  it('saves and replays immutable original parameters after another login, not reconstructed evidence', async () => {
    const f = await fixture(),
      x = await saved(f),
      recipe = await get(f, `/recommendations/${x.proposal.id}/request`).expect(
        200,
      );
    expect(recipe.body.command).toMatchObject({
      history: { limit: 100, contexts: f.command.history.contexts },
      policy: { provenance: f.command.policy!.provenance },
    });
    expect(recipe.body.provenance).toBe('HTTP_SAVE_REQUEST');
    await expect(
      db.progressionRevalidationRequest.update({
        where: { recommendationId: x.proposal.id },
        data: { provenance: 'rewrite' },
      }),
    ).rejects.toBeDefined();
    expect(
      (
        await post(f, '/recommendations', {
          command: f.command,
          expectedSemanticKey: x.preview.semanticKey,
          expectedDependencyKeys: x.preview.dependencyKeys,
        }).expect(201)
      ).body.id,
    ).toBe(x.proposal.id);
  });
  it('does not persist an arbitrary caller snapshot or owner identifier', async () => {
    const f = await fixture();
    for (const extra of [
      { athleteId: randomUUID() },
      { snapshot: {} },
      { status: 'APPLIED' },
    ])
      await post(f, '/preview', { ...f.command, ...extra }).expect(400);
  });
  it.each(['none', 'cookieOnly', 'foreignOrigin', 'missingOrigin'] as const)(
    'rejects %s business authentication/origin without changing cookie CSRF scope',
    async (kind) => {
      const f = await fixture();
      let r = request(app.getHttpServer()).post(root + '/preview');
      if (kind === 'cookieOnly')
        r = r.set('Cookie', f.login.headers['set-cookie']);
      if (kind !== 'none' && kind !== 'cookieOnly')
        r = r.set('Authorization', 'Bearer ' + f.token);
      if (kind === 'foreignOrigin') r = r.set('Origin', 'https://foreign.test');
      if (kind === 'none' || kind === 'cookieOnly') r = r.set('Origin', origin);
      const response = await r.send(f.command);
      expect(response.status).toBe(
        kind === 'foreignOrigin' || kind === 'missingOrigin' ? 403 : 401,
      );
    },
  );
  it('retains real auth refresh CSRF rejection and successful bearer business requests', async () => {
    const f = await fixture();
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', f.login.headers['set-cookie'])
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', f.login.headers['set-cookie'])
      .set('X-CSRF-Token', 'wrong')
      .send({})
      .expect(403);
    await post(f, '/preview', f.command).expect(200);
  });
  it.each(['revoked', 'expired', 'suspended'] as const)(
    'rejects a %s real session/account',
    async (kind) => {
      const f = await fixture();
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
        await db.$executeRaw`UPDATE auth_sessions SET created_at='2019-01-01Z'::timestamptz,last_used_at='2019-01-01Z'::timestamptz,expires_at='2020-01-01Z'::timestamptz WHERE user_id=${f.identity.account.id}::uuid`;
      await post(f, '/preview', f.command).expect(401);
    },
  );
  it('requires policy/evidence confirmations and exact challenge without applying on approval', async () => {
    const f = await fixture(),
      x = await saved(f),
      v = (
        await post(
          f,
          `/recommendations/${x.proposal.id}/inspection`,
          {},
        ).expect(200)
      ).body,
      base = {
        intentId: randomUUID(),
        action: 'APPROVE',
        expectedStatus: 'PENDING',
        expectedVersion: null,
        expectedSemanticKey: x.preview.semanticKey,
        expectedCycleKey: v.cycle.key,
        expectedDependencyKeys: x.preview.dependencyKeys,
      };
    await post(f, `/recommendations/${x.proposal.id}/reviews`, base).expect(
      422,
    );
    await post(f, `/recommendations/${x.proposal.id}/reviews`, {
      ...base,
      acceptance: {
        ...v.acceptanceChallenge,
        acceptPolicy: false,
        acceptEvidence: true,
      },
    }).expect(400);
    await post(f, `/recommendations/${x.proposal.id}/reviews`, {
      ...base,
      acceptance: {
        ...v.acceptanceChallenge,
        authorizationKey: 'a'.repeat(64),
        acceptPolicy: true,
        acceptEvidence: true,
      },
    }).expect(422);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: x.proposal.id },
      }),
    ).toBe(0);
  });
  it('rejects explicitly without approval, and never enables rejected application', async () => {
    const f = await fixture(),
      x = await saved(f),
      v = (await post(f, `/recommendations/${x.proposal.id}/inspection`, {}))
        .body;
    const review = await post(f, `/recommendations/${x.proposal.id}/reviews`, {
      intentId: randomUUID(),
      action: 'REJECT',
      expectedStatus: 'PENDING',
      expectedVersion: null,
      expectedSemanticKey: x.preview.semanticKey,
      expectedCycleKey: v.cycle.key,
      expectedDependencyKeys: x.preview.dependencyKeys,
      justification: 'No corresponde a mi siguiente entrenamiento.',
    }).expect(201);
    expect(review.body.status).toBe('REJECTED');
    const readiness = await post(
      f,
      `/recommendations/${x.proposal.id}/application-readiness`,
      { intentId: randomUUID(), activityId: f.activity.id },
    ).expect(200);
    expect(readiness.body.eligible).toBe(false);
  });
  it('isolates private proposals, requests, receipts, plans and exercises', async () => {
    const f = await fixture(),
      g = await fixture(),
      x = await saved(f);
    for (const suffix of ['', '/request', '/application'])
      await get(g, `/recommendations/${x.proposal.id}${suffix}`).expect(404);
    await post(g, `/recommendations/${x.proposal.id}/inspection`, {}).expect(
      404,
    );
    await post(g, '/preview', f.command).expect(404);
    await db.exercise.update({
      where: { id: f.e.id },
      data: { origin: 'PERSONAL', ownerId: f.identity.account.id },
    });
    await post(g, '/preview', {
      ...g.command,
      history: { ...g.command.history, exerciseId: f.e.id },
    }).expect(404);
  });
  it('keeps missing policy/configuration and insufficient data explicit', async () => {
    const f = await fixture();
    const noPolicy = await post(f, '/preview', {
      ...f.command,
      policy: undefined,
    }).expect(200);
    expect(noPolicy.body.decision).toBe('CONFIGURATION_REQUIRED');
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    const required = await post(f, '/context', f.command).expect(200);
    expect(required.body.configuration.status).toBe('CONFIGURATION_REQUIRED');
    expect(
      (await post(f, '/preview', f.command).expect(200)).body.decision,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('rejects modified loads, other destinations, stale versions and intent reuse authoritatively', async () => {
    const f = await fixture(),
      x = await ready(f),
      url = `/recommendations/${x.proposal.id}/application`;
    await post(f, url, { ...x.command, appliedLoad: '85' }).expect(422);
    await post(f, url, {
      ...x.command,
      destination: { ...x.command.destination, prescriptionId: randomUUID() },
    }).expect(422);
    await post(f, url, x.command).expect(201);
    await post(f, url, { ...x.command, appliedLoad: '85' }).expect(409);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: x.proposal.id },
      }),
    ).toBe(1);
  });
  it('validates the complete HTTP/PostgreSQL flow using the real frontend Axios service and Zod contracts', async () => {
    const f = await fixture();
    await new Promise<void>((ok, fail) => {
      const child = execFile(
        process.execPath,
        [
          '--experimental-strip-types',
          '--experimental-loader',
          './tests/typescript-loader.mjs',
          'tests/progression.http.mjs',
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
          command: f.command,
          activityId: f.activity.id,
        }),
      );
    });
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('82.500');
  });
  it('rolls back proposal, evidence and recipe together if recording replay parameters fails', async () => {
    const f = await fixture(),
      preview = (await post(f, '/preview', f.command).expect(200)).body;
    await db.$executeRawUnsafe(
      "CREATE FUNCTION prog6a_test_reject_recipe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only recording failure'; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER prog6a_test_reject_recipe BEFORE INSERT ON progression_revalidation_requests FOR EACH ROW EXECUTE FUNCTION prog6a_test_reject_recipe()',
    );
    try {
      const response = await post(f, '/recommendations', {
        command: f.command,
        expectedSemanticKey: preview.semanticKey,
        expectedDependencyKeys: preview.dependencyKeys,
      }).expect(500);
      expect(response.body).toEqual({
        code: 'INTERNAL_ERROR',
        reasons: [],
        message: 'No se pudo completar la operación.',
      });
      expect(
        await db.progressionRecommendation.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
      expect(
        await db.recommendationEvidence.count({
          where: { session: { athleteId: f.athleteId } },
        }),
      ).toBe(0);
      expect(
        (
          await db.planExercise.findUniqueOrThrow({
            where: { id: f.target.p.id },
          })
        ).targetLoad!.toFixed(3),
      ).toBe('80.000');
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER prog6a_test_reject_recipe ON progression_revalidation_requests',
      );
      await db.$executeRawUnsafe('DROP FUNCTION prog6a_test_reject_recipe()');
    }
  });
  it('recovers a discarded approval response with the same intention and one audit event', async () => {
    const f = await fixture(),
      x = await saved(f),
      v = (
        await post(
          f,
          `/recommendations/${x.proposal.id}/inspection`,
          {},
        ).expect(200)
      ).body,
      input = {
        intentId: randomUUID(),
        action: 'APPROVE',
        expectedStatus: 'PENDING',
        expectedVersion: null,
        expectedSemanticKey: x.preview.semanticKey,
        expectedCycleKey: v.cycle.key,
        expectedDependencyKeys: x.preview.dependencyKeys,
        acceptance: {
          ...v.acceptanceChallenge,
          acceptPolicy: true,
          acceptEvidence: true,
        },
      },
      path = `/recommendations/${x.proposal.id}/reviews`;
    const first = await post(f, path, input).expect(201),
      retry = await post(f, path, input).expect(201);
    expect(retry.body).toEqual(first.body);
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: x.proposal.id },
      }),
    ).toBe(1);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: x.proposal.id },
      }),
    ).toBe(0);
  });
});
