import type {
  RecommendationContext,
  RecommendationCommand,
} from '../../models/progression/recommendation-draft.model';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
import type {
  GuideCalculationContext,
  GuideComparisonSourceEvidence,
  WorkoutGuidePreviewInput,
  WorkoutGuideSource,
} from '../../models/progression/workout-guide.model';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { resolveEffectiveSettings } from './effective-settings.policy';
import { readDecimal } from './decimal';
import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import { guideComparisonKey } from './workout-guide-comparison.policy';

export function prepareGuideCalculationContext(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  cutoff: string,
  sourceTargets: RecordedTargets | null = context.target.targets,
  comparisonSource?: GuideComparisonSourceEvidence,
): GuideCalculationContext {
  const resolved = resolveEffectiveSettings(
    context.settings,
    context.history.athleteId,
    context.history.exerciseId,
    context.target.planId,
    undefined,
  );
  const selected = resolved.selected;
  const tasks = context.history.tasks.filter(
    (t) =>
      t.planExerciseId === context.target.prescriptionId &&
      t.sessionStatus === 'COMPLETED' &&
      !t.isOmitted &&
      t.performedOn &&
      source.performedOn &&
      t.performedOn < source.performedOn &&
      t.performedOn <= cutoff,
  );
  const reasons = resolved.reasons.filter(
    (r) =>
      ![
        'POLICY_PROVENANCE_REQUIRED',
        'SETTING_LOAD_UNIT_REQUIRED',
        'AMBIGUOUS_INCREMENT_MODE',
        'INCREMENT_MODE_REQUIRED',
      ].includes(r),
  );
  if (
    recommendationIdentity(sourceTargets) !==
    recommendationIdentity(context.target.targets)
  )
    reasons.push('DESTINATION_TARGETS_CHANGED');
  if (!context.target.prescriptionId || context.target.kind !== 'PRESCRIPTION')
    reasons.push('PRESCRIPTION_REQUIRED');
  if (!tasks.length) reasons.push('NO_ELIGIBLE_HISTORY');
  if (!source.timeZone || tasks.some((t) => t.timeZone !== source.timeZone))
    reasons.push('TIME_ZONE_MISMATCH');
  if (!context.target.targets?.targetLoadUnit)
    reasons.push('TARGET_UNIT_REQUIRED');
  if (Object.values(context.history.truncated).some(Boolean))
    reasons.push('READ_LIMIT_REACHED');
  const incrementModes: GuideCalculationContext['incrementModes'] = [];
  if (
    selected?.incrementAbsolute !== null &&
    selected?.incrementAbsolute !== undefined
  )
    incrementModes.push('ABSOLUTE');
  if (
    selected?.incrementPercent !== null &&
    selected?.incrementPercent !== undefined
  )
    incrementModes.push('PERCENT');
  if (!incrementModes.length) reasons.push('INCREMENT_REQUIRED');
  const setting = selected
    ? {
        minSuccessfulSessions: selected.minSuccessfulSessions,
        targetRpeMin: selected.targetRpeMin,
        targetRpeMax: selected.targetRpeMax,
        incrementAbsolute: selected.incrementAbsolute,
        incrementPercent: selected.incrementPercent,
        maxIncrementPercent: selected.maxIncrementPercent,
        maxLoad: selected.maxLoad,
      }
    : null;
  return {
    comparisonKey: guideComparisonKey(
      context,
      source,
      cutoff,
      sourceTargets,
      tasks.map((t) => t.id),
      comparisonSource,
    ),
    contextKey: recommendationIdentity({
      schemaVersion: 'session-readiness-preview-context-v1',
      source,
      cutoff,
      context,
      sourceTargets,
    }),
    ready: !reasons.length,
    reasons: [...new Set(reasons)],
    setting,
    unit: context.target.targets?.targetLoadUnit ?? null,
    incrementModes,
    tasks: tasks.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      performedOn: t.performedOn,
      timeZone: t.timeZone,
      status: t.sessionStatus,
      sets: t.availableSets,
    })),
    policyContract: 'session-readiness-preview-v1',
    executionAuthorized: false,
  };
}

export function buildGuidePreview(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  prepared: GuideCalculationContext,
  input: WorkoutGuidePreviewInput,
): RecommendationCommand {
  if (
    !input ||
    input.contextKey !== prepared.contextKey ||
    ![
      'session-readiness-preview-v1',
      'session-load-compliance-preview-v1',
    ].includes(input.policyContract) ||
    input.exerciseId !== context.history.exerciseId ||
    input.declaration?.sameVariant !== true ||
    input.declaration?.sameEquipment !== true ||
    input.declaration?.externalTotal !== true ||
    !prepared.incrementModes.includes(input.incrementMode) ||
    !prepared.ready ||
    !prepared.setting ||
    !prepared.unit ||
    !source.timeZone
  )
    throw new RecommendationError('INVALID_COMMAND');
  const step = readDecimal(input.gridStep);
  if (!step.ok || step.value.lte(0))
    throw new RecommendationError('INVALID_COMMAND');
  const tasks = [...prepared.tasks].sort(
    (a, b) =>
      a.performedOn!.localeCompare(b.performedOn!) || a.id.localeCompare(b.id),
  );
  const latest = tasks.at(-1)!,
    from = tasks[0].performedOn!,
    to = latest.performedOn!;
  const week = new Date(to + 'T00:00:00Z');
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() || 7) - 1));
  const start = week.toISOString().slice(0, 10);
  week.setUTCDate(week.getUTCDate() + 7);
  const endExclusive = week.toISOString().slice(0, 10);
  const target = context.target,
    s = prepared.setting;
  const key = 'owner-preview-' + prepared.contextKey;
  const complianceOnly =
    input.policyContract === 'session-load-compliance-preview-v1';
  const policyId = complianceOnly
    ? 'session-load-compliance-preview'
    : 'session-readiness-preview';
  return {
    history: {
      exerciseId: context.history.exerciseId,
      from: from < start ? from : start,
      to,
      timeZone: source.timeZone,
      limit: 100,
      contexts: tasks.map((t) => ({
        workoutExerciseId: t.id,
        loadMeaning: 'EXTERNAL_TOTAL',
        protocolKey: key,
        equipmentKey: key,
        source: 'OWNER_DECLARATION_FOR_ANALYSIS',
      })),
      comparisons: [],
    },
    period: {
      start,
      endExclusive,
      timeZone: source.timeZone,
      cutoffOn: to,
      weekStartsOn: 1,
    },
    destination: {
      kind: 'PRESCRIPTION',
      planId: target.planId!,
      weekId: target.weekId!,
      dayId: target.dayId!,
      prescriptionId: target.prescriptionId!,
    },
    expectedPlanVersion: target.planVersion ?? undefined,
    policy: {
      id: policyId,
      version: input.policyContract,
      provenance: {
        source: 'EXPLICIT_INTERNAL_POLICY',
        reference:
          'REQUEST_DECLARATION/NO_AUTHORIZATION:' + prepared.contextKey,
      },
      basis: 'ADJUSTED',
      baseline: 'DESTINATION_PRESCRIPTION',
      cohort: { mode: 'SAME_PRESCRIPTION' },
      assessment: {
        compliance: {
          id: policyId + '-compliance',
          slots: tasks.map((t) => ({
            taskId: t.id,
            original: [],
            adjusted: context.history.sets
              .filter(
                (set) => set.workoutExerciseId === t.id && set.kind === 'WORK',
              )
              .map((set) => set.setNumber),
            originalLoadMeaning: 'UNKNOWN',
            adjustedLoadMeaning: 'EXTERNAL_TOTAL',
          })),
          basic: {
            repetitions: 'UPPER_BOUND',
            load: 'EXACT_TARGET',
            rpe: 'DESCRIBE',
            coverage: 'ALL_REQUIRED',
          },
          readiness: {
            repetitions: 'UPPER_BOUND',
            load: 'EXACT_TARGET',
            rpe: complianceOnly
              ? 'DESCRIBE'
              : { minimum: s.targetRpeMin, maximum: s.targetRpeMax },
            coverage: 'ALL_REQUIRED',
          },
        },
        count: {
          id: policyId + '-count',
          basis: 'ADJUSTED',
          criterion: complianceOnly ? 'BASIC' : 'READINESS',
          mode: 'CONSECUTIVE',
          sameDate: 'DISTINCT_DATES',
          minimumSessions: s.minSuccessfulSessions,
          anchorTaskId: latest.id,
        },
      },
      settingRpeUse: complianceOnly
        ? 'CONTEXT_ONLY_EXPLICIT'
        : 'REQUIRE_INTERVAL',
      review: 'NOT_REQUIRED_EXPLICIT',
      oneRm: 'DESCRIPTIVE_CONTEXT_ONLY',
      requireClosedWeek: false,
      knowledge: 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF',
      loadMeaning: 'EXTERNAL_TOTAL',
      settingLoadUnit: prepared.unit,
      incrementMode: input.incrementMode,
      grid: {
        unit: prepared.unit,
        step: input.gridStep,
        origin: '0',
        rounding: 'FLOOR',
        source: 'REQUEST_DECLARATION/NO_AUTHORIZATION:' + prepared.contextKey,
      },
    },
  };
}
