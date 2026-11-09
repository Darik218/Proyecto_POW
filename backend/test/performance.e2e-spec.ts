import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaClient } from '../src/generated/prisma/client';
import type { WorkoutSetStatus } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { ProgressionModule } from '../src/progression/progression.module';
import { PerformanceService } from '../src/progression/performance.service';
import { OneRmService } from '../src/progression/one-rm.service';
import { PrismaProgressionRepository } from '../src/progression/prisma-progression.repository';
import type {
  PerformanceQuery,
  TaskContext,
} from '../src/models/progression/performance-analysis.model';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';
import {
  evidenceIdentity,
  prepareEstimates,
} from '../src/domain/progression/estimate-evidence.policy';
import { progressionIsolation } from './helpers/progression-isolation';

const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated(
  'PROG-2 descriptive analysis with read-only PostgreSQL permissions',
  () => {
    let app: INestApplication,
      writer: PrismaService,
      reader: PrismaClient,
      service: PerformanceService,
      estimates: OneRmService;
    let owner: { identity: AuthenticatedIdentity; athleteId: string },
      other: typeof owner,
      muscle: string;
    let race: (() => Promise<void>) | null = null;
    beforeAll(async () => {
      const url = await progressionIsolation();
      writer = new PrismaService();
      await writer.$connect();
      const role = 'prog2_reader_' + randomUUID().replaceAll('-', '');
      await writer.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN`);
      await writer.$executeRawUnsafe(
        `GRANT CONNECT ON DATABASE pulso_prog1b_test TO "${role}"`,
      );
      await writer.$executeRawUnsafe(
        `GRANT USAGE ON SCHEMA public TO "${role}"`,
      );
      await writer.$executeRawUnsafe(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`,
      );
      const readUrl = new URL(url);
      readUrl.username = role;
      reader = new PrismaClient({
        adapter: new PrismaPg({ connectionString: readUrl.toString() }),
      });
      const observed = reader.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const result = await query(args);
              if (
                model === 'WorkoutExercise' &&
                operation === 'findMany' &&
                race
              ) {
                const action = race;
                race = null;
                await action();
              }
              return result;
            },
          },
        },
      });
      const module = await Test.createTestingModule({
        imports: [ProgressionModule],
      })
        .overrideProvider(PrismaService)
        .useValue(observed)
        .compile();
      app = module.createNestApplication();
      await app.init();
      service = app.get(PerformanceService);
      estimates = new OneRmService(new PrismaProgressionRepository(writer));
      async function actor() {
        const user = await writer.user.create({
          data: {
            email: `perf-${randomUUID()}@example.test`,
            passwordHash: 'fixture',
            athlete: { create: {} },
          },
          include: { athlete: true },
        });
        return {
          identity: {
            account: {
              id: user.id,
              email: user.email,
              status: user.status,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            },
            sessionId: randomUUID(),
          },
          athleteId: user.athlete!.id,
        };
      }
      owner = await actor();
      other = await actor();
      muscle = (
        await writer.muscleGroup.create({
          data: { key: 'performance-' + randomUUID(), name: 'Fixture muscle' },
        })
      ).id;
    });
    afterAll(async () => {
      await app?.close();
      await reader?.$disconnect();
      await writer?.$disconnect();
    });
    const exercise = (privateOwner?: string) =>
      writer.exercise.create({
        data: {
          name: 'Performance ' + randomUUID(),
          primaryMuscleGroupId: muscle,
          equipment: 'Recorded equipment label',
          origin: privateOwner ? 'PERSONAL' : 'GLOBAL',
          ownerId: privateOwner ?? null,
          oneRmSuitability: 'SUITABLE',
        },
      });
    async function record(
      exerciseId: string,
      date: string | null,
      options: {
        actor?: typeof owner;
        unit?: 'KG' | 'LB';
        load?: string;
        reps?: number;
        timeZone?: string;
        legacy?: boolean;
        rpe?: string;
        sessionStatus?: 'IN_PROGRESS' | 'COMPLETED';
      } = {},
    ) {
      const actor = options.actor ?? owner;
      const session = await writer.workoutSession.create({
        data: {
          athleteId: actor.athleteId,
          status: options.sessionStatus ?? 'COMPLETED',
          startedAt: new Date('2026-01-01T12:00:00Z'),
          finishedAt:
            options.sessionStatus === 'IN_PROGRESS'
              ? null
              : new Date('2026-01-01T13:00:00Z'),
          performedOn: date ? new Date(date + 'T00:00:00Z') : null,
          timeZone: date ? (options.timeZone ?? 'America/Bogota') : null,
          recordingMode: 'RETROSPECTIVE',
        },
      });
      const workout = await writer.workoutExercise.create({
        data: {
          sessionId: session.id,
          exerciseId,
          orderInSession: 1,
          targetSets: 3,
          targetRepsMin: 5,
          targetRepsMax: 5,
          targetLoad: '80',
          targetLoadUnit: 'KG',
          originalSnapshot: {
            targets: {
              targetSets: 3,
              targetLoad: '75',
              targetLoadUnit: 'KG',
              targetRpe: null,
            },
            notes: 'must-not-leak-original-notes',
          },
        },
      });
      const load = new Decimal(options.load ?? '100'),
        unit = options.unit ?? 'KG';
      const set = await writer.setRecord.create({
        data: {
          workoutExerciseId: workout.id,
          setNumber: 1,
          status: options.legacy ? null : 'COMPLETED',
          kind: options.legacy ? null : 'WORK',
          isCompleted: !options.legacy,
          load,
          loadUnit: options.legacy ? null : unit,
          loadKg: options.legacy
            ? null
            : load.mul(unit === 'LB' ? '0.45359237' : '1').toDecimalPlaces(6),
          repetitions: options.reps ?? 5,
          rpe: options.rpe ?? null,
          recordedAt: new Date('2026-02-01T12:00:00Z'),
        },
      });
      return { session, workout, set };
    }
    function context(workoutExerciseId: string): TaskContext {
      return {
        workoutExerciseId,
        loadMeaning: 'EXTERNAL_TOTAL',
        protocolKey: 'owner-declared-protocol',
        equipmentKey: 'owner-declared-equipment',
        source: 'OWNER_DECLARATION_FOR_ANALYSIS',
      };
    }
    function query(exerciseId: string, tasks: string[] = []): PerformanceQuery {
      return {
        exerciseId,
        from: '2026-01-01',
        to: '2026-01-31',
        timeZone: 'America/Bogota',
        limit: 20,
        contexts: tasks.map(context),
        comparisons:
          tasks.length === 2
            ? [{ previousTaskId: tasks[0], currentTaskId: tasks[1] }]
            : [],
      };
    }
    const persist = (setId: string) =>
      estimates.estimateFromSet(owner.identity, {
        sourceSetId: setId,
        expectedSetVersion: 0,
        formulas: ['EPLEY', 'BRZYCKI'],
        interpretation: {
          meaning: 'EXTERNAL_TOTAL',
          source: 'OWNER_DECLARATION_AFTER_RECORDING',
        },
      });

    it('queries owned history, sporting dates and separate original/adjusted/executed dimensions', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-03');
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        performedOn: '2026-01-03',
        originalTargets: { targetLoad: '75' },
        adjustedTargets: { targetLoad: '80.000' },
        groups: [{ recordedRepetitions: 5, volumeKgRepetitions: '500.000000' }],
      });
      expect(JSON.stringify(result)).not.toContain(
        'must-not-leak-original-notes',
      );
      expect(result.tasks[0].sets[0].record.recordedAt).toBe(
        '2026-02-01T12:00:00.000Z',
      );
    });
    it('keeps athlete identity server-derived and never returns another athlete history', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-01'),
        b = await record(e.id, '2026-01-02', { actor: other });
      const result = await service.analyzeMyExercise(owner.identity, {
        ...query(e.id),
        athleteId: other.athleteId,
      } as PerformanceQuery);
      expect(result.tasks.map((t) => t.id)).toEqual([a.workout.id]);
      expect(JSON.stringify(result)).not.toContain(b.session.id);
      expect(
        (
          await service.analyzeMyExercise(other.identity, query(e.id))
        ).tasks.map((t) => t.id),
      ).toEqual([b.workout.id]);
    });
    it('allows owned private exercises and refuses foreign private exercises', async () => {
      const e = await exercise(owner.identity.account.id),
        f = await record(e.id, '2026-01-01');
      expect(
        (await service.analyzeMyExercise(owner.identity, query(e.id))).tasks[0]
          .id,
      ).toBe(f.workout.id);
      await expect(
        service.analyzeMyExercise(other.identity, query(e.id)),
      ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    });
    it('retains multiple sessions on the same sporting date without deriving chronology from IDs', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-02'),
        b = await record(e.id, '2026-01-02');
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [a.workout.id, b.workout.id]),
      );
      expect(result.coverage.uniqueSessions).toBe(2);
      expect(result.comparisons[0]).toMatchObject({
        status: 'NOT_COMPARABLE',
        reasons: expect.arrayContaining(['INTRADAY_ORDER_UNKNOWN']),
        sets: [],
      });
    });
    it('compares explicit tasks by position, preserving decimal load differences and RPE', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-02', { rpe: '8' }),
        b = await record(e.id, '2026-01-09', { rpe: '9' });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [a.workout.id, b.workout.id]),
      );
      expect(result.comparisons[0]).toMatchObject({
        status: 'AVAILABLE',
        sets: [
          {
            deltaLoadKg: '0.000000',
            deltaLoadPercent: '0.000000',
            rpe: { delta: '1.0', description: 'HIGHER_DECLARED_EFFORT' },
          },
        ],
      });
    });
    it('reads both persisted formulas without duplicating volume, and never recalculates missing estimates', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-02'),
        b = await record(e.id, '2026-01-09', { load: '102.5' });
      await persist(a.set.id);
      await persist(b.set.id);
      const before = await writer.oneRmEstimate.count({
        where: { exerciseId: e.id },
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [a.workout.id, b.workout.id]),
      );
      expect(result.estimates.groups.map((g) => g.formula)).toEqual([
        'BRZYCKI',
        'EPLEY',
      ]);
      expect(result.estimates.groups.every((g) => g.points.length === 2)).toBe(
        true,
      );
      expect(result.tasks.map((t) => t.groups[0].volumeKgRepetitions)).toEqual([
        '500.000000',
        '512.500000',
      ]);
      expect(result.comparisons[0].estimates.differences).toHaveLength(2);
      expect(
        await writer.oneRmEstimate.count({ where: { exerciseId: e.id } }),
      ).toBe(before);
      expect(JSON.stringify(result)).not.toContain('numericPolicy":'); // No full source snapshots.
    });
    it('preserves algorithm versions as distinct individual histories', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-02');
      await persist(f.set.id);
      const repo = new PrismaProgressionRepository(writer);
      await repo.fromOwnedSource(
        owner.identity.account.id,
        f.set.id,
        (source) =>
          prepareEstimates(source, {
            sourceSetId: f.set.id,
            expectedSetVersion: 0,
            formulas: ['EPLEY'],
            interpretation: {
              meaning: 'EXTERNAL_TOTAL',
              source: 'OWNER_DECLARATION_AFTER_RECORDING',
            },
          }).map((d) => {
            const snapshot = {
              ...d.snapshot,
              calculationVersion: 'future-fixture',
            };
            return {
              ...d,
              snapshot,
              algorithmVersion: 'future-fixture',
              calculationKey: evidenceIdentity(snapshot),
            };
          }),
      );
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id),
      );
      expect(result.estimates.groups).toHaveLength(3);
      expect(
        result.estimates.groups
          .filter((g) => g.formula === 'EPLEY')
          .map((g) => g.algorithmVersion)
          .sort(),
      ).toEqual(['future-fixture', 'prog-1a-literal-v1']);
      expect(result.coverage.uniqueSessions).toBe(1);
    });
    it('reports legacy series and sourceless unknown-unit estimates without guessing execution or dates', async () => {
      const e = await exercise(),
        f = await record(e.id, null, { legacy: true });
      await writer.oneRmEstimate.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId: e.id,
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '110',
          formula: 'EPLEY',
          algorithmVersion: 'legacy-fixture',
        },
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id),
      );
      expect(result.tasks[0]).toMatchObject({
        performedOn: null,
        reasons: expect.arrayContaining(['DATE_UNKNOWN']),
        groups: [
          {
            status: null,
            recordedRepetitions: null,
            volumeKgRepetitions: null,
          },
        ],
      });
      expect(result.tasks[0].sets[0].record.isCompleted).toBe(false);
      expect(result.estimates.excluded[0]).toMatchObject({
        sourceSetId: null,
        unit: null,
        reasons: ['LEGACY_ESTIMATE_UNVERIFIABLE'],
      });
      expect(
        await writer.setRecord.findUnique({ where: { id: f.set.id } }),
      ).toMatchObject({ status: null, loadUnit: null });
    });
    it('keeps native pounds and canonical kilograms without inferring comparability', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-02', { unit: 'LB' });
      const unknown = await service.analyzeMyExercise(
        owner.identity,
        query(e.id),
      );
      expect(unknown.tasks[0].sets[0]).toMatchObject({
        record: { load: '100.000', loadUnit: 'LB', loadKg: '45.359237' },
        volumeKgRepetitions: null,
        reasons: expect.arrayContaining(['LOAD_MEANING_UNKNOWN']),
      });
      const known = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(known.tasks[0].groups[0].volumeKgRepetitions).toBe('226.796185');
    });
    it('respects inclusive date boundaries and never treats createdAt or recordedAt as performedOn', async () => {
      const e = await exercise();
      await record(e.id, '2025-12-31');
      const a = await record(e.id, '2026-01-01');
      const b = await record(e.id, '2026-01-31');
      await record(e.id, '2026-02-01');
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id),
      );
      expect(result.tasks.map((t) => t.id)).toEqual([
        a.workout.id,
        b.workout.id,
      ]);
    });
    it('does not convert dates across time zones without an explicit policy', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-01'),
        b = await record(e.id, '2026-01-02', { timeZone: 'UTC' });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [a.workout.id, b.workout.id]),
      );
      expect(result.comparisons[0].reasons).toContain('TIME_ZONE_MISMATCH');
      expect(result.tasks[1].performedOn).toBe('2026-01-02');
    });
    it('reports bounds rather than claiming to analyze unloaded records', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-01');
      await record(e.id, '2026-01-02');
      const result = await service.analyzeMyExercise(owner.identity, {
        ...query(e.id, [a.workout.id]),
        limit: 1,
      });
      expect(result).toMatchObject({
        status: 'PARTIAL',
        coverage: { tasksReturned: 1, truncated: { tasks: true } },
        warnings: expect.arrayContaining(['READ_LIMIT_REACHED']),
      });
    });
    it('caps set reads and exposes available and reviewed counts independently', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-01');
      await writer.setRecord.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({
          workoutExerciseId: f.workout.id,
          setNumber: i + 2,
          status: 'COMPLETED' as WorkoutSetStatus,
          kind: 'WORK' as const,
          isCompleted: true,
          load: '100',
          loadUnit: 'KG' as const,
          loadKg: '100',
          repetitions: 5,
        })),
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(result).toMatchObject({
        status: 'PARTIAL',
        coverage: { reviewedSets: 1000, truncated: { sets: true } },
        tasks: [{ coverage: { availableSets: 1001, reviewedSets: 1000 } }],
      });
    });
    it('uses a coherent repeatable snapshot when execution changes between batched reads', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-01', { sessionStatus: 'IN_PROGRESS' });
      race = async () => {
        await writer.$transaction([
          writer.setRecord.update({
            where: { id: f.set.id },
            data: { load: '110', loadKg: '110', version: { increment: 1 } },
          }),
          writer.workoutSession.update({
            where: { id: f.session.id },
            data: { version: { increment: 1 } },
          }),
        ]);
      };
      const during = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(during.tasks[0].sets[0].record).toMatchObject({
        load: '100.000',
        version: 0,
      });
      expect(during.tasks[0].sessionVersion).toBe(0);
      const after = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(after.tasks[0].sets[0].record).toMatchObject({
        load: '110.000',
        version: 1,
      });
      expect(after.tasks[0].sessionVersion).toBe(1);
    });
    it('has no write privilege and preserves exact persisted rows while analyzing', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-01');
      await persist(f.set.id);
      const tables = [
        'training_plans',
        'plan_weeks',
        'plan_days',
        'plan_exercises',
        'workout_sessions',
        'workout_exercises',
        'set_records',
        'one_rm_estimates',
        'progression_recommendations',
      ];
      async function fingerprints() {
        return Promise.all(
          tables.map((table) =>
            writer.$queryRawUnsafe(
              `SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) AS digest FROM ${table} t`,
            ),
          ),
        );
      }
      const before = await fingerprints();
      await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(await fingerprints()).toEqual(before);
      await expect(
        reader.oneRmEstimate.create({
          data: {
            athleteId: owner.athleteId,
            exerciseId: e.id,
            inputLoad: '100',
            inputReps: 5,
            estimatedOneRm: '116',
            formula: 'EPLEY',
            algorithmVersion: 'write-must-fail',
          },
        }),
      ).rejects.toThrow();
      expect(await fingerprints()).toEqual(before);
    });
    it('returns insufficient data for an empty window and rejects invalid or unselected contexts', async () => {
      const e = await exercise();
      expect(
        await service.analyzeMyExercise(owner.identity, query(e.id)),
      ).toMatchObject({ status: 'INSUFFICIENT_DATA', tasks: [] });
      await expect(
        service.analyzeMyExercise(owner.identity, {
          ...query(e.id),
          from: '2026-02-30',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
      await expect(
        service.analyzeMyExercise(owner.identity, query(e.id, [randomUUID()])),
      ).rejects.toMatchObject({ code: 'TASK_NOT_IN_SELECTION' });
    });
    it('does not treat persisted load meaning as proof of a comparable protocol', async () => {
      const e = await exercise(),
        a = await record(e.id, '2026-01-01'),
        b = await record(e.id, '2026-01-08');
      await persist(a.set.id);
      await persist(b.set.id);
      const result = await service.analyzeMyExercise(owner.identity, {
        ...query(e.id),
        comparisons: [
          { previousTaskId: a.workout.id, currentTaskId: b.workout.id },
        ],
      });
      expect(
        result.tasks.every(
          (t) => t.sets[0].meaningSource === 'PERSISTED_OWNER_DECLARATION',
        ),
      ).toBe(true);
      expect(result.comparisons[0]).toMatchObject({
        status: 'NOT_COMPARABLE',
        reasons: expect.arrayContaining([
          'PROTOCOL_NOT_COMPARABLE',
          'EQUIPMENT_NOT_COMPARABLE',
        ]),
        sets: [],
      });
    });
    it('does not leak cross-owned legacy estimate references', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-01');
      const foreign = await writer.oneRmEstimate.create({
        data: {
          athleteId: other.athleteId,
          exerciseId: e.id,
          sourceSetId: f.set.id,
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '900',
          formula: 'EPLEY',
          algorithmVersion: 'foreign-legacy-fixture',
        },
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(result.estimates.groups).toEqual([]);
      expect(result.estimates.excluded).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(foreign.id);
    });
    it('keeps owned history after catalog retirement without permitting new writes', async () => {
      const e = await exercise(),
        f = await record(e.id, '2026-01-01');
      await persist(f.set.id);
      await writer.exercise.update({
        where: { id: e.id },
        data: { isActive: false },
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id, [f.workout.id]),
      );
      expect(result.tasks).toHaveLength(1);
      expect(result.warnings).toContain('EXERCISE_INACTIVE');
      expect(result.estimates.groups).toHaveLength(2);
    });
    it('bounds unplaced legacy estimates and reports the incomplete selection', async () => {
      const e = await exercise();
      await writer.oneRmEstimate.createMany({
        data: Array.from({ length: 2001 }, () => ({
          athleteId: owner.athleteId,
          exerciseId: e.id,
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '116.667',
          formula: 'EPLEY' as const,
          algorithmVersion: 'legacy-fixture',
        })),
      });
      const result = await service.analyzeMyExercise(
        owner.identity,
        query(e.id),
      );
      expect(result.estimates.excluded).toHaveLength(2000);
      expect(result.coverage.truncated.estimates).toBe(true);
      expect(result.warnings).toContain('READ_LIMIT_REACHED');
      expect(
        await writer.oneRmEstimate.count({ where: { exerciseId: e.id } }),
      ).toBe(2001);
    });
  },
);
