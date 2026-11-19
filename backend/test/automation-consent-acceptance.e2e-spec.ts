import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-6B-B persisted inactive human acceptance', () => {
  let db: PrismaService, service: AutomationConsentService;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    await db.$connect();
    service = new AutomationConsentService(new PrismaProgressionRepository(db));
  });
  afterAll(() => db?.$disconnect());
  async function fixture() {
    const f = await automationConsentFixture(db),
      created = await service.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: f.contract,
      });
    return { ...f, created };
  }
  it('records exact acceptance and permits terminal revocation without mutating snapshot or plan', async () => {
    const f = await fixture(),
      before = JSON.stringify(
        await db.planExercise.findUnique({ where: { id: f.target.p.id } }),
      );
    const c = await service.challengeMyAutomationConsent(
      f.identity,
      f.created.consentId,
      1,
    );
    const input = {
      consentId: c.consentId,
      intentId: randomUUID(),
      challengeId: c.id,
      expectedVersion: c.version,
      expectedState: 'PENDING_CONFIRMATION' as const,
      contractKey: c.contractKey,
      conditionsKey: c.conditionsKey,
      contextKey: c.contextKey,
      termsVersion: c.termsVersion,
      presentationVersion: c.presentationVersion,
      conditionsPresented: true as const,
      acknowledgments: {
        policy: true as const,
        limits: true as const,
        destinations: true as const,
        validity: true as const,
        revocation: true as const,
      },
    };
    const accepted = await service.acceptMyAutomationConsent(f.identity, input);
    expect(accepted.state).toBe('ACCEPTED_INACTIVE');
    expect(accepted.snapshot).toEqual(f.created.snapshot);
    expect(accepted.contractKey).toBe(f.created.contractKey);
    expect(accepted.acceptanceEvidence?.actorSessionId).toBe(
      f.identity.sessionId,
    );
    expect(await service.acceptMyAutomationConsent(f.identity, input)).toEqual(
      accepted,
    );
    await service.revokeMyAutomationConsent(f.identity, {
      consentId: c.consentId,
      intentId: randomUUID(),
      expectedVersion: 2,
      reason: 'OWNER_REQUEST',
    });
    const detail = await service.inspectMyAutomationConsent(
      f.identity,
      c.consentId,
    );
    expect(detail.state).toBe('REVOKED');
    expect(detail.executionAuthorized).toBe(false);
    expect(detail.events.map((e) => e.action)).toEqual([
      'CREATE',
      'ACCEPT',
      'REVOKE',
    ]);
    expect(detail.events[1].acceptanceEvidence).toEqual(
      accepted.acceptanceEvidence,
    );
    expect(await service.acceptMyAutomationConsent(f.identity, input)).toEqual(
      accepted,
    );
    expect(
      JSON.stringify(
        await db.planExercise.findUnique({ where: { id: f.target.p.id } }),
      ),
    ).toBe(before);
    expect(
      await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    ).toBe(0);
  });
  async function prepared() {
    const f = await fixture(),
      c = await service.challengeMyAutomationConsent(
        f.identity,
        f.created.consentId,
        1,
      );
    return {
      ...f,
      c,
      input: {
        consentId: c.consentId,
        intentId: randomUUID(),
        challengeId: c.id,
        expectedVersion: c.version,
        expectedState: 'PENDING_CONFIRMATION' as const,
        contractKey: c.contractKey,
        conditionsKey: c.conditionsKey,
        contextKey: c.contextKey,
        termsVersion: c.termsVersion,
        presentationVersion: c.presentationVersion,
        conditionsPresented: true as const,
        acknowledgments: {
          policy: true as const,
          limits: true as const,
          destinations: true as const,
          validity: true as const,
          revocation: true as const,
        },
      },
    };
  }
  it('serializes identical concurrent acceptances into one immutable event', async () => {
    const f = await prepared();
    const result = await Promise.all([
      service.acceptMyAutomationConsent(f.identity, f.input),
      service.acceptMyAutomationConsent(f.identity, f.input),
    ]);
    expect(result[0]).toEqual(result[1]);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: f.created.consentId, action: 'ACCEPT' },
      }),
    ).toBe(1);
  });
  it('rejects a second intention after accepting and rejects revision of accepted terms', async () => {
    const f = await prepared();
    await service.acceptMyAutomationConsent(f.identity, f.input);
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        intentId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_ALREADY_ACCEPTED' });
    await expect(
      service.reviseMyAutomationConsent(f.identity, {
        consentId: f.c.consentId,
        intentId: randomUUID(),
        expectedVersion: 2,
        contract: f.contract,
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_ALREADY_ACCEPTED' });
  });
  it('requires a real issued challenge and rejects undisplayed conditions', async () => {
    const f = await prepared();
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        challengeId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ACCEPTANCE_CHALLENGE_INVALID' });
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        conditionsPresented: false,
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_CONSENT_COMMAND' });
  });
  it.each([
    'contractKey',
    'conditionsKey',
    'contextKey',
    'termsVersion',
    'expectedVersion',
  ])('rejects manipulated %s without an event', async (key) => {
    const f = await prepared();
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        [key]:
          key === 'expectedVersion'
            ? 2
            : key === 'termsVersion'
              ? 'other-terms'
              : '0'.repeat(64),
      }),
    ).rejects.toBeDefined();
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: f.c.consentId, action: 'ACCEPT' },
      }),
    ).toBe(0);
  });
  it('rejects different-account ownership and the same account in a different session', async () => {
    const f = await prepared(),
      other = await fixture();
    await expect(
      service.acceptMyAutomationConsent(other.identity, f.input),
    ).rejects.toBeDefined();
    const session = await db.authSession.create({
      data: {
        userId: f.identity.account.id,
        tokenFamilyId: randomUUID(),
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 600000),
        absoluteExpiresAt: new Date(Date.now() + 600000),
      },
    });
    await expect(
      service.acceptMyAutomationConsent(
        { ...f.identity, sessionId: session.id },
        f.input,
      ),
    ).rejects.toMatchObject({ code: 'ACCEPTANCE_CHALLENGE_INVALID' });
  });
  it('invalidates a challenge after a revision and keeps the earlier snapshot', async () => {
    const f = await prepared();
    await service.reviseMyAutomationConsent(f.identity, {
      consentId: f.c.consentId,
      intentId: randomUUID(),
      expectedVersion: 1,
      contract: {
        ...f.contract,
        limits: { ...f.contract.limits, maximumLoad: '190' },
      },
    });
    await expect(
      service.acceptMyAutomationConsent(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'STALE_CONSENT' });
  });
  it('invalidates a changed destination even when plan version did not change', async () => {
    const f = await prepared();
    await db.planExercise.update({
      where: { id: f.target.p.id },
      data: { targetLoad: '81' },
    });
    await expect(
      service.acceptMyAutomationConsent(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'ACCEPTANCE_CHALLENGE_INVALID' });
  });
  it('invalidates decisive settings but ignores the unrelated legacy automatic preference', async () => {
    const f = await prepared();
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { autoApplyAuthorized: true },
    });
    expect(
      (await service.acceptMyAutomationConsent(f.identity, f.input)).state,
    ).toBe('ACCEPTED_INACTIVE');
    const g = await prepared();
    await db.progressionSetting.update({
      where: { id: g.setting.id },
      data: { maxLoad: '199' },
    });
    await expect(
      service.acceptMyAutomationConsent(g.identity, g.input),
    ).rejects.toBeDefined();
  });
  it('rejects a revoked session and a suspended account', async () => {
    const f = await prepared();
    await db.authSession.update({
      where: { id: f.identity.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(
      service.acceptMyAutomationConsent(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    const g = await prepared();
    await db.user.update({
      where: { id: g.identity.account.id },
      data: { status: 'SUSPENDED' },
    });
    await expect(
      service.acceptMyAutomationConsent(g.identity, g.input),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
  it('fences acceptance against a concurrent revocation and never revives terminal state', async () => {
    const f = await prepared();
    const res = await Promise.allSettled([
      service.acceptMyAutomationConsent(f.identity, f.input),
      service.revokeMyAutomationConsent(f.identity, {
        consentId: f.c.consentId,
        intentId: randomUUID(),
        expectedVersion: 1,
        reason: 'OWNER_REQUEST',
      }),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    let d = await service.inspectMyAutomationConsent(f.identity, f.c.consentId);
    if (d.state === 'ACCEPTED_INACTIVE') {
      await service.revokeMyAutomationConsent(f.identity, {
        consentId: f.c.consentId,
        intentId: randomUUID(),
        expectedVersion: 2,
        reason: 'OWNER_REQUEST',
      });
    }
    d = await service.inspectMyAutomationConsent(f.identity, f.c.consentId);
    expect(d.state).toBe('REVOKED');
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        intentId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
  });
  it('allows only one winner when acceptance competes with revision', async () => {
    const f = await prepared();
    const result = await Promise.allSettled([
      service.acceptMyAutomationConsent(f.identity, f.input),
      service.reviseMyAutomationConsent(f.identity, {
        consentId: f.c.consentId,
        intentId: randomUUID(),
        expectedVersion: 1,
        contract: { ...f.contract, termsVersion: 'new-terms' },
      }),
    ]);
    expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.progressionAutomationConsentEvent.count({
        where: { consentId: f.c.consentId },
      }),
    ).toBe(2);
  });
  it('keeps accepted inactive consents in overlap detection', async () => {
    const f = await prepared();
    await service.acceptMyAutomationConsent(f.identity, f.input);
    await expect(
      service.requestMyAutomationConsent(f.identity, {
        intentId: randomUUID(),
        contract: f.contract,
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTOMATION_CONSENT' });
  });
  it('rolls back accepted state without its audit and prevents modifying acceptance audit/challenge', async () => {
    const f = await prepared();
    await expect(
      db.$transaction(async (tx) => {
        await tx.progressionAutomationConsent.update({
          where: { id: f.c.consentId },
          data: {
            state: 'ACCEPTED_INACTIVE',
            version: 2,
            updatedAt: new Date(),
          },
        });
      }),
    ).rejects.toBeDefined();
    expect(
      (await service.inspectMyAutomationConsent(f.identity, f.c.consentId))
        .state,
    ).toBe('PENDING_CONFIRMATION');
    await service.acceptMyAutomationConsent(f.identity, f.input);
    await expect(
      db.progressionAutomationConsentEvent.deleteMany({
        where: { consentId: f.c.consentId, action: 'ACCEPT' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionConsentAcceptanceChallenge.update({
        where: { id: f.c.id },
        data: { termsVersion: 'tampered' },
      }),
    ).rejects.toBeDefined();
  });
  it('rejects reused intention with changed affirmative terms', async () => {
    const f = await prepared();
    await service.acceptMyAutomationConsent(f.identity, f.input);
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        termsVersion: 'altered',
      }),
    ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
  });

  it('expires a real issued short-lived challenge and leaves the consent pending', async () => {
    const f = await prepared();
    const old =
      await db.progressionConsentAcceptanceChallenge.findUniqueOrThrow({
        where: { id: f.c.id },
      });
    const [clock] = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return tx.$queryRaw<
        { now: Date }[]
      >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
    });
    const { id: _id, ...fields } = old;
    const h = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return tx.progressionConsentAcceptanceChallenge.create({
        data: {
          ...fields,
          dependencies: fields.dependencies as never,
          issuedAt: clock.now,
          expiresAt: new Date(clock.now.getTime() + 2000),
        },
      });
    });
    await db.$queryRaw`SELECT pg_sleep(2.1)::text AS waited`;
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        challengeId: h.id,
      }),
    ).rejects.toMatchObject({
      code: 'ACCEPTANCE_CHALLENGE_INVALID',
      reasons: ['CHALLENGE_EXPIRED'],
    });
  });
  it('rejects an expired consent even if an earlier challenge existed', async () => {
    const f = await automationConsentFixture(db);
    const [clock] = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return tx.$queryRaw<
        { now: Date }[]
      >`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
    });
    const created = await service.requestMyAutomationConsent(f.identity, {
      intentId: randomUUID(),
      contract: {
        ...f.contract,
        validity: {
          ...f.contract.validity,
          endsAt: new Date(clock.now.getTime() + 2500).toISOString(),
        },
      },
    });
    const c = await service.challengeMyAutomationConsent(
      f.identity,
      created.consentId,
      1,
    );
    await db.$queryRaw`SELECT pg_sleep(2.6)::text AS waited`;
    await expect(
      service.acceptMyAutomationConsent(f.identity, {
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
    ).rejects.toMatchObject({ code: 'CONSENT_EXPIRED' });
  });
  it('serializes different acceptance intentions with exactly one winner', async () => {
    const f = await prepared();
    const result = await Promise.allSettled([
      service.acceptMyAutomationConsent(f.identity, f.input),
      service.acceptMyAutomationConsent(f.identity, {
        ...f.input,
        intentId: randomUUID(),
      }),
    ]);
    expect(result.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((v) => v.status === 'rejected')).toMatchObject({
      reason: { code: 'CONSENT_ALREADY_ACCEPTED' },
    });
  });
  it.each(['session', 'settings', 'destination'])(
    'revalidates concurrent %s changes after acquiring its database fence',
    async (resource) => {
      const f = await prepared(),
        sql = new pg.Client({
          connectionString: process.env.PROG1B_TEST_DATABASE_URL,
        });
      await sql.connect();
      try {
        await sql.query('BEGIN');
        await sql.query("SET LOCAL TIME ZONE 'UTC'");
        const query =
          resource === 'session'
            ? [
                'SELECT id FROM auth_sessions WHERE id=$1 FOR UPDATE',
                f.identity.sessionId,
              ]
            : resource === 'settings'
              ? [
                  'SELECT id FROM progression_settings WHERE id=$1 FOR UPDATE',
                  f.setting.id,
                ]
              : [
                  'SELECT id FROM plan_exercises WHERE id=$1 FOR UPDATE',
                  f.target.p.id,
                ];
        await sql.query(query[0], [query[1]]);
        const result = service
          .acceptMyAutomationConsent(f.identity, f.input)
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
        await sql.query('SELECT pg_sleep(0.06)');
        if (resource === 'session')
          await sql.query(
            'UPDATE auth_sessions SET revoked_at=GREATEST(created_at,clock_timestamp()) WHERE id=$1',
            [f.identity.sessionId],
          );
        else if (resource === 'settings')
          await sql.query(
            'UPDATE progression_settings SET max_load=199 WHERE id=$1',
            [f.setting.id],
          );
        else
          await sql.query(
            'UPDATE plan_exercises SET target_load=81 WHERE id=$1',
            [f.target.p.id],
          );
        await sql.query('COMMIT');
        const settled = await result;
        expect('error' in settled).toBe(true);
        if ('error' in settled && resource === 'session')
          expect(settled.error.code).toBe('AUTHENTICATION_REQUIRED');
        expect(
          await db.progressionAutomationConsentEvent.count({
            where: { consentId: f.c.consentId, action: 'ACCEPT' },
          }),
        ).toBe(0);
      } finally {
        await sql.query('ROLLBACK');
        await sql.end();
      }
    },
  );
  it('rolls back an ACCEPT when its event fails and permits the same original intention afterward', async () => {
    const f = await prepared();
    const name = 'acceptance_failure_' + randomUUID().replaceAll('-', '');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consent_id='${f.c.consentId}'::uuid AND NEW.action='ACCEPT' THEN RAISE EXCEPTION 'isolated acceptance failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON progression_automation_consent_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      await expect(
        service.acceptMyAutomationConsent(f.identity, f.input),
      ).rejects.toBeDefined();
      expect(
        (await service.inspectMyAutomationConsent(f.identity, f.c.consentId))
          .state,
      ).toBe('PENDING_CONFIRMATION');
      expect(
        await db.progressionAutomationConsentEvent.count({
          where: { consentId: f.c.consentId },
        }),
      ).toBe(1);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER ${name} ON progression_automation_consent_events`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
    expect(
      (await service.acceptMyAutomationConsent(f.identity, f.input)).state,
    ).toBe('ACCEPTED_INACTIVE');
  });
  it('reproduces the evidence fingerprint from its explicit SQL canonicalization version', async () => {
    const f = await prepared(),
      a = await service.acceptMyAutomationConsent(f.identity, f.input);
    const [r] = await db.$queryRaw<
      { key: string }[]
    >`SELECT automation_acceptance_evidence_key(${JSON.stringify(a.acceptanceEvidence)}::jsonb) AS key`;
    expect(r.key).toBe(a.acceptanceEvidence!.acceptanceKey);
  });
});
