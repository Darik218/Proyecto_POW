import type {
  RecommendationDraft,
  PersistedRecommendation,
} from '../../models/progression/persisted-recommendation.model';
import type {
  ReviewInspection,
  ReviewEvent,
} from '../../models/progression/recommendation-review.model';
import type { ApplicationReceipt } from '../../models/progression/recommendation-application.model';
import type {
  ApplicationReadiness,
  RecommendationListResult,
  RevalidationRecipe,
} from '../../models/progression/progression-http.model';
import type { RecommendationService } from '../../progression/recommendation.service';
import { policyProjection } from '../../domain/progression/recommendation-query.policy';
function object(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function targets(value: unknown) {
  const v = object(value),
    num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : null),
    str = (k: string) =>
      typeof v[k] === 'string'
        ? (v[k] as string)
        : typeof v[k] === 'number'
          ? String(v[k])
          : null;
  return {
    targetSets: num('targetSets'),
    targetRepsMin: num('targetRepsMin'),
    targetRepsMax: num('targetRepsMax'),
    targetLoad: str('targetLoad'),
    targetLoadUnit:
      v.targetLoadUnit === 'KG' || v.targetLoadUnit === 'LB'
        ? v.targetLoadUnit
        : null,
    targetRpe: str('targetRpe'),
  };
}
export class ProgressionPresenter {
  private configuration(c: RecommendationDraft['evidence']['configuration']) {
    const s = c.selected;
    return {
      status: c.status,
      scope: c.scope,
      reasons: c.reasons,
      mode: c.mode,
      selected: s
        ? {
            minSuccessfulSessions: s.minSuccessfulSessions,
            targetRpeMin: s.targetRpeMin,
            targetRpeMax: s.targetRpeMax,
            incrementPercent: s.incrementPercent,
            incrementAbsolute: s.incrementAbsolute,
            maxIncrementPercent: s.maxIncrementPercent,
            maxLoad: s.maxLoad,
          }
        : null,
      policy: c.policy ? policyProjection(c.policy) : null,
    };
  }
  private destination(d: RecommendationDraft['evidence']['destination']) {
    return {
      kind: d.kind,
      taskId: d.taskId,
      planId: d.planId,
      weekId: d.weekId,
      dayId: d.dayId,
      prescriptionId: d.prescriptionId,
      planVersion: d.planVersion,
      planStatus: d.planStatus,
      retired: d.retired,
      targets: targets(d.targets),
    };
  }
  private task(t: RecommendationDraft['evidence']['source']['tasks'][number]) {
    return {
      id: t.id,
      sessionId: t.sessionId,
      performedOn: t.performedOn,
      timeZone: t.timeZone,
      isOmitted: t.isOmitted,
      availableSets: t.availableSets,
      original: targets(t.originalTargets),
      adjusted: targets(t.adjustedTargets),
    };
  }
  private set(s: RecommendationDraft['evidence']['source']['sets'][number]) {
    return {
      id: s.id,
      workoutExerciseId: s.workoutExerciseId,
      setNumber: s.setNumber,
      status: s.status,
      kind: s.kind,
      isCompleted: s.isCompleted,
      load: s.load,
      loadUnit: s.loadUnit,
      loadKg: s.loadKg,
      repetitions: s.repetitions,
      rpe: s.rpe,
    };
  }
  context(
    value: Awaited<ReturnType<RecommendationService['contextForMyExercise']>>,
  ) {
    return {
      exerciseId: value.context.history.exerciseId,
      destination: this.destination(value.context.target),
      configuration: this.configuration(value.configuration),
      history: {
        tasks: value.context.history.tasks.map((t) => this.task(t)),
        sets: value.context.history.sets.map((s) => this.set(s)),
        truncated: value.context.history.truncated,
      },
    };
  }
  preview(d: RecommendationDraft) {
    const e = d.evidence,
      a = e.assessment;
    return {
      kind: 'PREVIEW' as const,
      decision: d.decision,
      reasons: d.reasons,
      semanticKey: d.semanticKey,
      dependencyKeys: d.dependencyKeys,
      exerciseId: e.exerciseId,
      engineVersion: e.engineVersion,
      period: {
        start: e.period.start,
        endExclusive: e.period.endExclusive,
        cutoffOn: e.period.cutoffOn,
        timeZone: e.period.timeZone,
        weekStartsOn: e.period.weekStartsOn,
        closed: e.period.closed,
      },
      historyWindow: e.historyWindow,
      destination: this.destination(e.destination),
      configuration: this.configuration(e.configuration),
      increment: d.increment
        ? {
            status: d.increment.status,
            reasons: d.increment.reasons,
            unit: d.increment.unit,
            currentLoad: d.increment.currentLoad,
            proposedLoad: d.increment.proposedLoad,
            currentLoadKg: d.increment.currentLoadKg,
            proposedLoadKg: d.increment.proposedLoadKg,
            requestedDelta: d.increment.requestedDelta,
            allowedUpperLoad: d.increment.allowedUpperLoad,
          }
        : null,
      evidence: {
        tasks: e.source.tasks.map((t) => this.task(t)),
        sets: e.source.sets.map((s) => this.set(s)),
        assessments: a
          ? a.tasks.map((t) => ({
              taskId: t.taskId,
              original: {
                status: t.original.status,
                reasons: t.original.reasons,
                basic: t.original.basic.result,
                readiness: t.original.readiness.result,
                rpeCoverage: t.original.rpeCoverage.percent,
                coverage: t.original.coverage,
              },
              adjusted: {
                status: t.adjusted.status,
                reasons: t.adjusted.reasons,
                basic: t.adjusted.basic.result,
                readiness: t.adjusted.readiness.result,
                rpeCoverage: t.adjusted.rpeCoverage.percent,
                coverage: t.adjusted.coverage,
              },
            }))
          : [],
        satisfactory: a
          ? {
              status: a.satisfactoryTasks.status,
              reasons: a.satisfactoryTasks.reasons,
              qualifyingCount: a.satisfactoryTasks.qualifyingCount,
              distinctSessions: a.satisfactoryTasks.distinctSessions,
              meetsMinimum: a.satisfactoryTasks.meetsMinimum,
            }
          : null,
        signals: a
          ? a.signals.map((s) => ({
              taskId: s.currentTaskId,
              status: s.status,
              reasons: s.reasons,
              reviewSignal: s.reviewSignal,
              currentRpe: s.currentRpe,
              referenceRpe: s.referenceRpe,
              deltaRpe: s.deltaRpe,
              deltaPerformancePercent: s.deltaPerformancePercent,
              coveragePercent: s.coveragePercent,
            }))
          : [],
        temporalSignals: a
          ? {
              status: a.temporalSignals.status,
              reasons: a.temporalSignals.reasons,
              persistentReviewSignal: a.temporalSignals.persistentReviewSignal,
            }
          : null,
        oneRm: {
          interpretation: 'DESCRIPTIVE_ONLY_NOT_OFFICIAL' as const,
          points: e.oneRm.groups.flatMap((g) =>
            g.points.map((p) => ({
              id: p.id,
              taskId: p.workoutExerciseId,
              performedOn: p.performedOn,
              formula: p.formula,
              resultKg: p.resultKg,
              warnings: p.warnings,
              evidenceStatus: p.evidenceStatus,
            })),
          ),
        },
        coverage: {
          uniqueSessions: e.coverage.uniqueSessions,
          tasksReturned: e.coverage.tasksReturned,
          reviewedSets: e.coverage.reviewedSets,
          truncated: e.coverage.truncated,
        },
        excludedTasks: e.excludedTasks.map((t) => ({
          taskId: t.taskId,
          reasons: [t.reason],
        })),
        interpretation: 'DESCRIPTIVE_ONLY_NOT_A_FATIGUE_DIAGNOSIS' as const,
      },
      applicationAuthorization: 'NOT_GRANTED' as const,
    };
  }
  proposal(p: PersistedRecommendation) {
    return {
      id: p.id,
      exerciseId: p.exerciseId,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      reviewVersion: p.reviewVersion,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      previousLoad: p.previousLoad,
      recommendedLoad: p.recommendedLoad,
      loadUnit: p.loadUnit,
      generation: p.generation ? this.preview(p.generation.draft) : null,
      cycleKey: p.generation?.cycleKey ?? null,
      generationState: p.generation ? 'MODERN' : 'LEGACY_UNKNOWN',
    };
  }
  review(e: ReviewEvent) {
    return {
      id: e.id,
      recommendationId: e.recommendationId,
      intentId: e.intentId,
      action: e.action,
      fromStatus: e.fromStatus,
      status: e.toStatus,
      version: e.version,
      decidedAt: e.decidedAt.toISOString(),
      justification: e.justification,
      acceptance: e.acceptance
        ? {
            scope: e.acceptance.scope,
            acceptPolicy: e.acceptance.acceptPolicy,
            acceptEvidence: e.acceptance.acceptEvidence,
          }
        : null,
    };
  }
  inspection(v: ReviewInspection) {
    return {
      proposal: this.proposal(v.proposal),
      events: v.events.map((e) => this.review(e)),
      validity: v.validity,
      compatibility: v.compatibility,
      cycle: v.cycle,
      approvalBlockers: v.approvalBlockers,
      acceptanceChallenge: v.acceptanceChallenge,
      manualAuthorization: v.manualAuthorization,
    };
  }
  application(r: ApplicationReceipt) {
    return {
      id: r.id,
      auditId: r.id,
      recommendationId: r.recommendationId,
      intentId: r.intentId,
      status: 'APPLIED' as const,
      origin: r.origin,
      previousLoad: r.previousLoad,
      appliedLoad: r.appliedLoad,
      loadUnit: r.loadUnit,
      planExerciseId: r.planExerciseId,
      scheduledActivityId: r.scheduledActivityId,
      reviewId: r.reviewId,
      effectiveAt: r.effectiveAt.toISOString(),
      destination: {
        planId: r.audit.destination.planId,
        weekId: r.audit.destination.weekId,
        dayId: r.audit.destination.dayId,
        prescriptionId: r.audit.destination.prescriptionId,
        planVersionBefore: r.audit.destination.planVersionBefore,
        planVersionAfter: r.audit.destination.planVersionAfter,
      },
      temporal: {
        scheduledOn: r.audit.temporal.scheduledOn,
        timeZone: r.audit.temporal.timeZone,
      },
    };
  }
  readiness(v: ApplicationReadiness) {
    return {
      eligible: v.eligible,
      reasons: v.reasons,
      command: v.command,
      receipt: v.receipt ? this.application(v.receipt) : null,
      inspectedAt: v.inspectedAt.toISOString(),
    };
  }
  list(v: RecommendationListResult) {
    return {
      items: v.items.map((r) => ({
        id: r.id,
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        previousLoad: r.previousLoad,
        recommendedLoad: r.recommendedLoad,
        loadUnit: r.loadUnit,
        generationKnown: r.generationKnown,
      })),
      page: v.page,
      limit: v.limit,
      total: v.total,
    };
  }
  recipe(r: RevalidationRecipe | null) {
    return r
      ? {
          schemaVersion: r.schemaVersion,
          command: r.command,
          recordedAt: r.recordedAt.toISOString(),
          provenance: r.provenance,
        }
      : null;
  }
}
