import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { RecommendationService } from '../src/progression/recommendation.service';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { settingParameters } from '../src/domain/progression/progression-settings.policy';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { ProgressionSettingsService } from '../src/progression/progression-settings.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
const parameters = () => ({
  minSuccessfulSessions: 3,
  targetRpeMin: '6',
  targetRpeMax: '8',
  incrementPercent: null,
  incrementAbsolute: '2.5',
  maxIncrementPercent: '5',
  maxLoad: null,
});
isolated('SETTINGS-1 PostgreSQL settings management', () => {
  let db: PrismaService, service: ProgressionSettingsService;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    await db.$connect();
    service = new ProgressionSettingsService(
      new PrismaProgressionRepository(db),
    );
  });
  afterAll(() => db?.$disconnect());
  async function fixture() {
    const f = await automationConsentFixture(db);
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    return f;
  }
  it('creates all three scopes and replaces the full row without changing precedence', async () => {
    const f = await fixture();
    const a = await service.create(f.identity, {
      intentId: randomUUID(),
      scope: { exerciseId: null, trainingPlanId: null },
      parameters: parameters(),
    });
    let effective = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    });
    expect(effective.scope).toBe('ATHLETE');
    expect(effective.selected!.id).toBe(a.settingId);
    expect(effective.externalRequirements).toContain(
      'POLICY_PROVENANCE_REQUIRED',
    );
    const b = await service.create(f.identity, {
      intentId: randomUUID(),
      scope: { exerciseId: f.e.id, trainingPlanId: null },
      parameters: { ...parameters(), maxLoad: '190' },
    });
    effective = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    });
    expect(effective.scope).toBe('EXERCISE');
    expect(effective.selected!.id).toBe(b.settingId);
    const c = await service.create(f.identity, {
      intentId: randomUUID(),
      scope: { exerciseId: f.e.id, trainingPlanId: f.target.plan.id },
      parameters: { ...parameters(), incrementAbsolute: '1.25' },
    });
    effective = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    });
    expect(effective.scope).toBe('EXERCISE_PLAN');
    expect(effective.selected!.maxLoad).toBeNull();
    expect(effective.selected!.incrementAbsolute).toBe('1.250');
    const updated = await service.replace(f.identity, c.settingId, {
      intentId: randomUUID(),
      expectedRevision: c.revision,
      parameters: { ...parameters(), incrementAbsolute: '1.500' },
      confirmImpact: true,
    });
    expect(updated.revision).not.toBe(c.revision);
    expect(updated.effective!.selected!.incrementAbsolute).toBe('1.500');
    expect((await service.list(f.identity, { page: 1, limit: 20 })).total).toBe(
      3,
    );
  });
  const general = { exerciseId: null, trainingPlanId: null };
  const create = (f: Awaited<ReturnType<typeof fixture>>, scope = general) =>
    service.create(f.identity, {
      intentId: randomUUID(),
      scope,
      parameters: parameters(),
    });
  it('distinguishes missing rows from missing external policy and requires actual plan/exercise relation', async () => {
    const f = await fixture();
    let r = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: null,
    });
    expect(r.selected).toBeNull();
    expect(r.settingReasons).toContain('SETTING_REQUIRED');
    expect(r.externalRequirements).toContain('POLICY_PROVENANCE_REQUIRED');
    await create(f);
    r = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: null,
    });
    expect(r.selected).not.toBeNull();
    expect(r.settingReasons).not.toContain('SETTING_REQUIRED');
    expect(r.status).toBe('CONFIGURATION_REQUIRED');
  });
  it('does not fall back or merge a more-specific incomplete legacy row', async () => {
    const f = await fixture();
    await create(f);
    const legacy = await db.progressionSetting.create({
      data: {
        athleteId: f.athleteId,
        exerciseId: f.e.id,
        minSuccessfulSessions: 4,
        targetRpeMin: '0',
        targetRpeMax: '10',
        maxIncrementPercent: '0',
        incrementAbsolute: null,
        incrementPercent: null,
      },
    });
    const r = await service.effective(f.identity, {
      exerciseId: f.e.id,
      trainingPlanId: f.target.plan.id,
    });
    expect(r.scope).toBe('EXERCISE');
    expect(r.selected!.id).toBe(legacy.id);
    expect(r.selected!.incrementAbsolute).toBeNull();
    expect(r.status).toBe('CONFIGURATION_REQUIRED');
  });
  it('reuses the exact policy resolver for known units and incompatibility', async () => {
    const f = await fixture();
    const p = {
      minSuccessfulSessions: f.setting.minSuccessfulSessions,
      targetRpeMin: f.setting.targetRpeMin.toFixed(1),
      targetRpeMax: f.setting.targetRpeMax.toFixed(1),
      incrementAbsolute: f.setting.incrementAbsolute?.toFixed(3) ?? null,
      incrementPercent: f.setting.incrementPercent?.toFixed(3) ?? null,
      maxIncrementPercent: f.setting.maxIncrementPercent.toFixed(3),
      maxLoad: f.setting.maxLoad?.toFixed(3) ?? null,
    };
    await service.create(f.identity, {
      intentId: randomUUID(),
      scope: { exerciseId: f.e.id, trainingPlanId: null },
      parameters: p,
    });
    expect(
      (
        await service.effective(f.identity, {
          exerciseId: f.e.id,
          trainingPlanId: f.target.plan.id,
          policy: f.command.policy,
        })
      ).status,
    ).toBe('VALID');
    expect(
      (
        await service.effective(f.identity, {
          exerciseId: f.e.id,
          trainingPlanId: f.target.plan.id,
          policy: { ...f.command.policy!, settingLoadUnit: 'LB' },
        })
      ).reasons,
    ).toContain('UNIT_POLICY_MISMATCH');
  });
  it('rejects duplicate scope without changing the existing row', async () => {
    const f = await fixture(),
      a = await create(f);
    await expect(create(f)).rejects.toMatchObject({
      code: 'SETTING_SCOPE_EXISTS',
    });
    expect((await service.get(f.identity, a.settingId)).revision).toBe(
      a.revision,
    );
  });
  it('isolates list, row, mutation receipts and foreign plans/exercises', async () => {
    const f = await fixture(),
      g = await fixture(),
      a = await create(f);
    expect((await service.list(g.identity, { page: 1, limit: 20 })).total).toBe(
      0,
    );
    await expect(service.get(g.identity, a.settingId)).rejects.toMatchObject({
      code: 'SOURCE_NOT_FOUND',
    });
    await expect(
      service.operation(g.identity, a.intentId),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(
      service.create(f.identity, {
        intentId: randomUUID(),
        scope: { exerciseId: f.e.id, trainingPlanId: g.target.plan.id },
        parameters: parameters(),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await db.exercise.update({
      where: { id: g.e.id },
      data: { origin: 'PERSONAL', ownerId: g.identity.account.id },
    });
    await expect(
      service.create(f.identity, {
        intentId: randomUUID(),
        scope: { exerciseId: g.e.id, trainingPlanId: null },
        parameters: parameters(),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
  it('rejects a plan that does not actually contain the exercise', async () => {
    const f = await fixture(),
      plan = await db.trainingPlan.create({
        data: { athleteId: f.athleteId, name: 'Empty own plan' },
      });
    await expect(
      service.create(f.identity, {
        intentId: randomUUID(),
        scope: { exerciseId: f.e.id, trainingPlanId: plan.id },
        parameters: parameters(),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
  it('checks a revoked session and inactive account even for an idempotent replay', async () => {
    const f = await fixture(),
      input = {
        intentId: randomUUID(),
        scope: general,
        parameters: parameters(),
      };
    await service.create(f.identity, input);
    await db.authSession.update({
      where: { id: f.identity.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(service.create(f.identity, input)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    const g = await fixture();
    await db.user.update({
      where: { id: g.identity.account.id },
      data: { status: 'SUSPENDED' },
    });
    await expect(create(g)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });
  it.each([
    { incrementAbsolute: '0.0001' },
    { maxLoad: '100000' },
    { targetRpeMax: '10.1' },
    { incrementPercent: '6' },
    { minSuccessfulSessions: 0 },
  ])('rejects invalid values without any write %p', async (change) => {
    const f = await fixture();
    await expect(
      service.create(f.identity, {
        intentId: randomUUID(),
        scope: general,
        parameters: { ...parameters(), ...change },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    expect(
      await db.progressionSetting.count({ where: { athleteId: f.athleteId } }),
    ).toBe(0);
  });
  it('stores exact Decimal values including the allowed boundaries', async () => {
    const f = await fixture(),
      p = {
        ...parameters(),
        targetRpeMin: '0',
        targetRpeMax: '10',
        incrementAbsolute: '99999.999',
        maxIncrementPercent: '999.999',
        maxLoad: '99999.999',
      };
    const r = await service.create(f.identity, {
      intentId: randomUUID(),
      scope: general,
      parameters: p,
    });
    expect(r.result.incrementAbsolute).toBe('99999.999');
    expect(r.result.maxIncrementPercent).toBe('999.999');
    expect(
      (
        await db.progressionSetting.findUniqueOrThrow({
          where: { id: r.settingId },
        })
      ).maxLoad!.toFixed(3),
    ).toBe('99999.999');
  });
  it('rejects stale replacement and advances revision on a no-op', async () => {
    const f = await fixture(),
      a = await create(f),
      input = {
        intentId: randomUUID(),
        expectedRevision: a.revision,
        parameters: parameters(),
        confirmImpact: true,
      };
    const b = await service.replace(f.identity, a.settingId, input);
    expect(b.revision).not.toBe(a.revision);
    await expect(
      service.replace(f.identity, a.settingId, {
        ...input,
        intentId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'STALE_SETTING' });
    expect((await service.get(f.identity, a.settingId)).revision).toBe(
      b.revision,
    );
  });
  it('retains PostgreSQL microseconds in the opaque revision even when JS timestamps match', async () => {
    const f = await fixture(),
      a = await create(f);
    await db.$executeRaw`UPDATE progression_settings SET updated_at='2030-01-01T00:00:00.123456Z'::timestamptz WHERE id=${a.settingId}::uuid`;
    const first = await service.get(f.identity, a.settingId);
    await db.$executeRaw`UPDATE progression_settings SET updated_at='2030-01-01T00:00:00.123457Z'::timestamptz WHERE id=${a.settingId}::uuid`;
    const second = await service.get(f.identity, a.settingId);
    expect(first.updatedAt).toBe(second.updatedAt);
    expect(first.revision).not.toBe(second.revision);
  });
  it('serializes concurrent complete replacements with one winner', async () => {
    const f = await fixture(),
      a = await create(f);
    const result = await Promise.allSettled(
      ['1.25', '1.5'].map((v) =>
        service.replace(f.identity, a.settingId, {
          intentId: randomUUID(),
          expectedRevision: a.revision,
          parameters: { ...parameters(), incrementAbsolute: v },
          confirmImpact: true,
        }),
      ),
    );
    expect(result.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((v) => v.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_SETTING' },
    });
  });
  it('makes concurrent identical creations idempotent and preserves unique scope', async () => {
    const f = await fixture(),
      input = {
        intentId: randomUUID(),
        scope: general,
        parameters: parameters(),
      };
    const [a, b] = await Promise.all([
      service.create(f.identity, input),
      service.create(f.identity, input),
    ]);
    expect(a).toEqual(b);
    expect(
      await db.progressionSetting.count({ where: { athleteId: f.athleteId } }),
    ).toBe(1);
  });
  it('returns the original receipt without overwriting a later edit', async () => {
    const f = await fixture(),
      a = await create(f),
      input = {
        intentId: randomUUID(),
        expectedRevision: a.revision,
        parameters: { ...parameters(), incrementAbsolute: '1.25' },
        confirmImpact: true,
      },
      b = await service.replace(f.identity, a.settingId, input);
    const c = await service.replace(f.identity, a.settingId, {
      ...input,
      intentId: randomUUID(),
      expectedRevision: b.revision,
      parameters: { ...parameters(), incrementAbsolute: '1.5' },
    });
    expect(await service.replace(f.identity, a.settingId, input)).toEqual(b);
    expect((await service.get(f.identity, a.settingId)).revision).toBe(
      c.revision,
    );
    await expect(
      service.replace(f.identity, a.settingId, {
        ...input,
        parameters: parameters(),
      }),
    ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
  });
  it('preserves historical autoApplyAuthorized and refuses scope or authority fields', async () => {
    const f = await fixture(),
      a = await create(f);
    await db.progressionSetting.update({
      where: { id: a.settingId },
      data: { autoApplyAuthorized: true },
    });
    const r = await service.get(f.identity, a.settingId);
    const b = await service.replace(f.identity, a.settingId, {
      intentId: randomUUID(),
      expectedRevision: r.revision,
      parameters: parameters(),
      confirmImpact: true,
    });
    expect(b.result.autoApplyAuthorized).toBe(true);
    await expect(
      service.replace(f.identity, a.settingId, {
        intentId: randomUUID(),
        expectedRevision: b.revision,
        parameters: parameters(),
        confirmImpact: true,
        scope: general,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTING' });
  });
  it('rejects retirement of the selected exercise before replacement', async () => {
    const f = await fixture(),
      a = await service.create(f.identity, {
        intentId: randomUUID(),
        scope: { exerciseId: f.e.id, trainingPlanId: null },
        parameters: parameters(),
      });
    await db.exercise.update({
      where: { id: f.e.id },
      data: { isActive: false },
    });
    await expect(
      service.replace(f.identity, a.settingId, {
        intentId: randomUUID(),
        expectedRevision: a.revision,
        parameters: parameters(),
        confirmImpact: true,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
  async function history() {
    const h = createHash('sha256');
    for (const table of [
      'progression_recommendations',
      'recommendation_evidence',
      'recommendation_reviews',
      'progression_applications',
      'progression_automation_consents',
      'progression_automation_consent_events',
      'progression_consent_acceptance_challenges',
      'training_plans',
      'plan_weeks',
      'plan_days',
      'plan_exercises',
      'workout_sessions',
      'workout_exercises',
      'set_records',
    ]) {
      const values = await db.$queryRawUnsafe<{ row: string }[]>(
        `SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
      );
      h.update(JSON.stringify(values));
    }
    return h.digest('hex');
  }
  it('preserves modern recommendations, reviews, applications, plans and execution history', async () => {
    const f = await applicationFixture(db),
      repo = new PrismaProgressionRepository(db);
    await new RecommendationService(repo).applyMyApprovedRecommendation(
      f.identity,
      f.input,
    );
    const row = await service.get(f.identity, f.setting.id),
      before = await history();
    const p = { ...settingParameters(row), incrementAbsolute: '3.000' };
    const impact = await service.impact(f.identity, row.id, row.revision, p);
    expect(impact.recommendationIds).toContain(f.proposal.id);
    await service.replace(f.identity, row.id, {
      intentId: randomUUID(),
      expectedRevision: row.revision,
      parameters: p,
      confirmImpact: true,
    });
    expect(await history()).toBe(before);
  });
  it('compares consent decision keys without rewriting accepted snapshots or events', async () => {
    const f = await automationConsentFixture(db),
      consents = new AutomationConsentService(
        new PrismaProgressionRepository(db),
      ),
      requested = await consents.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: f.contract,
      }),
      c = await consents.challengeMyAutomationConsent(
        f.identity,
        requested.consentId,
        1,
      );
    await consents.acceptMyAutomationConsent(f.identity, {
      consentId: c.consentId,
      intentId: randomUUID(),
      challengeId: c.id,
      expectedVersion: 1,
      expectedState: 'PENDING_CONFIRMATION',
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
    });
    const row = await service.get(f.identity, f.setting.id),
      before = await history();
    const noOp = await service.impact(
      f.identity,
      row.id,
      row.revision,
      settingParameters(row),
    );
    expect(noOp.consents.find((v) => v.id === c.consentId)!.compatibility).toBe(
      'UNCHANGED',
    );
    const p = { ...settingParameters(row), incrementAbsolute: '3.000' },
      impact = await service.impact(f.identity, row.id, row.revision, p);
    expect(
      impact.consents.find((v) => v.id === c.consentId)!.compatibility,
    ).toBe('REQUIRES_REEVALUATION');
    await service.replace(f.identity, row.id, {
      intentId: randomUUID(),
      expectedRevision: row.revision,
      parameters: p,
      confirmImpact: true,
    });
    expect(await history()).toBe(before);
    const current = await consents.inspectMyAutomationConsent(
      f.identity,
      c.consentId,
    );
    expect(current.state).toBe('ACCEPTED_INACTIVE');
    expect(current.currentConfiguration).toBe('CHANGED');
    expect(current.executionAuthorized).toBe(false);
  });
  it('distinguishes shadowed setting changes from consent incompatibility and challenge invalidation', async () => {
    const f = await automationConsentFixture(db),
      consents = new AutomationConsentService(
        new PrismaProgressionRepository(db),
      );
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { exerciseId: f.e.id },
    });
    const generalRow = await service.create(f.identity, {
      intentId: randomUUID(),
      scope: general,
      parameters: parameters(),
    });
    const c = await consents.requestMyAutomationConsent(f.identity, {
      intentId: randomUUID(),
      contract: f.contract,
    });
    const impact = await service.impact(
      f.identity,
      generalRow.settingId,
      generalRow.revision,
      { ...parameters(), incrementAbsolute: '1' },
    );
    expect(impact.consents.find((v) => v.id === c.consentId)).toMatchObject({
      compatibility: 'UNCHANGED',
      challengeMayBeStale: true,
    });
  });
  it('rolls back row creation if the immutable receipt fails', async () => {
    const f = await fixture(),
      name = 'settings_failure_' + randomUUID().replaceAll('-', ''),
      input = {
        intentId: randomUUID(),
        scope: general,
        parameters: parameters(),
      };
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated receipt failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON progression_setting_mutations FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      await expect(service.create(f.identity, input)).rejects.toBeDefined();
      expect(
        await db.progressionSetting.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER ${name} ON progression_setting_mutations`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
    const a = await service.create(f.identity, input);
    await expect(
      db.progressionSettingMutation.delete({ where: { id: a.id } }),
    ).rejects.toBeDefined();
  });

  it('different simultaneous intentions cannot create two rows in the same scope', async () => {
    const f = await fixture();
    const r = await Promise.allSettled([create(f), create(f)]);
    expect(r.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((v) => v.status === 'rejected')).toMatchObject({
      reason: { code: 'SETTING_SCOPE_EXISTS' },
    });
    expect(
      await db.progressionSetting.count({ where: { athleteId: f.athleteId } }),
    ).toBe(1);
  });
  it('bounds retries while a concurrent session revocation holds its fence, then denies the revoked session', async () => {
    const f = await fixture(),
      client = new pg.Client({
        connectionString: process.env.PROG1B_TEST_DATABASE_URL,
      });
    await client.connect();
    try {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query('BEGIN');
      await client.query(
        'UPDATE auth_sessions SET revoked_at=GREATEST(clock_timestamp(),created_at) WHERE id=$1',
        [f.identity.sessionId],
      );
      await expect(create(f)).rejects.toMatchObject({ code: 'SOURCE_BUSY' });
      expect(
        await db.progressionSetting.count({
          where: { athleteId: f.athleteId },
        }),
      ).toBe(0);
      await client.query('COMMIT');
      await expect(create(f)).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
  it('changing a setting invalidates a previously issued acceptance challenge without rewriting its contract', async () => {
    const f = await automationConsentFixture(db),
      consents = new AutomationConsentService(
        new PrismaProgressionRepository(db),
      ),
      requested = await consents.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: f.contract,
      }),
      c = await consents.challengeMyAutomationConsent(
        f.identity,
        requested.consentId,
        1,
      ),
      before = await history(),
      row = await service.get(f.identity, f.setting.id);
    await service.replace(f.identity, row.id, {
      intentId: randomUUID(),
      expectedRevision: row.revision,
      parameters: { ...settingParameters(row), incrementAbsolute: '3.000' },
      confirmImpact: true,
    });
    await expect(
      consents.acceptMyAutomationConsent(f.identity, {
        consentId: c.consentId,
        intentId: randomUUID(),
        challengeId: c.id,
        expectedVersion: 1,
        expectedState: 'PENDING_CONFIRMATION',
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
      }),
    ).rejects.toBeDefined();
    expect(await history()).toBe(before);
    expect(
      (await consents.inspectMyAutomationConsent(f.identity, c.consentId))
        .state,
    ).toBe('PENDING_CONFIRMATION');
  });
});
