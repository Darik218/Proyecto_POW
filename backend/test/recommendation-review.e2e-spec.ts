import { withPreOperationalSchema } from './helpers/pre-operational-schema';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { RecommendationService } from '../src/progression/recommendation.service';
import type { ReviewCommand } from '../src/models/progression/recommendation-review.model';
import {
  reviewFixture,
  plannedReviewTarget,
} from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-5A authenticated manual decisions with real PostgreSQL', () => {
  let db: PrismaService,
    second: PrismaService,
    service: RecommendationService,
    parallel: RecommendationService,
    close: () => Promise<void>;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    second = new PrismaService();
    await db.$connect();
    await second.$connect();
    const m = await Test.createTestingModule({ imports: [ProgressionModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    await m.init();
    service = m.get(RecommendationService);
    parallel = new RecommendationService(
      new PrismaProgressionRepository(second),
    );
    close = () => m.close();
  });
  afterAll(async () => {
    await close?.();
    await db?.$disconnect();
    await second?.$disconnect();
  });
  async function prepared(planned = true) {
    const f = await reviewFixture(db),
      target = planned ? await plannedReviewTarget(db, f) : null,
      d = await service.proposeMyExercise(f.identity, f.command);
    expect(d.decision).toBe('INCREASE');
    const proposal = await service.saveMyProposal(f.identity, {
      command: f.command,
      expectedSemanticKey: d.semanticKey,
      expectedDependencyKeys: d.dependencyKeys,
    });
    const view = await service.inspectMyProposal(
      f.identity,
      proposal.id,
      f.command,
    );
    return { ...f, target, proposal, view };
  }
  type F = Awaited<ReturnType<typeof prepared>>;
  function input(
    f: F,
    action: 'APPROVE' | 'REJECT' = 'APPROVE',
  ): ReviewCommand {
    return {
      recommendationId: f.proposal.id,
      intentId: randomUUID(),
      action,
      expectedStatus: 'PENDING',
      expectedVersion: null,
      expectedSemanticKey: f.proposal.generation!.semanticKey,
      expectedCycleKey: f.proposal.generation!.cycleKey,
      expectedDependencyKeys: f.proposal.generation!.draft.dependencyKeys,
      command: f.command,
      justification: 'Explicit fixture decision',
      acceptance:
        action === 'APPROVE' && f.view.acceptanceChallenge
          ? {
              ...f.view.acceptanceChallenge,
              acceptPolicy: true,
              acceptEvidence: true,
            }
          : undefined,
    };
  }
  async function unchanged(f: F) {
    return {
      sessions: await db.workoutSession.findMany({
        where: { athleteId: f.athleteId },
        include: { exercises: { include: { sets: true } } },
      }),
      plans: await db.trainingPlan.findMany({
        where: { athleteId: f.athleteId },
        include: { weeks: { include: { days: true, planExercises: true } } },
      }),
    };
  }
  it('inspects own evidence coherently and records explicit per-case approval without applying anything', async () => {
    const f = await prepared(),
      before = await unchanged(f);
    expect(f.view.validity.state).toBe('CURRENT');
    expect(f.view.approvalBlockers).toEqual([]);
    expect(f.view.acceptanceChallenge).not.toHaveProperty('acceptPolicy');
    const event = await service.reviewMyProposal(f.identity, input(f));
    expect(event).toMatchObject({
      actorUserId: f.identity.account.id,
      athleteId: f.athleteId,
      action: 'APPROVE',
      fromStatus: 'PENDING',
      toStatus: 'APPROVED',
      fromVersion: null,
      version: 1,
    });
    const row = await db.progressionRecommendation.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    // Verify the physical instant, independently of the adapter's offset parser.
    const [instant] = await db.$queryRaw<
      { utc: string }[]
    >`SELECT to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc FROM progression_recommendations WHERE id=${row.id}::uuid`;
    expect(instant.utc).toEqual(event.decidedAt.toISOString());
    expect(row.reviewVersion).toBe(1);
    expect(row.cycleSlot).toBe(f.proposal.generation!.cycleSlot);
    expect(row.planWeekId).toBeNull();
    expect(row.planExerciseId).toBeNull();
    expect(await unchanged(f)).toEqual(before);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: row.id },
      }),
    ).toBe(0);
    const view = await service.inspectMyProposal(f.identity, row.id, f.command);
    expect(view.manualAuthorization).toMatchObject({
      state: 'ACCEPTED_FOR_THIS_PROPOSAL',
      eventId: event.id,
      requiresRevalidation: true,
    });
    expect(view.proposal.generationAuthorization).toBe('NOT_GRANTED');
  });
  it.each(['APPROVE', 'REJECT'] as const)(
    'identical %s retries preserve the same event, date and current state after evidence changes',
    async (action) => {
      const f = await prepared(),
        command = input(f, action),
        first = await service.reviewMyProposal(f.identity, command);
      await db.progressionSetting.update({
        where: { id: f.setting.id },
        data: { incrementAbsolute: '5' },
      });
      const retry = await parallel.reviewMyProposal(f.identity, command);
      expect(retry).toEqual(first);
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(1);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe(first.toStatus);
    },
  );
  it.each([
    'action',
    'justification',
    'proposal',
    'acceptance',
    'version',
  ] as const)(
    'rejects reuse of an intent with different %s',
    async (change) => {
      const f = await prepared(),
        command = input(f),
        first = await service.reviewMyProposal(f.identity, command);
      const altered = {
        ...command,
        ...(change === 'action'
          ? { action: 'REJECT' as const, acceptance: undefined }
          : change === 'justification'
            ? { justification: 'changed' }
            : change === 'proposal'
              ? { recommendationId: randomUUID() }
              : change === 'acceptance'
                ? {
                    acceptance: {
                      ...command.acceptance!,
                      policyKey: '0'.repeat(64),
                    },
                  }
                : { expectedVersion: 1 }),
      };
      await expect(
        service.reviewMyProposal(f.identity, altered),
      ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
      expect(
        (
          await db.recommendationReview.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).toStatus,
      ).toBe('APPROVED');
    },
  );
  it.each(['APPROVE', 'REJECT'] as const)(
    'coalesces identical concurrent %s from separate connections',
    async (action) => {
      const f = await prepared(),
        command = input(f, action),
        events = await Promise.all([
          service.reviewMyProposal(f.identity, command),
          parallel.reviewMyProposal(f.identity, command),
        ]);
      expect(events[0]).toEqual(events[1]);
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(1);
    },
  );
  it('resolves a simultaneous approval/rejection with one winning event and one conflict', async () => {
    const f = await prepared(),
      result = await Promise.allSettled([
        service.reviewMyProposal(f.identity, input(f)),
        parallel.reviewMyProposal(f.identity, input(f, 'REJECT')),
      ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'REVIEW_CONFLICT' },
    });
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
  });
  it('does not overwrite a consumed version with a new decision intent', async () => {
    const f = await prepared();
    await service.reviewMyProposal(f.identity, input(f));
    await expect(
      service.reviewMyProposal(f.identity, input(f, 'REJECT')),
    ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
  });
  it.each(['APPROVED', 'REJECTED', 'APPLIED', 'EXPIRED', 'BLOCKED'] as const)(
    'preserves unaudited historical %s rather than inventing approval',
    async (status) => {
      const exercise = async (migrate?: () => Promise<void>) => {
        const f = await prepared();
        await db.progressionRecommendation.update({
          where: { id: f.proposal.id },
          data: { status },
        });
        if (migrate) await migrate();
        await expect(
          service.reviewMyProposal(f.identity, input(f, 'REJECT')),
        ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
        const v = await service.inspectMyProposal(
          f.identity,
          f.proposal.id,
          f.command,
        );
        expect(v.manualAuthorization.state).not.toBe(
          'ACCEPTED_FOR_THIS_PROPOSAL',
        );
        expect(
          await db.recommendationReview.count({
            where: { recommendationId: f.proposal.id },
          }),
        ).toBe(0);
      };
      if (status !== 'APPLIED') return exercise();
      return withPreOperationalSchema(async (historical, migrate) => {
        const originalDb = db,
          originalService = service;
        db = historical;
        service = new RecommendationService(
          new PrismaProgressionRepository(historical),
        );
        try {
          await exercise(migrate);
        } finally {
          db = originalDb;
          service = originalService;
        }
      });
    },
  );
  it.each(['missing', 'ack', 'scope', 'digest'] as const)(
    'blocks approval with %s explicit acceptance',
    async (mode) => {
      const f = await prepared(),
        c = input(f);
      const a =
        mode === 'missing'
          ? undefined
          : mode === 'ack'
            ? { ...c.acceptance!, acceptEvidence: false }
            : mode === 'scope'
              ? { ...c.acceptance!, scope: 'ALL_FUTURE' }
              : { ...c.acceptance!, authorizationKey: '0'.repeat(64) };
      await expect(
        service.reviewMyProposal(f.identity, {
          ...c,
          acceptance: a,
        } as ReviewCommand),
      ).rejects.toBeDefined();
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    },
  );
  it.each(['setting', 'version', 'load', 'retired', 'history'] as const)(
    'blocks approval after a %s dependency/destination change but permits explicit rejection',
    async (change) => {
      const f = await prepared(),
        c = input(f),
        t = f.target!;
      if (change === 'setting')
        await db.progressionSetting.update({
          where: { id: f.setting.id },
          data: { incrementAbsolute: '5' },
        });
      if (change === 'version')
        await db.trainingPlan.update({
          where: { id: t.plan.id },
          data: { version: { increment: 1 } },
        });
      if (change === 'load')
        await db.planExercise.update({
          where: { id: t.p.id },
          data: { targetLoad: '81' },
        });
      if (change === 'retired')
        await db.planDay.update({
          where: { id: t.day.id },
          data: {
            retiredAt: new Date('2026-01-12'),
            retiredFromOn: new Date('2026-01-12'),
          },
        });
      if (change === 'history')
        await db.workoutExercise.update({
          where: { id: f.tasks[0].id },
          data: { planExerciseId: t.p.id },
        });
      const v = await service.inspectMyProposal(
        f.identity,
        f.proposal.id,
        f.command,
      );
      expect(v.approvalBlockers.length).toBeGreaterThan(0);
      await expect(
        service.reviewMyProposal(f.identity, c),
      ).rejects.toMatchObject({ code: 'APPROVAL_BLOCKED' });
      expect(
        (await service.reviewMyProposal(f.identity, input(f, 'REJECT')))
          .toStatus,
      ).toBe('REJECTED');
    },
  );
  it('blocks task-only approval and still permits inspection and rejection', async () => {
    const f = await prepared(false);
    expect(f.view.compatibility.reasons).toContain('TARGET_NOT_RESOLVED');
    await expect(
      service.reviewMyProposal(f.identity, input(f)),
    ).rejects.toMatchObject({ code: 'APPROVAL_BLOCKED' });
    expect(
      (await service.reviewMyProposal(f.identity, input(f, 'REJECT'))).toStatus,
    ).toBe('REJECTED');
  });
  it('rejects obsolete/inaccessible sources without claiming they are current', async () => {
    const f = await prepared(),
      g = await reviewFixture(db);
    await db.exercise.update({
      where: { id: f.e.id },
      data: { origin: 'PERSONAL', ownerId: g.identity.account.id },
    });
    const v = await service.inspectMyProposal(
      f.identity,
      f.proposal.id,
      f.command,
    );
    expect(v.validity.state).toBe('SOURCE_INACCESSIBLE');
    expect(
      (
        await service.reviewMyProposal(f.identity, {
          ...input(f, 'REJECT'),
          command: undefined,
        })
      ).toStatus,
    ).toBe('REJECTED');
  });
  it.each(['revoked', 'expired', 'foreign', 'inactive', 'fabricated'] as const)(
    'requires an actual current owned auth session: %s',
    async (change) => {
      const f = await prepared(),
        g = await reviewFixture(db);
      let identity = f.identity;
      if (change === 'revoked')
        await db.authSession.update({
          where: { id: identity.sessionId },
          data: { revokedAt: new Date() },
        });
      if (change === 'expired')
        await db.authSession.update({
          where: { id: identity.sessionId },
          data: {
            createdAt: new Date('2019-01-01'),
            lastUsedAt: new Date('2019-01-01'),
            expiresAt: new Date('2020-01-01'),
          },
        });
      if (change === 'inactive')
        await db.user.update({
          where: { id: identity.account.id },
          data: { status: 'SUSPENDED' },
        });
      if (change === 'foreign')
        identity = { ...identity, sessionId: g.identity.sessionId };
      if (change === 'fabricated')
        identity = { ...identity, sessionId: randomUUID() };
      await expect(
        service.reviewMyProposal(identity, input(f)),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    },
  );
  it('never permits another athlete to inspect or review a proposal', async () => {
    const f = await prepared(),
      g = await reviewFixture(db);
    await expect(
      service.inspectMyProposal(g.identity, f.proposal.id, f.command),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(
      service.reviewMyProposal(g.identity, input(f)),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
  it('blocks expiry and preserves cycle reservation after rejection', async () => {
    const f = await prepared();
    await db.$executeRaw`UPDATE progression_recommendations SET expires_at=${new Date().toISOString()}::timestamptz WHERE id=${f.proposal.id}::uuid`;
    expect(
      (await service.inspectMyProposal(f.identity, f.proposal.id, f.command))
        .approvalBlockers,
    ).toContain('PROPOSAL_EXPIRED');
    await expect(
      service.reviewMyProposal(f.identity, input(f)),
    ).rejects.toMatchObject({ code: 'APPROVAL_BLOCKED' });
    await service.reviewMyProposal(f.identity, input(f, 'REJECT'));
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).cycleSlot,
    ).toBe(f.proposal.generation!.cycleSlot);
  });
  it('informs six-decimal incompatibility without rounding or authorizing it', async () => {
    const f = await reviewFixture(db);
    await plannedReviewTarget(db, f);
    f.command.policy!.grid.origin = '0.000001';
    const d = await service.proposeMyExercise(f.identity, f.command);
    expect(d.decision).toBe('INCREASE');
    const p = await service.saveMyProposal(f.identity, {
        command: f.command,
        expectedSemanticKey: d.semanticKey,
        expectedDependencyKeys: d.dependencyKeys,
      }),
      v = await service.inspectMyProposal(f.identity, p.id, f.command);
    expect(p.recommendedLoad).toBe('80.000001');
    expect(v.compatibility.reasons).toContain(
      'DESTINATION_DECIMAL_INCOMPATIBLE',
    );
  });
  it('keeps legacy metadata unknown, allows explicit pending rejection and forbids approval', async () => {
    const f = await reviewFixture(db),
      row = await db.progressionRecommendation.create({
        data: {
          athleteId: f.athleteId,
          exerciseId: f.e.id,
          recommendedLoad: '42.125',
          algorithmVersion: 'legacy',
          effectiveSettings: { unknown: true },
          justification: 'legacy',
        },
      });
    const v = await service.inspectMyProposal(f.identity, row.id);
    expect(v.validity.state).toBe('LEGACY_UNKNOWN');
    const c: ReviewCommand = {
      recommendationId: row.id,
      intentId: randomUUID(),
      action: 'APPROVE',
      expectedStatus: 'PENDING',
      expectedVersion: null,
      expectedSemanticKey: null,
      expectedCycleKey: null,
      expectedDependencyKeys: null,
    };
    await expect(service.reviewMyProposal(f.identity, c)).rejects.toMatchObject(
      { code: 'APPROVAL_BLOCKED' },
    );
    const e = await service.reviewMyProposal(f.identity, {
      ...c,
      intentId: randomUUID(),
      action: 'REJECT',
      justification: 'Reject unknown legacy evidence',
    });
    expect(e.semanticKey).toBeNull();
    expect(e.acceptance).toBeNull();
    expect(
      (await service.inspectMyProposal(f.identity, row.id)).validity.state,
    ).toBe('LEGACY_UNKNOWN');
  });
  it('keeps state unchanged if event persistence fails, then recovers', async () => {
    const f = await prepared(),
      c = input(f);
    const failing = db.$extends({
      query: {
        recommendationReview: {
          async create() {
            throw new Error('injected audit failure');
          },
        },
      },
    });
    const svc = new RecommendationService(
      new PrismaProgressionRepository(failing as unknown as PrismaService),
    );
    await expect(svc.reviewMyProposal(f.identity, c)).rejects.toThrow(
      'injected audit failure',
    );
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect((await service.reviewMyProposal(f.identity, c)).toStatus).toBe(
      'APPROVED',
    );
  });
  it('rolls back audit if the compare-and-swap transition fails', async () => {
    const f = await prepared();
    const failing = db.$extends({
      query: {
        progressionRecommendation: {
          async updateMany() {
            return { count: 0 };
          },
        },
      },
    });
    const svc = new RecommendationService(
      new PrismaProgressionRepository(failing as unknown as PrismaService),
    );
    await expect(
      svc.reviewMyProposal(f.identity, input(f)),
    ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).reviewVersion,
    ).toBeNull();
  });
  it('retries a configuration writer during approval and then rejects stale acceptance', async () => {
    const f = await prepared(),
      c = input(f);
    let once = true;
    const racing = db.$extends({
      query: {
        progressionSetting: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (once) {
              once = false;
              await second.progressionSetting.update({
                where: { id: f.setting.id },
                data: { incrementAbsolute: '5' },
              });
            }
            return rows;
          },
        },
      },
    });
    const svc = new RecommendationService(
      new PrismaProgressionRepository(racing as unknown as PrismaService),
    );
    await expect(svc.reviewMyProposal(f.identity, c)).rejects.toMatchObject({
      code: 'APPROVAL_BLOCKED',
    });
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it('protects events and generation metadata with real SQL restrictions', async () => {
    const f = await prepared(),
      e = await service.reviewMyProposal(f.identity, input(f));
    await expect(
      db.recommendationReview.update({
        where: { id: e.id },
        data: { justification: 'rewrite' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.recommendationReview.delete({ where: { id: e.id } }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionRecommendation.update({
        where: { id: f.proposal.id },
        data: { reviewVersion: null },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionRecommendation.update({
        where: { id: f.proposal.id },
        data: { snapshot: { changed: true } },
      }),
    ).rejects.toBeDefined();
  });
  it('rejects a versioned state transition without its audit at COMMIT', async () => {
    const f = await prepared();
    await expect(
      db.$transaction(async (tx) => {
        await tx.progressionRecommendation.update({
          where: { id: f.proposal.id },
          data: {
            status: 'APPROVED',
            reviewVersion: 1,
            reviewedAt: new Date(),
          },
        });
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
  it('rejects an orphan audit event at COMMIT and leaves no event', async () => {
    const f = await prepared();
    await expect(
      db.$transaction(async (tx) => {
        await tx.recommendationReview.create({
          data: {
            recommendationId: f.proposal.id,
            athleteId: f.athleteId,
            actorUserId: f.identity.account.id,
            intentId: randomUUID(),
            payloadKey: 'a'.repeat(64),
            schemaVersion: 'manual-recommendation-review-v1',
            action: 'REJECT',
            fromStatus: 'PENDING',
            toStatus: 'REJECTED',
            fromVersion: null,
            version: 1,
            semanticKey: f.proposal.generation!.semanticKey,
            cycleKey: f.proposal.generation!.cycleKey,
            dependencyKeys: f.proposal.generation!.draft.dependencyKeys,
            justification: 'orphan fixture',
          },
        });
      }),
    ).rejects.toBeDefined();
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it('retries a real plan writer during approval, then rejects changed destination evidence', async () => {
    const f = await prepared();
    let once = true;
    const observed = db.$extends({
      query: {
        planExercise: {
          async findFirst({ args, query }) {
            const row = await query(args);
            if (once) {
              once = false;
              await second.trainingPlan.update({
                where: { id: f.target!.plan.id },
                data: { version: { increment: 1 } },
              });
            }
            return row;
          },
        },
      },
    });
    const racing = new RecommendationService(
      new PrismaProgressionRepository(observed as unknown as PrismaService),
    );
    await expect(
      racing.reviewMyProposal(f.identity, input(f)),
    ).rejects.toMatchObject({ code: 'APPROVAL_BLOCKED' });
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
  });
  it.each([
    'actor',
    'missingAcceptance',
    'jsonNullAcceptance',
    'missingJustification',
  ] as const)('rejects SQL audit manipulation: %s', async (attack) => {
    const f = await prepared(),
      other = await reviewFixture(db),
      approve = attack !== 'actor' && attack !== 'missingJustification';
    await expect(
      db.$transaction(async (tx) => {
        await tx.recommendationReview.create({
          data: {
            recommendationId: f.proposal.id,
            athleteId: f.athleteId,
            actorUserId:
              attack === 'actor'
                ? other.identity.account.id
                : f.identity.account.id,
            intentId: randomUUID(),
            payloadKey: 'a'.repeat(64),
            schemaVersion: 'manual-recommendation-review-v1',
            action: approve ? 'APPROVE' : 'REJECT',
            fromStatus: 'PENDING',
            toStatus: approve ? 'APPROVED' : 'REJECTED',
            fromVersion: null,
            version: 1,
            semanticKey: f.proposal.generation!.semanticKey,
            cycleKey: f.proposal.generation!.cycleKey,
            dependencyKeys: f.proposal.generation!.draft.dependencyKeys,
            acceptance:
              attack === 'jsonNullAcceptance' ? Prisma.JsonNull : Prisma.DbNull,
            justification:
              attack === 'missingJustification' ? null : 'attack fixture',
          },
        });
      }),
    ).rejects.toBeDefined();
    expect(
      await db.recommendationReview.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).status,
    ).toBe('PENDING');
  });
  it('does not permit an application transition even with an application-shaped row in the same transaction', async () => {
    const f = await prepared();
    await service.reviewMyProposal(f.identity, input(f));
    await expect(
      db.$transaction(async (tx) => {
        await tx.progressionApplication.create({
          data: {
            recommendationId: f.proposal.id,
            appliedLoad: '82.5',
            origin: 'MANUAL',
            effectiveAt: new Date(),
          },
        });
        await tx.progressionRecommendation.update({
          where: { id: f.proposal.id },
          data: { status: 'APPLIED' },
        });
      }),
    ).rejects.toBeDefined();
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).status,
    ).toBe('APPROVED');
  });
  it.each(['semantic', 'cycle', 'dependencies', 'version'] as const)(
    'rejects manipulated expected %s without an audit or state change',
    async (field) => {
      const f = await prepared(),
        c = input(f),
        altered = {
          ...c,
          ...(field === 'semantic'
            ? { expectedSemanticKey: '0'.repeat(64) }
            : field === 'cycle'
              ? { expectedCycleKey: '0'.repeat(64) }
              : field === 'version'
                ? { expectedVersion: 1 }
                : {
                    expectedDependencyKeys: {
                      ...c.expectedDependencyKeys!,
                      evidence: '0'.repeat(64),
                    },
                  }),
        };
      await expect(
        service.reviewMyProposal(f.identity, altered),
      ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    },
  );
  it('protects the generation of an explicitly rejected legacy proposal after recording its audit', async () => {
    const f = await reviewFixture(db),
      p = await db.progressionRecommendation.create({
        data: {
          athleteId: f.athleteId,
          exerciseId: f.e.id,
          recommendedLoad: '42.125',
          algorithmVersion: 'legacy',
          effectiveSettings: { unknown: true },
          justification: 'legacy',
        },
      });
    await service.reviewMyProposal(f.identity, {
      recommendationId: p.id,
      intentId: randomUUID(),
      action: 'REJECT',
      expectedStatus: 'PENDING',
      expectedVersion: null,
      expectedSemanticKey: null,
      expectedCycleKey: null,
      expectedDependencyKeys: null,
      justification: 'Explicit rejection',
    });
    await expect(
      db.progressionRecommendation.update({
        where: { id: p.id },
        data: { recommendedLoad: '50' },
      }),
    ).rejects.toBeDefined();
  });

  it.each(['APPROVE', 'REJECT'] as const)(
    'allows only one of two concurrent %s decisions with different intent IDs',
    async (action) => {
      const f = await prepared(),
        outcomes = await Promise.allSettled([
          service.reviewMyProposal(f.identity, input(f, action)),
          parallel.reviewMyProposal(f.identity, input(f, action)),
        ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'REVIEW_CONFLICT' },
      });
      expect(
        await db.recommendationReview.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(1);
    },
  );
});
