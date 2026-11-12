import type { Prisma } from '../src/generated/prisma/client';
import { plannedReviewTarget } from './helpers/recommendation-review-fixtures';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { AutomaticProgressionService } from '../src/progression/automatic-progression.service';
import { AutomationConsentService } from '../src/progression/automation-consent.service';
import { RecommendationService } from '../src/progression/recommendation.service';
import { automationConsentFixture } from './helpers/automation-consent-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
import { internalProgressionCapability } from '../src/progression/internal-progression-principal';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('FINAL-MVP operational automatic application on PostgreSQL', () => {
  let db: PrismaService,
    repo: PrismaProgressionRepository,
    service: AutomaticProgressionService,
    consents: AutomationConsentService,
    recommendations: RecommendationService;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    await db.$connect();
    repo = new PrismaProgressionRepository(db);
    service = new AutomaticProgressionService(repo);
    consents = new AutomationConsentService(repo);
    recommendations = new RecommendationService(repo);
  });
  afterAll(() => db.$disconnect());
  async function fixture(accept = true, validitySeconds?: number) {
    const f = await automationConsentFixture(db);
    if (validitySeconds)
      f.contract = {
        ...f.contract,
        validity: {
          ...f.contract.validity,
          endsAt: new Date(
            new Date(f.contract.validity.startsAt).getTime() +
              validitySeconds * 1000,
          ).toISOString(),
        },
      };

    f.command.policy = structuredClone(
      f.contract.policy,
    ) as typeof f.command.policy;
    const request = await consents.requestMyAutomationConsent(f.identity, {
      intentId: randomUUID(),
      contract: f.contract,
    });
    if (accept) {
      const c = await consents.challengeMyAutomationConsent(
        f.identity,
        request.consentId,
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
    }
    const [date] = await db.$queryRaw<
      { on: string }[]
    >`SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date+7)::text AS on`;
    const activity = await db.scheduledActivity.create({
      data: {
        athleteId: f.athleteId,
        planWeekId: f.target.week.id,
        planDayId: f.target.day.id,
        originalOn: new Date(date.on),
        scheduledOn: new Date(date.on),
        timeZone: 'UTC',
        title: 'Future operational fixture',
      },
    });
    const draft = await recommendations.proposeMyExercise(
      f.identity,
      f.command,
    );
    expect(draft.decision).toBe('INCREASE');
    const proposal = await recommendations.saveMyProposal(
      f.identity,
      {
        command: f.command,
        expectedSemanticKey: draft.semanticKey,
        expectedDependencyKeys: draft.dependencyKeys,
      },
      true,
    );
    return { ...f, consentId: request.consentId, activity, proposal };
  }
  async function activate(
    f: Awaited<ReturnType<typeof fixture>>,
    intentId = randomUUID(),
  ) {
    const st = await service.status(f.identity, f.consentId);
    const input = {
      intentId,
      expectedConsentVersion: st.consentVersion,
      expectedContractKey: st.contractKey,
      acceptanceEventId: st.acceptanceEventId!,
      activationTermsVersion: st.activationTermsVersion,
      conditionsKey: st.conditionsKey,
      confirmActivation: true as const,
    };
    return {
      input,
      receipt: await service.activate(f.identity, f.consentId, input),
    };
  }
  it('does not activate without an accredited human acceptance', async () => {
    const f = await fixture(false),
      st = await service.status(f.identity, f.consentId);
    expect(st.executionAuthorized).toBe(false);
    await expect(
      service.activate(f.identity, f.consentId, {
        intentId: randomUUID(),
        expectedConsentVersion: 1,
        expectedContractKey: st.contractKey,
        acceptanceEventId: randomUUID(),
        activationTermsVersion: st.activationTermsVersion,
        conditionsKey: st.conditionsKey,
        confirmActivation: true,
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_BLOCKED' });
    expect(
      await db.progressionOperationalGrant.count({
        where: { consentId: f.consentId },
      }),
    ).toBe(0);
  });
  it('activates explicitly, applies once, records AUTO not human approval, and preserves history', async () => {
    const f = await fixture();
    expect((await service.status(f.identity, f.consentId)).effectiveState).toBe(
      'INACTIVE',
    );
    const before = JSON.stringify(
      await db.workoutSession.findMany({
        where: { athleteId: f.athleteId },
        include: { exercises: { include: { sets: true } } },
      }),
    );
    await activate(f);
    const intent = randomUUID(),
      r = await service.process(f.identity, f.consentId, intent);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({
      result: 'APPLIED',
      previousLoad: '80.000000',
      appliedLoad: '82.500000',
      unit: 'KG',
    });
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('82.500');
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    const app = await db.progressionApplication.findUniqueOrThrow({
      where: { recommendationId: f.proposal.id },
    });
    expect(app.origin).toBe('AUTOMATIC');
    expect(app.actorUserId).toBeNull();
    expect(app.reviewId).toBeNull();
    expect(app.executorId).toBe('PULSO_INTERNAL_PROGRESSION_WORKER_V1');
    expect(await service.process(f.identity, f.consentId, intent)).toEqual(r);
    expect(
      (await service.history(f.identity, f.consentId, 1, 20)).items,
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        await db.workoutSession.findMany({
          where: { athleteId: f.athleteId },
          include: { exercises: { include: { sets: true } } },
        }),
      ),
    ).toBe(before);
    expect(
      (await consents.inspectMyAutomationConsent(f.identity, f.consentId))
        .executionAuthorized,
    ).toBe(false);
  });
  it('two simultaneous explicit checks consume a cycle and plan version only once', async () => {
    const f = await fixture();
    await activate(f);
    const [a, b] = await Promise.all([
      service.process(f.identity, f.consentId, randomUUID()),
      service.process(f.identity, f.consentId, randomUUID()),
    ]);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
    expect(
      [...a.results, ...b.results]
        .filter((v) => v.result === 'APPLIED')
        .every(
          (v) =>
            v.applicationId === a.results[0]?.applicationId ||
            v.applicationId === b.results[0]?.applicationId,
        ),
    ).toBe(true);
  });
  it('retains original activation receipt after terminal revocation without reactivation', async () => {
    const f = await fixture(),
      a = await activate(f);
    await service.revoke(f.identity, f.consentId, {
      intentId: randomUUID(),
      grantId: a.receipt.grant!.id,
      expectedGrantVersion: 1,
      confirmRevocation: true,
    });
    expect(await service.activate(f.identity, f.consentId, a.input)).toEqual(
      a.receipt,
    );
    expect((await service.status(f.identity, f.consentId)).effectiveState).toBe(
      'REVOKED',
    );
    await expect(
      service.process(f.identity, f.consentId, randomUUID()),
    ).rejects.toMatchObject({ code: 'GRANT_REVOKED' });
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it('blocks a revocation committed before worker checks and continues other grants', async () => {
    const f = await fixture(),
      a = await activate(f);
    await consents.revokeMyAutomationConsent(f.identity, {
      intentId: randomUUID(),
      consentId: f.consentId,
      expectedVersion: 2,
      reason: 'OWNER_REQUEST',
    });
    const r = await service.process(f.identity, f.consentId, randomUUID());
    expect(r.results[0].result).toBe('BLOCKED');
    expect(r.results[0].reasons).toContain('CONSENT_NOT_ACTIVE');
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect(
      (await service.history(f.identity, f.consentId, 1, 20)).items[0].result,
    ).toBe('BLOCKED');
    expect(a.receipt.grant!.state).toBe('ACTIVE');
  });
  it('configuration changes block an old proposal and leave consent snapshots intact', async () => {
    const f = await fixture();
    await activate(f);
    const original = await db.progressionAutomationConsent.findUniqueOrThrow({
      where: { id: f.consentId },
    });
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '3' },
    });
    const r = await service.process(f.identity, f.consentId, randomUUID());
    expect(r.results[0].reasons).toContain('STALE_PROPOSAL');
    expect(
      (
        await db.progressionAutomationConsent.findUniqueOrThrow({
          where: { id: f.consentId },
        })
      ).snapshot,
    ).toEqual(original.snapshot);
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('80.000');
  });
  it('activity ambiguity and plan version changes block instead of choosing first', async () => {
    const f = await fixture();
    await activate(f);
    await db.scheduledActivity.create({
      data: {
        athleteId: f.athleteId,
        planWeekId: f.target.week.id,
        planDayId: f.target.day.id,
        originalOn: f.activity.originalOn,
        scheduledOn: f.activity.scheduledOn,
        timeZone: 'UTC',
        title: 'Second candidate',
      },
    });
    const r = await service.process(f.identity, f.consentId, randomUUID());
    expect(r.results[0].reasons).toContain('DESTINATION_AMBIGUOUS');
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it('isolation rejects foreign resource reads, processing and activation intentions', async () => {
    const f = await fixture(),
      g = await fixture(),
      a = await activate(f);
    await expect(service.status(g.identity, f.consentId)).rejects.toMatchObject(
      { code: 'SOURCE_NOT_FOUND' },
    );
    await expect(
      service.process(g.identity, f.consentId, randomUUID()),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(
      service.operation(g.identity, a.input.intentId),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
  it('rejects forged internal principals even if their text matches', async () => {
    await expect(
      repo.processActiveAutomatic(
        { kind: 'PULSO_INTERNAL_PROGRESSION_WORKER_V1' } as ReturnType<
          typeof internalProgressionCapability
        >,
        1,
      ),
    ).rejects.toThrow('Internal progression capability required');
  });
  it('worker uses active grants without issuing sessions and skips already applied records after restart', async () => {
    const f = await fixture();
    await activate(f);
    const sessions = await db.authSession.count();
    await repo.processActiveAutomatic(internalProgressionCapability(), 100);
    await repo.processActiveAutomatic(internalProgressionCapability(), 100);
    expect(await db.authSession.count()).toBe(sessions);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
  });
  it('new audit tables and automatic receipts reject edits/deletion', async () => {
    const f = await fixture(),
      a = await activate(f),
      r = await service.process(f.identity, f.consentId, randomUUID());
    await expect(
      db.progressionAutomaticRun.delete({ where: { id: r.results[0].id } }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionOperationalEvent.delete({
        where: { id: a.receipt.eventId },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionApplication.delete({
        where: { id: r.results[0].applicationId! },
      }),
    ).rejects.toBeDefined();
  });
  it('rolls back prescription, version, state and application when success audit fails', async () => {
    const f = await fixture();
    await activate(f);
    const n = 'fail_auto_' + randomUUID().replaceAll('-', '');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${n}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result='APPLIED' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${n} BEFORE INSERT ON progression_automatic_runs FOR EACH ROW EXECUTE FUNCTION ${n}()`,
    );
    try {
      await expect(
        service.process(f.identity, f.consentId, randomUUID()),
      ).rejects.toBeDefined();
      expect(
        (
          await db.planExercise.findUniqueOrThrow({
            where: { id: f.target.p.id },
          })
        ).targetLoad!.toFixed(3),
      ).toBe('80.000');
      expect(
        (
          await db.trainingPlan.findUniqueOrThrow({
            where: { id: f.target.plan.id },
          })
        ).version,
      ).toBe(0);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe('PENDING');
      expect(
        await db.progressionApplication.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER ${n} ON progression_automatic_runs`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION ${n}()`);
    }
  });
  it('a bounded worker rotates past blocked and empty grants to independent valid work', async () => {
    const bad = await fixture();
    await activate(bad);
    await db.progressionSetting.update({
      where: { id: bad.setting.id },
      data: { incrementAbsolute: '3' },
    });
    const good = await fixture();
    await activate(good);
    const total = await db.progressionOperationalGrant.count({
      where: { state: 'ACTIVE' },
    });
    for (let n = 0; n < total + 2; n++)
      await repo.processActiveAutomatic(internalProgressionCapability(), 1);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: good.proposal.id },
      }),
    ).toBe(1);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: bad.proposal.id },
      }),
    ).toBe(0);
  });
  it('resumes the identical durable CHECK after a transient interruption without applying twice', async () => {
    const f = await fixture();
    await activate(f);
    const intent = randomUUID(),
      n = 'interrupt_auto_' + randomUUID().replaceAll('-', '');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${n}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result='APPLIED' THEN RAISE EXCEPTION 'interrupted check'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${n} BEFORE INSERT ON progression_automatic_runs FOR EACH ROW EXECUTE FUNCTION ${n}()`,
    );
    try {
      await expect(
        service.process(f.identity, f.consentId, intent),
      ).rejects.toBeDefined();
      expect(
        await db.progressionAutomaticBatch.count({
          where: { athleteId: f.athleteId, intentId: intent },
        }),
      ).toBe(1);
      await expect(service.operation(f.identity, intent)).rejects.toMatchObject(
        { code: 'SOURCE_BUSY' },
      );
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER ${n} ON progression_automatic_runs`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION ${n}()`);
    }
    const result = await service.process(f.identity, f.consentId, intent);
    expect(result.results[0].result).toBe('APPLIED');
    expect(await service.operation(f.identity, intent)).toEqual(result);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
  });
  it('rejects a changed target plan version and never rewrites original targets', async () => {
    const f = await fixture();
    await activate(f);
    await db.trainingPlan.update({
      where: { id: f.target.plan.id },
      data: { version: { increment: 1 } },
    });
    const r = await service.process(f.identity, f.consentId, randomUUID());
    expect(r.results[0].result).toBe('BLOCKED');
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('80.000');
  });
  it('a committed grant revocation before a periodic tick prevents any automatic write', async () => {
    const f = await fixture(),
      a = await activate(f);
    await service.revoke(f.identity, f.consentId, {
      intentId: randomUUID(),
      grantId: a.receipt.grant!.id,
      expectedGrantVersion: 1,
      confirmRevocation: true,
    });
    await repo.processActiveAutomatic(internalProgressionCapability(), 100);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  async function manual(
    f: Awaited<ReturnType<typeof fixture>>,
    proposal = f.proposal,
    command = f.command,
    target = f.target,
    activity = f.activity,
  ) {
    const view = await recommendations.inspectMyProposal(
        f.identity,
        proposal.id,
        command,
      ),
      draft = proposal.generation!.draft;
    const review = await recommendations.reviewMyProposal(f.identity, {
      recommendationId: proposal.id,
      intentId: randomUUID(),
      action: 'APPROVE',
      expectedStatus: 'PENDING',
      expectedVersion: null,
      expectedSemanticKey: draft.semanticKey,
      expectedCycleKey: proposal.generation!.cycleKey,
      expectedDependencyKeys: draft.dependencyKeys,
      command,
      acceptance: {
        ...view.acceptanceChallenge!,
        acceptPolicy: true,
        acceptEvidence: true,
      },
    });
    return recommendations.applyMyApprovedRecommendation(f.identity, {
      recommendationId: proposal.id,
      intentId: randomUUID(),
      reviewId: review.id,
      expectedReviewVersion: 1,
      expectedSemanticKey: draft.semanticKey,
      expectedCycleKey: proposal.generation!.cycleKey,
      expectedDependencyKeys: draft.dependencyKeys,
      destination: {
        planId: target.plan.id,
        weekId: target.week.id,
        dayId: target.day.id,
        prescriptionId: target.p.id,
      },
      expectedPlanVersion: target.plan.version,
      activityId: activity.id,
      expectedActivityVersion: activity.version,
      expectedScheduledOn: activity.scheduledOn.toISOString().slice(0, 10),
      timeZone: activity.timeZone,
      previousLoad: draft.increment!.currentLoad!,
      appliedLoad: draft.increment!.proposedLoad!,
      loadUnit: 'KG',
      command,
    });
  }
  it('manual authorization and automatic processing racing share one application/cycle/version', async () => {
    const f = await fixture();
    await activate(f);
    const outcomes = await Promise.allSettled([
      manual(f),
      service.process(f.identity, f.consentId, randomUUID()),
    ]);
    expect(outcomes.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
    const row = await db.progressionApplication.findUniqueOrThrow({
      where: { recommendationId: f.proposal.id },
    });
    expect(
      row.origin === 'MANUAL'
        ? row.reviewId !== null
        : row.operationalGrantId !== null,
    ).toBe(true);
  });
  it('weekly frequency includes a manual application to another destination for the same athlete and exercise', async () => {
    const f = await fixture();
    await activate(f);
    const original = structuredClone(f.command),
      other = await plannedReviewTarget(db, f),
      command = structuredClone(f.command);
    f.command = original;
    const activity = await db.scheduledActivity.create({
      data: {
        athleteId: f.athleteId,
        planWeekId: other.week.id,
        planDayId: other.day.id,
        originalOn: f.activity.originalOn,
        scheduledOn: f.activity.scheduledOn,
        timeZone: 'UTC',
        title: 'Independent manual destination',
      },
    });
    const draft = await recommendations.proposeMyExercise(f.identity, command),
      proposal = await recommendations.saveMyProposal(
        f.identity,
        {
          command,
          expectedSemanticKey: draft.semanticKey,
          expectedDependencyKeys: draft.dependencyKeys,
        },
        true,
      );
    await manual(f, proposal, command, other, activity);
    const result = await service.process(f.identity, f.consentId, randomUUID());
    expect(result.results[0].result).toBe('BLOCKED');
    expect(result.results[0].reasons).toContain('FREQUENCY_EXCEEDED');
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it.each(['setting', 'plan', 'activity'] as const)(
    'revalidates after a concurrent %s write commits under source locks',
    async (kind) => {
      const f = await fixture();
      await activate(f);
      let ready!: () => void, release!: () => void;
      const locked = new Promise<void>((r) => {
          ready = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const writer = db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          if (kind === 'setting')
            await tx.progressionSetting.update({
              where: { id: f.setting.id },
              data: { incrementAbsolute: '3' },
            });
          else if (kind === 'plan')
            await tx.trainingPlan.update({
              where: { id: f.target.plan.id },
              data: { version: { increment: 1 } },
            });
          else
            await tx.scheduledActivity.update({
              where: { id: f.activity.id },
              data: { version: { increment: 1 }, status: 'OMITTED' },
            });
          ready();
          await gate;
        },
        { timeout: 10000 },
      );
      await locked;
      const checking = service.process(f.identity, f.consentId, randomUUID());
      await new Promise((r) => setTimeout(r, 60));
      release();
      await writer;
      const result = await checking;
      expect(result.results[0].result).toBe('BLOCKED');
      expect(
        await db.progressionApplication.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    },
  );
  it('revocation racing with execution is serialized, preserving any earlier valid application', async () => {
    const f = await fixture(),
      a = await activate(f);
    await Promise.allSettled([
      service.process(f.identity, f.consentId, randomUUID()),
      service.revoke(f.identity, f.consentId, {
        intentId: randomUUID(),
        grantId: a.receipt.grant!.id,
        expectedGrantVersion: 1,
        confirmRevocation: true,
      }),
    ]);
    const grant = await db.progressionOperationalGrant.findUniqueOrThrow({
      where: { id: a.receipt.grant!.id },
    });
    expect(grant.state).toBe('REVOKED');
    const app = await db.progressionApplication.findUnique({
      where: { recommendationId: f.proposal.id },
    });
    if (app)
      expect(app.effectiveAt.getTime()).toBeLessThanOrEqual(
        grant.revokedAt!.getTime(),
      );
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBeLessThanOrEqual(1);
  });
  it('an expired accepted consent blocks processing even while its operational grant is ACTIVE', async () => {
    const f = await fixture(true, 3);
    await activate(f);
    await db.$queryRaw`SELECT pg_sleep(GREATEST(0,extract(epoch from ${f.contract.validity.endsAt}::timestamptz-clock_timestamp()))+0.03)::text`;
    const result = await service.process(f.identity, f.consentId, randomUUID());
    expect(result.results[0]).toMatchObject({
      result: 'BLOCKED',
      reasons: ['CONSENT_NOT_ACTIVE'],
    });
    expect((await service.status(f.identity, f.consentId)).effectiveState).toBe(
      'EXPIRED',
    );
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it('rejects activation against stale conditions and reuse of another operation intention', async () => {
    const f = await fixture(),
      status = await service.status(f.identity, f.consentId);
    await expect(
      service.activate(f.identity, f.consentId, {
        intentId: randomUUID(),
        expectedConsentVersion: status.consentVersion,
        expectedContractKey: status.contractKey,
        acceptanceEventId: status.acceptanceEventId!,
        activationTermsVersion: status.activationTermsVersion,
        conditionsKey: '0'.repeat(64),
        confirmActivation: true,
      }),
    ).rejects.toMatchObject({ code: 'STALE_GRANT' });
    const a = await activate(f);
    await expect(
      service.process(f.identity, f.consentId, a.input.intentId),
    ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
  });
  it('SQL prevents neutral recommendations being marked APPLIED without an automatic application and receipt', async () => {
    const f = await fixture();
    await expect(
      db.progressionRecommendation.update({
        where: { id: f.proposal.id },
        data: { status: 'APPLIED' },
      }),
    ).rejects.toBeDefined();
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).status,
    ).toBe('PENDING');
  });
});
