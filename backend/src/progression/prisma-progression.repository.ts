import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  captureSourceEvidence,
  evidenceIdentity,
} from '../domain/progression/estimate-evidence.policy';
import type {
  EstimateDraft,
  EstimateSource,
  StoredOneRmEstimate,
  EvidenceValue,
} from '../models/progression/one-rm-estimate.model';
import { OneRmPersistenceError } from '../models/progression/one-rm-estimate.model';
import type { ProgressionRepository } from './progression.repository';
import type {
  PerformanceHistory,
  RecordedTargets,
  ValidatedPerformanceQuery,
} from '../models/progression/performance-analysis.model';
import { PerformanceError } from '../models/progression/performance-analysis.model';
import { PERFORMANCE_LIMITS } from '../domain/progression/performance-query.policy';

function originalTargets(
  snapshot: Prisma.JsonValue,
): Readonly<Partial<Record<keyof RecordedTargets, EvidenceValue>>> | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const targets = snapshot.targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets))
    return null;
  const selected: Partial<Record<keyof RecordedTargets, EvidenceValue>> = {};
  for (const key of [
    'targetSets',
    'targetRepsMin',
    'targetRepsMax',
    'targetLoad',
    'targetLoadUnit',
    'targetRpe',
  ] as const) {
    const value = targets[key];
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'string'
    )
      selected[key] = value;
  }
  return selected;
}

@Injectable()
export class PrismaProgressionRepository implements ProgressionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async readHistory(
    userId: string,
    query: ValidatedPerformanceQuery,
  ): Promise<PerformanceHistory> {
    return this.prisma.$transaction(
      async (tx) => {
        // This transaction cannot persist changes, even if a later read path
        // accidentally attempts a write. Multiple batched reads share one snapshot.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const athlete = await tx.athlete.findFirst({
          where: { userId, user: { status: 'ACTIVE' } },
          select: { id: true },
        });
        const exercise = await tx.exercise.findFirst({
          where: {
            id: query.exerciseId,
            OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
          },
          select: { id: true, isActive: true },
        });
        if (!athlete || !exercise)
          throw new PerformanceError('SOURCE_NOT_FOUND');
        const tasks = await tx.workoutExercise.findMany({
          where: {
            exerciseId: exercise.id,
            session: {
              athleteId: athlete.id,
              OR: [
                {
                  performedOn: {
                    gte: new Date(query.from + 'T00:00:00Z'),
                    lte: new Date(query.to + 'T00:00:00Z'),
                  },
                },
                { performedOn: null },
              ],
            },
          },
          orderBy: [
            { session: { performedOn: { sort: 'asc', nulls: 'last' } } },
            { sessionId: 'asc' },
            { orderInSession: 'asc' },
            { id: 'asc' },
          ],
          take: query.limit + 1,
          select: {
            id: true,
            exerciseId: true,
            orderInSession: true,
            isOmitted: true,
            originalSnapshot: true,
            targetSets: true,
            targetRepsMin: true,
            targetRepsMax: true,
            targetLoad: true,
            targetLoadUnit: true,
            targetRpe: true,
            _count: { select: { sets: true } },
            session: {
              select: {
                id: true,
                athleteId: true,
                version: true,
                status: true,
                performedOn: true,
                timeZone: true,
              },
            },
          },
        });
        const selectedTasks = tasks.slice(0, query.limit);
        const sets = await tx.setRecord.findMany({
          where: {
            workoutExerciseId: { in: selectedTasks.map((t) => t.id) },
            workoutExercise: {
              exerciseId: exercise.id,
              session: { athleteId: athlete.id },
            },
          },
          orderBy: [
            { workoutExerciseId: 'asc' },
            { setNumber: 'asc' },
            { id: 'asc' },
          ],
          take: PERFORMANCE_LIMITS.sets + 1,
          select: {
            id: true,
            workoutExerciseId: true,
            setNumber: true,
            version: true,
            status: true,
            kind: true,
            isCompleted: true,
            load: true,
            loadUnit: true,
            loadKg: true,
            repetitions: true,
            rpe: true,
            recordedAt: true,
          },
        });
        const selectedSets = sets.slice(0, PERFORMANCE_LIMITS.sets);
        const estimates = await tx.oneRmEstimate.findMany({
          where: {
            athleteId: athlete.id,
            exerciseId: exercise.id,
            OR: [
              { sourceSetId: { in: selectedSets.map((s) => s.id) } },
              { sourceSetId: null },
            ],
          },
          orderBy: { id: 'asc' },
          take: PERFORMANCE_LIMITS.estimates + 1,
        });
        return {
          athleteId: athlete.id,
          userId,
          exerciseId: exercise.id,
          exerciseIsActive: exercise.isActive,
          tasks: selectedTasks.map((t) => ({
            id: t.id,
            athleteId: t.session.athleteId,
            exerciseId: t.exerciseId,
            sessionId: t.session.id,
            sessionVersion: t.session.version,
            sessionStatus: t.session.status,
            orderInSession: t.orderInSession,
            isOmitted: t.isOmitted,
            performedOn:
              t.session.performedOn?.toISOString().slice(0, 10) ?? null,
            timeZone: t.session.timeZone,
            availableSets: t._count.sets,
            originalTargets: originalTargets(t.originalSnapshot),
            adjustedTargets: {
              targetSets: t.targetSets,
              targetRepsMin: t.targetRepsMin,
              targetRepsMax: t.targetRepsMax,
              targetLoad: t.targetLoad?.toFixed(3) ?? null,
              targetLoadUnit: t.targetLoadUnit,
              targetRpe: t.targetRpe?.toFixed(1) ?? null,
            },
          })),
          sets: selectedSets.map((s) => ({
            ...s,
            load: s.load?.toFixed(3) ?? null,
            loadKg: s.loadKg?.toFixed(6) ?? null,
            rpe: s.rpe?.toFixed(1) ?? null,
            recordedAt: s.recordedAt.toISOString(),
          })),
          estimates: estimates
            .slice(0, PERFORMANCE_LIMITS.estimates)
            .map((e) => ({
              id: e.id,
              athleteId: e.athleteId,
              exerciseId: e.exerciseId,
              sourceSetId: e.sourceSetId,
              sourceSetVersion: e.sourceSetVersion,
              formula: e.formula,
              algorithmVersion: e.algorithmVersion,
              eligibilityVersion: e.eligibilityVersion,
              estimateKind: e.estimateKind,
              inputLoad: e.inputLoad.toFixed(3),
              inputLoadUnit: e.inputLoadUnit,
              inputLoadKg: e.inputLoadKg?.toFixed(6) ?? null,
              inputReps: e.inputReps,
              result: e.estimatedOneRm.toFixed(6),
              resultUnit: e.resultUnit,
              calculationKey: e.calculationKey,
              calculatedAt: e.calculatedAt.toISOString(),
              snapshot: e.snapshot as EvidenceValue,
            })),
          truncated: {
            tasks: tasks.length > query.limit,
            sets: sets.length > PERFORMANCE_LIMITS.sets,
            estimates: estimates.length > PERFORMANCE_LIMITS.estimates,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async fromOwnedSource(
    userId: string,
    setId: string,
    prepare: (source: EstimateSource) => readonly EstimateDraft[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.setRecord.findFirst({
        where: {
          id: setId,
          workoutExercise: { session: { athlete: { userId } } },
        },
        select: {
          workoutExercise: { select: { sessionId: true, exerciseId: true } },
        },
      });
      if (!initial) throw new OneRmPersistenceError('SOURCE_NOT_FOUND');
      // Follow the existing session -> exercise/set direction. SHARE stabilizes
      // a completed source and still lets identical calculations run concurrently.
      await tx.$queryRaw`SELECT id FROM workout_sessions WHERE id = ${initial.workoutExercise.sessionId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM exercises WHERE id = ${initial.workoutExercise.exerciseId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM set_records WHERE id = ${setId}::uuid FOR SHARE`;
      const row = await tx.setRecord.findFirst({
        where: {
          id: setId,
          workoutExercise: {
            session: { athlete: { userId, user: { status: 'ACTIVE' } } },
          },
        },
        select: {
          id: true,
          version: true,
          status: true,
          kind: true,
          isCompleted: true,
          load: true,
          loadUnit: true,
          loadKg: true,
          repetitions: true,
          rpe: true,
          recordedAt: true,
          workoutExercise: {
            select: {
              id: true,
              sessionId: true,
              exerciseId: true,
              isOmitted: true,
              exercise: {
                select: {
                  isActive: true,
                  origin: true,
                  ownerId: true,
                  oneRmSuitability: true,
                },
              },
              session: {
                select: {
                  id: true,
                  athleteId: true,
                  version: true,
                  status: true,
                  performedOn: true,
                  timeZone: true,
                },
              },
            },
          },
        },
      });
      if (!row) throw new OneRmPersistenceError('SOURCE_NOT_FOUND');
      const workout = row.workoutExercise,
        session = workout.session,
        exercise = workout.exercise;
      if (
        workout.sessionId !== initial.workoutExercise.sessionId ||
        workout.exerciseId !== initial.workoutExercise.exerciseId
      )
        throw new OneRmPersistenceError('SOURCE_CHANGED');
      if (
        !exercise.isActive ||
        (exercise.origin !== 'GLOBAL' && exercise.ownerId !== userId)
      )
        throw new OneRmPersistenceError('SOURCE_NOT_FOUND');
      const source: EstimateSource = {
        userId,
        athleteId: session.athleteId,
        exerciseId: workout.exerciseId,
        sessionId: session.id,
        workoutExerciseId: workout.id,
        sourceSetId: row.id,
        sourceSetVersion: row.version,
        sessionVersion: session.version,
        sessionStatus: session.status,
        status: row.status,
        kind: row.kind,
        isCompleted: row.isCompleted,
        isOmitted: workout.isOmitted,
        load: row.load,
        loadUnit: row.loadUnit,
        loadKg: row.loadKg,
        repetitions: row.repetitions,
        rpe: row.rpe,
        oneRmSuitability: exercise.oneRmSuitability,
        recordedAt: row.recordedAt.toISOString(),
        performedOn: session.performedOn?.toISOString().slice(0, 10) ?? null,
        timeZone: session.timeZone,
      };
      const drafts = prepare(source);
      const observed = captureSourceEvidence(source);
      const declaration = {
        meaning: 'EXTERNAL_TOTAL',
        source: 'OWNER_DECLARATION_AFTER_RECORDING',
        declaredByUserId: userId,
      };
      for (const draft of drafts) {
        if (
          draft.athleteId !== source.athleteId ||
          draft.exerciseId !== source.exerciseId ||
          draft.sourceSetId !== source.sourceSetId ||
          draft.sourceSetVersion !== source.sourceSetVersion ||
          draft.calculationKey !== evidenceIdentity(draft.snapshot)
        )
          throw new OneRmPersistenceError('IDENTITY_CONFLICT');
        for (const section of ['source', 'input', 'exercise'] as const) {
          if (
            draft.snapshot[section] === undefined ||
            evidenceIdentity(draft.snapshot[section]) !==
              evidenceIdentity(observed[section])
          )
            throw new OneRmPersistenceError('IDENTITY_CONFLICT');
        }
        if (
          draft.snapshot.interpretation === undefined ||
          evidenceIdentity(draft.snapshot.interpretation) !==
            evidenceIdentity(declaration)
        )
          throw new OneRmPersistenceError('IDENTITY_CONFLICT');
      }
      // Same insertion order prevents cross-formula retry deadlocks. DO NOTHING
      // never updates evidence or calculatedAt, and uniqueness handles races.
      await tx.oneRmEstimate.createMany({
        data: [...drafts]
          .sort((a, b) => a.calculationKey.localeCompare(b.calculationKey))
          .map((draft) => ({
            ...draft,
            snapshot: draft.snapshot as Prisma.InputJsonObject,
          })),
        skipDuplicates: true,
      });
      const rows = await tx.oneRmEstimate.findMany({
        where: {
          athleteId: source.athleteId,
          calculationKey: { in: drafts.map((d) => d.calculationKey) },
        },
      });
      return drafts.map((draft): StoredOneRmEstimate => {
        const stored = rows.find(
          (r) => r.calculationKey === draft.calculationKey,
        );
        if (
          !stored ||
          stored.athleteId !== draft.athleteId ||
          stored.exerciseId !== draft.exerciseId ||
          stored.sourceSetId !== draft.sourceSetId ||
          stored.sourceSetVersion !== draft.sourceSetVersion ||
          stored.formula !== draft.formula ||
          stored.algorithmVersion !== draft.algorithmVersion ||
          stored.eligibilityVersion !== draft.eligibilityVersion ||
          stored.estimateKind !== draft.estimateKind ||
          stored.inputLoadUnit !== draft.inputLoadUnit ||
          stored.resultUnit !== draft.resultUnit ||
          stored.inputReps !== draft.inputReps ||
          !stored.inputLoad.eq(draft.inputLoad) ||
          !stored.inputLoadKg?.eq(draft.inputLoadKg) ||
          !stored.estimatedOneRm.eq(draft.estimatedOneRm) ||
          evidenceIdentity(stored.snapshot as EvidenceValue) !==
            draft.calculationKey
        )
          throw new OneRmPersistenceError('IDENTITY_CONFLICT');
        return { ...stored, snapshot: stored.snapshot as EvidenceValue };
      });
    });
  }

  async getOwned(
    userId: string,
    id: string,
  ): Promise<StoredOneRmEstimate | null> {
    const row = await this.prisma.oneRmEstimate.findFirst({
      where: { id, athlete: { userId } },
    });
    return row ? { ...row, snapshot: row.snapshot as EvidenceValue } : null;
  }
}
