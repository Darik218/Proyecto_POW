import { withPreOperationalSchema } from './helpers/pre-operational-schema';
import pg from 'pg';
import { PrismaDailyPlanningRepository } from '../src/training-plans/prisma-daily-planning.repository';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import { ProgressionModule } from '../src/progression/progression.module';
import { RecommendationService } from '../src/progression/recommendation.service';
import { OneRmService } from '../src/progression/one-rm.service';
import { recommendationPolicy } from './helpers/recommendation-fixtures';
import type { RecommendationCommand } from '../src/models/progression/recommendation-draft.model';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';
import { progressionIsolation } from './helpers/progression-isolation';
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-4B real PostgreSQL neutral recommendation persistence', () => {
  let db: PrismaService,
    second: PrismaService,
    service: RecommendationService,
    otherService: RecommendationService,
    close: () => Promise<void>;
  beforeAll(async () => {
    await progressionIsolation();
    db = new PrismaService();
    second = new PrismaService();
    await db.$connect();
    await second.$connect();
    const module = await Test.createTestingModule({
      imports: [ProgressionModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    await module.init();
    service = module.get(RecommendationService);
    close = () => module.close();
    otherService = new RecommendationService(
      new PrismaProgressionRepository(second),
    );
  });
  afterAll(async () => {
    await close?.();
    await db?.$disconnect();
    await second?.$disconnect();
  });
  async function fixture(unit: 'KG' | 'LB' = 'KG') {
    const u = await db.user.create({
      data: {
        email: randomUUID() + '@example.test',
        passwordHash: 'fixture',
        athlete: { create: {} },
      },
      include: { athlete: true },
    });
    const identity: AuthenticatedIdentity = {
      account: {
        id: u.id,
        email: u.email,
        status: u.status,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      },
      sessionId: randomUUID(),
    };
    const group = await db.muscleGroup.create({
      data: { key: randomUUID(), name: 'Fixture ' + randomUUID() },
    });
    const e = await db.exercise.create({
      data: {
        name: 'Fixture',
        equipment: 'barbell',
        primaryMuscleGroupId: group.id,
        oneRmSuitability: 'SUITABLE',
      },
    });
    const tasks = [];
    for (const date of ['2026-01-05', '2026-01-06']) {
      const session = await db.workoutSession.create({
        data: {
          athleteId: u.athlete!.id,
          status: 'COMPLETED',
          performedOn: new Date(date + 'T00:00:00Z'),
          timeZone: 'UTC',
          startedAt: new Date(date + 'T12:00:00Z'),
          finishedAt: new Date(date + 'T13:00:00Z'),
        },
      });
      const task = await db.workoutExercise.create({
        data: {
          sessionId: session.id,
          exerciseId: e.id,
          orderInSession: 1,
          targetSets: 1,
          targetRepsMin: 5,
          targetRepsMax: 6,
          targetLoad: '80',
          targetLoadUnit: unit,
          targetRpe: '8',
          originalSnapshot: {
            exercise: { id: e.id },
            targets: {
              targetSets: 1,
              targetRepsMin: 5,
              targetRepsMax: 6,
              targetLoad: '80',
              targetLoadUnit: unit,
              targetRpe: '8',
            },
          },
        },
      });
      await db.setRecord.create({
        data: {
          workoutExerciseId: task.id,
          setNumber: 1,
          status: 'COMPLETED',
          kind: 'WORK',
          isCompleted: true,
          repetitions: 6,
          load: '80',
          loadUnit: unit,
          loadKg: unit === 'KG' ? '80' : '36.287390',
          rpe: '7',
        },
      });
      tasks.push(task);
    }
    const setting = await db.progressionSetting.create({
      data: {
        athleteId: u.athlete!.id,
        minSuccessfulSessions: 2,
        targetRpeMin: 6,
        targetRpeMax: 8,
        incrementAbsolute: '2.5',
        maxIncrementPercent: '10',
      },
    });
    const ids = tasks.map((t) => t.id),
      policy = recommendationPolicy();
    policy.cohort = { mode: 'EXPLICIT_TASK_SET', taskIds: ids };
    policy.assessment.compliance!.slots = ids.map((taskId) => ({
      taskId,
      original: [1],
      adjusted: [1],
      originalLoadMeaning: 'EXTERNAL_TOTAL',
      adjustedLoadMeaning: 'EXTERNAL_TOTAL',
    }));
    policy.assessment.count!.anchorTaskId = ids[1];
    policy.settingLoadUnit = unit;
    policy.grid.unit = unit;
    const command: Mutable<RecommendationCommand> = {
      history: {
        exerciseId: e.id,
        from: '2026-01-01',
        to: '2026-01-11',
        timeZone: 'UTC',
        limit: 100,
        contexts: ids.map((workoutExerciseId) => ({
          workoutExerciseId,
          loadMeaning: 'EXTERNAL_TOTAL',
          protocolKey: 'fixture',
          equipmentKey: 'barbell',
          source: 'OWNER_DECLARATION_FOR_ANALYSIS',
        })),
        comparisons: [{ previousTaskId: ids[0], currentTaskId: ids[1] }],
      },
      period: {
        start: '2026-01-05',
        endExclusive: '2026-01-12',
        timeZone: 'UTC',
        cutoffOn: '2026-01-11',
        weekStartsOn: 1,
      },
      destination: { kind: 'WORKOUT_TASK', taskId: ids[1] },
      policy,
    };
    return { identity, athleteId: u.athlete!.id, e, tasks, setting, command };
  }
  async function planned(f: Awaited<ReturnType<typeof fixture>>) {
    const plan = await db.trainingPlan.create({
      data: { athleteId: f.athleteId, name: 'Editable intended destination' },
    });
    const week = await db.planWeek.create({
      data: { trainingPlanId: plan.id, weekNumber: 1 },
    });
    const day = await db.planDay.create({
      data: { planWeekId: week.id, name: 'Day', position: 1 },
    });
    const p = await db.planExercise.create({
      data: {
        planWeekId: week.id,
        planDayId: day.id,
        exerciseId: f.e.id,
        position: 1,
        targetSets: 1,
        targetRepsMin: 5,
        targetRepsMax: 6,
        targetLoad: '80',
        targetLoadUnit: 'KG',
        targetRpe: '8',
      },
    });
    f.command.destination = {
      kind: 'PRESCRIPTION',
      planId: plan.id,
      weekId: week.id,
      dayId: day.id,
      prescriptionId: p.id,
    };
    f.command.expectedPlanVersion = plan.version;
    f.command.policy!.baseline = 'DESTINATION_PRESCRIPTION';
    return { plan, week, day, p };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function envelope(f: F, command = f.command) {
    const d = await service.proposeMyExercise(f.identity, command);
    expect(d.decision).toBe('INCREASE');
    return {
      command,
      expectedSemanticKey: d.semanticKey,
      expectedDependencyKeys: d.dependencyKeys,
    };
  }
  const count = (f: F) =>
    db.progressionRecommendation.count({ where: { athleteId: f.athleteId } });
  it.each(['KG', 'LB'] as const)(
    'stores exact %s native values, canonical values, unchanged evidence and neutral authorization',
    async (unit) => {
      const f = await fixture(unit),
        input = await envelope(f),
        before = await db.workoutExercise.findMany({
          where: { exerciseId: f.e.id },
          include: { sets: true },
        });
      const result = await service.saveMyProposal(f.identity, input),
        row = await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: result.id },
          include: { evidence: true },
        });
      expect(result.status).toBe('PENDING');
      expect(result.generationAuthorization).toBe('NOT_GRANTED');
      expect(result.generation!.draft.semanticKey).toBe(
        input.expectedSemanticKey,
      );
      expect(row.previousLoad!.toFixed(6)).toBe('80.000000');
      expect(row.recommendedLoad.toFixed(6)).toBe('82.500000');
      expect(row.loadUnit).toBe(unit);
      expect(row.recommendedLoadKg!.toFixed(6)).toBe(
        unit === 'KG' ? '82.500000' : '37.421371',
      );
      expect(row.planExerciseId).toBeNull();
      expect(row.planWeekId).toBeNull();
      expect(row.evidence.map((x) => x.role)).toEqual(['CONTEXT', 'CONTEXT']);
      expect(row.expiresAt).toBeNull();
      expect(
        await db.workoutExercise.findMany({
          where: { exerciseId: f.e.id },
          include: { sets: true },
        }),
      ).toEqual(before);
      expect(await service.getMyProposal(f.identity, result.id)).toEqual(
        result,
      );
    },
  );
  it.each([
    'PENDING',
    'REJECTED',
    'APPLIED',
    'EXPIRED',
    'BLOCKED',
    'APPROVED',
  ] as const)(
    'retries preserve ID/date/evidence and current %s state even after source changes',
    async (status) => {
      const exercise = async (migrate?: () => Promise<void>) => {
        const f = await fixture(),
          input = await envelope(f),
          saved = await service.saveMyProposal(f.identity, input);
        await db.progressionRecommendation.update({
          where: { id: saved.id },
          data: { status },
        });
        if (migrate) await migrate();
        await db.progressionSetting.update({
          where: { id: f.setting.id },
          data: { incrementAbsolute: '5' },
        });
        const retried = await service.saveMyProposal(f.identity, input);
        expect(retried.id).toBe(saved.id);
        expect(retried.createdAt).toEqual(saved.createdAt);
        expect(retried.evidence).toEqual(saved.evidence);
        expect(retried.generation).toEqual(saved.generation);
        expect(retried.status).toBe(status);
        expect(await count(f)).toBe(1);
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
  it('coalesces identical concurrent writes from independent Prisma connections', async () => {
    const f = await fixture(),
      input = await envelope(f);
    const results = await Promise.all([
      service.saveMyProposal(f.identity, input),
      otherService.saveMyProposal(f.identity, input),
      service.saveMyProposal(f.identity, input),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await count(f)).toBe(1);
    expect(
      await db.recommendationEvidence.count({
        where: { recommendationId: results[0].id },
      }),
    ).toBe(2);
  });
  it('blocks competing fingerprints and never treats released/terminal cycles as authorization to replace', async () => {
    const f = await fixture(),
      first = await service.saveMyProposal(f.identity, await envelope(f));
    await db.progressionRecommendation.update({
      where: { id: first.id },
      data: { status: 'REJECTED', cycleSlot: null },
    });
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5' },
    });
    await expect(
      service.saveMyProposal(f.identity, await envelope(f)),
    ).rejects.toMatchObject({ code: 'CYCLE_CONFLICT' });
    expect(await count(f)).toBe(1);
  });
  it('allows only one competitor in a real simultaneous cycle race', async () => {
    const f = await fixture(),
      a = await envelope(f),
      c = structuredClone(f.command);
    c.policy = { ...c.policy!, id: 'another-explicit-policy' };
    const b = await envelope(f, c);
    const outcomes = await Promise.allSettled([
      service.saveMyProposal(f.identity, a),
      otherService.saveMyProposal(f.identity, b),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { code: 'CYCLE_CONFLICT' },
    });
    expect(await count(f)).toBe(1);
  });
  it.each(['increment', 'limit', 'scope', 'revision'] as const)(
    'rejects stale %s settings before insertion and reports configuration dependency',
    async (change) => {
      const f = await fixture(),
        input = await envelope(f);
      if (change === 'scope')
        await db.progressionSetting.create({
          data: {
            athleteId: f.athleteId,
            exerciseId: f.e.id,
            minSuccessfulSessions: 2,
            targetRpeMin: 6,
            targetRpeMax: 8,
            incrementAbsolute: '5',
            maxIncrementPercent: '10',
          },
        });
      else
        await db.progressionSetting.update({
          where: { id: f.setting.id },
          data:
            change === 'increment'
              ? { incrementAbsolute: '5' }
              : change === 'limit'
                ? { maxLoad: '81' }
                : { updatedAt: new Date('2026-11-10T00:00:00Z') },
        });
      await expect(
        service.saveMyProposal(f.identity, input),
      ).rejects.toMatchObject({
        code: 'STALE_PROPOSAL',
        changedDependencies: expect.arrayContaining(['configuration']),
      });
      expect(await count(f)).toBe(0);
    },
  );
  it.each(['policy', 'cohort', 'period'] as const)(
    'rejects a changed %s command using the old expected identity',
    async (change) => {
      const f = await fixture(),
        input = await envelope(f),
        c = structuredClone(f.command);
      if (change === 'policy') c.policy = { ...c.policy!, id: 'changed' };
      if (change === 'cohort')
        c.policy = {
          ...c.policy!,
          cohort: { mode: 'EXPLICIT_TASK_SET', taskIds: [f.tasks[1].id] },
        };
      if (change === 'period') {
        c.period = {
          ...c.period,
          start: '2026-01-12',
          endExclusive: '2026-01-19',
          cutoffOn: '2026-01-18',
        };
        c.history = { ...c.history, to: '2026-01-18' };
      }
      await expect(
        service.saveMyProposal(f.identity, { ...input, command: c }),
      ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
      expect(await count(f)).toBe(0);
    },
  );
  it('detects retrospective evidence and reports obsolescence without mutating the saved snapshot', async () => {
    const f = await fixture(),
      input = await envelope(f),
      saved = await service.saveMyProposal(f.identity, input);
    const s = await db.workoutSession.create({
      data: {
        athleteId: f.athleteId,
        status: 'COMPLETED',
        performedOn: new Date('2026-01-07'),
        timeZone: 'UTC',
      },
    });
    await db.workoutExercise.create({
      data: { sessionId: s.id, exerciseId: f.e.id, orderInSession: 1 },
    });
    const check = await service.checkMyProposal(
      f.identity,
      saved.id,
      f.command,
    );
    expect(check).toMatchObject({
      status: 'OBSOLETE',
      changedDependencies: expect.arrayContaining(['evidence']),
    });
    expect(
      (await service.getMyProposal(f.identity, saved.id))!.generation,
    ).toEqual(saved.generation);
  });
  it('rejects cross-owner saves/reads, inactive accounts and private exercise misuse', async () => {
    const f = await fixture(),
      g = await fixture(),
      input = await envelope(f);
    await expect(
      service.saveMyProposal(g.identity, input),
    ).rejects.toBeDefined();
    const saved = await service.saveMyProposal(f.identity, input);
    expect(await service.getMyProposal(g.identity, saved.id)).toBeNull();
    await db.exercise.update({
      where: { id: f.e.id },
      data: { origin: 'PERSONAL', ownerId: g.identity.account.id },
    });
    await expect(
      service.getMyProposal(f.identity, saved.id),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await db.user.update({
      where: { id: g.identity.account.id },
      data: { status: 'SUSPENDED' },
    });
    await expect(
      service.saveMyProposal(g.identity, input),
    ).rejects.toBeDefined();
  });
  it('preserves legacy ambiguity, status, values and nullable generation metadata', async () => {
    const f = await fixture(),
      row = await db.progressionRecommendation.create({
        data: {
          athleteId: f.athleteId,
          exerciseId: f.e.id,
          previousLoad: null,
          recommendedLoad: '42.125',
          algorithmVersion: 'old-unknown',
          status: 'APPLIED',
          effectiveSettings: { legacy: true },
          justification: 'legacy',
        },
      });
    const read = await service.getMyProposal(f.identity, row.id);
    expect(read).toMatchObject({
      generation: null,
      generationAuthorization: 'LEGACY_UNKNOWN',
      loadUnit: null,
      previousLoadKg: null,
      recommendedLoadKg: null,
      status: 'APPLIED',
      recommendedLoad: '42.125000',
    });
    expect(
      await service.checkMyProposal(f.identity, row.id, f.command),
    ).toMatchObject({ status: 'LEGACY_UNKNOWN' });
  });
  it('enforces SQL immutability, projection consistency, semantic uniqueness and exact evidence', async () => {
    const f = await fixture(),
      input = await envelope(f),
      saved = await service.saveMyProposal(f.identity, input);
    await expect(
      db.progressionRecommendation.update({
        where: { id: saved.id },
        data: { snapshot: { bad: true } },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.progressionRecommendation.delete({ where: { id: saved.id } }),
    ).rejects.toBeDefined();
    await expect(
      db.recommendationEvidence.deleteMany({
        where: { recommendationId: saved.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.recommendationEvidence.updateMany({
        where: { recommendationId: saved.id },
        data: { role: 'SATISFACTORY' },
      }),
    ).rejects.toBeDefined();
    const row = await db.progressionRecommendation.findUniqueOrThrow({
        where: { id: saved.id },
      }),
      { id: _id, createdAt: _createdAt, ...data } = row;
    await expect(
      db.progressionRecommendation.create({
        data: {
          ...data,
          effectiveSettings: data.effectiveSettings as Prisma.InputJsonValue,
          snapshot: data.snapshot as Prisma.InputJsonValue,
          dependencyKeys: data.dependencyKeys as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await count(f)).toBe(1);
  });
  it('rolls back recommendation and evidence when a required evidence insertion fails', async () => {
    const f = await fixture(),
      input = await envelope(f);
    const broken = db.$extends({
      query: {
        recommendationEvidence: {
          async createMany() {
            throw new Error('injected evidence failure');
          },
        },
      },
    });
    const fail = new RecommendationService(
      new PrismaProgressionRepository(broken as unknown as PrismaService),
    );
    await expect(fail.saveMyProposal(f.identity, input)).rejects.toThrow(
      'injected evidence failure',
    );
    expect(await count(f)).toBe(0);
    const saved = await service.saveMyProposal(f.identity, input);
    expect(saved.evidence).toHaveLength(2);
  });
  it('retries a real source update racing with the read, then rejects stale evidence', async () => {
    const f = await fixture(),
      input = await envelope(f);
    let once = true;
    const observed = db.$extends({
      query: {
        progressionSetting: {
          async findMany({ args, query }) {
            const result = await query(args);
            if (once) {
              once = false;
              await second.progressionSetting.update({
                where: { id: f.setting.id },
                data: { incrementAbsolute: '5' },
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
      racing.saveMyProposal(f.identity, input),
    ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
    expect(await count(f)).toBe(0);
  });
  it('preserves generation on a mismatched retry request and rejects unauthenticated target substitution', async () => {
    const f = await fixture(),
      input = await envelope(f),
      saved = await service.saveMyProposal(f.identity, input),
      command = structuredClone(f.command);
    command.policy = { ...command.policy!, version: 'future' };
    await expect(
      service.saveMyProposal(f.identity, { ...input, command }),
    ).rejects.toMatchObject({ code: 'REQUEST_MISMATCH' });
    expect(
      (await service.getMyProposal(f.identity, saved.id))!.generation,
    ).toEqual(saved.generation);
  });
  it('retains separate descriptive 1RM formulas without duplicating recommendation/session evidence', async () => {
    const f = await fixture(),
      set = await db.setRecord.findFirstOrThrow({
        where: { workoutExerciseId: f.tasks[0].id },
      });
    const estimates = new OneRmService(new PrismaProgressionRepository(db));
    await estimates.estimateFromSet(f.identity, {
      sourceSetId: set.id,
      expectedSetVersion: set.version,
      formulas: ['EPLEY', 'BRZYCKI'],
      interpretation: {
        meaning: 'EXTERNAL_TOTAL',
        source: 'OWNER_DECLARATION_AFTER_RECORDING',
      },
    });
    expect(
      await db.oneRmEstimate.count({ where: { sourceSetId: set.id } }),
    ).toBe(2);
    const result = await service.saveMyProposal(f.identity, await envelope(f));
    expect(result.evidence).toHaveLength(2);
    expect(await count(f)).toBe(1);
  });
  it('accepts a semantically identical retry with irrelevant contexts outside the captured cohort', async () => {
    const f = await fixture(),
      input = await envelope(f),
      saved = await service.saveMyProposal(f.identity, input);
    const command = structuredClone(f.command);
    command.history.contexts!.push({
      workoutExerciseId: randomUUID(),
      loadMeaning: 'EXTERNAL_TOTAL',
      source: 'OWNER_DECLARATION_FOR_ANALYSIS',
      protocolKey: 'ignored',
      equipmentKey: 'ignored',
    });
    const next = await service.proposeMyExercise(f.identity, command);
    expect(next.semanticKey).toBe(input.expectedSemanticKey);
    expect(
      (await service.saveMyProposal(f.identity, { ...input, command })).id,
    ).toBe(saved.id);
  });
  it('rejects inconsistent expected dependency keys before creating a row', async () => {
    const f = await fixture(),
      input = await envelope(f);
    await expect(
      service.saveMyProposal(f.identity, {
        ...input,
        expectedDependencyKeys: {
          ...input.expectedDependencyKeys,
          configuration: '0'.repeat(64),
        },
      }),
    ).rejects.toMatchObject({
      code: 'STALE_PROPOSAL',
      changedDependencies: ['configuration'],
    });
    expect(await count(f)).toBe(0);
  });

  it.each(['version', 'load', 'retired'] as const)(
    'revalidates the intended plan %s without persisting old evidence',
    async (change) => {
      const f = await fixture(),
        p = await planned(f),
        input = await envelope(f);
      if (change === 'version')
        await db.trainingPlan.update({
          where: { id: p.plan.id },
          data: { version: { increment: 1 } },
        });
      if (change === 'load')
        await db.planExercise.update({
          where: { id: p.p.id },
          data: { targetLoad: '81' },
        });
      if (change === 'retired')
        await db.planDay.update({
          where: { id: p.day.id },
          data: {
            retiredAt: new Date('2026-01-12'),
            retiredFromOn: new Date('2026-01-12'),
          },
        });
      await expect(
        service.saveMyProposal(f.identity, input),
      ).rejects.toMatchObject({
        code: 'STALE_PROPOSAL',
        changedDependencies: expect.arrayContaining(['destination']),
      });
      expect(await count(f)).toBe(0);
    },
  );
  it('saves an intended prescription without adding a planning historical protection', async () => {
    const f = await fixture(),
      p = await planned(f),
      input = await envelope(f),
      before = await db.trainingPlan.findUniqueOrThrow({
        where: { id: p.plan.id },
        include: { weeks: { include: { days: true, planExercises: true } } },
      });
    const saved = await service.saveMyProposal(f.identity, input);
    expect(
      await db.trainingPlan.findUniqueOrThrow({
        where: { id: p.plan.id },
        include: { weeks: { include: { days: true, planExercises: true } } },
      }),
    ).toEqual(before);
    expect(
      await db.progressionRecommendation.count({
        where: { OR: [{ planWeekId: p.week.id }, { planExerciseId: p.p.id }] },
      }),
    ).toBe(0);
    // Exercise-only source tasks are independent of this editable destination.
    const repository = new PrismaDailyPlanningRepository(db);
    const updated = await repository.change(f.athleteId, p.plan.id, p.week.id, {
      action: 'updateExercise',
      dayId: p.day.id,
      prescriptionId: p.p.id,
      input: { notes: 'still editable' },
    });
    expect(updated).toBeDefined();
    expect(
      (await db.planExercise.findUniqueOrThrow({ where: { id: p.p.id } }))
        .notes,
    ).toBe('still editable');
    expect(
      (await service.getMyProposal(f.identity, saved.id))!.generation!.draft
        .evidence.destination.prescriptionId,
    ).toBe(p.p.id);
  });
  it('retains a positive LB microincrement even if canonical rounding equals the previous KG value', async () => {
    const f = await fixture('LB');
    f.command.policy!.grid = { ...f.command.policy!.grid, origin: '0.000001' };
    const saved = await service.saveMyProposal(f.identity, await envelope(f));
    expect(saved.recommendedLoad).toBe('80.000001');
    expect(saved.previousLoadKg).toBe(saved.recommendedLoadKg);
  });
  it.each([
    'incomplete',
    'warmup',
    'omitted',
    'unknownUnit',
    'unknownMeaning',
    'partial',
    'truncated',
  ] as const)(
    'does not persist %s source evidence as an increase',
    async (change) => {
      const f = await fixture(),
        input = await envelope(f),
        set = await db.setRecord.findFirstOrThrow({
          where: { workoutExerciseId: f.tasks[0].id },
        });
      if (change === 'incomplete')
        await db.setRecord.update({
          where: { id: set.id },
          data: { status: 'INCOMPLETE', isCompleted: false },
        });
      if (change === 'warmup')
        await db.setRecord.update({
          where: { id: set.id },
          data: { kind: 'WARMUP' },
        });
      if (change === 'omitted')
        await db.workoutExercise.update({
          where: { id: f.tasks[0].id },
          data: { isOmitted: true },
        });
      if (change === 'unknownUnit')
        await db.setRecord.update({
          where: { id: set.id },
          data: { status: null, kind: null, loadUnit: null, loadKg: null },
        });
      if (change === 'unknownMeaning')
        f.command.policy!.loadMeaning = 'UNKNOWN';
      if (change === 'partial')
        await db.setRecord.update({
          where: { id: set.id },
          data: { repetitions: 4 },
        });
      if (change === 'truncated') f.command.history.limit = 1;
      await expect(
        service.saveMyProposal(f.identity, { ...input, command: f.command }),
      ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
      expect(await count(f)).toBe(0);
    },
  );
  it('bounds lock contention and reports a typed transient error without partial writes', async () => {
    const f = await fixture(),
      input = await envelope(f);
    let release!: () => void, ready!: () => void;
    const acquired = new Promise<void>((r) => (ready = r)),
      gate = new Promise<void>((r) => (release = r));
    const holding = second.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM athletes WHERE id=${f.athleteId}::uuid FOR UPDATE`;
      ready();
      await gate;
    });
    await acquired;
    try {
      await expect(
        service.saveMyProposal(f.identity, input),
      ).rejects.toMatchObject({ code: 'SOURCE_BUSY' });
      expect(await count(f)).toBe(0);
    } finally {
      release();
      await holding;
    }
    expect(
      (await service.saveMyProposal(f.identity, input)).evidence,
    ).toHaveLength(2);
  });
  it('rejects incomplete evidence during application mapping and rolls the parent row back', async () => {
    const f = await fixture(),
      input = await envelope(f);
    const partial = db.$extends({
      query: {
        recommendationEvidence: {
          async createMany({ args, query }) {
            const rows =
              args.data as Prisma.RecommendationEvidenceCreateManyInput[];
            return query({ ...args, data: rows.slice(0, 1) });
          },
        },
      },
    });
    const faulty = new RecommendationService(
      new PrismaProgressionRepository(partial as unknown as PrismaService),
    );
    await expect(
      faulty.saveMyProposal(f.identity, input),
    ).rejects.toBeDefined();
    expect(await count(f)).toBe(0);
    expect(
      await db.recommendationEvidence.count({
        where: { sessionId: { in: f.tasks.map((t) => t.sessionId) } },
      }),
    ).toBe(0);
  });
  it('persists exact six-decimal results beyond the former Decimal(8,3) range', async () => {
    const f = await fixture();
    for (const task of f.tasks) {
      await db.workoutExercise.update({
        where: { id: task.id },
        data: { targetLoad: '99999.999' },
      });
      await db.setRecord.updateMany({
        where: { workoutExerciseId: task.id },
        data: { load: '99999.999', loadKg: '99999.999' },
      });
    }
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '99999.999', maxIncrementPercent: '100' },
    });
    f.command.policy!.grid.step = '0.001';
    const saved = await service.saveMyProposal(f.identity, await envelope(f));
    expect(saved.recommendedLoad).toBe('199999.998000');
    expect(saved.recommendedLoadKg).toBe('199999.998000');
  });
  it('never interprets autoApplyAuthorized or a test policy as consent to application', async () => {
    const f = await fixture();
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { autoApplyAuthorized: true },
    });
    const saved = await service.saveMyProposal(f.identity, await envelope(f));
    expect(saved.status).toBe('PENDING');
    expect(saved.generationAuthorization).toBe('NOT_GRANTED');
    expect(
      saved.generation!.draft.evidence.configuration.selected!
        .autoApplyAuthorized,
    ).toBe(true);
    expect(
      await db.progressionApplication.count({
        where: { recommendationId: saved.id },
      }),
    ).toBe(0);
  });
  it('associates multiple captured tasks from one session only once and keeps mixed detail in the capture', async () => {
    const f = await fixture();
    await db.workoutExercise.update({
      where: { id: f.tasks[1].id },
      data: { sessionId: f.tasks[0].sessionId, orderInSession: 2 },
    });
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { minSuccessfulSessions: 1 },
    });
    f.command.policy!.assessment.count!.minimumSessions = 1;
    const saved = await service.saveMyProposal(f.identity, await envelope(f));
    expect(saved.generation!.draft.evidence.source.tasks).toHaveLength(2);
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0].role).toBe('CONTEXT');
  });
  it('enforces deferred SQL completeness at COMMIT even when the application is bypassed', async () => {
    const f = await fixture(),
      saved = await service.saveMyProposal(f.identity, await envelope(f)),
      client = new pg.Client({
        connectionString: await progressionIsolation(),
      });
    const id = randomUUID(),
      key = randomUUID().replaceAll('-', '').repeat(2);
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO progression_recommendations(id,athlete_id,exercise_id,previous_load,recommended_load,justification,status,algorithm_version,effective_settings,load_unit,previous_load_kg,recommended_load_kg,semantic_key,cycle_key,cycle_slot,request_key,snapshot,dependency_keys,proposal_kind)
       SELECT $1,athlete_id,exercise_id,previous_load,recommended_load,justification,'PENDING',algorithm_version,effective_settings,load_unit,previous_load_kg,recommended_load_kg,$2,$2,$2,request_key,snapshot,dependency_keys,proposal_kind FROM progression_recommendations WHERE id=$3`,
        [id, key, saved.id],
      );
      await client.query(
        "INSERT INTO recommendation_evidence(id,recommendation_id,session_id,role) VALUES($1,$2,$3,'CONTEXT')",
        [randomUUID(), id, f.tasks[0].sessionId],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
      });
      await client.query('ROLLBACK');
      expect(
        await db.progressionRecommendation.findUnique({ where: { id } }),
      ).toBeNull();
      expect(
        await db.recommendationEvidence.count({
          where: { recommendationId: id },
        }),
      ).toBe(0);
    } finally {
      await client.end();
    }
  });
});
