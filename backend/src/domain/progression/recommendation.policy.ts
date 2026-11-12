import type {
  Decision,
  RecommendationCommand,
  RecommendationContext,
  RecommendationAssessment,
} from '../../models/progression/recommendation-draft.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import { analyzePerformance } from './performance';
import { comparableTasks } from './comparability.policy';
import { sameTargets } from './effort-analysis.policy';
import { normalizeTargets } from './prescription-assessment.policy';
import { resolveEffectiveSettings } from './effective-settings.policy';
import { validateWeeklyPeriod } from './weekly-period.policy';
import { calculateIncrement } from './load-increment.policy';
import {
  recommendationIdentity,
  recommendationDependencyKeys,
} from './recommendation-evidence.policy';
export const RECOMMENDATION_ENGINE_VERSION = 'prog-4a-weekly-v1';
export function prepareRecommendation(
  context: RecommendationContext,
  command: RecommendationCommand,
) {
  const week = validateWeeklyPeriod(command.period),
    h = context.history,
    p = command.policy;
  if (
    h.exerciseId !== command.history.exerciseId ||
    h.tasks.some(
      (t) => t.athleteId !== h.athleteId || t.exerciseId !== h.exerciseId,
    )
  )
    throw new RecommendationError('SOURCE_NOT_FOUND');
  const settings = resolveEffectiveSettings(
    context.settings,
    h.athleteId,
    h.exerciseId,
    context.target.planId,
    p,
  );
  const mode = p?.cohort?.mode;
  const selected = h.tasks.filter((t) =>
    mode === 'SAME_PRESCRIPTION'
      ? context.target.prescriptionId !== null &&
        t.planExerciseId === context.target.prescriptionId
      : mode === 'EXPLICIT_TASK_SET'
        ? p!.cohort.mode === 'EXPLICIT_TASK_SET' &&
          Array.isArray(p!.cohort.taskIds) &&
          p!.cohort.taskIds.includes(t.id)
        : true,
  );
  const selectedIds = new Set(selected.map((t) => t.id));
  const scoped = {
    ...h,
    tasks: selected,
    sets: h.sets.filter((s) => selectedIds.has(s.workoutExerciseId)),
    estimates: h.estimates.filter(
      (e) =>
        e.sourceSetId === null ||
        h.sets.some(
          (s) => s.id === e.sourceSetId && selectedIds.has(s.workoutExerciseId),
        ),
    ),
  };
  const query = {
    ...command.history,
    contexts: (command.history.contexts ?? []).filter((c) =>
      selectedIds.has(c.workoutExerciseId),
    ),
    comparisons: (command.history.comparisons ?? []).filter(
      (c) =>
        selectedIds.has(c.previousTaskId) && selectedIds.has(c.currentTaskId),
    ),
  };
  const performance = analyzePerformance(scoped, {
    ...query,
    contexts: query.contexts,
    comparisons: query.comparisons,
  });
  const options =
    settings.status === 'VALID' &&
    p &&
    selectedIds.has(p.assessment.count!.anchorTaskId)
      ? {
          ...p.assessment,
          compliance: p.assessment.compliance
            ? {
                ...p.assessment.compliance,
                slots: p.assessment.compliance.slots.filter((s) =>
                  selectedIds.has(s.taskId),
                ),
              }
            : undefined,
        }
      : null;
  const excludedTasks = h.tasks
    .filter((t) => !selectedIds.has(t.id))
    .map((t) => ({ taskId: t.id, reason: 'OUTSIDE_EXPLICIT_COHORT' }));
  return {
    week,
    h,
    p,
    settings,
    mode,
    selected,
    selectedIds,
    scoped,
    performance,
    options,
    excludedTasks,
  };
}
export function decideRecommendation(
  context: RecommendationContext,
  command: RecommendationCommand,
  prepared: ReturnType<typeof prepareRecommendation>,
  assessment: RecommendationAssessment | null,
) {
  const {
    week,
    h,
    p,
    settings,
    mode,
    selected,
    selectedIds,
    scoped,
    performance,
    excludedTasks,
  } = prepared;
  const finalize = (
    decision: Decision,
    reasons: readonly string[],
    increment: ReturnType<typeof calculateIncrement> | null = null,
  ) => {
    const rawEvidence = {
      schemaVersion: 'recommendation-evidence-v1',
      engineVersion: RECOMMENDATION_ENGINE_VERSION,
      athleteId: h.athleteId,
      exerciseId: h.exerciseId,
      period: week,
      historyWindow: {
        from: command.history.from,
        to: command.history.to,
        timeZone: command.history.timeZone,
      },
      knowledge: p?.knowledge ?? null,
      configuration: settings,
      destination: context.target,
      expectedPlanVersion: command.expectedPlanVersion,
      assessment,
      oneRm: {
        use: 'DESCRIPTIVE_CONTEXT_ONLY',
        ...performance.estimates,
        comparisons: performance.comparisons.map((c) => ({
          previousTaskId: c.previousTaskId,
          currentTaskId: c.currentTaskId,
          ...c.estimates,
        })),
      },
      source: { tasks: scoped.tasks, sets: scoped.sets },
      excludedTasks,
      coverage: performance.coverage,
      decision,
      reasons: [...new Set(reasons)].sort(),
      increment,
    };
    const evidence: typeof rawEvidence = JSON.parse(
      JSON.stringify(rawEvidence, (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value))
          throw new RecommendationError('NUMERIC_INPUT_INVALID');
        return value;
      }),
    );
    const dependencyKeys = recommendationDependencyKeys(evidence);
    return {
      decision,
      reasons: evidence.reasons,
      increment,
      evidence,
      dependencyKeys,
      semanticKey: recommendationIdentity(evidence),
      applicationAuthorization: 'NOT_GRANTED' as const,
    };
  };
  if (settings.status !== 'VALID' || !p || !settings.selected || !settings.mode)
    return finalize('CONFIGURATION_REQUIRED', settings.reasons);
  if (
    command.history.timeZone !== week.timeZone ||
    command.history.to !== week.cutoffOn ||
    command.history.from > week.start
  )
    return finalize('CONFIGURATION_REQUIRED', ['HISTORY_WEEK_MISMATCH']);
  if (
    p.baseline !== 'DESTINATION_PRESCRIPTION' &&
    p.baseline !== `ANCHOR_${p.basis}`
  )
    return finalize('CONFIGURATION_REQUIRED', ['BASELINE_BASIS_MISMATCH']);
  if (p.requireClosedWeek && !week.closed)
    return finalize('INSUFFICIENT_DATA', ['WEEK_NOT_CLOSED']);
  if (mode === 'SAME_PRESCRIPTION' && !context.target.prescriptionId)
    return finalize('CONFIGURATION_REQUIRED', [
      'PRESCRIPTION_COHORT_REQUIRES_DESTINATION',
    ]);
  if (
    p.cohort.mode === 'EXPLICIT_TASK_SET' &&
    p.cohort.taskIds.some((id) => !selectedIds.has(id))
  )
    return finalize('INSUFFICIENT_DATA', ['COHORT_TASK_NOT_IN_SELECTION']);
  if (
    command.expectedPlanVersion !== undefined &&
    context.target.planVersion !== command.expectedPlanVersion
  )
    return finalize('REVIEW_REQUIRED', ['DESTINATION_VERSION_CHANGED']);
  if (
    context.target.retired ||
    (context.target.kind === 'PRESCRIPTION' && context.target.dayId === null)
  )
    return finalize('REVIEW_REQUIRED', ['DESTINATION_REQUIRES_REVIEW']);
  if (!h.exerciseIsActive)
    return finalize('REVIEW_REQUIRED', ['EXERCISE_INACTIVE']);
  if (Object.values(h.truncated).some(Boolean))
    return finalize('INSUFFICIENT_DATA', ['READ_LIMIT_REACHED']);
  if (new Set(selected.map((t) => t.id)).size !== selected.length)
    return finalize('INSUFFICIENT_DATA', ['DUPLICATE_TASK_REFERENCE']);
  const anchorId = p.assessment.count!.anchorTaskId,
    anchor = performance.tasks.find((t) => t.id === anchorId);
  if (!anchor || !selected.length)
    return finalize('INSUFFICIENT_DATA', ['ANCHOR_NOT_IN_COHORT']);
  if (
    context.target.kind === 'WORKOUT_TASK' &&
    context.target.taskId !== anchor.id
  )
    return finalize('CONFIGURATION_REQUIRED', ['DESTINATION_ANCHOR_MISMATCH']);
  if (
    !anchor.performedOn ||
    anchor.performedOn < week.start ||
    anchor.performedOn > week.cutoffOn
  )
    return finalize('INSUFFICIENT_DATA', ['ANCHOR_OUTSIDE_WEEK']);
  const reasons: string[] = [];
  for (const task of performance.tasks) {
    if (
      !task.performedOn ||
      task.performedOn < command.history.from ||
      task.performedOn > week.cutoffOn ||
      task.timeZone !== week.timeZone
    )
      reasons.push('SPORTING_WINDOW_OR_ZONE_UNKNOWN');
    if (!sameTargets(task, anchor, p.basis))
      reasons.push('TARGETS_NOT_COMPARABLE');
    const [a, b] =
      (task.performedOn ?? '') <= (anchor.performedOn ?? '')
        ? [task, anchor]
        : [anchor, task];
    if (task.id !== anchor.id)
      reasons.push(
        ...comparableTasks(a, b, a.context, b.context, week.timeZone).filter(
          (r) =>
            r !== 'INTRADAY_ORDER_UNKNOWN' ||
            p.assessment.count!.mode === 'CONSECUTIVE',
        ),
      );
    const assessed = assessment!.tasks.find((t) => t.taskId === task.id)![
      p.basis === 'ORIGINAL' ? 'original' : 'adjusted'
    ];
    if (
      assessed.reasons.length > 0 ||
      assessed.basic.reasons.includes('INSUFFICIENT_SLOT_EVIDENCE') ||
      ['NOT_EVALUABLE', 'CONFIGURATION_REQUIRED'].includes(
        assessed.basic.result,
      ) ||
      assessed.slots.some(
        (s) =>
          !s.record ||
          s.record.kind !== 'WORK' ||
          s.record.status === null ||
          (s.sourceAnalysis?.volumeStatus !== 'INCLUDED' &&
            !(s.record.status === 'SKIPPED' && s.reasons.length === 0)),
      )
    )
      reasons.push('REQUIRED_EVIDENCE_INCOMPLETE');
  }
  if (reasons.length) return finalize('INSUFFICIENT_DATA', reasons);
  if (context.target.kind === 'PRESCRIPTION' && context.target.targets) {
    const anchorTargets =
      p.basis === 'ORIGINAL'
        ? normalizeTargets(anchor.originalTargets).targets
        : anchor.adjustedTargets;
    if (
      !anchorTargets ||
      !sameTargets(
        { ...anchor, adjustedTargets: context.target.targets },
        { ...anchor, adjustedTargets: anchorTargets },
        'ADJUSTED',
      )
    )
      return finalize('REVIEW_REQUIRED', ['DESTINATION_TARGETS_DIVERGE']);
  }
  if (
    p.review !== 'NOT_REQUIRED_EXPLICIT' &&
    !assessment!.signals.some(
      (s) => s.currentTaskId === anchor.id && s.status === 'AVAILABLE',
    )
  )
    return finalize('INSUFFICIENT_DATA', [
      'REQUIRED_ANCHOR_SIGNAL_NOT_EVALUABLE',
    ]);
  if (p.review === 'ANY_SIGNAL') {
    if (assessment!.signals.some((s) => s.reviewSignal === true))
      return finalize('REVIEW_REQUIRED', ['HIGHER_EFFORT_LOWER_OUTPUT_SIGNAL']);
    if (assessment!.signalStatus !== 'AVAILABLE')
      return finalize('INSUFFICIENT_DATA', ['REQUIRED_SIGNALS_NOT_EVALUABLE']);
  }
  if (p.review === 'TEMPORAL_SIGNAL') {
    if (assessment!.temporalSignals.sourceTaskIds.at(-1) !== anchor.id)
      return finalize('INSUFFICIENT_DATA', [
        'TEMPORAL_WINDOW_DOES_NOT_END_AT_ANCHOR',
      ]);
    if (assessment!.temporalSignals.persistentReviewSignal === true)
      return finalize('REVIEW_REQUIRED', ['PERSISTENT_REVIEW_SIGNAL']);
    if (assessment!.temporalSignals.status !== 'AVAILABLE')
      return finalize('INSUFFICIENT_DATA', [
        'REQUIRED_TEMPORAL_SIGNAL_NOT_EVALUABLE',
      ]);
  }
  const count = assessment!.satisfactoryTasks;
  if (count.status !== 'AVAILABLE' || count.meetsMinimum === null)
    return finalize('INSUFFICIENT_DATA', ['SATISFACTORY_COHORT_INCOMPLETE']);
  if (!count.meetsMinimum) return finalize('MAINTAIN', ['MINIMUM_NOT_REACHED']);
  const anchorAssessment = assessment!.tasks.find(
    (t) => t.taskId === anchor.id,
  )![p.basis === 'ORIGINAL' ? 'original' : 'adjusted'];
  if (
    ['NOT_EVALUABLE', 'CONFIGURATION_REQUIRED'].includes(
      anchorAssessment.readiness.result,
    ) ||
    anchorAssessment.readiness.reasons.includes('INSUFFICIENT_SLOT_EVIDENCE')
  )
    return finalize('INSUFFICIENT_DATA', ['READINESS_NOT_EVALUABLE']);
  if (anchorAssessment.readiness.result !== 'SATISFIED')
    return finalize('MAINTAIN', ['READINESS_NOT_MET']);
  const baseline =
    p.baseline === 'DESTINATION_PRESCRIPTION'
      ? context.target.targets
      : p.baseline === 'ANCHOR_ORIGINAL'
        ? normalizeTargets(anchor.originalTargets).targets
        : anchor.adjustedTargets;
  if (
    p.baseline === 'DESTINATION_PRESCRIPTION' &&
    context.target.kind !== 'PRESCRIPTION'
  )
    return finalize('CONFIGURATION_REQUIRED', ['BASELINE_SOURCE_MISMATCH']);
  const meaning =
    p.baseline === 'DESTINATION_PRESCRIPTION'
      ? p.loadMeaning
      : assessment!.tasks.find((t) => t.taskId === anchor.id)![
          p.baseline === 'ANCHOR_ORIGINAL' ? 'original' : 'adjusted'
        ].targetLoadMeaning;
  if (p.loadMeaning !== 'EXTERNAL_TOTAL' || meaning !== 'EXTERNAL_TOTAL')
    return finalize('INSUFFICIENT_DATA', ['LOAD_MEANING_UNKNOWN']);
  const increment = calculateIncrement({
    current: baseline?.targetLoad ?? null,
    unit: baseline?.targetLoadUnit ?? null,
    meaning: p.loadMeaning,
    mode: settings.mode,
    absolute: settings.selected.incrementAbsolute,
    percent: settings.selected.incrementPercent,
    maximumPercent: settings.selected.maxIncrementPercent,
    maximumLoad: settings.selected.maxLoad,
    grid: p.grid,
  });
  return finalize(increment.status, increment.reasons, increment);
}
export function compareDrafts(
  previous: Pick<
    ReturnType<typeof decideRecommendation>,
    'semanticKey' | 'dependencyKeys'
  >,
  current: Pick<
    ReturnType<typeof decideRecommendation>,
    'semanticKey' | 'dependencyKeys'
  >,
) {
  const changed = (
    Object.keys(
      current.dependencyKeys,
    ) as (keyof typeof current.dependencyKeys)[]
  ).filter((k) => previous.dependencyKeys[k] !== current.dependencyKeys[k]);
  return { obsolete: previous.semanticKey !== current.semanticKey, changed };
}
