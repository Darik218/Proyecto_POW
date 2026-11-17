import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import type {
  GuideHistoryTask,
  GuideProposal,
  GuideProposalAssessment,
  WorkoutGuideQuery,
  GuideExerciseSource,
  GuideCalculation,
  GuideSuggestion,
  WorkoutGuideSnapshot,
} from '../../models/progression/workout-guide.model';
import { assertPersistableDecimal } from './estimate-evidence.policy';
import { compareDrafts } from './recommendation.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
/** Scope of the non-operative weekly guide, not a physiological decay rule.
 * Civil sporting dates already belong to the declared timezone; UTC only
 * represents those dates while locating ISO Monday week boundaries. */
export function guidePreviewPeriodReasons(
  source: WorkoutGuideSnapshot['source'],
  reference: ReturnType<typeof referenceGuidance>['lastReference'],
) {
  if (!reference || !source.performedOn) return [];
  if (
    !source.timeZone ||
    reference.sessions.some((t) => t.timeZone !== source.timeZone)
  )
    return ['TIME_ZONE_MISMATCH'];
  const monday = new Date(source.performedOn + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
  monday.setUTCDate(monday.getUTCDate() - 7);
  return reference.performedOn < monday.toISOString().slice(0, 10)
    ? ['REFERENCE_OUTSIDE_PREVIEW_PERIOD']
    : [];
}
export function guideCalculationReasons(
  exercise: GuideExerciseSource,
  calculation: GuideCalculation,
  snapshot: WorkoutGuideSnapshot,
) {
  const c = calculation.command,
    h = calculation.context.history;
  const reasons: string[] = [];
  if (snapshot.status !== 'TRAINABLE' || exercise.isOmitted)
    reasons.push('EXERCISE_OMITTED');
  if (exercise.historyTruncated) reasons.push('READ_LIMIT_REACHED');
  if (
    h.exerciseId !== exercise.exerciseId ||
    c.history.exerciseId !== exercise.exerciseId
  )
    reasons.push('EXERCISE_MISMATCH');
  if (!snapshot.source.performedOn || !snapshot.source.timeZone)
    reasons.push('DATE_UNKNOWN');
  if (c.history.timeZone !== snapshot.source.timeZone)
    reasons.push('TIME_ZONE_MISMATCH');
  if (
    c.history.to > snapshot.historyCutoffOn ||
    !snapshot.source.performedOn ||
    c.history.to >= snapshot.source.performedOn
  )
    reasons.push('CUTOFF_NOT_BEFORE_WORKOUT');
  if (
    exercise.history.some(
      (t) =>
        t.performedOn === null || t.performedOn === snapshot.source.performedOn,
    )
  )
    reasons.push('INCOMPLETE_HISTORY');
  const latest = exercise.history
    .filter(
      (t) =>
        t.performedOn &&
        snapshot.source.performedOn &&
        t.performedOn < snapshot.source.performedOn,
    )
    .reduce<string | null>(
      (v, t) => (v === null || t.performedOn! > v ? t.performedOn : v),
      null,
    );
  if (!latest) reasons.push('NO_ELIGIBLE_HISTORY');
  const cohort = c.policy?.cohort;
  const included = h.tasks.filter((t) =>
    cohort?.mode === 'EXPLICIT_TASK_SET'
      ? cohort.taskIds.includes(t.id)
      : t.planExerciseId === exercise.prescriptionId,
  );
  if (
    latest &&
    (latest > c.history.to ||
      !exercise.history
        .filter((t) => t.performedOn === latest)
        .every((t) => included.some((i) => i.id === t.taskId)))
  )
    reasons.push('LATEST_HISTORY_NOT_IN_DECLARED_COHORT');
  const anchor = included.find(
    (t) => t.id === c.policy?.assessment.count?.anchorTaskId,
  );
  if (latest && anchor?.performedOn !== latest)
    reasons.push('ANCHOR_NOT_LATEST_REFERENCE');
  const target = calculation.context.target;
  if (
    target.kind === 'PRESCRIPTION'
      ? target.prescriptionId !== exercise.prescriptionId
      : target.taskId !== exercise.id
  )
    reasons.push('DESTINATION_MISMATCH');
  if (
    recommendationIdentity(target.targets) !==
    recommendationIdentity(exercise.target)
  )
    reasons.push('DESTINATION_TARGETS_CHANGED');
  return reasons;
}
export function guideSuggestion(
  origin: GuideSuggestion['origin'],
  action: GuideSuggestion['action'],
  reasons: string[],
  target: RecordedTargets,
  load: string | null = null,
  policyVersion: string | null = null,
): GuideSuggestion {
  const numeric =
    (action === 'INCREASE' || action === 'MAINTAIN') && load !== null;
  const messages = {
    INCREASE:
      'El cálculo con tu política y registros permite proponer un incremento. Revisa cómo te encuentras antes de entrenar.',
    MAINTAIN: 'Los registros evaluados indican mantener la carga del objetivo.',
    REVIEW_REQUIRED:
      'Revisa los cambios y el contexto antes de elegir la carga.',
    CONFIGURATION_REQUIRED:
      'Falta una configuración o declaración de análisis aplicable para calcular una sugerencia.',
    INSUFFICIENT_DATA:
      'No hay evidencia comparable suficiente para calcular una carga.',
    NO_REPRESENTABLE_INCREMENT:
      'El incremento configurado no se puede representar con las cargas declaradas.',
  };
  return {
    origin,
    action,
    load: numeric ? load : null,
    unit: numeric ? target.targetLoadUnit : null,
    reps: numeric ? (target.targetRepsMax ?? target.targetRepsMin) : null,
    sets: numeric ? target.targetSets : null,
    reason: messages[action],
    reasons: [...new Set(reasons)],
    policyVersion,
    executionAuthorized: false,
  };
}
export function validateWorkoutGuideQuery(
  query: WorkoutGuideQuery,
): WorkoutGuideQuery {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [query.activityId, query.planDayId, query.sessionId].filter(
    (v) => v !== undefined,
  );
  const validDate = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(new Date(v).getTime()) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    ids.length !== 1 ||
    !ids.every((v) => typeof v === 'string' && uuid.test(v!)) ||
    (query.performedOn !== undefined && !validDate(query.performedOn)) ||
    (query.planDayId && (!query.performedOn || !query.timeZone))
  )
    throw new RecommendationError('INVALID_COMMAND');
  if (query.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: query.timeZone }).format();
    } catch {
      throw new RecommendationError('INVALID_COMMAND');
    }
  }
  return { ...query };
}
export function referenceGuidance(
  history: GuideHistoryTask[],
  performedOn: string | null,
  truncated: boolean,
) {
  const actual = history.filter((t) => t.sets.length > 0),
    reasons: string[] = [];
  const eligible = actual.filter(
    (t) =>
      t.performedOn !== null &&
      performedOn !== null &&
      t.performedOn < performedOn,
  );
  const latest = eligible.reduce<string | null>(
    (date, t) =>
      date === null || t.performedOn! > date ? t.performedOn : date,
    null,
  );
  const sessions = eligible
    .filter((t) => t.performedOn === latest)
    .map(({ sessionId, taskId, performedOn, timeZone, sets }) => ({
      sessionId,
      taskId,
      performedOn,
      timeZone,
      sets,
    }));
  if (actual.some((t) => t.performedOn === null) || performedOn === null)
    reasons.push('DATE_UNKNOWN');
  if (actual.some((t) => t.performedOn === performedOn))
    reasons.push('SAME_DAY_NOT_ORDERED');
  if (sessions.length > 1) reasons.push('INTRADAY_ORDER_UNKNOWN');
  if (
    sessions.some((t) =>
      t.sets.some((s) => s.load !== null && s.loadUnit === null),
    )
  )
    reasons.push('LOAD_UNIT_UNKNOWN');
  if (truncated) reasons.push('READ_LIMIT_REACHED');
  const gapDays =
    latest && performedOn
      ? Math.round((Date.parse(performedOn) - Date.parse(latest)) / 86400000)
      : null;
  if (gapDays !== null)
    reasons.push('GAP_DESCRIPTIVE_ONLY', 'REVIEW_REFERENCE_BEFORE_TRAINING');
  const state =
    actual.length === 0 && !truncated
      ? 'FIRST_BASELINE'
      : latest
        ? 'REFERENCE_AVAILABLE'
        : 'INSUFFICIENT_DATA';
  return {
    lastReference: latest ? { performedOn: latest, sessions, gapDays } : null,
    guidance: {
      state,
      reasons,
      message:
        state === 'FIRST_BASELINE'
          ? 'Primera referencia: registra lo que puedas realizar con control.'
          : state === 'INSUFFICIENT_DATA'
            ? 'No hay una referencia anterior fechada suficiente. Revisa el objetivo antes de entrenar.'
            : `Tu última referencia registrada fue hace ${gapDays} días. Revisa cómo te encuentras; el tiempo transcurrido no determina una pérdida de fuerza.`,
    },
  };
}
export function assessGuideProposal(
  input: GuideProposalAssessment,
): GuideProposal {
  const {
      proposal: p,
      command: c,
      current,
      target,
      prescriptionId,
      latestDate,
      now,
      performedOn,
    } = input,
    reasons: string[] = [];
  const g = p.generation,
    d = g?.draft.evidence.destination;
  if (!g || !c?.policy || !current) reasons.push('REVALIDATION_UNAVAILABLE');
  if (
    !prescriptionId ||
    d?.kind !== 'PRESCRIPTION' ||
    d.prescriptionId !== prescriptionId ||
    c?.destination.kind !== 'PRESCRIPTION' ||
    c.destination.prescriptionId !== prescriptionId
  )
    reasons.push('PRESCRIPTION_MISMATCH');
  try {
    assertPersistableDecimal(p.recommendedLoad, 8, 3);
  } catch {
    reasons.push('DESTINATION_DECIMAL_INCOMPATIBLE');
  }
  if (!p.loadUnit || target.targetLoadUnit !== p.loadUnit)
    reasons.push('TARGET_UNIT_MISMATCH');
  if (
    g &&
    recommendationIdentity(d?.targets ?? null) !==
      recommendationIdentity(target)
  )
    reasons.push('PRESCRIPTION_TARGETS_CHANGED');
  if (!['PENDING', 'APPROVED'].includes(p.status))
    reasons.push('PROPOSAL_NOT_ACTIVE');
  if (p.expiresAt && p.expiresAt <= now) reasons.push('PROPOSAL_EXPIRED');
  if (g && current) {
    const compared = compareDrafts(g.draft, current);
    if (compared.obsolete || compared.changed.length)
      reasons.push('PROPOSAL_OBSOLETE', ...compared.changed);
    if (
      current.decision !== 'INCREASE' ||
      current.increment?.proposedLoad !== p.recommendedLoad
    )
      reasons.push('NO_CURRENT_INCREASE');
  }
  if (
    !performedOn ||
    !c ||
    c.history.to >= performedOn ||
    c.period.cutoffOn >= performedOn
  )
    reasons.push('CUTOFF_NOT_BEFORE_WORKOUT');
  if (
    latestDate &&
    c &&
    (latestDate > c.history.to || latestDate > c.period.cutoffOn)
  )
    reasons.push('NEWER_REFERENCE_OUTSIDE_PROPOSAL');
  return {
    id: p.id,
    status: reasons.length ? 'REQUIRES_REVIEW' : 'CURRENT',
    recommendedLoad: reasons.length ? null : p.recommendedLoad,
    loadUnit: p.loadUnit,
    reasons: [...new Set(reasons)],
    href: `/app/progression/recommendations/${encodeURIComponent(p.id)}`,
  };
}

export function isGuideDayTrainable(
  day: {
    retiredAt: Date | null;
    retiredFromOn: Date | null;
    planStatus: string;
  },
  performedOn: string,
) {
  return (
    ['DRAFT', 'ACTIVE'].includes(day.planStatus) &&
    (!day.retiredAt ||
      (!!day.retiredFromOn &&
        performedOn < day.retiredFromOn.toISOString().slice(0, 10)))
  );
}

export function originalGuideTargets(
  snapshot: unknown,
): RecordedTargets | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const t = (snapshot as Record<string, unknown>).targets;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const fields = t as Record<string, unknown>;
  return {
    targetSets:
      typeof fields.targetSets === 'number' ? fields.targetSets : null,
    targetRepsMin:
      typeof fields.targetRepsMin === 'number' ? fields.targetRepsMin : null,
    targetRepsMax:
      typeof fields.targetRepsMax === 'number' ? fields.targetRepsMax : null,
    targetLoad:
      typeof fields.targetLoad === 'string' ? fields.targetLoad : null,
    targetLoadUnit:
      fields.targetLoadUnit === 'KG' || fields.targetLoadUnit === 'LB'
        ? fields.targetLoadUnit
        : null,
    targetRpe:
      typeof fields.targetRpe === 'string'
        ? fields.targetRpe
        : typeof fields.targetRpe === 'number' &&
            Number.isFinite(fields.targetRpe) &&
            fields.targetRpe >= 0 &&
            fields.targetRpe <= 10
          ? String(fields.targetRpe)
          : null,
  };
}
