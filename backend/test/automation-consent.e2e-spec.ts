import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/database/prisma.service';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { plannedReviewTarget } from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-5C-A pending bounded automation consent PostgreSQL', () => {
  let db: PrismaService,
    otherDb: PrismaService,
    svc: AutomationConsentService,
    other: AutomationConsentService,
    close: () => Promise<void>;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    otherDb = new PrismaService();
    await db.$connect();
    await otherDb.$connect();
    const m = await Test.createTestingModule({ imports: [ProgressionModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    await m.init();
    svc = m.get(AutomationConsentService);
    other = new AutomationConsentService(
      new PrismaProgressionRepository(otherDb),
    );
    close = () => m.close();
  });
  afterAll(async () => {
    await close?.();
    await db?.$disconnect();
    await otherDb?.$disconnect();
  });
  type F = Awaited<ReturnType<typeof automationConsentFixture>>;
  const request = (f: F, intentId = randomUUID()) => ({
    intentId,
    contract: f.contract,
  });
  async function invariant() {
    const result: Record<string, string> = {};
    for (const table of [
      'users',
      'athletes',
      'auth_sessions',
      'exercises',
      'training_plans',
      'plan_weeks',
      'plan_days',
      'plan_exercises',
      'scheduled_activities',
      'workout_sessions',
      'workout_exercises',
      'set_records',
      'one_rm_estimates',
      'progression_settings',
      'progression_recommendations',
      'recommendation_evidence',
      'recommendation_reviews',
      'progression_applications',
    ])
      result[table] = (
        await db.$queryRawUnsafe<{ hash: string }[]>(
          `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
        )
      )[0].hash;
    return result;
  }
  it('requests/inspects a real pending contract without acceptance or any training writes', async () => {
    const f = await automationConsentFixture(db),
      before = await invariant(),
      op = request(f),
      r = await svc.requestMyAutomationConsent(f.identity, op),
      v = await svc.inspectMyAutomationConsent(f.identity, r.consentId);
    expect(r).toMatchObject({
      action: 'CREATE',
      version: 1,
      state: 'PENDING_CONFIRMATION',
      fromVersion: null,
      snapshot: {
        humanAcceptance: 'NOT_RECORDED',
        operationalAuthorization: 'NOT_AVAILABLE_IN_PROG_5C_A',
      },
    });
    expect(r.snapshot.contract).toMatchObject({
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    });
    expect(v).toMatchObject({
      state: 'PENDING_CONFIRMATION',
      version: 1,
      effectiveState: 'PENDING_CONFIRMATION',
      currentConfiguration: 'MATCH',
      executionAuthorized: false,
      acceptanceChallenge: { humanAcceptance: 'NOT_RECORDED' },
    });
    expect(v.events).toEqual([r]);
    expect(await invariant()).toEqual(before);
  });
  it('returns immutable original receipts after revisions, revocation and response loss', async () => {
    const f = await automationConsentFixture(db),
      before = await invariant(),
      op = request(f),
      first = await svc.requestMyAutomationConsent(f.identity, op),
      rev = {
        consentId: first.consentId,
        intentId: randomUUID(),
        expectedVersion: 1,
        contract: {
          ...f.contract,
          limits: { ...f.contract.limits, maximumLoad: '190' },
        },
      },
      second = await svc.reviseMyAutomationConsent(f.identity, rev),
      revoke = {
        consentId: first.consentId,
        intentId: randomUUID(),
        expectedVersion: 2,
        reason: 'OWNER_REQUEST' as const,
      },
      last = await svc.revokeMyAutomationConsent(f.identity, revoke);
    expect(last).toMatchObject({ version: 3, state: 'REVOKED' });
    expect(await svc.requestMyAutomationConsent(f.identity, op)).toEqual(first);
    expect(await svc.reviseMyAutomationConsent(f.identity, rev)).toEqual(
      second,
    );
    expect(await svc.revokeMyAutomationConsent(f.identity, revoke)).toEqual(
      last,
    );
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, first.consentId))
        .events,
    ).toEqual([first, second, last]);
    expect(await invariant()).toEqual(before);
  });
  it.each(['differentContent', 'differentAction'] as const)(
    'rejects an intent reused with %s',
    async (kind) => {
      const f = await automationConsentFixture(db),
        op = request(f),
        r = await svc.requestMyAutomationConsent(f.identity, op);
      await expect(
        kind === 'differentContent'
          ? svc.requestMyAutomationConsent(f.identity, {
              ...op,
              contract: { ...f.contract, termsVersion: 'other' },
            })
          : svc.revokeMyAutomationConsent(f.identity, {
              intentId: op.intentId,
              consentId: r.consentId,
              expectedVersion: 1,
              reason: 'OWNER_REQUEST',
            }),
      ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
    },
  );
  it('coalesces identical simultaneous requests from separate connections', async () => {
    const f = await automationConsentFixture(db),
      op = request(f),
      r = await Promise.all([
        svc.requestMyAutomationConsent(f.identity, op),
        other.requestMyAutomationConsent(f.identity, op),
      ]);
    expect(r[0]).toEqual(r[1]);
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(1);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(1);
  });
  it('rejects competing overlapping requests, including null-plan vs plan-specific scope', async () => {
    const f = await automationConsentFixture(db),
      op = request(f),
      r = await Promise.allSettled([
        svc.requestMyAutomationConsent(f.identity, op),
        other.requestMyAutomationConsent(f.identity, {
          ...request(f),
          contract: { ...f.contract, trainingPlanId: null },
        }),
      ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { code: 'AMBIGUOUS_AUTOMATION_CONSENT' },
    });
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(1);
  });
  it('permits adjacent half-open periods and disjoint explicit destinations', async () => {
    const f = await automationConsentFixture(db),
      a = await svc.requestMyAutomationConsent(f.identity, request(f)),
      adjacent = {
        ...f.contract,
        validity: {
          ...f.contract.validity,
          startsAt: f.contract.validity.endsAt,
          endsAt: new Date(
            Date.parse(f.contract.validity.endsAt) + 86400000,
          ).toISOString(),
        },
      };
    expect(
      (
        await svc.requestMyAutomationConsent(f.identity, {
          intentId: randomUUID(),
          contract: adjacent,
        })
      ).consentId,
    ).not.toBe(a.consentId);
    const target = await plannedReviewTarget(db, f),
      disjoint = {
        ...f.contract,
        trainingPlanId: target.plan.id,
        selector: { ...f.contract.selector, prescriptionIds: [target.p.id] },
      };
    expect(
      (
        await svc.requestMyAutomationConsent(f.identity, {
          intentId: randomUUID(),
          contract: disjoint,
        })
      ).state,
    ).toBe('PENDING_CONFIRMATION');
  });
  it('revocation is terminal; a fresh request is explicit and never inherits acceptance', async () => {
    const f = await automationConsentFixture(db),
      r = await svc.requestMyAutomationConsent(f.identity, request(f));
    await svc.revokeMyAutomationConsent(f.identity, {
      consentId: r.consentId,
      intentId: randomUUID(),
      expectedVersion: 1,
      reason: 'OWNER_REQUEST',
    });
    await expect(
      svc.reviseMyAutomationConsent(f.identity, {
        consentId: r.consentId,
        intentId: randomUUID(),
        expectedVersion: 2,
        contract: f.contract,
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(
      (await svc.requestMyAutomationConsent(f.identity, request(f))).snapshot
        .humanAcceptance,
    ).toBe('NOT_RECORDED');
  });
  it.each(['inspect', 'revise', 'revoke'] as const)(
    'isolates another athlete on %s',
    async (action) => {
      const f = await automationConsentFixture(db),
        g = await automationConsentFixture(db),
        r = await svc.requestMyAutomationConsent(f.identity, request(f));
      await expect(
        action === 'inspect'
          ? svc.inspectMyAutomationConsent(g.identity, r.consentId)
          : action === 'revise'
            ? svc.reviseMyAutomationConsent(g.identity, {
                consentId: r.consentId,
                intentId: randomUUID(),
                expectedVersion: 1,
                contract: g.contract,
              })
            : svc.revokeMyAutomationConsent(g.identity, {
                consentId: r.consentId,
                intentId: randomUUID(),
                expectedVersion: 1,
                reason: 'OWNER_REQUEST',
              }),
      ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    },
  );
  it.each(['revoked', 'expired', 'inactive', 'fake'] as const)(
    'requires a current real actor session: %s',
    async (kind) => {
      const f = await automationConsentFixture(db);
      if (kind === 'revoked')
        await db.authSession.update({
          where: { id: f.identity.sessionId },
          data: { revokedAt: new Date() },
        });
      if (kind === 'expired')
        await db.$executeRaw`UPDATE auth_sessions SET created_at='2019-01-01Z'::timestamptz,last_used_at='2019-01-01Z'::timestamptz,expires_at='2020-01-01Z'::timestamptz WHERE id=${f.identity.sessionId}::uuid`;
      if (kind === 'inactive')
        await db.user.update({
          where: { id: f.identity.account.id },
          data: { status: 'SUSPENDED' },
        });
      if (kind === 'fake') f.identity.sessionId = randomUUID();
      await expect(
        svc.requestMyAutomationConsent(f.identity, request(f)),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      expect(
        await db.progressionAutomationConsent.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
    },
  );
  it.each([
    'foreignPlan',
    'foreignExercise',
    'wrongExercise',
    'wrongUnit',
    'activePlan',
    'retiredDay',
    'historical',
    'missingPolicy',
    'missingSetting',
  ] as const)('rejects non-authorizable %s', async (kind) => {
    const f = await automationConsentFixture(db),
      g = await automationConsentFixture(db);
    let c = f.contract;
    if (kind === 'foreignPlan') c = { ...c, trainingPlanId: g.target.plan.id };
    if (kind === 'foreignExercise') {
      await db.exercise.update({
        where: { id: g.e.id },
        data: { origin: 'PERSONAL', ownerId: g.identity.account.id },
      });
      c = { ...c, exerciseId: g.e.id };
    }
    if (kind === 'wrongExercise')
      await db.planExercise.update({
        where: { id: f.target.p.id },
        data: { exerciseId: g.e.id },
      });
    if (kind === 'wrongUnit')
      await db.planExercise.update({
        where: { id: f.target.p.id },
        data: { targetLoadUnit: 'LB' },
      });
    if (kind === 'activePlan')
      await db.trainingPlan.update({
        where: { id: f.target.plan.id },
        data: { status: 'ACTIVE' },
      });
    if (kind === 'retiredDay')
      await db.planDay.update({
        where: { id: f.target.day.id },
        data: { retiredAt: new Date(), retiredFromOn: new Date('2026-01-01') },
      });
    if (kind === 'historical')
      await db.workoutExercise.update({
        where: { id: f.tasks[0].id },
        data: { planExerciseId: f.target.p.id },
      });
    if (kind === 'missingPolicy') c = { ...c, policy: undefined as any };
    if (kind === 'missingSetting')
      await db.progressionSetting.delete({ where: { id: f.setting.id } });
    await expect(
      svc.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: c,
      }),
    ).rejects.toBeDefined();
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it('compares effective plan-specific bindings for every enumerated plan', async () => {
    const f = await automationConsentFixture(db),
      target = await plannedReviewTarget(db, f),
      c = {
        ...f.contract,
        trainingPlanId: null,
        selector: {
          ...f.contract.selector,
          prescriptionIds: [f.target.p.id, target.p.id],
        },
      };
    const r = await svc.requestMyAutomationConsent(f.identity, {
      intentId: randomUUID(),
      contract: c,
    });
    expect(r.snapshot.bindings).toHaveLength(2);
    await db.progressionSetting.create({
      data: {
        athleteId: f.athleteId,
        exerciseId: f.e.id,
        trainingPlanId: target.plan.id,
        minSuccessfulSessions: 2,
        targetRpeMin: 6,
        targetRpeMax: 8,
        incrementAbsolute: '5',
        maxIncrementPercent: '10',
      },
    });
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, r.consentId))
        .currentConfiguration,
    ).toBe('CHANGED');
  });
  it('does not reinterpret the legacy preference, and ignores informational changes only', async () => {
    const f = await automationConsentFixture(db);
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { autoApplyAuthorized: true },
    });
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
    const r = await svc.requestMyAutomationConsent(f.identity, request(f));
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { autoApplyAuthorized: false },
    });
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, r.consentId))
        .currentConfiguration,
    ).toBe('MATCH');
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5' },
    });
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, r.consentId))
        .currentConfiguration,
    ).toBe('CHANGED');
  });
  it('permits only one CAS revision/revocation and preserves its exact audit', async () => {
    const f = await automationConsentFixture(db),
      r = await svc.requestMyAutomationConsent(f.identity, request(f)),
      results = await Promise.allSettled([
        svc.reviseMyAutomationConsent(f.identity, {
          intentId: randomUUID(),
          consentId: r.consentId,
          expectedVersion: 1,
          contract: { ...f.contract, termsVersion: 'revision-2' },
        }),
        other.revokeMyAutomationConsent(f.identity, {
          intentId: randomUUID(),
          consentId: r.consentId,
          expectedVersion: 1,
          reason: 'OWNER_REQUEST',
        }),
      ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const v = await svc.inspectMyAutomationConsent(f.identity, r.consentId);
    expect(v.version).toBe(2);
    expect(v.events).toHaveLength(2);
  });
  it.each(['head', 'event'] as const)(
    'rolls back a failed %s write and permits recovery',
    async (where) => {
      const f = await automationConsentFixture(db),
        op = request(f),
        failing = db.$extends({
          query: {
            $allModels: {
              async $allOperations({ model, operation, args, query }) {
                if (
                  operation === 'create' &&
                  model ===
                    (where === 'head'
                      ? 'ProgressionAutomationConsent'
                      : 'ProgressionAutomationConsentEvent')
                )
                  throw Error('Injected consent write');
                return query(args);
              },
            },
          },
        }),
        broken = new AutomationConsentService(
          new PrismaProgressionRepository(failing as unknown as PrismaService),
        );
      await expect(
        broken.requestMyAutomationConsent(f.identity, op),
      ).rejects.toThrow('Injected');
      expect(
        await db.progressionAutomationConsent.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
      expect(
        (await svc.requestMyAutomationConsent(f.identity, op)).version,
      ).toBe(1);
    },
  );
  it('enforces immutable events, terminal history and paired transitions at COMMIT', async () => {
    const f = await automationConsentFixture(db),
      r = await svc.requestMyAutomationConsent(f.identity, request(f));
    await expect(
      db.progressionAutomationConsentEvent.update({
        where: { id: r.id },
        data: { reason: 'rewrite' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionAutomationConsentEvent.delete({ where: { id: r.id } }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionAutomationConsent.delete({ where: { id: r.consentId } }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionAutomationConsent.update({
        where: { id: r.consentId },
        data: { state: 'ACTIVE' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionAutomationConsent.update({
        where: { id: r.consentId },
        data: { version: 2 },
      }),
    ).rejects.toBeDefined();
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, r.consentId)).version,
    ).toBe(1);
  });
  it('SQL rejects a transaction that omits the CREATE event even if an extra version follows', async () => {
    const f = await automationConsentFixture(db),
      failing = db.$extends({
        query: {
          progressionAutomationConsentEvent: {
            async create({ args }) {
              return { ...args.data, id: randomUUID() };
            },
          },
        },
      }),
      broken = new AutomationConsentService(
        new PrismaProgressionRepository(failing as unknown as PrismaService),
      );
    await expect(
      broken.requestMyAutomationConsent(f.identity, request(f)),
    ).rejects.toBeDefined();
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it('bounds lock contention without partial writes, then recovers', async () => {
    const f = await automationConsentFixture(db);
    let ready!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (ready = r)),
      gate = new Promise<void>((r) => (release = r)),
      held = otherDb.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM athletes WHERE id=${f.athleteId}::uuid FOR UPDATE`;
          ready();
          await gate;
        },
        { timeout: 15000 },
      );
    await entered;
    try {
      await expect(
        svc.requestMyAutomationConsent(f.identity, request(f)),
      ).rejects.toMatchObject({ code: 'SOURCE_BUSY' });
    } finally {
      release();
      await held;
    }
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
    expect(
      (await svc.requestMyAutomationConsent(f.identity, request(f))).version,
    ).toBe(1);
  });
  it('sees revocation committed between initial identity lookup and owner fences', async () => {
    const f = await automationConsentFixture(db);
    let once = true;
    const observed = db.$extends({
        query: {
          $allOperations: async ({ args, operation, query }) => {
            const result = await query(args);
            if (once && operation === '$queryRaw') {
              once = false;
              await otherDb.authSession.update({
                where: { id: f.identity.sessionId },
                data: { revokedAt: new Date() },
              });
            }
            return result;
          },
        },
      }),
      racing = new AutomationConsentService(
        new PrismaProgressionRepository(observed as unknown as PrismaService),
      );
    await expect(
      racing.requestMyAutomationConsent(f.identity, request(f)),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it.each(['revoke', 'revise'] as const)(
    'rolls back a missing audit during %s and preserves previous version',
    async (kind) => {
      const f = await automationConsentFixture(db),
        first = await svc.requestMyAutomationConsent(f.identity, request(f));
      const missing = db.$extends({
          query: {
            progressionAutomationConsentEvent: {
              async create({ args }) {
                return { ...args.data, id: randomUUID() };
              },
            },
          },
        }),
        broken = new AutomationConsentService(
          new PrismaProgressionRepository(missing as unknown as PrismaService),
        );
      await expect(
        kind === 'revoke'
          ? broken.revokeMyAutomationConsent(f.identity, {
              consentId: first.consentId,
              intentId: randomUUID(),
              expectedVersion: 1,
              reason: 'OWNER_REQUEST',
            })
          : broken.reviseMyAutomationConsent(f.identity, {
              consentId: first.consentId,
              intentId: randomUUID(),
              expectedVersion: 1,
              contract: { ...f.contract, termsVersion: 'second' },
            }),
      ).rejects.toBeDefined();
      const view = await svc.inspectMyAutomationConsent(
        f.identity,
        first.consentId,
      );
      expect(view.version).toBe(1);
      expect(view.state).toBe('PENDING_CONFIRMATION');
      expect(view.events).toEqual([first]);
    },
  );
  it.each([
    'missingLimits',
    'zeroLimit',
    'foreignOwner',
    'falseAcceptance',
    'unknownUnit',
    'missingDestination',
    'wrongHierarchy',
    'wrongOrigin',
  ] as const)(
    'SQL rejects a fabricated %s snapshot and rolls back',
    async (kind) => {
      const f = await automationConsentFixture(db),
        g = await automationConsentFixture(db);
      const tampered = db.$extends({
          query: {
            progressionAutomationConsent: {
              async create({ args, query }) {
                const snap = args.data.snapshot as any;
                if (kind === 'missingLimits') delete snap.contract.limits;
                if (kind === 'zeroLimit')
                  snap.contract.limits.maximumLoad = '0';
                if (kind === 'foreignOwner')
                  args.data.actorUserId = g.identity.account.id;
                if (kind === 'falseAcceptance')
                  snap.humanAcceptance = 'ACCEPTED';
                if (kind === 'unknownUnit') snap.contract.limits.unit = null;
                if (kind === 'missingDestination') snap.destinations = [];
                if (kind === 'wrongHierarchy')
                  snap.destinations[0].weekId = randomUUID();
                if (kind === 'wrongOrigin')
                  snap.contract.provenance.source = 'HUMAN_CONFIRMED';
                return query(args);
              },
            },
          },
        }),
        broken = new AutomationConsentService(
          new PrismaProgressionRepository(tampered as unknown as PrismaService),
        );
      await expect(
        broken.requestMyAutomationConsent(f.identity, request(f)),
      ).rejects.toBeDefined();
      expect(
        await db.progressionAutomationConsent.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
    },
  );
  it('requires the CREATE audit even when a later version is inserted in the same transaction', async () => {
    const f = await automationConsentFixture(db),
      initial = await svc.requestMyAutomationConsent(f.identity, request(f));
    await svc.revokeMyAutomationConsent(f.identity, {
      consentId: initial.consentId,
      intentId: randomUUID(),
      expectedVersion: 1,
      reason: 'OWNER_REQUEST',
    });
    const head = await db.progressionAutomationConsent.findUniqueOrThrow({
        where: { id: initial.consentId },
      }),
      id = randomUUID();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const [time] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
        const { id: _id, ...copy } = head;
        await tx.progressionAutomationConsent.create({
          data: {
            ...copy,
            id,
            state: 'PENDING_CONFIRMATION',
            version: 1,
            revokedAt: null,
            createdAt: time.now,
            updatedAt: time.now,
            snapshot: head.snapshot as any,
          },
        });
        await tx.progressionAutomationConsent.update({
          where: { id },
          data: { version: 2 },
        });
        await tx.progressionAutomationConsentEvent.create({
          data: {
            consentId: id,
            athleteId: f.athleteId,
            actorUserId: f.identity.account.id,
            action: 'REVISE',
            intentId: randomUUID(),
            requestKey: 'a'.repeat(64),
            fromVersion: 1,
            version: 2,
            fromState: 'PENDING_CONFIRMATION',
            state: 'PENDING_CONFIRMATION',
            contractKey: head.contractKey,
            snapshot: head.snapshot as any,
            recordedAt: time.now,
          },
        });
      }),
    ).rejects.toBeDefined();
    expect(await db.progressionAutomationConsent.count({ where: { id } })).toBe(
      0,
    );
  });
  it('UTC remains local to consent transactions on a non-UTC connection', async () => {
    const f = await automationConsentFixture(db),
      r = await svc.requestMyAutomationConsent(f.identity, request(f)),
      physical = await db.$queryRaw<
        { utc: string }[]
      >`SELECT to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc FROM progression_automation_consent_events WHERE id=${r.id}::uuid`;
    expect(physical[0].utc).toBe(r.recordedAt.toISOString());
    expect(
      (await svc.inspectMyAutomationConsent(f.identity, r.consentId)).events[0]
        .recordedAt,
    ).toEqual(r.recordedAt);
  });
  it('sees an existing free session attached before destination fences and rejects the request', async () => {
    const f = await automationConsentFixture(db),
      free = await db.workoutSession.create({
        data: { athleteId: f.athleteId, status: 'PLANNED' },
      });
    let once = true;
    const raced = db.$extends({
        query: {
          planExercise: {
            async findMany({ args, query }) {
              const result = await query(args);
              if (once) {
                once = false;
                await otherDb.workoutSession.update({
                  where: { id: free.id },
                  data: {
                    trainingPlanId: f.target.plan.id,
                    planWeekId: f.target.week.id,
                    planDayId: f.target.day.id,
                  },
                });
              }
              return result;
            },
          },
        },
      }),
      service = new AutomationConsentService(
        new PrismaProgressionRepository(raced as unknown as PrismaService),
      );
    await expect(
      service.requestMyAutomationConsent(f.identity, request(f)),
    ).rejects.toMatchObject({
      code: 'CONSENT_CONFIGURATION_REQUIRED',
      reasons: expect.arrayContaining(['DESTINATION_NOT_AUTHORIZABLE']),
    });
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it('destination UPDATE fences block FK attachment after the definitive resource read', async () => {
    const f = await automationConsentFixture(db),
      free = await db.workoutSession.create({
        data: { athleteId: f.athleteId, status: 'PLANNED' },
      });
    let count = 0;
    const raced = db.$extends({
        query: {
          planExercise: {
            async findMany({ args, query }) {
              const result = await query(args);
              if (++count === 2) {
                await expect(
                  otherDb.$transaction(async (tx) => {
                    await tx.$executeRaw`SET LOCAL lock_timeout='50ms'`;
                    await tx.$executeRaw`UPDATE workout_sessions SET training_plan_id=${f.target.plan.id}::uuid,plan_week_id=${f.target.week.id}::uuid,plan_day_id=${f.target.day.id}::uuid WHERE id=${free.id}::uuid`;
                  }),
                ).rejects.toBeDefined();
              }
              return result;
            },
          },
        },
      }),
      service = new AutomationConsentService(
        new PrismaProgressionRepository(raced as unknown as PrismaService),
      );
    expect(
      (await service.requestMyAutomationConsent(f.identity, request(f))).state,
    ).toBe('PENDING_CONFIRMATION');
    expect(
      (await db.workoutSession.findUniqueOrThrow({ where: { id: free.id } }))
        .trainingPlanId,
    ).toBeNull();
    expect(count).toBe(2);
  });
  it('preserves UTC instants and restores an explicit Bogota connection default after commit and rollback', async () => {
    const f = await automationConsentFixture(db),
      client = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: process.env.PROG1B_TEST_DATABASE_URL,
          options: '-c TimeZone=America/Bogota',
          max: 1,
        }),
      }),
      service = new AutomationConsentService(
        new PrismaProgressionRepository(client as unknown as PrismaService),
      );
    try {
      const first = await service.requestMyAutomationConsent(
        f.identity,
        request(f),
      );
      const [physical] = await db.$queryRaw<
        { utc: string }[]
      >`SELECT to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc FROM progression_automation_consent_events WHERE id=${first.id}::uuid`;
      expect(physical.utc).toBe(first.recordedAt.toISOString());
      await expect(
        service.requestMyAutomationConsent(f.identity, request(f)),
      ).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTOMATION_CONSENT' });
      expect(
        (await client.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`)[0]
          .TimeZone,
      ).toBe('America/Bogota');
      expect(
        (await service.inspectMyAutomationConsent(f.identity, first.consentId))
          .events[0],
      ).toEqual(first);
    } finally {
      await client.$disconnect();
    }
  });
  it('SQL itself rejects a duplicated destination even when selector counts match', async () => {
    const f = await automationConsentFixture(db),
      target = await plannedReviewTarget(db, f),
      c = {
        ...f.contract,
        trainingPlanId: null,
        selector: {
          ...f.contract.selector,
          prescriptionIds: [f.target.p.id, target.p.id],
        },
      };
    let databaseRejected = false;
    const tampered = db.$extends({
        query: {
          progressionAutomationConsent: {
            async create({ args, query }) {
              const capture = args.data.snapshot as any;
              capture.destinations[1] = structuredClone(
                capture.destinations[0],
              );
              try {
                return await query(args);
              } catch (error) {
                databaseRejected = true;
                throw error;
              }
            },
          },
        },
      }),
      service = new AutomationConsentService(
        new PrismaProgressionRepository(tampered as unknown as PrismaService),
      );
    await expect(
      service.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: c,
      }),
    ).rejects.toBeDefined();
    expect(databaseRejected).toBe(true);
    expect(
      await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  it.each(['RepeatableRead', 'Serializable'] as const)(
    'SQL rejects %s consent writes that could reuse a pre-fence snapshot',
    async (isolation) => {
      const f = await automationConsentFixture(db),
        r = await svc.requestMyAutomationConsent(f.identity, request(f)),
        head = await db.progressionAutomationConsent.findUniqueOrThrow({
          where: { id: r.consentId },
        });
      await expect(
        db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
            await tx.progressionAutomationConsent.create({
              data: {
                ...head,
                id: randomUUID(),
                snapshot: head.snapshot as any,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel[isolation] },
        ),
      ).rejects.toThrow('Consent writes require READ COMMITTED owner fences');
    },
  );
});
