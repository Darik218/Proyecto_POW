import type { RecommendationContext } from '../../models/progression/recommendation-draft.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import type {
  GuideRepetitionContext,
  GuideComparisonSourceEvidence,
  GuidePlannedComparisonEvidence,
  GuideSuggestion,
  WorkoutGuideRepetitionPreviewInput,
  WorkoutGuideSource,
} from '../../models/progression/workout-guide.model';
import { readDecimal } from './decimal';
import { resolveEffectiveSettings } from './effective-settings.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { normalizeTargets } from './prescription-assessment.policy';
import { guidePreviewPeriodReasons } from './workout-guide.policy';
import {
  guideComparisonKey,
  hasPlannedNominalComparison,
} from './workout-guide-comparison.policy';
export const REPETITION_PREVIEW_VERSION = 'session-repetition-preview-v1';
export const PROGRESSIVE_PREVIEW_VERSION = 'session-repetition-preview-v2';
// Optional, bounded next-session practice target; never a strength estimate.
// Only the count/repetition portion is applicable. No load meaning, kg conversion,
// equipment increment, RIR mapping, fatigue or official recommendation is inferred.
function repetitionLoadBaseline(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  target: RecordedTargets | null,
  taskIds?: readonly string[],
) {
  if (!target) return null;
  let load = target.targetLoad,
    unit = target.targetLoadUnit;
  let baselineSource: 'PRESCRIPTION' | 'RECORDED_HISTORY' = 'PRESCRIPTION';
  // Only an explicitly unprescribed load may use actual nominal recorded values.
  // A prescribed value with an unknown unit remains ambiguous and is rejected.
  if (load === null && unit === null) {
    baselineSource = 'RECORDED_HISTORY';
    const latest = context.history.tasks
      .filter(
        (t) =>
          (taskIds
            ? taskIds.includes(t.id)
            : t.planExerciseId === context.target.prescriptionId) &&
          t.performedOn &&
          source.performedOn &&
          t.performedOn < source.performedOn,
      )
      .sort(
        (a, b) =>
          b.performedOn!.localeCompare(a.performedOn!) ||
          a.id.localeCompare(b.id),
      )[0];
    const candidate =
      latest &&
      context.history.sets.find(
        (s) => s.workoutExerciseId === latest.id && s.kind === 'WORK',
      );
    load = candidate?.load ?? null;
    unit = candidate?.loadUnit ?? null;
  }
  const decimal = readDecimal(load);
  return decimal.ok && decimal.value.gt(0) && (unit === 'KG' || unit === 'LB')
    ? { load: decimal.value.toFixed(), unit, baselineSource }
    : null;
}
export function prepareRepetitionContext(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  cutoff: string,
  sourceTargets: RecordedTargets | null = context.target.targets,
  comparisonSource?: GuideComparisonSourceEvidence,
  contract: GuideRepetitionContext['policyContract'] = REPETITION_PREVIEW_VERSION,
  plannedEvidence?: GuidePlannedComparisonEvidence,
): GuideRepetitionContext {
  const resolved = resolveEffectiveSettings(
    context.settings,
    context.history.athleteId,
    context.history.exerciseId,
    context.target.planId,
    undefined,
  );
  const selected = resolved.selected;
  const progressive = contract === PROGRESSIVE_PREVIEW_VERSION;
  const applicable = context.history.tasks.filter((task) =>
    progressive
      ? !!task.performedOn &&
        !!source.performedOn &&
        task.performedOn < source.performedOn &&
        task.performedOn <= cutoff
      : task.planExerciseId === context.target.prescriptionId,
  );
  const scope = new Map(
    plannedEvidence?.taskScopes?.map(({ taskId, planId }) => [taskId, planId]),
  );
  const usePlanHistory =
    progressive &&
    plannedEvidence?.destinationCaptured &&
    source.trainingPlanId &&
    applicable.some((task) => scope.get(task.id) === source.trainingPlanId);
  const candidates = applicable
    .filter(
      (task) =>
        task.performedOn &&
        source.performedOn &&
        task.performedOn < source.performedOn &&
        (!usePlanHistory ||
          !scope.has(task.id) ||
          scope.get(task.id) === source.trainingPlanId),
    )
    .sort(
      (a, b) =>
        b.performedOn!.localeCompare(a.performedOn!) ||
        a.id.localeCompare(b.id),
    );
  const minimumSessions = selected?.minSuccessfulSessions ?? 1;
  const recentPair = candidates.slice(0, 2);
  // A minimum is an evidence floor. Inspect a second recent occurrence when
  // nominal comparability for both is established, even with a floor of one.
  const considerTrend =
    progressive &&
    minimumSessions === 1 &&
    recentPair.length === 2 &&
    !guidePreviewPeriodReasons(source, {
      performedOn: recentPair[1].performedOn!,
      sessions: [{ timeZone: recentPair[1].timeZone }],
    }).length &&
    hasPlannedNominalComparison(
      context,
      source,
      recentPair.map(({ id }) => id),
      plannedEvidence,
    );
  const tasks = candidates.slice(0, considerTrend ? 2 : minimumSessions);
  const taskIds = tasks.map(({ id }) => id);

  const reasons: string[] = [];
  if (resolved.reasons.includes('AMBIGUOUS_SETTING_SCOPE'))
    reasons.push('AMBIGUOUS_SETTING_SCOPE');
  if (
    selected &&
    (!Number.isSafeInteger(selected.minSuccessfulSessions) ||
      selected.minSuccessfulSessions < 1)
  )
    reasons.push('SETTING_MINIMUM_INVALID');
  const parsed = normalizeTargets(sourceTargets),
    t = parsed.targets;
  reasons.push(...parsed.reasons);
  const baseline = repetitionLoadBaseline(
    context,
    source,
    t,
    progressive ? taskIds : undefined,
  );
  if (!baseline) reasons.push('KNOWN_LOAD_BASELINE_REQUIRED');
  if (context.target.kind !== 'PRESCRIPTION' || !context.target.prescriptionId)
    reasons.push('PRESCRIPTION_REQUIRED');
  if (context.target.retired || !context.history.exerciseIsActive)
    reasons.push('DESTINATION_UNAVAILABLE');
  if (
    recommendationIdentity(sourceTargets) !==
    recommendationIdentity(context.target.targets)
  )
    reasons.push('DESTINATION_TARGETS_CHANGED');
  if (!source.performedOn || !source.timeZone) reasons.push('DATE_UNKNOWN');
  if (
    !context.history.tasks.some(
      (t) =>
        (progressive || t.planExerciseId === context.target.prescriptionId) &&
        t.performedOn &&
        source.performedOn &&
        t.performedOn < source.performedOn &&
        t.performedOn <= cutoff,
    )
  )
    reasons.push('NO_ELIGIBLE_HISTORY');
  if (
    source.kind === 'SESSION' &&
    !['PLANNED', 'IN_PROGRESS'].includes(source.status)
  )
    reasons.push('SESSION_NOT_TRAINABLE');
  if (Object.values(context.history.truncated).some(Boolean))
    reasons.push('READ_LIMIT_REACHED');
  if (progressive) {
    const consideredDates = new Set(
      tasks.map(({ performedOn }) => performedOn),
    );
    if (
      candidates.filter(({ performedOn }) => consideredDates.has(performedOn))
        .length > consideredDates.size
    )
      reasons.push('INTRADAY_ORDER_UNKNOWN');
  }

  const prepared: GuideRepetitionContext = {
    ...(progressive ? { historyCutoffOn: cutoff } : {}),
    comparisonKey: guideComparisonKey(
      context,
      source,
      cutoff,
      sourceTargets,
      taskIds,
      comparisonSource,
    ),
    contextKey: recommendationIdentity({
      schemaVersion: contract,
      source,
      cutoff,
      context,
      sourceTargets,
      ...(progressive ? { comparisonSource, plannedEvidence } : {}),
    }),
    ready: !reasons.length,
    reasons: [...new Set(reasons)],
    minimumSessions,
    minimumSource: selected ? 'PERSISTED_SETTING' : 'PLAN_BOUND_INITIAL_POLICY',
    baselineSource: baseline?.baselineSource ?? null,
    tasks: tasks.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      performedOn: t.performedOn,
      timeZone: t.timeZone,
    })),
    policyContract: contract,
    executionAuthorized: false,
  };
  if (progressive) {
    if (comparisonSource?.isOmitted) prepared.reasons.push('EXERCISE_OMITTED');
    if (
      comparisonSource?.replacesWorkoutExerciseId ||
      (comparisonSource?.originalExerciseId &&
        comparisonSource.originalExerciseId !== context.history.exerciseId)
    )
      prepared.reasons.push('SUBSTITUTION_NOT_COMPARABLE');
    // Validate evidence using the very same numeric policy before requesting any
    // owner declaration. This never exposes a calculated target or declares
    // physical comparability on the owner's behalf.
    prepared.ready = !prepared.reasons.length;
    const verified = hasPlannedNominalComparison(
      context,
      source,
      taskIds,
      plannedEvidence,
    );
    const assessed = evaluateRepetitionEvidence(
      context,
      source,
      prepared,
      verified,
    );
    if (assessed.origin !== 'CALCULATED')
      prepared.reasons.push(...assessed.reasons);
    prepared.reasons = [...new Set(prepared.reasons)];
    prepared.ready = !prepared.reasons.length;
    prepared.comparability = !prepared.ready
      ? { state: 'NOT_COMPARABLE', source: null }
      : verified
        ? { state: 'AUTOMATIC_VERIFIED', source: 'PLANNED_NOMINAL_LOAD' }
        : { state: 'CONFIRMATION_REQUIRED', source: null };
  }
  return prepared;
}
export function repetitionPreview(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  prepared: GuideRepetitionContext,
  input: WorkoutGuideRepetitionPreviewInput,
): GuideSuggestion {
  if (
    input.policyContract !== prepared.policyContract ||
    input.contextKey !== prepared.contextKey ||
    input.exerciseId !== context.history.exerciseId ||
    input.declaration?.sameVariant !== true ||
    input.declaration?.sameEquipment !== true ||
    input.declaration?.sameLoadConvention !== true
  )
    throw new RecommendationError('INVALID_COMMAND');
  return evaluateRepetitionEvidence(
    context,
    source,
    prepared,
    prepared.comparability?.state === 'AUTOMATIC_VERIFIED',
  );
}

export function automaticRepetitionPreview(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  prepared: GuideRepetitionContext,
): GuideSuggestion | null {
  return prepared.ready &&
    prepared.comparability?.state === 'AUTOMATIC_VERIFIED'
    ? evaluateRepetitionEvidence(context, source, prepared, true)
    : null;
}

function evaluateRepetitionEvidence(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  prepared: GuideRepetitionContext,
  allowImprovingTrend = false,
): GuideSuggestion {
  const progressive = prepared.policyContract === PROGRESSIVE_PREVIEW_VERSION;
  const target = context.target.targets!,
    reasons = [...prepared.reasons];
  const no = (
    why: string[],
    action: GuideSuggestion['action'] = 'INSUFFICIENT_DATA',
  ): GuideSuggestion => ({
    origin: context.history.tasks.length
      ? 'HISTORICAL_REFERENCE'
      : 'INSUFFICIENT_DATA',
    action,
    load: null,
    unit: null,
    reps: null,
    sets: null,
    reason:
      'Los registros no permiten avanzar repeticiones de forma comparable. Usa el objetivo del plan o ajusta tu sesión manualmente.',
    reasons: [...new Set(why)],
    policyVersion: prepared.policyContract,
    executionAuthorized: false,
  });
  if (!prepared.ready) return no(reasons, 'CONFIGURATION_REQUIRED');
  const selectedTasks = new Set(prepared.tasks.map(({ id }) => id));
  const relevant = context.history.tasks.filter((t) =>
    progressive
      ? selectedTasks.has(t.id) &&
        !!t.performedOn &&
        !!source.performedOn &&
        t.performedOn < source.performedOn &&
        t.performedOn <= prepared.historyCutoffOn!
      : t.planExerciseId === context.target.prescriptionId,
  );
  if (!relevant.length) return no(['NO_ELIGIBLE_HISTORY']);
  if (
    relevant.some((t) => !t.performedOn || t.performedOn >= source.performedOn!)
  )
    return no(['INCOMPLETE_HISTORY']);
  const tasks = [...relevant].sort(
    (a, b) =>
      b.performedOn!.localeCompare(a.performedOn!) || a.id.localeCompare(b.id),
  );
  const latest = tasks[0],
    slice = progressive ? tasks : tasks.slice(0, prepared.minimumSessions);
  const period = guidePreviewPeriodReasons(source, {
    performedOn: latest.performedOn!,
    sessions: [],
    gapDays: null,
  });
  if (period.length) return no(period, 'REVIEW_REQUIRED');
  if (slice.length < prepared.minimumSessions)
    return no(['MINIMUM_NOT_REACHED']);
  if (
    tasks.filter((t) => t.performedOn === latest.performedOn).length > 1 ||
    new Set(slice.map((t) => t.performedOn)).size !== slice.length
  )
    return no(['INTRADAY_ORDER_UNKNOWN']);
  if (new Set(slice.map((t) => t.sessionId)).size !== slice.length)
    return no(['DUPLICATE_SESSION_REFERENCE']);
  const sessionRepetitions: number[][] = [];
  let effort = false;
  const baseline = repetitionLoadBaseline(
    context,
    source,
    target,
    progressive ? prepared.tasks.map((task) => task.id) : undefined,
  );
  if (!baseline) return no(['KNOWN_LOAD_BASELINE_REQUIRED']);
  const targetLoad = readDecimal(baseline.load);
  for (const task of slice) {
    if (
      task.athleteId !== context.history.athleteId ||
      task.exerciseId !== context.history.exerciseId
    )
      return no(['SOURCE_OWNERSHIP_MISMATCH']);
    if (progressive && !task.planExerciseId)
      return no(['PRESCRIPTION_HISTORY_REQUIRED']);
    if (
      progressive &&
      task.originalExerciseId &&
      task.originalExerciseId !== task.exerciseId
    )
      return no(['SUBSTITUTION_NOT_COMPARABLE']);
    if (task.sessionStatus !== 'COMPLETED' || task.isOmitted)
      return no(['SESSION_NOT_COMPLETED']);
    if (task.replacesWorkoutExerciseId)
      return no(['SUBSTITUTION_NOT_COMPARABLE']);
    if (task.timeZone !== source.timeZone) return no(['TIME_ZONE_MISMATCH']);
    if (
      recommendationIdentity(task.adjustedTargets) !==
      recommendationIdentity(target)
    )
      return no(['HISTORICAL_TARGETS_DIFFER']);
    const all = context.history.sets.filter(
        (s) => s.workoutExerciseId === task.id,
      ),
      sets = all.filter((s) => s.kind === 'WORK');
    if (all.length < task.availableSets || sets.length !== target.targetSets)
      return no(['WORK_SLOT_MAPPING_INCOMPLETE']);
    if (all.some((s) => s.kind === null)) return no(['SET_KIND_UNKNOWN']);
    if (
      new Set(sets.map((s) => s.id)).size !== sets.length ||
      new Set(sets.map((s) => s.setNumber)).size !== sets.length
    )
      return no(['DUPLICATE_SET_REFERENCE']);
    if (
      progressive &&
      sets.some(
        (set) => !Number.isSafeInteger(set.setNumber) || set.setNumber < 1,
      )
    )
      return no(['WORK_SLOT_MAPPING_INCOMPLETE']);
    const repetitions: number[] = [];
    for (const set of sets.sort((a, b) => a.setNumber - b.setNumber)) {
      if (set.status !== 'COMPLETED' || !set.isCompleted)
        return no(['WORK_SET_NOT_COMPLETED']);
      if (
        !Number.isSafeInteger(set.repetitions) ||
        set.repetitions! < target.targetRepsMin! ||
        set.repetitions! > target.targetRepsMax!
      )
        return no(['REPETITIONS_OUTSIDE_PRESCRIBED_RANGE']);
      const load = readDecimal(set.load);
      if (
        !load.ok ||
        !targetLoad.ok ||
        !load.value.eq(targetLoad.value) ||
        set.loadUnit !== baseline.unit
      )
        return no(['RECORDED_LOAD_DIFFERS']);
      if (set.rpe !== null) {
        effort = true;
        const rpe = readDecimal(set.rpe);
        if (!rpe.ok || rpe.value.lt(0) || rpe.value.gt(10))
          return no(['RECORDED_EFFORT_INVALID']);
        const setting = resolveEffectiveSettings(
          context.settings,
          context.history.athleteId,
          context.history.exerciseId,
          context.target.planId,
          undefined,
        ).selected;
        const cap = readDecimal(setting?.targetRpeMax ?? target.targetRpe);
        if (cap.ok && rpe.value.gt(cap.value))
          return no(['RECORDED_EFFORT_ABOVE_TARGET'], 'REVIEW_REQUIRED');
      }
      repetitions.push(set.repetitions!);
    }
    sessionRepetitions.push(repetitions);
  }
  const latestRepetitions = sessionRepetitions[0];
  if (
    !latestRepetitions?.length ||
    sessionRepetitions.some((repetitions, sessionIndex) =>
      repetitions.some((value, index) => {
        if (!allowImprovingTrend)
          return value !== latestRepetitions[progressive ? index : 0];
        return (
          sessionIndex > 0 &&
          value > sessionRepetitions[sessionIndex - 1][index]
        );
      }),
    )
  )
    return no(['HISTORY_REPETITIONS_INCONSISTENT']);
  const improving = sessionRepetitions
    .slice(1)
    .some((repetitions) =>
      repetitions.some((value, index) => value < latestRepetitions[index]),
    );
  const evidenceDescription =
    slice.length === 1
      ? 'Cumpliste el rango en la sesión comparable.'
      : improving
        ? `Mejoraste repeticiones sin perderlas en ninguna serie de las ${slice.length} sesiones comparables.`
        : `Repetiste los resultados en ${slice.length} sesiones comparables.`;

  const mixed = new Set(latestRepetitions).size > 1;
  const previous = mixed
      ? Math.min(...latestRepetitions)
      : latestRepetitions[0],
    next = Math.min(previous + 1, target.targetRepsMax!);
  // A stable work-set pattern can progress one slot without raising the load,
  // reducing the other targets, or claiming that all sets reached the upper bound.
  const slot = latestRepetitions.indexOf(previous);
  const repsBySet = mixed
    ? latestRepetitions.map((value, index) => (index === slot ? next : value))
    : undefined;
  const advance = next > previous;
  return {
    origin: 'CALCULATED',
    action: 'MAINTAIN',
    load: targetLoad.ok ? targetLoad.value.toFixed(6) : null,
    unit: baseline.unit,
    reps: mixed ? null : next,
    ...(repsBySet ? { repsBySet } : {}),
    sets: target.targetSets,
    reason: repsBySet
      ? `${evidenceDescription} Con ${latestRepetitions.join(' / ')} repeticiones registradas, prueba ${next} en la serie ${slot + 1} a la misma carga y conserva las demás metas del plan.`
      : advance
        ? progressive
          ? `${evidenceDescription} Registraste ${previous} repeticiones por serie. Prueba ${next} a la misma carga, dentro del rango del plan.`
          : `Completaste ${previous} repeticiones por serie con esta carga. Puedes intentar ${next}, dentro del rango de tu plan, y ajustar el objetivo si lo necesitas.`
        : 'Completaste el extremo superior del rango. Mantén esta referencia; aumentar peso requiere un incremento disponible y una política de carga explícitos.',
    reasons: [
      advance ? 'REPETITION_TARGET_ADVANCE' : 'REPETITION_RANGE_COMPLETED',
      ...(advance ? [] : ['LOAD_INCREMENT_REQUIRES_EXPLICIT_POLICY']),
      'EFFORT_NOT_REQUIRED_BY_POLICY',
      ...(effort ? ['RECORDED_EFFORT_CONTEXT'] : []),
      ...(allowImprovingTrend && slice.length > 1
        ? [
            improving
              ? 'COMPARABLE_SESSIONS_IMPROVING'
              : 'COMPARABLE_SESSIONS_STABLE',
          ]
        : []),
      prepared.minimumSource,
      ...(baseline.baselineSource === 'RECORDED_HISTORY'
        ? ['LOAD_FROM_RECORDED_HISTORY']
        : []),
    ],
    policyVersion: prepared.policyContract,
    executionAuthorized: false,
  };
}
