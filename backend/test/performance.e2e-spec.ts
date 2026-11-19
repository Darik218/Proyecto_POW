import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaClient } from '../src/generated/prisma/client';
import type { WorkoutSetStatus } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { ProgressionModule } from '../src/progression/progression.module';
import { RecommendationService } from '../src/progression/recommendation.service';
import { recommendationPolicy } from './helpers/recommendation-fixtures';
import type {
  RecommendationCommand,
  Destination,
} from '../src/models/progression/recommendation-draft.model';
import { AssessmentService } from '../src/progression/assessment.service';
import type { AssessmentOptions } from '../src/models/progression/prescription-assessment.model';
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
      assessment: AssessmentService,
      recommendations: RecommendationService,
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
      assessment = app.get(AssessmentService);
      recommendations = app.get(RecommendationService);
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
      // Keep the fixture's intended UTC instant under non-UTC server defaults.
      await writer.$executeRaw`UPDATE set_records SET recorded_at=${'2026-02-01T12:00:00.000Z'}::timestamptz WHERE id=${set.id}::uuid`;
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

    describe('PROG-3 assessment through the real SELECT-only module', () => {
      function assessmentPolicy(ids: string[]): AssessmentOptions {
        return {
          compliance: {
            id: 'test-policy-not-a-production-default',
            slots: ids.map((taskId) => ({
              taskId,
              original: [1],
              adjusted: [1],
              originalLoadMeaning: 'EXTERNAL_TOTAL',
              adjustedLoadMeaning: 'EXTERNAL_TOTAL',
            })),
            basic: {
              repetitions: 'MINIMUM',
              load: 'AT_LEAST_TARGET',
              rpe: 'DESCRIBE',
              coverage: 'ALL_REQUIRED',
            },
          },
        };
      }
      async function prepared(
        exerciseId: string,
        date = '2026-01-01',
        options: Parameters<typeof record>[2] = {},
      ) {
        const f = await record(exerciseId, date, {
          load: '80',
          reps: 6,
          rpe: '7',
          ...options,
        });
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: {
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: 6,
            targetLoad: '80',
            targetLoadUnit: 'KG',
            targetRpe: '8',
            originalSnapshot: {
              exercise: { id: exerciseId },
              targets: {
                targetSets: 1,
                targetRepsMin: 8,
                targetRepsMax: 10,
                targetLoad: '100',
                targetLoadUnit: 'KG',
                targetRpe: 8,
              },
            },
          },
        });
        return f;
      }
      async function assess(
        exerciseId: string,
        ids: string[],
        policy: AssessmentOptions = assessmentPolicy(ids),
        actor = owner,
      ) {
        return assessment.assessMyExercise(actor.identity, {
          history: query(exerciseId, ids),
          policy,
        });
      }
      it('keeps original, adjusted and actual values separate after persistence', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].original.basic.result).toBe('NOT_MET');
        expect(a.tasks[0].adjusted.basic.result).toBe('SATISFIED');
        expect(a.tasks[0].adjusted.slots[0].record).toMatchObject({
          id: f.set.id,
          version: 0,
          repetitions: 6,
          load: '80.000',
          rpe: '7.0',
        });
        expect(a.tasks[0].sessionVersion).toBe(0);
        expect(a.tasks[0].performedOn).toBe('2026-01-01');
      });
      it('requires explicit target load meaning despite known persisted actual units', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        const p = assessmentPolicy([f.workout.id]);
        const without = {
          ...p,
          compliance: {
            ...p.compliance!,
            slots: [{ taskId: f.workout.id, original: [1], adjusted: [1] }],
          },
        };
        const a = await assess(e.id, [f.workout.id], without);
        expect(a.tasks[0].adjusted.basic.result).toBe('NOT_EVALUABLE');
        expect(a.tasks[0].adjusted.slots[0].loadReasons).toContain(
          'TARGET_LOAD_MEANING_UNKNOWN',
        );
      });
      it('uses independent mappings after a real warmup and preserves extra sets', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        await writer.setRecord.update({
          where: { id: f.set.id },
          data: { kind: 'WARMUP' },
        });
        const work = await writer.setRecord.create({
          data: {
            workoutExerciseId: f.workout.id,
            setNumber: 2,
            status: 'COMPLETED',
            kind: 'WORK',
            isCompleted: true,
            repetitions: 6,
            load: '80',
            loadUnit: 'KG',
            loadKg: '80',
            rpe: '8',
          },
        });
        const p = assessmentPolicy([f.workout.id]);
        const mapped = {
          ...p,
          compliance: {
            ...p.compliance!,
            slots: [
              {
                taskId: f.workout.id,
                original: [2],
                adjusted: [2],
                originalLoadMeaning: 'EXTERNAL_TOTAL' as const,
                adjustedLoadMeaning: 'EXTERNAL_TOTAL' as const,
              },
            ],
          },
        };
        const a = await assess(e.id, [f.workout.id], mapped);
        expect(a.tasks[0].adjusted.basic.result).toBe('SATISFIED');
        expect(a.tasks[0].adjusted.slots[0].record?.id).toBe(work.id);
        expect(a.tasks[0].adjusted.additionalSetIds).toEqual([f.set.id]);
      });
      it.each(['INCOMPLETE', 'FAILED', 'PENDING', 'SKIPPED'] as const)(
        'retains persisted %s without crediting completed work',
        async (status) => {
          const e = await exercise(),
            f = await prepared(e.id);
          const pending = status === 'PENDING' || status === 'SKIPPED';
          await writer.setRecord.update({
            where: { id: f.set.id },
            data: {
              status,
              isCompleted: false,
              repetitions: pending ? null : status === 'FAILED' ? 0 : 3,
              load: pending ? null : '80',
              loadUnit: pending ? null : 'KG',
              loadKg: pending ? null : '80',
              rpe: null,
            },
          });
          const a = await assess(e.id, [f.workout.id]);
          expect(a.tasks[0].adjusted.basic.result).not.toBe('SATISFIED');
          expect(a.tasks[0].adjusted.slots[0].record?.status).toBe(status);
        },
      );
      it('does not infer a legacy status, unit or original snapshot', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        await writer.setRecord.update({
          where: { id: f.set.id },
          data: {
            status: null,
            kind: null,
            isCompleted: false,
            loadUnit: null,
            loadKg: null,
          },
        });
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: { originalSnapshot: { legacy: true } },
        });
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].original.status).toBe('NOT_EVALUABLE');
        expect(a.tasks[0].adjusted.basic.result).toBe('NOT_EVALUABLE');
        expect(a.tasks[0].adjusted.slots[0].reasons).toContain(
          'SET_STATUS_UNKNOWN',
        );
      });
      it('retains malformed target evidence instead of treating it as an absent optional load', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: {
            originalSnapshot: {
              targets: {
                targetSets: 1,
                targetRepsMin: 5,
                targetRepsMax: 6,
                targetLoad: true,
              },
            },
          },
        });
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].original.rawTargets?.targetLoad).toBe(true);
        expect(a.tasks[0].original.status).toBe('NOT_EVALUABLE');
      });
      it('preserves omitted and cancelled work without declaring satisfaction', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: { isOmitted: true },
        });
        await writer.workoutSession.update({
          where: { id: f.session.id },
          data: { status: 'CANCELLED' },
        });
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].adjusted.reasons).toEqual(
          expect.arrayContaining(['EXERCISE_OMITTED', 'SESSION_NOT_COMPLETED']),
        );
        expect(a.tasks[0].adjusted.basic.result).not.toBe('SATISFIED');
      });
      it('preserves LB input, known zero and unknown units without fabricating conversions', async () => {
        const e = await exercise(),
          f = await prepared(e.id, '2026-01-01', { load: '100', unit: 'LB' });
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: { targetLoad: '100', targetLoadUnit: 'LB' },
        });
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].adjusted.slots[0].loadDifferenceKg).toBe('0.000000');
        expect(a.tasks[0].adjusted.slots[0].record?.load).toBe('100.000');
        await writer.setRecord.update({
          where: { id: f.set.id },
          data: { load: '0', loadKg: '0', loadUnit: 'KG' },
        });
        await writer.workoutExercise.update({
          where: { id: f.workout.id },
          data: { targetLoad: '0', targetLoadUnit: 'KG' },
        });
        expect(
          (await assess(e.id, [f.workout.id])).tasks[0].adjusted.basic.result,
        ).toBe('SATISFIED');
        await writer.setRecord.update({
          where: { id: f.set.id },
          data: {
            loadUnit: null,
            loadKg: null,
            status: null,
            kind: null,
            isCompleted: false,
          },
        });
        expect(
          (await assess(e.id, [f.workout.id])).tasks[0].adjusted.basic.result,
        ).toBe('NOT_EVALUABLE');
      });
      it('keeps zero RPE distinct from missing RPE and never infers RIR', async () => {
        const e = await exercise(),
          f = await prepared(e.id, '2026-01-01', { rpe: '0' });
        expect(
          (await assess(e.id, [f.workout.id])).tasks[0].adjusted.rpeCoverage
            .valid,
        ).toBe(1);
        await writer.setRecord.update({
          where: { id: f.set.id },
          data: { rpe: null },
        });
        const a = await assess(e.id, [f.workout.id]);
        expect(a.tasks[0].adjusted.rpeCoverage).toMatchObject({
          valid: 0,
          missing: 1,
          percent: '0.000000',
        });
        expect(JSON.stringify(a)).not.toContain('rir');
      });
      it('enforces owner identity and private exercise visibility', async () => {
        const e = await exercise(owner.identity.account.id),
          f = await prepared(e.id);
        await expect(
          assess(e.id, [f.workout.id], assessmentPolicy([f.workout.id]), other),
        ).rejects.toThrow('SOURCE_NOT_FOUND');
        const global = await exercise();
        await prepared(global.id, '2026-01-01', { actor: other });
        expect((await assess(global.id, [])).tasks).toEqual([]);
      });
      it('uses sporting windows and refuses intraday chronology or time-zone substitutions', async () => {
        const e = await exercise(),
          a = await prepared(e.id),
          b = await prepared(e.id);
        const p = {
          ...assessmentPolicy([a.workout.id, b.workout.id]),
          signal: {
            id: 'signal',
            basis: 'ADJUSTED' as const,
            rpeComparison: 'MATCHED_LOAD_DESCRIPTIVE' as const,
            referenceSize: 1,
            rpeThreshold: '1',
            performanceThresholdPercent: '10',
            minimumRpeCoveragePercent: '100',
          },
        };
        const r = await assess(e.id, [a.workout.id, b.workout.id], p);
        expect(r.signals[0].reviewSignal).toBeNull();
        expect(r.signals[0].reasons).toContain('INTRADAY_ORDER_UNKNOWN');
        await writer.workoutSession.update({
          where: { id: b.session.id },
          data: {
            performedOn: new Date('2026-01-02T00:00:00Z'),
            timeZone: 'Europe/Madrid',
          },
        });
        expect(
          (await assess(e.id, [a.workout.id, b.workout.id], p)).signals[0]
            .reasons,
        ).toContain('TIME_ZONE_MISMATCH');
      });
      it('compares a declared review signal without changing strict PROG-2 RPE comparisons', async () => {
        const e = await exercise(),
          a = await prepared(e.id, '2026-01-01', { reps: 10, rpe: '7' }),
          b = await prepared(e.id, '2026-01-02', { reps: 8, rpe: '9' });
        const p = {
          ...assessmentPolicy([a.workout.id, b.workout.id]),
          signal: {
            id: 'signal',
            basis: 'ADJUSTED' as const,
            rpeComparison: 'MATCHED_LOAD_DESCRIPTIVE' as const,
            referenceSize: 1,
            rpeThreshold: '1',
            performanceThresholdPercent: '10',
            minimumRpeCoveragePercent: '100',
          },
        };
        const r = await assess(e.id, [a.workout.id, b.workout.id], p);
        expect(r.signals[0]).toMatchObject({
          reviewSignal: true,
          deltaRpe: '2.000000',
          deltaPerformancePercent: '-20.000000',
        });
        expect(r.strictComparisons[0].sets[0].rpe.delta).toBeNull();
        expect(r.tasks[0].adjusted.targets?.targetRepsMax).toBe(6);
      });
      it('reads under SELECT-only privileges and preserves exact planning, execution, estimates and settings rows', async () => {
        const e = await exercise(),
          f = await prepared(e.id);
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
          'progression_settings',
          'progression_recommendations',
        ];
        const fingerprints = () =>
          Promise.all(
            tables.map((table) =>
              writer.$queryRawUnsafe(
                `SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) AS digest FROM ${table} t`,
              ),
            ),
          );
        const before = await fingerprints();
        await assess(e.id, [f.workout.id]);
        await assess(e.id, [f.workout.id]);
        expect(await fingerprints()).toEqual(before);
      });
      it('propagates query truncation and does not prove a minimum from a partial window', async () => {
        const e = await exercise(),
          a = await prepared(e.id),
          b = await prepared(e.id, '2026-01-02');
        const p = {
          ...assessmentPolicy([a.workout.id]),
          count: {
            id: 'count',
            basis: 'ADJUSTED' as const,
            criterion: 'BASIC' as const,
            mode: 'ACCUMULATED' as const,
            sameDate: 'DISTINCT_SESSIONS' as const,
            minimumSessions: 1,
            anchorTaskId: a.workout.id,
          },
        };
        const q = { ...query(e.id), limit: 1 };
        const r = await assessment.assessMyExercise(owner.identity, {
          history: q,
          policy: p,
        });
        expect(r.coverage.truncated.tasks).toBe(true);
        expect(r.satisfactoryTasks.meetsMinimum).toBeNull();
        expect(
          await writer.workoutSession.count({
            where: { id: { in: [a.session.id, b.session.id] } },
          }),
        ).toBe(2);
      });
      it('uses the coherent PROG-2 snapshot rather than requerying goals or sets during assessment', async () => {
        const e = await exercise(),
          f = await prepared(e.id, '2026-01-01', {
            sessionStatus: 'IN_PROGRESS',
          });
        race = async () => {
          await writer.workoutExercise.update({
            where: { id: f.workout.id },
            data: { targetRepsMin: 9, targetRepsMax: 10 },
          });
          await writer.setRecord.update({
            where: { id: f.set.id },
            data: { repetitions: 4, version: 1 },
          });
        };
        const r = await assess(e.id, [f.workout.id]);
        expect(r.tasks[0].adjusted.targets?.targetRepsMin).toBe(5);
        expect(r.tasks[0].adjusted.slots[0].record?.repetitions).toBe(6);
        const next = await assess(e.id, [f.workout.id]);
        expect(next.tasks[0].adjusted.targets?.targetRepsMin).toBe(9);
        expect(next.tasks[0].adjusted.slots[0].record?.repetitions).toBe(4);
      });

      describe('PROG-4A weekly proposals through the read-only module', () => {
        async function configured(
          exerciseId: string,
          extra: {
            exerciseId?: string;
            trainingPlanId?: string;
            incrementAbsolute?: string | null;
            incrementPercent?: string | null;
            minSuccessfulSessions?: number;
            maxLoad?: string | null;
          } = {},
        ) {
          return writer.progressionSetting.create({
            data: {
              athleteId: owner.athleteId,
              targetRpeMin: '6',
              targetRpeMax: '8',
              minSuccessfulSessions: 2,
              incrementAbsolute: '2.5',
              maxIncrementPercent: '10',
              ...extra,
            },
          });
        }
        function request(
          exerciseId: string,
          ids: string[],
          destination: Destination = {
            kind: 'WORKOUT_TASK',
            taskId: ids[ids.length - 1],
          },
        ): RecommendationCommand {
          const policy = recommendationPolicy();
          return {
            history: { ...query(exerciseId, ids), to: '2026-01-11' },
            period: {
              start: '2026-01-05',
              endExclusive: '2026-01-12',
              timeZone: 'America/Bogota',
              cutoffOn: '2026-01-11',
              weekStartsOn: 1,
            },
            destination,
            policy: {
              ...policy,
              cohort: { mode: 'EXPLICIT_TASK_SET', taskIds: ids },
              assessment: {
                ...policy.assessment,
                compliance: {
                  ...assessmentPolicy(ids).compliance!,
                  readiness: policy.assessment.compliance!.readiness,
                },
                count: {
                  ...policy.assessment.count!,
                  anchorTaskId: ids[ids.length - 1],
                },
              },
            },
          };
        }
        async function pair() {
          const e = await exercise(),
            a = await prepared(e.id, '2026-01-05'),
            b = await prepared(e.id, '2026-01-06');
          return { e, a, b, ids: [a.workout.id, b.workout.id] };
        }
        async function destination(exerciseId: string, actor = owner) {
          const plan = await writer.trainingPlan.create({
            data: {
              athleteId: actor.athleteId,
              name: 'PROG4 fixture',
              status: 'DRAFT',
            },
          });
          const week = await writer.planWeek.create({
            data: { trainingPlanId: plan.id, weekNumber: 1 },
          });
          const day = await writer.planDay.create({
            data: { planWeekId: week.id, name: 'Push', position: 1 },
          });
          const prescription = await writer.planExercise.create({
            data: {
              planWeekId: week.id,
              planDayId: day.id,
              exerciseId,
              position: 1,
              targetSets: 1,
              targetRepsMin: 5,
              targetRepsMax: 6,
              targetLoad: '80',
              targetLoadUnit: 'KG',
              targetRpe: '8',
            },
          });
          return {
            plan,
            week,
            day,
            prescription,
            selector: {
              kind: 'PRESCRIPTION' as const,
              planId: plan.id,
              weekId: week.id,
              dayId: day.id,
              prescriptionId: prescription.id,
            },
          };
        }
        it('resolves an exercise configuration and proposes 82.5 KG without writing a recommendation', async () => {
          const f = await pair();
          const row = await configured(f.e.id, { exerciseId: f.e.id });
          const before = await writer.progressionRecommendation.count();
          const r = await recommendations.proposeMyExercise(
            owner.identity,
            request(f.e.id, f.ids),
          );
          expect(r).toMatchObject({
            decision: 'INCREASE',
            increment: { proposedLoad: '82.500000' },
            evidence: {
              configuration: { scope: 'EXERCISE', selected: { id: row.id } },
            },
          });
          expect(await writer.progressionRecommendation.count()).toBe(before);
        });

        it('computes a fully native LB proposal while retaining original and canonical source loads', async () => {
          const e = await exercise(),
            a = await prepared(e.id, '2026-01-05', { load: '100', unit: 'LB' }),
            b = await prepared(e.id, '2026-01-06', { load: '100', unit: 'LB' });
          await configured(e.id, { exerciseId: e.id });
          await writer.workoutExercise.updateMany({
            where: { id: { in: [a.workout.id, b.workout.id] } },
            data: { targetLoad: '100', targetLoadUnit: 'LB' },
          });
          const q = request(e.id, [a.workout.id, b.workout.id]);
          const r = await recommendations.proposeMyExercise(owner.identity, {
            ...q,
            policy: {
              ...q.policy!,
              settingLoadUnit: 'LB',
              grid: { ...q.policy!.grid, unit: 'LB' },
            },
          });
          expect(r).toMatchObject({
            decision: 'INCREASE',
            increment: {
              unit: 'LB',
              proposedLoad: '102.500000',
              proposedLoadKg: '46.493218',
            },
          });
          expect(r.evidence.source.sets[0]).toMatchObject({
            load: '100.000',
            loadUnit: 'LB',
            loadKg: '45.359237',
          });
        });
        it('resolves account activity from PostgreSQL rather than trusting the supplied identity status', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          await writer.user.update({
            where: { id: owner.identity.account.id },
            data: { status: 'SUSPENDED' },
          });
          try {
            await expect(
              recommendations.proposeMyExercise(
                owner.identity,
                request(f.e.id, f.ids),
              ),
            ).rejects.toThrow('SOURCE_NOT_FOUND');
          } finally {
            await writer.user.update({
              where: { id: owner.identity.account.id },
              data: { status: 'ACTIVE' },
            });
          }
        });
        it('resolves a general configuration for an exercise with no narrower row', async () => {
          const f = await pair();
          const general = await configured(f.e.id);
          try {
            expect(
              (
                await recommendations.proposeMyExercise(
                  owner.identity,
                  request(f.e.id, f.ids),
                )
              ).evidence.configuration.selected?.id,
            ).toBe(general.id);
          } finally {
            await writer.progressionSetting.delete({
              where: { id: general.id },
            });
          }
        });
        it('selects a complete plan row before exercise and general without merging', async () => {
          const f = await pair(),
            d = await destination(f.e.id);
          await configured(f.e.id, {
            exerciseId: f.e.id,
            incrementAbsolute: '5',
          });
          const specific = await configured(f.e.id, {
            exerciseId: f.e.id,
            trainingPlanId: d.plan.id,
          });
          const q = request(f.e.id, f.ids, d.selector);
          const r = await recommendations.proposeMyExercise(owner.identity, q);
          expect(r.evidence.configuration).toMatchObject({
            scope: 'EXERCISE_PLAN',
            selected: { id: specific.id, incrementAbsolute: '2.500' },
          });
        });
        it('does not fill an incomplete plan row from the valid exercise row', async () => {
          const f = await pair(),
            d = await destination(f.e.id);
          await configured(f.e.id, { exerciseId: f.e.id });
          await configured(f.e.id, {
            exerciseId: f.e.id,
            trainingPlanId: d.plan.id,
            incrementAbsolute: null,
          });
          expect(
            (
              await recommendations.proposeMyExercise(
                owner.identity,
                request(f.e.id, f.ids, d.selector),
              )
            ).decision,
          ).toBe('CONFIGURATION_REQUIRED');
        });
        it('rejects ambiguous dual increments unless the caller selects a mode explicitly', async () => {
          const f = await pair();
          await configured(f.e.id, {
            exerciseId: f.e.id,
            incrementPercent: '2',
          });
          const q = request(f.e.id, f.ids);
          expect(
            (await recommendations.proposeMyExercise(owner.identity, q))
              .reasons,
          ).toContain('AMBIGUOUS_INCREMENT_MODE');
          expect(
            (
              await recommendations.proposeMyExercise(owner.identity, {
                ...q,
                policy: { ...q.policy!, incrementMode: 'PERCENT' },
              })
            ).decision,
          ).toBe('NO_REPRESENTABLE_INCREMENT');
        });
        it('checks ownership of destination, exercise and account', async () => {
          const f = await pair(),
            foreign = await destination(f.e.id, other);
          await expect(
            recommendations.proposeMyExercise(
              owner.identity,
              request(f.e.id, f.ids, foreign.selector),
            ),
          ).rejects.toThrow('SOURCE_NOT_FOUND');
          const personal = await exercise(other.identity.account.id),
            recorded = await prepared(personal.id, '2026-01-05', {
              actor: other,
            });
          await expect(
            recommendations.proposeMyExercise(
              owner.identity,
              request(personal.id, [recorded.workout.id]),
            ),
          ).rejects.toThrow('SOURCE_NOT_FOUND');
          await expect(
            recommendations.proposeMyExercise(
              other.identity,
              request(f.e.id, f.ids),
            ),
          ).rejects.toThrow('SOURCE_NOT_FOUND');
        });

        it('resolves plan-specific settings for a WORKOUT_TASK actually linked to that prescription', async () => {
          const f = await pair(),
            d = await destination(f.e.id);
          await configured(f.e.id, { exerciseId: f.e.id });
          const specific = await configured(f.e.id, {
            exerciseId: f.e.id,
            trainingPlanId: d.plan.id,
            incrementAbsolute: '5',
          });
          await writer.workoutExercise.update({
            where: { id: f.b.workout.id },
            data: { planExerciseId: d.prescription.id },
          });
          const r = await recommendations.proposeMyExercise(
            owner.identity,
            request(f.e.id, f.ids),
          );
          expect(r.evidence.configuration.selected?.id).toBe(specific.id);
          expect(r.evidence.destination.planId).toBe(d.plan.id);
          expect(
            r.evidence.assessment?.tasks.find(
              (t) => t.taskId === f.b.workout.id,
            )?.original.targets?.targetLoad,
          ).toBe('100');
        });
        it('validates the complete plan/week/day/prescription hierarchy', async () => {
          const f = await pair(),
            d = await destination(f.e.id),
            wrong = await destination(f.e.id);
          await expect(
            recommendations.proposeMyExercise(
              owner.identity,
              request(f.e.id, f.ids, { ...d.selector, dayId: wrong.day.id }),
            ),
          ).rejects.toThrow('SOURCE_NOT_FOUND');
          await expect(
            recommendations.proposeMyExercise(
              owner.identity,
              request(f.e.id, f.ids, { ...d.selector, weekId: wrong.week.id }),
            ),
          ).rejects.toThrow('SOURCE_NOT_FOUND');
        });
        it('does not count another prescription under SAME_PRESCRIPTION', async () => {
          const f = await pair(),
            d = await destination(f.e.id);
          await configured(f.e.id, { exerciseId: f.e.id });
          await writer.workoutExercise.update({
            where: { id: f.b.workout.id },
            data: { planExerciseId: d.prescription.id },
          });
          const q = request(f.e.id, f.ids, d.selector),
            r = await recommendations.proposeMyExercise(owner.identity, {
              ...q,
              policy: { ...q.policy!, cohort: { mode: 'SAME_PRESCRIPTION' } },
            });
          expect(r.decision).toBe('MAINTAIN');
          expect(r.evidence.excludedTasks).toEqual([
            { taskId: f.a.workout.id, reason: 'OUTSIDE_EXPLICIT_COHORT' },
          ]);
          expect(
            r.evidence.assessment?.satisfactoryTasks.distinctSessions,
          ).toBe(1);
        });
        it('does not credit a completed session as readiness when the upper rep bound was not met', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          await writer.setRecord.update({
            where: { id: f.b.set.id },
            data: { repetitions: 5 },
          });
          expect(
            (
              await recommendations.proposeMyExercise(
                owner.identity,
                request(f.e.id, f.ids),
              )
            ).decision,
          ).toBe('MAINTAIN');
        });
        it('does not treat missing RPE under a required interval as zero or success', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          await writer.setRecord.update({
            where: { id: f.b.set.id },
            data: { rpe: null },
          });
          expect(
            (
              await recommendations.proposeMyExercise(
                owner.identity,
                request(f.e.id, f.ids),
              )
            ).decision,
          ).toBe('INSUFFICIENT_DATA');
        });
        it('uses a configured PROG3 review signal instead of proposing a load reduction', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          await writer.setRecord.update({
            where: { id: f.a.set.id },
            data: { repetitions: 10, rpe: '7' },
          });
          await writer.setRecord.update({
            where: { id: f.b.set.id },
            data: { repetitions: 8, rpe: '9' },
          });
          const q = request(f.e.id, f.ids);
          const p = {
            ...q.policy!,
            review: 'ANY_SIGNAL' as const,
            assessment: {
              ...q.policy!.assessment,
              signal: {
                id: 'signal',
                basis: 'ADJUSTED' as const,
                rpeComparison: 'MATCHED_LOAD_DESCRIPTIVE' as const,
                referenceSize: 1,
                rpeThreshold: '1',
                performanceThresholdPercent: '10',
                minimumRpeCoveragePercent: '100',
              },
            },
          };
          expect(
            await recommendations.proposeMyExercise(owner.identity, {
              ...q,
              policy: p,
            }),
          ).toMatchObject({ decision: 'REVIEW_REQUIRED', increment: null });
        });
        it('reads both persisted 1RM formulas only as descriptive separate context', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          await persist(f.a.set.id);
          await persist(f.b.set.id);
          const r = await recommendations.proposeMyExercise(
            owner.identity,
            request(f.e.id, f.ids),
          );
          expect(r.evidence.oneRm.groups.map((g) => g.formula).sort()).toEqual([
            'BRZYCKI',
            'EPLEY',
          ]);
          expect(
            r.evidence.oneRm.groups
              .flatMap((g) => g.points)
              .every((p) => p.evidenceStatus === 'NOT_ASSESSED'),
          ).toBe(true);
          expect(
            r.evidence.assessment?.satisfactoryTasks.distinctSessions,
          ).toBe(2);
        });
        it('keeps retrospective audit timestamps separate from sporting dates and cutoff', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          const q = request(f.e.id, f.ids);
          const r = await recommendations.proposeMyExercise(owner.identity, q);
          expect(r.evidence.source.sets[0].recordedAt).toContain('2026-02-01');
          expect(r.decision).toBe('INCREASE');
          await writer.workoutSession.update({
            where: { id: f.b.session.id },
            data: { performedOn: new Date('2026-01-12T00:00:00Z') },
          });
          expect(
            (await recommendations.proposeMyExercise(owner.identity, q))
              .decision,
          ).toBe('INSUFFICIENT_DATA');
        });
        it('propagates a history read limit without using a partial minimum', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          const q = request(f.e.id, f.ids);
          const r = await recommendations.proposeMyExercise(owner.identity, {
            ...q,
            history: { ...q.history, limit: 1 },
            destination: { kind: 'WORKOUT_TASK', taskId: f.b.workout.id },
          });
          expect(r.decision).toBe('INSUFFICIENT_DATA');
        });
        it('does not change exact persisted rows under its SELECT-only database role', async () => {
          const f = await pair();
          await configured(f.e.id, { exerciseId: f.e.id });
          const tables = [
            'training_plans',
            'plan_weeks',
            'plan_days',
            'plan_exercises',
            'workout_sessions',
            'workout_exercises',
            'set_records',
            'one_rm_estimates',
            'progression_settings',
            'progression_recommendations',
            'recommendation_evidence',
            'progression_applications',
          ];
          const digest = () =>
            Promise.all(
              tables.map((t) =>
                writer.$queryRawUnsafe(
                  `SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) AS digest FROM ${t} t`,
                ),
              ),
            );
          const before = await digest();
          const a = await recommendations.proposeMyExercise(
              owner.identity,
              request(f.e.id, f.ids),
            ),
            b = await recommendations.proposeMyExercise(
              owner.identity,
              request(f.e.id, [...f.ids]),
            );
          expect(a.semanticKey).toBe(b.semanticKey);
          expect(await digest()).toEqual(before);
        });
        it('reads setting, destination and sources from one repeatable snapshot under concurrent change', async () => {
          const f = await pair(),
            d = await destination(f.e.id),
            row = await configured(f.e.id, { exerciseId: f.e.id });
          const q = request(f.e.id, f.ids, d.selector);
          race = async () => {
            await writer.$transaction([
              writer.progressionSetting.update({
                where: { id: row.id },
                data: { incrementAbsolute: '5' },
              }),
              writer.trainingPlan.update({
                where: { id: d.plan.id },
                data: { version: 1 },
              }),
              writer.setRecord.update({
                where: { id: f.a.set.id },
                data: { rpe: '6', version: 1 },
              }),
            ]);
          };
          const first = await recommendations.proposeMyExercise(
              owner.identity,
              q,
            ),
            second = await recommendations.proposeMyExercise(owner.identity, q);
          expect(first.evidence.configuration.selected?.incrementAbsolute).toBe(
            '2.500',
          );
          expect(first.evidence.destination.planVersion).toBe(0);
          expect(
            first.evidence.source.sets.find((s) => s.id === f.a.set.id)
              ?.version,
          ).toBe(0);
          expect(
            second.evidence.configuration.selected?.incrementAbsolute,
          ).toBe('5.000');
          expect(second.evidence.destination.planVersion).toBe(1);
          expect(
            second.evidence.source.sets.find((s) => s.id === f.a.set.id)
              ?.version,
          ).toBe(1);
          expect(first.semanticKey).not.toBe(second.semanticKey);
        });
      });
    });
  },
);
