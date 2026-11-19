import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { RecommendationService } from '../src/progression/recommendation.service';
import { applicationFixture } from './helpers/recommendation-application-fixtures';
import { reviewFixture } from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-5B exact authorized application with real PostgreSQL', () => {
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
  type F = Awaited<ReturnType<typeof applicationFixture>>;
  async function unchanged(f: F) {
    const tables = [
      'workout_sessions',
      'workout_exercises',
      'set_records',
      'one_rm_estimates',
      'recommendation_evidence',
      'recommendation_reviews',
      'scheduled_activities',
    ];
    const result: Record<string, string> = {};
    for (const table of tables) {
      const r = await db.$queryRawUnsafe<{ hash: string }[]>(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${table} t`,
      );
      result[table] = r[0].hash;
    }
    const parent = await db.progressionRecommendation.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    return {
      tables: result,
      parent: {
        snapshot: parent.snapshot,
        settings: parent.effectiveSettings,
        previousLoad: parent.previousLoad!.toFixed(6),
        recommendedLoad: parent.recommendedLoad.toFixed(6),
        reviewVersion: parent.reviewVersion,
        reviewedAt: parent.reviewedAt,
        cycleSlot: parent.cycleSlot,
      },
    };
  }
  async function noApplication(f: F) {
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
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(f.input.expectedPlanVersion);
  }
  it.each(['KG', 'LB'] as const)(
    'applies an accredited %s proposal atomically with exact Decimal and immutable audit',
    async (unit) => {
      const f = await applicationFixture(db, { unit }),
        before = await unchanged(f),
        result = await service.applyMyApprovedRecommendation(
          f.identity,
          f.input,
        );
      expect(result).toMatchObject({
        recommendationId: f.proposal.id,
        actorUserId: f.identity.account.id,
        reviewId: f.review!.id,
        previousLoad: '80.000000',
        appliedLoad: '82.500000',
        loadUnit: unit,
        origin: 'MANUAL',
      });
      expect(result.audit).toMatchObject({
        schemaVersion: 'manual-progression-application-v1',
        action: 'APPLY',
        fromStatus: 'APPROVED',
        toStatus: 'APPLIED',
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
      expect(
        (
          await db.trainingPlan.findUniqueOrThrow({
            where: { id: f.target.plan.id },
          })
        ).version,
      ).toBe(1);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe('APPLIED');
      expect(await unchanged(f)).toEqual(before);
      expect(
        await db.progressionApplication.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(1);
    },
  );
  it('preserves an exact 80.125000 grid value', async () => {
    const f = await applicationFixture(db, {
        increment: '0.125',
        step: '0.125',
      }),
      r = await service.applyMyApprovedRecommendation(f.identity, f.input);
    expect(r.appliedLoad).toBe('80.125000');
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('80.125');
  });
  it('returns the same application after response loss and later legitimate destination edits', async () => {
    const f = await applicationFixture(db),
      first = await service.applyMyApprovedRecommendation(f.identity, f.input);
    await db.planExercise.update({
      where: { id: f.target.p.id },
      data: { targetLoad: '90' },
    });
    await db.trainingPlan.update({
      where: { id: f.target.plan.id },
      data: { version: { increment: 1 } },
    });
    await db.scheduledActivity.update({
      where: { id: f.activity.id },
      data: { version: { increment: 1 }, title: 'Later edit' },
    });
    const retried = await parallel.applyMyApprovedRecommendation(
      f.identity,
      f.input,
    );
    expect(retried).toEqual(first);
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad!.toFixed(3),
    ).toBe('90.000');
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
  });
  it('coalesces identical simultaneous applications from independent connections', async () => {
    const f = await applicationFixture(db),
      r = await Promise.all([
        service.applyMyApprovedRecommendation(f.identity, f.input),
        parallel.applyMyApprovedRecommendation(f.identity, f.input),
      ]);
    expect(r[0]).toEqual(r[1]);
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
  });
  it('permits only one of two distinct intentions on the same recommendation', async () => {
    const f = await applicationFixture(db),
      r = await Promise.allSettled([
        service.applyMyApprovedRecommendation(f.identity, f.input),
        parallel.applyMyApprovedRecommendation(f.identity, {
          ...f.input,
          intentId: randomUUID(),
        }),
      ]);
    expect(r.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((v) => v.status === 'rejected')).toMatchObject({
      reason: { code: 'ALREADY_APPLIED' },
    });
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: f.proposal.id },
      }),
    ).toBe(1);
  });
  it.each(['load', 'destination', 'review', 'activity', 'version'] as const)(
    'rejects intent reuse with changed %s and does not touch the successful receipt',
    async (field) => {
      const f = await applicationFixture(db),
        first = await service.applyMyApprovedRecommendation(
          f.identity,
          f.input,
        ),
        c = structuredClone(f.input);
      if (field === 'load') c.appliedLoad = '85';
      if (field === 'destination') c.destination.prescriptionId = randomUUID();
      if (field === 'review') c.reviewId = randomUUID();
      if (field === 'activity') c.activityId = randomUUID();
      if (field === 'version') c.expectedPlanVersion = 2;
      await expect(
        service.applyMyApprovedRecommendation(f.identity, c),
      ).rejects.toMatchObject({ code: 'INTENT_REUSED' });
      expect(
        (
          await db.progressionApplication.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).appliedLoad.toFixed(3),
      ).toBe('82.500');
    },
  );
  it.each(['pending', 'unaudited', 'rejected', 'legacyApplication'] as const)(
    'requires accredited approval, not %s',
    async (kind) => {
      const f = await applicationFixture(db, { approve: false });
      if (kind === 'unaudited')
        await db.progressionRecommendation.update({
          where: { id: f.proposal.id },
          data: { status: 'APPROVED' },
        });
      if (kind === 'rejected')
        await service.reviewMyProposal(f.identity, {
          recommendationId: f.proposal.id,
          intentId: randomUUID(),
          action: 'REJECT',
          expectedStatus: 'PENDING',
          expectedVersion: null,
          expectedSemanticKey: f.draft.semanticKey,
          expectedCycleKey: f.input.expectedCycleKey,
          expectedDependencyKeys: f.draft.dependencyKeys,
          justification: 'fixture rejection',
        });
      if (kind === 'legacyApplication')
        await db.progressionApplication.create({
          data: {
            recommendationId: f.proposal.id,
            appliedLoad: '82.5',
            origin: 'MANUAL',
            effectiveAt: new Date(),
          },
        });
      await expect(
        service.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toBeDefined();
      if (kind !== 'legacyApplication') await noApplication(f);
    },
  );
  it.each(['foreign', 'revoked', 'expired', 'inactive', 'fabricated'] as const)(
    'checks current actor/session: %s',
    async (kind) => {
      const f = await applicationFixture(db),
        other = await reviewFixture(db);
      let identity = f.identity;
      if (kind === 'foreign') identity = other.identity;
      if (kind === 'revoked')
        await db.authSession.update({
          where: { id: identity.sessionId },
          data: { revokedAt: new Date() },
        });
      if (kind === 'expired')
        await db.authSession.update({
          where: { id: identity.sessionId },
          data: {
            createdAt: new Date('2019-01-01'),
            lastUsedAt: new Date('2019-01-01'),
            expiresAt: new Date('2020-01-01'),
          },
        });
      if (kind === 'inactive')
        await db.user.update({
          where: { id: identity.account.id },
          data: { status: 'SUSPENDED' },
        });
      if (kind === 'fabricated')
        identity = { ...identity, sessionId: randomUUID() };
      await expect(
        service.applyMyApprovedRecommendation(identity, f.input),
      ).rejects.toBeDefined();
      await noApplication(f);
    },
  );
  it.each([
    'planVersion',
    'baseline',
    'unit',
    'exercise',
    'setting',
    'policy',
    'retired',
    'active',
    'history',
    'prepared',
    'past',
    'omitted',
    'missingDate',
    'anotherActivityPast',
  ] as const)(
    'blocks changed or protected %s without applying',
    async (kind) => {
      const f = await applicationFixture(db),
        c = structuredClone(f.input);
      if (kind === 'planVersion')
        await db.trainingPlan.update({
          where: { id: f.target.plan.id },
          data: { version: { increment: 1 } },
        });
      if (kind === 'baseline')
        await db.planExercise.update({
          where: { id: f.target.p.id },
          data: { targetLoad: '81' },
        });
      if (kind === 'unit')
        await db.planExercise.update({
          where: { id: f.target.p.id },
          data: { targetLoadUnit: 'LB' },
        });
      if (kind === 'exercise') {
        const e = await db.exercise.create({
          data: {
            name: 'Changed',
            equipment: 'bar',
            primaryMuscleGroupId: f.e.primaryMuscleGroupId,
          },
        });
        await db.planExercise.update({
          where: { id: f.target.p.id },
          data: { exerciseId: e.id },
        });
      }
      if (kind === 'setting')
        await db.progressionSetting.update({
          where: { id: f.setting.id },
          data: { incrementAbsolute: '5' },
        });
      if (kind === 'policy') c.command.policy!.version = 'different';
      if (kind === 'retired')
        await db.planDay.update({
          where: { id: f.target.day.id },
          data: {
            retiredAt: new Date(),
            retiredFromOn: f.activity.scheduledOn,
          },
        });
      if (kind === 'active')
        await db.trainingPlan.update({
          where: { id: f.target.plan.id },
          data: { status: 'ACTIVE' },
        });
      if (kind === 'history')
        await db.workoutExercise.update({
          where: { id: f.tasks[0].id },
          data: { planExerciseId: f.target.p.id },
        });
      if (kind === 'prepared')
        await db.workoutSession.create({
          data: {
            athleteId: f.athleteId,
            status: 'PLANNED',
            trainingPlanId: f.target.plan.id,
            planWeekId: f.target.week.id,
            planDayId: f.target.day.id,
            scheduledActivityId: f.activity.id,
          },
        });
      if (kind === 'past')
        await db.scheduledActivity.update({
          where: { id: f.activity.id },
          data: {
            scheduledOn: new Date('2020-01-01'),
            version: { increment: 1 },
          },
        });
      if (kind === 'omitted')
        await db.scheduledActivity.update({
          where: { id: f.activity.id },
          data: { status: 'OMITTED' },
        });
      if (kind === 'missingDate') c.activityId = randomUUID();
      if (kind === 'anotherActivityPast')
        await db.scheduledActivity.create({
          data: {
            athleteId: f.athleteId,
            planWeekId: f.target.week.id,
            planDayId: f.target.day.id,
            originalOn: new Date('2020-01-01'),
            scheduledOn: new Date('2020-01-01'),
            timeZone: 'UTC',
            title: 'Past related activity',
          },
        });
      const before = await db.planExercise.findUniqueOrThrow({
        where: { id: f.target.p.id },
      });
      await expect(
        service.applyMyApprovedRecommendation(f.identity, c),
      ).rejects.toBeDefined();
      expect(
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        }),
      ).toEqual(before);
      expect(
        await db.progressionApplication.count({
          where: { recommendationId: f.proposal.id },
        }),
      ).toBe(0);
    },
  );
  it.each(['target', 'plan', 'application', 'status'] as const)(
    'rolls back all writes when %s persistence fails',
    async (which) => {
      const f = await applicationFixture(db);
      const failing = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              if (
                (which === 'target' &&
                  model === 'PlanExercise' &&
                  operation === 'updateMany') ||
                (which === 'plan' &&
                  model === 'TrainingPlan' &&
                  operation === 'updateMany') ||
                (which === 'application' &&
                  model === 'ProgressionApplication' &&
                  operation === 'create') ||
                (which === 'status' &&
                  model === 'ProgressionRecommendation' &&
                  operation === 'updateMany')
              )
                throw new Error('Injected ' + which + ' failure');
              return query(args);
            },
          },
        },
      });
      const svc = new RecommendationService(
        new PrismaProgressionRepository(failing as unknown as PrismaService),
      );
      await expect(
        svc.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toThrow('Injected');
      await noApplication(f);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe('APPROVED');
      expect(
        (await service.applyMyApprovedRecommendation(f.identity, f.input))
          .appliedLoad,
      ).toBe('82.500000');
    },
  );
  it('enforces receipt immutability and prevents APPLIED from reverting to APPROVED', async () => {
    const f = await applicationFixture(db),
      r = await service.applyMyApprovedRecommendation(f.identity, f.input);
    await expect(
      db.progressionApplication.update({
        where: { id: r.id },
        data: { appliedLoad: '85' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionApplication.delete({ where: { id: r.id } }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionRecommendation.update({
        where: { id: f.proposal.id },
        data: { status: 'APPROVED' },
      }),
    ).rejects.toBeDefined();
  });
  it('does not mark a managed recommendation APPLIED with only a status update', async () => {
    const f = await applicationFixture(db);
    await expect(
      db.progressionRecommendation.update({
        where: { id: f.proposal.id },
        data: { status: 'APPLIED' },
      }),
    ).rejects.toBeDefined();
    await noApplication(f);
  });
  it('rejects a prepared session committed between identity lookup and acquisition of source fences', async () => {
    const f = await applicationFixture(db);
    let once = true;
    const observed = db.$extends({
      query: {
        progressionApplication: {
          async findUnique({ args, query }) {
            const result = await query(args);
            if (once) {
              once = false;
              await second.workoutSession.create({
                data: {
                  athleteId: f.athleteId,
                  status: 'PLANNED',
                  trainingPlanId: f.target.plan.id,
                  planWeekId: f.target.week.id,
                  planDayId: f.target.day.id,
                  scheduledActivityId: f.activity.id,
                },
              });
            }
            return result;
          },
        },
      },
    });
    const racing = new RecommendationService(
      new PrismaProgressionRepository(observed as unknown as PrismaService),
    );
    await expect(
      racing.applyMyApprovedRecommendation(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'APPLICATION_BLOCKED' });
    await noApplication(f);
  });
  it('returns the winner receipt when an identical application commits before the loser acquires its fence', async () => {
    const f = await applicationFixture(db);
    let once = true;
    let winner: unknown;
    const observed = db.$extends({
      query: {
        progressionApplication: {
          async findUnique({ args, query }) {
            const result = await query(args);
            if (once) {
              once = false;
              winner = await parallel.applyMyApprovedRecommendation(
                f.identity,
                f.input,
              );
            }
            return result;
          },
        },
      },
    });
    const racing = new RecommendationService(
      new PrismaProgressionRepository(observed as unknown as PrismaService),
    );
    expect(
      await racing.applyMyApprovedRecommendation(f.identity, f.input),
    ).toEqual(winner);
    expect(
      (
        await db.trainingPlan.findUniqueOrThrow({
          where: { id: f.target.plan.id },
        })
      ).version,
    ).toBe(1);
  });
  it.each(['revocation', 'setting', 'baseline'] as const)(
    'sees %s committed after the initial lookup and before fences',
    async (kind) => {
      const f = await applicationFixture(db);
      let once = true;
      const observed = db.$extends({
        query: {
          progressionApplication: {
            async findUnique({ args, query }) {
              const result = await query(args);
              if (once) {
                once = false;
                if (kind === 'revocation')
                  await second.authSession.update({
                    where: { id: f.identity.sessionId },
                    data: { revokedAt: new Date() },
                  });
                if (kind === 'setting')
                  await second.progressionSetting.update({
                    where: { id: f.setting.id },
                    data: { incrementAbsolute: '5' },
                  });
                if (kind === 'baseline')
                  await second.planExercise.update({
                    where: { id: f.target.p.id },
                    data: { targetLoad: '81' },
                  });
              }
              return result;
            },
          },
        },
      });
      const racing = new RecommendationService(
        new PrismaProgressionRepository(observed as unknown as PrismaService),
      );
      await expect(
        racing.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toBeDefined();
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
      ).toBe(kind === 'baseline' ? '81.000' : '80.000');
    },
  );
  it('rereads every affected activity after locking, rejecting a concurrently moved activity', async () => {
    const f = await applicationFixture(db);
    let once = true;
    const observed = db.$extends({
      query: {
        scheduledActivity: {
          async findMany({ args, query }) {
            const result = await query(args);
            if (once) {
              once = false;
              await second.scheduledActivity.update({
                where: { id: f.activity.id },
                data: {
                  scheduledOn: new Date('2020-01-01'),
                  version: { increment: 1 },
                },
              });
            }
            return result;
          },
        },
      },
    });
    const racing = new RecommendationService(
      new PrismaProgressionRepository(observed as unknown as PrismaService),
    );
    await expect(
      racing.applyMyApprovedRecommendation(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'STALE_APPLICATION' });
    await noApplication(f);
  });
  it('bounds lock contention, rolls back, and can retry after the conflicting writer releases', async () => {
    const f = await applicationFixture(db);
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (acquired = r)),
      gate = new Promise<void>((r) => (release = r));
    const held = second.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM plan_exercises WHERE id=${f.target.p.id}::uuid FOR UPDATE`;
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    try {
      await expect(
        service.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toMatchObject({ code: 'SOURCE_BUSY' });
      await noApplication(f);
    } finally {
      release();
      await held;
    }
    expect(
      (await service.applyMyApprovedRecommendation(f.identity, f.input))
        .appliedLoad,
    ).toBe('82.500000');
  });
  it('uses actual UTC instants across non-UTC connections without changing their session defaults', async () => {
    const f = await applicationFixture(db);
    const clients = ['UTC', 'America/Bogota'].map(
      (zone) =>
        new PrismaClient({
          adapter: new PrismaPg({
            connectionString: process.env.PROG1B_TEST_DATABASE_URL,
            options: '-c TimeZone=' + zone,
            max: 1,
          }),
        }),
    );
    try {
      const services = clients.map(
        (client) =>
          new RecommendationService(
            new PrismaProgressionRepository(client as unknown as PrismaService),
          ),
      );
      const drafts = await Promise.all(
        services.map((s) => s.proposeMyExercise(f.identity, f.command)),
      );
      expect(drafts[0].semanticKey).toBe(drafts[1].semanticKey);
      expect(drafts[0].dependencyKeys).toEqual(drafts[1].dependencyKeys);
      expect(drafts[0].semanticKey).toBe(f.draft.semanticKey);
      const applied = await services[1].applyMyApprovedRecommendation(
        f.identity,
        f.input,
      );
      expect(
        await services[0].applyMyApprovedRecommendation(f.identity, f.input),
      ).toEqual(applied);
      const [physical] = await db.$queryRaw<
        { applied: string; reviewed: string; decided: string }[]
      >`SELECT to_char(a.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS applied,to_char(p.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reviewed,to_char(r.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided FROM progression_applications a JOIN progression_recommendations p ON p.id=a.recommendation_id JOIN recommendation_reviews r ON r.id=a.review_id WHERE a.id=${applied.id}::uuid`;
      expect(physical.applied).toBe(applied.effectiveAt.toISOString());
      expect(physical.reviewed).toBe(f.review!.decidedAt.toISOString());
      expect(physical.decided).toBe(physical.reviewed);
      await expect(
        services[1].applyMyApprovedRecommendation(f.identity, {
          ...f.input,
          intentId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_APPLIED' });
      for (const [i, zone] of ['UTC', 'America/Bogota'].entries())
        expect(
          (await clients[i].$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`)[0]
            .TimeZone,
        ).toBe(zone);
      expect(
        (
          await db.scheduledActivity.findUniqueOrThrow({
            where: { id: f.activity.id },
          })
        ).scheduledOn
          .toISOString()
          .slice(0, 10),
      ).toBe(f.input.expectedScheduledOn);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });
  it('returns a typed authentication failure for malformed identities', async () => {
    const f = await applicationFixture(db);
    await expect(
      service.applyMyApprovedRecommendation(
        { ...f.identity, sessionId: 'invalid' },
        f.input,
      ),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await noApplication(f);
  });
  it.each(['target', 'version', 'status'] as const)(
    'SQL constraints reject a transaction missing its actual %s write',
    async (missing) => {
      const f = await applicationFixture(db);
      const incomplete = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              if (
                operation === 'updateMany' &&
                ((missing === 'target' && model === 'PlanExercise') ||
                  (missing === 'version' && model === 'TrainingPlan') ||
                  (missing === 'status' &&
                    model === 'ProgressionRecommendation'))
              )
                return { count: 1 };
              return query(args);
            },
          },
        },
      });
      const svc = new RecommendationService(
        new PrismaProgressionRepository(incomplete as unknown as PrismaService),
      );
      await expect(
        svc.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toBeDefined();
      await noApplication(f);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe('APPROVED');
    },
  );
  it.each([
    'missingAudit',
    'wrongLoad',
    'foreignActor',
    'oldTime',
    'futureTime',
    'wrongLocalDay',
    'wrongReview',
    'missingAuthorization',
  ] as const)(
    'SQL rejects %s audit tampering and rolls back the destination',
    async (kind) => {
      const f = await applicationFixture(db),
        other = kind === 'foreignActor' ? await reviewFixture(db) : null;
      const tampered = db.$extends({
        query: {
          progressionApplication: {
            async create({ args, query }) {
              const audit = args.data.audit as unknown as {
                load: { appliedLoad: string };
                temporal: { checkedAt: string; localOn: string };
                authorization?: unknown;
              };
              if (kind === 'missingAudit') args.data.audit = Prisma.DbNull;
              if (kind === 'wrongLoad') audit.load.appliedLoad = '85';
              if (kind === 'foreignActor')
                args.data.actorUserId = other!.identity.account.id;
              if (kind === 'wrongReview') args.data.reviewId = randomUUID();
              if (kind === 'missingAuthorization') delete audit.authorization;
              if (kind === 'wrongLocalDay')
                audit.temporal.localOn = '2000-01-01';
              if (kind === 'oldTime' || kind === 'futureTime') {
                const t =
                  kind === 'oldTime'
                    ? new Date('2020-01-01')
                    : new Date('2100-01-01');
                args.data.effectiveAt = t;
                audit.temporal.checkedAt = t.toISOString();
                audit.temporal.localOn = t.toISOString().slice(0, 10);
              }
              return query(args);
            },
          },
        },
      });
      const svc = new RecommendationService(
        new PrismaProgressionRepository(tampered as unknown as PrismaService),
      );
      await expect(
        svc.applyMyApprovedRecommendation(f.identity, f.input),
      ).rejects.toBeDefined();
      await noApplication(f);
      expect(
        (
          await db.progressionRecommendation.findUniqueOrThrow({
            where: { id: f.proposal.id },
          })
        ).status,
      ).toBe('APPROVED');
    },
  );
  it('blocks approval and application instead of rounding an incompatible six-decimal proposal', async () => {
    const f = await applicationFixture(db, {
      approve: false,
      percent: '0.001',
      step: '0.000001',
    });
    expect(f.input.appliedLoad).toBe('80.000800');
    const inspected = await service.inspectMyProposal(
      f.identity,
      f.proposal.id,
      f.command,
    );
    expect(inspected.compatibility).toMatchObject({
      compatible: false,
      reasons: expect.arrayContaining(['DESTINATION_DECIMAL_INCOMPATIBLE']),
    });
    await expect(
      service.applyMyApprovedRecommendation(f.identity, f.input),
    ).rejects.toMatchObject({ code: 'APPLICATION_BLOCKED' });
    await noApplication(f);
  });
  it.each([
    'foreignReview',
    'differentDestination',
    'differentGeneration',
    'wrongGrid',
    'unit',
    'zero',
    'decrease',
    'outOfRange',
  ] as const)(
    'rejects unauthorized %s before touching planning',
    async (kind) => {
      const f = await applicationFixture(db),
        c = structuredClone(f.input);
      if (kind === 'foreignReview') {
        const other = await applicationFixture(db);
        c.reviewId = other.review!.id;
      }
      if (kind === 'differentDestination') c.destination.dayId = randomUUID();
      if (kind === 'differentGeneration')
        c.expectedSemanticKey = 'a'.repeat(64);
      if (kind === 'wrongGrid') c.command.policy!.grid.step = '3';
      if (kind === 'unit') c.loadUnit = 'LB';
      if (kind === 'zero') c.appliedLoad = '0';
      if (kind === 'decrease') c.appliedLoad = '79';
      if (kind === 'outOfRange') c.appliedLoad = '100000';
      await expect(
        service.applyMyApprovedRecommendation(f.identity, c),
      ).rejects.toBeDefined();
      await noApplication(f);
    },
  );
  it('fails closed when the editable-session fence cannot cover the athlete', async () => {
    const f = await applicationFixture(db);
    await db.workoutSession.createMany({
      data: Array.from({ length: 1001 }, () => ({
        athleteId: f.athleteId,
        status: 'PLANNED' as const,
      })),
    });
    await expect(
      service.applyMyApprovedRecommendation(f.identity, f.input),
    ).rejects.toMatchObject({
      code: 'APPLICATION_BLOCKED',
      reasons: ['SOURCE_COVERAGE_INCOMPLETE'],
    });
    await noApplication(f);
  });
});
