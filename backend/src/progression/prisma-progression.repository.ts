import * as automaticPersistence from './automatic-progression.persistence';
import type {
  ActivateOperationalInput,
  RevokeOperationalInput,
} from '../models/progression/automatic-progression.model';
import type { InternalProgressionCapability } from './internal-progression-principal';
import * as settingsPersistence from './progression-settings.persistence';
import type {
  SettingContext,
  SettingOperation,
  SettingParameters,
} from '../models/progression/progression-setting.model';
import { issueConsentAcceptanceChallenge } from './consent-acceptance.persistence';
import {
  listConsents,
  consentCandidates,
  previewConsent,
  consentOperationReceipt,
} from './automation-consent-queries.persistence';
import type {
  ConsentListQuery,
  ConsentCandidateQuery,
  ConsentContract,
} from '../models/progression/automation-consent.model';
import { applyRecommendation } from './recommendation-application.persistence';
import {
  listRecommendations,
  getRevalidationRequest,
  getApplicationReceipt,
  inspectApplication,
} from './progression-queries.persistence';
import type {
  RecommendationListQuery,
  ApplicationReadinessOperation,
} from '../models/progression/progression-http.model';
import {
  mutateAutomationConsent,
  inspectAutomationConsent,
} from './automation-consent.persistence';
import type { ConsentOperation } from '../models/progression/automation-consent.model';
import type { ApplyOperation } from '../models/progression/recommendation-application.model';
import {
  inspectRecommendation,
  reviewRecommendation,
} from './recommendation-review.persistence';
import type {
  ReviewOperation,
  ReviewState,
  ReviewInspection,
} from '../models/progression/recommendation-review.model';
import type { ValidatedRecommendationCommand } from '../models/progression/recommendation-draft.model';
import {
  persistRecommendation,
  getOwnedRecommendation,
} from './recommendation.persistence';
import type { PersistProposalOperation } from '../models/progression/persisted-recommendation.model';
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
import type {
  Destination,
  RecommendationContext,
  RecommendationTarget,
} from '../models/progression/recommendation-draft.model';
import { RecommendationError } from '../models/progression/recommendation-draft.model';
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
    if (value !== undefined) selected[key] = value as EvidenceValue;
  }
  return selected;
}

function originalExerciseId(snapshot: Prisma.JsonValue): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const e = snapshot.exercise;
  return e &&
    typeof e === 'object' &&
    !Array.isArray(e) &&
    typeof e.id === 'string'
    ? e.id
    : null;
}

@Injectable()
export class PrismaProgressionRepository implements ProgressionRepository {
  listProgressionSettings(
    u: string,
    s: string,
    q: { page: number; limit: number },
  ) {
    return settingsPersistence.listProgressionSettings(this.prisma, u, s, q);
  }
  getProgressionSetting(u: string, s: string, id: string) {
    return settingsPersistence.getProgressionSetting(this.prisma, u, s, id);
  }
  effectiveProgressionSetting(u: string, s: string, c: SettingContext) {
    return settingsPersistence.effectiveProgressionSetting(
      this.prisma,
      u,
      s,
      c,
    );
  }
  mutateProgressionSetting(u: string, s: string, op: SettingOperation) {
    return settingsPersistence.mutateProgressionSetting(this.prisma, u, s, op);
  }
  getSettingMutation(u: string, s: string, id: string) {
    return settingsPersistence.getSettingMutation(this.prisma, u, s, id);
  }
  progressionSettingImpact(
    u: string,
    s: string,
    id: string,
    r: string,
    p: SettingParameters,
  ) {
    return settingsPersistence.progressionSettingImpact(
      this.prisma,
      u,
      s,
      id,
      r,
      p,
    );
  }

  issueAutomationConsentAcceptance(
    userId: string,
    sessionId: string,
    id: string,
    expectedVersion: number,
  ) {
    return issueConsentAcceptanceChallenge(
      this.prisma,
      userId,
      sessionId,
      id,
      expectedVersion,
    );
  }

  listRecommendations(
    userId: string,
    sessionId: string,
    query: RecommendationListQuery,
  ) {
    return listRecommendations(this.prisma, userId, sessionId, query);
  }
  getRevalidationRequest(userId: string, sessionId: string, id: string) {
    return getRevalidationRequest(this.prisma, userId, sessionId, id);
  }
  getApplicationReceipt(userId: string, sessionId: string, id: string) {
    return getApplicationReceipt(this.prisma, userId, sessionId, id);
  }
  inspectApplication(
    userId: string,
    sessionId: string,
    id: string,
    operation: ApplicationReadinessOperation,
  ) {
    return inspectApplication(
      this.prisma,
      userId,
      sessionId,
      id,
      operation,
      (tx, command) =>
        this.readRecommendationContextWithin(
          tx,
          userId,
          command.history,
          command.destination,
        ),
    );
  }
  listAutomationConsents(
    userId: string,
    sessionId: string,
    q: ConsentListQuery,
  ) {
    return listConsents(this.prisma, userId, sessionId, q);
  }
  automationConsentCandidates(
    userId: string,
    sessionId: string,
    q: ConsentCandidateQuery,
  ) {
    return consentCandidates(this.prisma, userId, sessionId, q);
  }
  previewAutomationConsent(
    userId: string,
    sessionId: string,
    c: ConsentContract,
  ) {
    return previewConsent(this.prisma, userId, sessionId, c);
  }
  automationConsentReceipt(userId: string, sessionId: string, id: string) {
    return consentOperationReceipt(this.prisma, userId, sessionId, id);
  }
  mutateAutomationConsent(
    userId: string,
    sessionId: string,
    operation: ConsentOperation,
  ) {
    return mutateAutomationConsent(this.prisma, userId, sessionId, operation);
  }
  inspectAutomationConsent(userId: string, sessionId: string, id: string) {
    return inspectAutomationConsent(this.prisma, userId, sessionId, id);
  }
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
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        return this.readHistoryWithin(tx, userId, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async readHistoryWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    query: ValidatedPerformanceQuery,
  ): Promise<PerformanceHistory> {
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
    if (!athlete || !exercise) throw new PerformanceError('SOURCE_NOT_FOUND');
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
        planExerciseId: true,
        replacesWorkoutExerciseId: true,
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
        planExerciseId: t.planExerciseId,
        replacesWorkoutExerciseId: t.replacesWorkoutExerciseId,
        sessionStatus: t.session.status,
        orderInSession: t.orderInSession,
        isOmitted: t.isOmitted,
        performedOn: t.session.performedOn?.toISOString().slice(0, 10) ?? null,
        timeZone: t.session.timeZone,
        availableSets: t._count.sets,
        originalTargets: originalTargets(t.originalSnapshot),
        originalExerciseId: originalExerciseId(t.originalSnapshot),
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
      estimates: estimates.slice(0, PERFORMANCE_LIMITS.estimates).map((e) => ({
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
  }

  async readRecommendationContext(
    userId: string,
    query: ValidatedPerformanceQuery,
    destination: Destination,
  ): Promise<RecommendationContext> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        return this.readRecommendationContextWithin(
          tx,
          userId,
          query,
          destination,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async readRecommendationContextWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    query: ValidatedPerformanceQuery,
    destination: Destination,
  ): Promise<RecommendationContext> {
    const athlete = await tx.athlete.findFirst({
      where: { userId, user: { status: 'ACTIVE' } },
      select: { id: true },
    });
    const exercise = await tx.exercise.findFirst({
      where: {
        id: query.exerciseId,
        OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', ownerId: userId }],
      },
      select: { id: true },
    });
    if (!athlete || !exercise)
      throw new RecommendationError('SOURCE_NOT_FOUND');
    let target: RecommendationTarget;
    if (destination.kind === 'PRESCRIPTION') {
      const p = await tx.planExercise.findFirst({
        where: {
          id: destination.prescriptionId,
          exerciseId: exercise.id,
          planWeekId: destination.weekId,
          planDayId: destination.dayId,
          planWeek: {
            trainingPlanId: destination.planId,
            trainingPlan: { athleteId: athlete.id },
          },
        },
        select: {
          id: true,
          planWeekId: true,
          planDayId: true,
          targetSets: true,
          targetReps: true,
          targetRepsMin: true,
          targetRepsMax: true,
          targetLoad: true,
          targetLoadUnit: true,
          targetRpe: true,
          planDay: { select: { retiredAt: true } },
          planWeek: {
            select: {
              trainingPlan: {
                select: { id: true, version: true, status: true },
              },
            },
          },
        },
      });
      if (!p) throw new RecommendationError('SOURCE_NOT_FOUND');
      target = {
        kind: 'PRESCRIPTION',
        taskId: null,
        planId: p.planWeek.trainingPlan.id,
        weekId: p.planWeekId,
        dayId: p.planDayId,
        prescriptionId: p.id,
        planVersion: p.planWeek.trainingPlan.version,
        planStatus: p.planWeek.trainingPlan.status,
        retired: p.planDay?.retiredAt != null,
        targets: {
          targetSets: p.targetSets,
          targetRepsMin: p.targetRepsMin ?? p.targetReps,
          targetRepsMax: p.targetRepsMax ?? p.targetReps,
          targetLoad: p.targetLoad?.toFixed(3) ?? null,
          targetLoadUnit: p.targetLoadUnit,
          targetRpe: p.targetRpe?.toFixed(1) ?? null,
        },
      };
    } else {
      const task = await tx.workoutExercise.findFirst({
        where: {
          id: destination.taskId,
          exerciseId: exercise.id,
          session: { athleteId: athlete.id },
        },
        select: {
          id: true,
          planExercise: {
            select: {
              id: true,
              planWeekId: true,
              planDayId: true,
              planDay: { select: { retiredAt: true } },
              planWeek: {
                select: {
                  trainingPlan: {
                    select: {
                      id: true,
                      athleteId: true,
                      version: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!task) throw new RecommendationError('SOURCE_NOT_FOUND');
      const origin = task.planExercise,
        plan = origin?.planWeek.trainingPlan;
      if (plan && plan.athleteId !== athlete.id)
        throw new RecommendationError('SOURCE_NOT_FOUND');
      target = {
        kind: 'WORKOUT_TASK',
        taskId: task.id,
        planId: plan?.id ?? null,
        weekId: origin?.planWeekId ?? null,
        dayId: origin?.planDayId ?? null,
        prescriptionId: origin?.id ?? null,
        planVersion: plan?.version ?? null,
        planStatus: plan?.status ?? null,
        retired: origin?.planDay?.retiredAt != null,
        targets: null,
      };
    }
    const settings = await tx.progressionSetting.findMany({
      where: {
        athleteId: athlete.id,
        OR: [
          { exerciseId: null, trainingPlanId: null },
          { exerciseId: exercise.id, trainingPlanId: null },
          ...(target.planId
            ? [{ exerciseId: exercise.id, trainingPlanId: target.planId }]
            : []),
        ],
      },
      take: 4,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        athleteId: true,
        exerciseId: true,
        trainingPlanId: true,
        minSuccessfulSessions: true,
        targetRpeMin: true,
        targetRpeMax: true,
        incrementPercent: true,
        incrementAbsolute: true,
        maxIncrementPercent: true,
        maxLoad: true,
        autoApplyAuthorized: true,
        updatedAt: true,
      },
    });
    const history = await this.readHistoryWithin(tx, userId, query);
    return {
      history,
      target,
      settings: settings.map((s) => ({
        ...s,
        targetRpeMin: s.targetRpeMin.toFixed(1),
        targetRpeMax: s.targetRpeMax.toFixed(1),
        incrementPercent: s.incrementPercent?.toFixed(3) ?? null,
        incrementAbsolute: s.incrementAbsolute?.toFixed(3) ?? null,
        maxIncrementPercent: s.maxIncrementPercent.toFixed(3),
        maxLoad: s.maxLoad?.toFixed(3) ?? null,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }
  persistRecommendation(userId: string, operation: PersistProposalOperation) {
    return persistRecommendation(this.prisma, userId, operation, (tx) =>
      this.readRecommendationContextWithin(
        tx,
        userId,
        operation.command.history,
        operation.command.destination,
      ),
    );
  }
  getOwnedRecommendation(userId: string, id: string) {
    return getOwnedRecommendation(this.prisma, userId, id);
  }

  inspectRecommendation(
    userId: string,
    sessionId: string,
    id: string,
    command: ValidatedRecommendationCommand | undefined,
    inspect: (state: ReviewState) => ReviewInspection,
  ) {
    return inspectRecommendation(
      this.prisma,
      userId,
      sessionId,
      id,
      command,
      (tx, c) =>
        this.readRecommendationContextWithin(
          tx,
          userId,
          c.history,
          c.destination,
        ),
      inspect,
    );
  }
  reviewRecommendation(
    userId: string,
    sessionId: string,
    operation: ReviewOperation,
  ) {
    return reviewRecommendation(
      this.prisma,
      userId,
      sessionId,
      operation,
      (tx, c) =>
        this.readRecommendationContextWithin(
          tx,
          userId,
          c.history,
          c.destination,
        ),
    );
  }
  applyRecommendation(
    userId: string,
    sessionId: string,
    operation: ApplyOperation,
  ) {
    return applyRecommendation(
      this.prisma,
      userId,
      sessionId,
      operation,
      (tx, c) =>
        this.readRecommendationContextWithin(
          tx,
          userId,
          c.history,
          c.destination,
        ),
    );
  }
  operationalStatus(a: { userId: string; sessionId: string }, id: string) {
    return automaticPersistence.operationalStatus(this.prisma, a, id);
  }
  mutateOperationalGrant(
    a: { userId: string; sessionId: string },
    id: string,
    action: 'ACTIVATE' | 'REVOKE',
    input: ActivateOperationalInput | RevokeOperationalInput,
  ) {
    return automaticPersistence.mutateOperationalGrant(
      this.prisma,
      a,
      id,
      action,
      input,
    );
  }
  operationalOperation(a: { userId: string; sessionId: string }, id: string) {
    return automaticPersistence.operationalOperation(this.prisma, a, id);
  }
  automaticHistory(
    a: { userId: string; sessionId: string },
    id: string,
    page: number,
    limit: number,
  ) {
    return automaticPersistence.automaticHistory(
      this.prisma,
      a,
      id,
      page,
      limit,
    );
  }
  automaticReceipt(a: { userId: string; sessionId: string }, id: string) {
    return automaticPersistence.automaticReceipt(this.prisma, a, id);
  }
  processOwnAutomatic(
    cap: InternalProgressionCapability,
    a: { userId: string; sessionId: string },
    id: string,
    intent: string,
    limit: number,
  ) {
    return automaticPersistence.processOwnAutomatic(
      this.prisma,
      cap,
      a,
      id,
      intent,
      limit,
      (tx, u, c) =>
        this.readRecommendationContextWithin(tx, u, c.history, c.destination),
    );
  }
  processActiveAutomatic(cap: InternalProgressionCapability, limit: number) {
    return automaticPersistence.processActiveAutomatic(
      this.prisma,
      cap,
      limit,
      (tx, u, c) =>
        this.readRecommendationContextWithin(tx, u, c.history, c.destination),
    );
  }
  async fromOwnedSource(
    userId: string,
    setId: string,
    prepare: (source: EstimateSource) => readonly EstimateDraft[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const row = await tx.oneRmEstimate.findFirst({
        where: { id, athlete: { userId } },
      });
      return row ? { ...row, snapshot: row.snapshot as EvidenceValue } : null;
    });
  }
}
