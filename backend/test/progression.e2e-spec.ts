import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Decimal } from '@prisma/client/runtime/client';
import type { AuthenticatedIdentity } from '../src/auth/auth.types';
import type {
  WorkoutStatus,
  WorkoutSetStatus,
  WorkoutSetKind,
  OneRmSuitability,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { ProgressionModule } from '../src/progression/progression.module';
import { OneRmService } from '../src/progression/one-rm.service';
import { PROGRESSION_REPOSITORY } from '../src/progression/progression.repository';
import type { ProgressionRepository } from '../src/progression/progression.repository';
import { WorkoutSessionsModule } from '../src/workout-sessions/workout-sessions.module';
import { WorkoutSessionsService } from '../src/workout-sessions/workout-sessions.service';
import { calculateOneRm } from '../src/domain/progression/one-rm';
import {
  prepareEstimates,
  evidenceIdentity,
} from '../src/domain/progression/estimate-evidence.policy';
import type {
  EstimateCommand,
  EvidenceValue,
} from '../src/models/progression/one-rm-estimate.model';
import { progressionIsolation } from './helpers/progression-isolation';

const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('PROG-1B real PostgreSQL descriptive estimation', () => {
  let app: INestApplication,
    prisma: PrismaService,
    service: OneRmService,
    repository: ProgressionRepository;
  type Actor = { identity: AuthenticatedIdentity; athleteId: string };
  let owner: Actor, other: Actor, groupId: string;
  const stamp = new Date('2026-01-01T12:00:00Z');
  beforeAll(async () => {
    await progressionIsolation();
    process.env.AUTH_ACCESS_TOKEN_SECRET ??=
      'isolated-progression-test-secret-at-least-32';
    process.env.AUTH_REFRESH_TOKEN_PEPPER ??=
      'isolated-progression-test-pepper-at-least-32';
    process.env.CORS_ORIGINS = 'http://localhost:5173';
    process.env.AUTH_COOKIE_SECURE = 'false';
    const module = await Test.createTestingModule({
      imports: [ProgressionModule, WorkoutSessionsModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(OneRmService);
    repository = app.get(PROGRESSION_REPOSITORY);
    async function actor(): Promise<Actor> {
      const user = await prisma.user.create({
        data: {
          email: `prog1b-${randomUUID()}@example.test`,
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
    groupId = (
      await prisma.muscleGroup.create({
        data: { key: 'prog1b-' + randomUUID(), name: 'Test muscle' },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });

  async function fixture(
    options: {
      actor?: Actor;
      load?: string;
      unit?: 'KG' | 'LB';
      sessionStatus?: WorkoutStatus;
      status?: WorkoutSetStatus | null;
      kind?: WorkoutSetKind | null;
      isOmitted?: boolean;
      suitability?: OneRmSuitability;
      privateOwner?: string;
      isActive?: boolean;
      repetitions?: number;
      rpe?: string | null;
    } = {},
  ) {
    const actor = options.actor ?? owner,
      status = options.status === undefined ? 'COMPLETED' : options.status;
    const sessionStatus = options.sessionStatus ?? 'COMPLETED';
    const exercise = await prisma.exercise.create({
      data: {
        name: 'PROG1B ' + randomUUID(),
        primaryMuscleGroupId: groupId,
        equipment: 'Fixture',
        oneRmSuitability: options.suitability ?? 'SUITABLE',
        isActive: options.isActive ?? true,
        origin: options.privateOwner ? 'PERSONAL' : 'GLOBAL',
        ownerId: options.privateOwner ?? null,
      },
    });
    const session = await prisma.workoutSession.create({
      data: {
        athleteId: actor.athleteId,
        status: sessionStatus,
        startedAt: sessionStatus === 'PLANNED' ? null : stamp,
        finishedAt:
          sessionStatus === 'COMPLETED' || sessionStatus === 'CANCELLED'
            ? new Date('2026-01-01T13:00:00Z')
            : null,
        performedOn: new Date('2026-01-01'),
        timeZone: 'America/Bogota',
        recordingMode: 'RETROSPECTIVE',
      },
    });
    const workout = await prisma.workoutExercise.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        orderInSession: 1,
        isOmitted: options.isOmitted ?? false,
        targetSets: 3,
        targetRepsMin: 5,
        targetRepsMax: 5,
        targetLoad: '100',
        targetLoadUnit: 'KG',
        originalSnapshot: { kind: 'FREE', targetLoad: '100' },
      },
    });
    const pending = status === 'PENDING' || status === 'SKIPPED';
    const load = new Decimal(options.load ?? '100'),
      unit = options.unit ?? 'KG';
    const set = await prisma.setRecord.create({
      data: {
        workoutExerciseId: workout.id,
        setNumber: 1,
        status,
        kind: options.kind === undefined ? 'WORK' : options.kind,
        load: pending ? null : load,
        loadUnit: pending || status === null ? null : unit,
        loadKg:
          pending || status === null
            ? null
            : load.mul(unit === 'LB' ? '0.45359237' : '1').toDecimalPlaces(6),
        repetitions: pending
          ? null
          : (options.repetitions ?? (status === 'FAILED' ? 0 : 5)),
        rpe: pending ? null : (options.rpe ?? null),
        isCompleted: status === 'COMPLETED',
        recordedAt: stamp,
      },
    });
    const command: EstimateCommand = {
      sourceSetId: set.id,
      expectedSetVersion: 0,
      formulas: ['EPLEY', 'BRZYCKI'],
      interpretation: {
        meaning: 'EXTERNAL_TOTAL',
        source: 'OWNER_DECLARATION_AFTER_RECORDING',
      },
    };
    return { exercise, session, workout, set, command };
  }

  it('resolves registered providers', () => {
    expect(service).toBeInstanceOf(OneRmService);
    expect(repository).toBeDefined();
  });
  it('persists both exact formulas and reproduces each from source snapshots', async () => {
    const f = await fixture(),
      rows = await service.estimateFromSet(owner.identity, f.command);
    expect(rows.map((r) => [r.formula, r.estimatedOneRm.toFixed(6)])).toEqual([
      ['EPLEY', '116.666667'],
      ['BRZYCKI', '112.500000'],
    ]);
    for (const row of rows) {
      const stored = await prisma.oneRmEstimate.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(stored).toMatchObject({
        athleteId: owner.athleteId,
        exerciseId: f.exercise.id,
        sourceSetId: f.set.id,
        sourceSetVersion: 0,
        inputLoadUnit: 'KG',
        resultUnit: 'KG',
        estimateKind: 'DESCRIPTIVE',
      });
      const snapshot = stored.snapshot as { [key: string]: EvidenceValue };
      expect(snapshot).toMatchObject({
        schemaVersion: 'one-rm-evidence-v1',
        evidenceStatus: 'NOT_ASSESSED',
        source: {
          setId: f.set.id,
          sessionId: f.session.id,
          workoutExerciseId: f.workout.id,
          athleteId: owner.athleteId,
        },
        interpretation: {
          source: 'OWNER_DECLARATION_AFTER_RECORDING',
          declaredByUserId: owner.identity.account.id,
        },
        eligibility: { warnings: ['EFFORT_UNVERIFIED'] },
      });
      expect(evidenceIdentity(snapshot)).toBe(stored.calculationKey);
      const input = snapshot.input as {
        load: string;
        loadUnit: string;
        repetitions: number;
      };
      const replay = calculateOneRm(input);
      expect(
        replay.ok &&
          replay.estimates.find((r) => r.formula === row.formula)
            ?.estimatedOneRm,
      ).toBe(stored.estimatedOneRm.toFixed(6));
    }
  });
  it('keeps pound original values and canonical kilograms', async () => {
    const f = await fixture({ unit: 'LB' }),
      [row] = await service.estimateFromSet(owner.identity, f.command);
    expect(row.inputLoad.toFixed(3)).toBe('100.000');
    expect(row.inputLoadUnit).toBe('LB');
    expect(row.inputLoadKg!.toFixed(6)).toBe('45.359237');
    expect(row.estimatedOneRm.toFixed(6)).toBe('52.919110');
  });
  it('stores six decimals and results larger than the previous column range', async () => {
    const f = await fixture({ load: '99999.999', repetitions: 10 });
    expect(
      (await service.estimateFromSet(owner.identity, f.command)).map((r) =>
        r.estimatedOneRm.toFixed(6),
      ),
    ).toEqual(['133333.332000', '133333.332000']);
  });
  it('returns original IDs, timestamps and snapshots for identical concurrent retries', async () => {
    const f = await fixture();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.estimateFromSet(owner.identity, f.command),
      ),
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(
      await service.estimateFromSet(owner.identity, {
        ...f.command,
        formulas: ['BRZYCKI', 'EPLEY'],
      }),
    ).toEqual(results[0]);
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(2);
  }, 30000);
  it('isolates creation and reading between athletes', async () => {
    const f = await fixture();
    await expect(
      service.estimateFromSet(other.identity, f.command),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(0);
    const [row] = await service.estimateFromSet(owner.identity, f.command);
    expect(await service.getMyEstimate(other.identity, row.id)).toBeNull();
    expect((await service.getMyEstimate(owner.identity, row.id))?.id).toBe(
      row.id,
    );
  });
  it('accepts owned private exercises and rejects foreign or inactive ones', async () => {
    const owned = await fixture({ privateOwner: owner.identity.account.id });
    expect(
      await service.estimateFromSet(owner.identity, owned.command),
    ).toHaveLength(2);
    for (const options of [
      { privateOwner: other.identity.account.id },
      { isActive: false },
    ]) {
      // Invalid ownership combination allowed by basic FKs must still be rejected.
      const f = await fixture(options);
      await expect(
        service.estimateFromSet(owner.identity, f.command),
      ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
      expect(
        await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
      ).toBe(0);
    }
  });
  it.each([
    { sessionStatus: 'PLANNED' },
    { sessionStatus: 'IN_PROGRESS' },
    { sessionStatus: 'CANCELLED' },
    { status: 'INCOMPLETE' },
    { status: 'FAILED' },
    { status: 'PENDING' },
    { status: 'SKIPPED' },
    { status: null, kind: null },
    { kind: 'WARMUP' },
    { isOmitted: true },
    { suitability: 'NOT_SUITABLE' },
    { suitability: 'UNDETERMINED' },
    { repetitions: 11 },
    { load: '0' },
  ] satisfies Parameters<typeof fixture>[0][])(
    'rejects noneligible source %j without writing',
    async (options) => {
      const f = await fixture(options);
      await expect(
        service.estimateFromSet(owner.identity, f.command),
      ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
      expect(
        await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
      ).toBe(0);
    },
  );
  it('requires explicit posterior interpretation, valid formulas and unchanged version', async () => {
    const f = await fixture();
    await expect(
      service.estimateFromSet(owner.identity, {
        ...f.command,
        interpretation: undefined,
      } as unknown as EstimateCommand),
    ).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED' });
    await expect(
      service.estimateFromSet(owner.identity, {
        ...f.command,
        expectedSetVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await expect(
      service.estimateFromSet(owner.identity, {
        ...f.command,
        formulas: ['UNKNOWN'],
      } as unknown as EstimateCommand),
    ).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(0);
  });
  it('preserves source, targets and existing completed-session edit restrictions', async () => {
    const f = await fixture();
    const beforeSet = await prisma.setRecord.findUnique({
      where: { id: f.set.id },
    });
    const beforeWorkout = await prisma.workoutExercise.findUnique({
      where: { id: f.workout.id },
    });
    const beforeSession = await prisma.workoutSession.findUnique({
      where: { id: f.session.id },
    });
    await service.estimateFromSet(owner.identity, f.command);
    expect(
      await prisma.setRecord.findUnique({ where: { id: f.set.id } }),
    ).toEqual(beforeSet);
    expect(
      await prisma.workoutExercise.findUnique({ where: { id: f.workout.id } }),
    ).toEqual(beforeWorkout);
    expect(
      await prisma.workoutSession.findUnique({ where: { id: f.session.id } }),
    ).toEqual(beforeSession);
    await expect(
      app.get(WorkoutSessionsService).recordSet(
        owner.identity,
        f.session.id,
        f.workout.id,
        {
          setNumber: 1,
          status: 'COMPLETED',
          kind: 'WORK',
          load: '90',
          loadUnit: 'KG',
          repetitions: 5,
          expectedVersion: f.session.version,
          expectedSetVersion: 0,
        },
        f.set.id,
      ),
    ).rejects.toThrow();
    expect(
      await prisma.setRecord.findUnique({ where: { id: f.set.id } }),
    ).toEqual(beforeSet);
  });
  it('enforces immutable snapshots and denies deleting modern evidence', async () => {
    const f = await fixture(),
      [row] = await service.estimateFromSet(owner.identity, f.command);
    await expect(
      prisma.oneRmEstimate.update({
        where: { id: row.id },
        data: { estimatedOneRm: '1' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneRmEstimate.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.oneRmEstimate.update({
        where: { id: row.id },
        data: {
          snapshot: {
            ...(row.snapshot as { [key: string]: EvidenceValue }),
            extraEvidence: 'changed',
          } as import('../src/generated/prisma/client').Prisma.InputJsonObject,
        },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.oneRmEstimate.findUnique({ where: { id: row.id } }),
    ).toMatchObject({ snapshot: row.snapshot });
  });
  it('rolls back both formulas on persistence failure, then permits retry', async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION prog1b_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_set_id='${f.set.id}'::uuid AND EXISTS (SELECT 1 FROM one_rm_estimates WHERE source_set_id=NEW.source_set_id) THEN RAISE EXCEPTION 'fixture rollback after first row'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER prog1b_test_failure BEFORE INSERT ON one_rm_estimates FOR EACH ROW EXECUTE FUNCTION prog1b_test_failure()',
    );
    try {
      await expect(
        service.estimateFromSet(owner.identity, f.command),
      ).rejects.toThrow();
      expect(
        await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER prog1b_test_failure ON one_rm_estimates',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION prog1b_test_failure()');
    }
    expect(
      await service.estimateFromSet(owner.identity, f.command),
    ).toHaveLength(2);
  });
  it('retains versioned evidence and rejects ownership conflicts without overwrites', async () => {
    const f = await fixture(),
      original = await service.estimateFromSet(owner.identity, f.command);
    const future = await repository.fromOwnedSource(
      owner.identity.account.id,
      f.set.id,
      (source) =>
        prepareEstimates(source, f.command).map((draft) => {
          // Test storage of another version, not a new algorithm exposed by service.
          const snapshot = {
            ...draft.snapshot,
            calculationVersion: 'future-test-fixture',
          };
          return {
            ...draft,
            algorithmVersion: 'future-test-fixture',
            snapshot,
            calculationKey: evidenceIdentity(snapshot),
          };
        }),
    );
    expect(future.map((r) => r.id)).not.toEqual(original.map((r) => r.id));
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(4);
    await expect(
      repository.fromOwnedSource(
        owner.identity.account.id,
        f.set.id,
        (source) =>
          prepareEstimates(source, f.command).map((draft) => ({
            ...draft,
            athleteId: other.athleteId,
          })),
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
    expect(await service.estimateFromSet(owner.identity, f.command)).toEqual(
      original,
    );
  });
  it('enforces conversion, references, full metadata and numeric column bounds', async () => {
    const f = await fixture();
    await expect(
      prisma.setRecord.update({
        where: { id: f.set.id },
        data: { loadKg: '99' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneRmEstimate.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId: f.exercise.id,
          sourceSetId: randomUUID(),
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '116',
          formula: 'EPLEY',
          algorithmVersion: 'legacy-fixture',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.oneRmEstimate.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId: f.exercise.id,
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '1000000000000000000',
          formula: 'EPLEY',
          algorithmVersion: 'legacy-fixture',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneRmEstimate.create({
        data: {
          athleteId: owner.athleteId,
          exerciseId: f.exercise.id,
          inputLoad: '100',
          inputReps: 5,
          estimatedOneRm: '116',
          formula: 'EPLEY',
          algorithmVersion: 'fixture',
          estimateKind: 'DESCRIPTIVE',
        },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(0);
  });

  it('rejects a row whose projection contradicts its own hashed snapshot', async () => {
    const f = await fixture();
    await expect(
      repository.fromOwnedSource(
        owner.identity.account.id,
        f.set.id,
        (source) =>
          prepareEstimates(source, f.command).map((draft) => ({
            ...draft,
            estimatedOneRm: '1',
          })),
      ),
    ).rejects.toThrow();
    expect(
      await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
    ).toBe(0);
  });

  it.each(['source', 'interpretation', 'input', 'exercise'])(
    'rejects forged %s evidence even with a recalculated hash',
    async (section) => {
      const f = await fixture();
      await expect(
        repository.fromOwnedSource(
          owner.identity.account.id,
          f.set.id,
          (source) =>
            prepareEstimates(source, f.command).map((draft) => {
              const original = draft.snapshot[section] as {
                [key: string]: EvidenceValue;
              };
              const change: { [key: string]: EvidenceValue } =
                section === 'source'
                  ? { sessionId: randomUUID(), workoutExerciseId: randomUUID() }
                  : section === 'interpretation'
                    ? { declaredByUserId: other.identity.account.id }
                    : section === 'input'
                      ? { rpe: '10' }
                      : { oneRmSuitability: 'UNDETERMINED' };
              const snapshot = {
                ...draft.snapshot,
                [section]: { ...original, ...change },
              };
              return {
                ...draft,
                snapshot,
                calculationKey: evidenceIdentity(snapshot),
              };
            }),
        ),
      ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
      expect(
        await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
      ).toBe(0);
    },
  );

  it('rereads a locked source and rejects a stale version after concurrent completion', async () => {
    const f = await fixture({ sessionStatus: 'IN_PROGRESS' });
    const locker = new pg.Client({
      connectionString: await progressionIsolation(),
    });
    await locker.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await locker.query('BEGIN');
      await locker.query(
        'SELECT id FROM workout_sessions WHERE id=$1 FOR UPDATE',
        [f.session.id],
      );
      await locker.query(
        'UPDATE set_records SET load=90,load_kg=90,version=1 WHERE id=$1',
        [f.set.id],
      );
      const lockedSource = (
        await locker.query(
          'SELECT started_at::text AS started FROM workout_sessions WHERE id=$1',
          [f.session.id],
        )
      ).rows[0];
      expect(lockedSource.started).not.toBeNull();
      await locker.query(
        "UPDATE workout_sessions SET status='COMPLETED',finished_at=started_at + interval '1 hour',version=1 WHERE id=$1",
        [f.session.id],
      );
      const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      outcome = service.estimateFromSet(owner.identity, f.command).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        const { rows } = await locker.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (rows[0].n > 0) {
          blocked = true;
          break;
        }
        await new Promise((ok) => setTimeout(ok, 10));
      }
      expect(blocked).toBe(true);
      await locker.query('COMMIT');
      expect(await outcome).toMatchObject({
        error: { code: 'SOURCE_CHANGED' },
      });
      expect(
        await prisma.oneRmEstimate.count({ where: { sourceSetId: f.set.id } }),
      ).toBe(0);
      const [row] = await service.estimateFromSet(owner.identity, {
        ...f.command,
        expectedSetVersion: 1,
      });
      expect(row.inputLoad.toFixed(3)).toBe('90.000');
      expect(row.sourceSetVersion).toBe(1);
    } finally {
      await locker.query('ROLLBACK');
      await locker.end();
      await outcome;
    }
  });

  it('calculates from executed results without changing an associated prescription or plan', async () => {
    const f = await fixture();
    const plan = await prisma.trainingPlan.create({
      data: {
        athleteId: owner.athleteId,
        name: 'PROG1B immutable source plan',
      },
    });
    const week = await prisma.planWeek.create({
      data: { trainingPlanId: plan.id, weekNumber: 1 },
    });
    const day = await prisma.planDay.create({
      data: { planWeekId: week.id, name: 'Source day', position: 1 },
    });
    const prescription = await prisma.planExercise.create({
      data: {
        planWeekId: week.id,
        planDayId: day.id,
        exerciseId: f.exercise.id,
        position: 1,
        targetSets: 3,
        targetReps: 5,
        targetLoad: '75',
        targetLoadUnit: 'KG',
      },
    });
    await prisma.workoutSession.update({
      where: { id: f.session.id },
      data: { trainingPlanId: plan.id, planWeekId: week.id, planDayId: day.id },
    });
    await prisma.workoutExercise.update({
      where: { id: f.workout.id },
      data: {
        planExerciseId: prescription.id,
        targetLoad: '80',
        originalSnapshot: { targetLoad: '75' },
      },
    });
    const [row] = await service.estimateFromSet(owner.identity, f.command);
    expect(row.estimatedOneRm.toFixed(6)).toBe('116.666667');
    expect(
      await prisma.planExercise.findUnique({ where: { id: prescription.id } }),
    ).toEqual(prescription);
    expect(
      await prisma.trainingPlan.findUnique({ where: { id: plan.id } }),
    ).toEqual(plan);
    expect(
      (
        await prisma.workoutExercise.findUniqueOrThrow({
          where: { id: f.workout.id },
        })
      ).targetLoad!.toString(),
    ).toBe('80');
  });
});
