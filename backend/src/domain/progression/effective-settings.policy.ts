import type {
  RecommendationPolicy,
  StoredProgressionSetting,
} from '../../models/progression/recommendation-draft.model';
import { readDecimal } from './decimal';
import { validateAssessmentOptions } from './assessment-query.policy';
const key = (s: unknown) =>
  typeof s === 'string' && !!s.trim() && s.length <= 160;
export function resolveEffectiveSettings(
  rows: readonly StoredProgressionSetting[],
  athleteId: string,
  exerciseId: string,
  planId: string | null,
  policy: RecommendationPolicy | undefined,
) {
  const applicable = rows.filter(
    (s) =>
      s.athleteId === athleteId &&
      ((s.exerciseId === null && s.trainingPlanId === null) ||
        (s.exerciseId === exerciseId &&
          (s.trainingPlanId === null ||
            (planId !== null && s.trainingPlanId === planId)))),
  );
  const rank = (s: StoredProgressionSetting) =>
    s.trainingPlanId !== null ? 2 : s.exerciseId !== null ? 1 : 0;
  const highest = applicable.length ? Math.max(...applicable.map(rank)) : -1;
  const choices = applicable.filter((s) => rank(s) === highest);
  const selected = choices.length === 1 ? choices[0] : null;
  const scope =
    highest === 2
      ? 'EXERCISE_PLAN'
      : highest === 1
        ? 'EXERCISE'
        : highest === 0
          ? 'ATHLETE'
          : null;
  const reasons: string[] = [];
  let mode: 'ABSOLUTE' | 'PERCENT' | null = null;
  if (!selected)
    reasons.push(
      choices.length > 1 ? 'AMBIGUOUS_SETTING_SCOPE' : 'SETTING_REQUIRED',
    );
  if (
    !policy ||
    !key(policy.id) ||
    !key(policy.version) ||
    !key(policy.provenance?.reference) ||
    policy.provenance.source !== 'EXPLICIT_INTERNAL_POLICY'
  )
    reasons.push('POLICY_PROVENANCE_REQUIRED');
  if (policy) {
    if (
      !['ORIGINAL', 'ADJUSTED'].includes(policy.basis) ||
      ![
        'DESTINATION_PRESCRIPTION',
        'ANCHOR_ORIGINAL',
        'ANCHOR_ADJUSTED',
      ].includes(policy.baseline)
    )
      reasons.push('BASIS_OR_BASELINE_REQUIRED');
    if (
      !['REQUIRE_INTERVAL', 'CONTEXT_ONLY_EXPLICIT'].includes(
        policy.settingRpeUse,
      ) ||
      !['NOT_REQUIRED_EXPLICIT', 'ANY_SIGNAL', 'TEMPORAL_SIGNAL'].includes(
        policy.review,
      )
    )
      reasons.push('RPE_POLICY_REQUIRED');
    if (
      policy.knowledge !== 'CURRENT_RECORDS_FOR_SPORTING_CUTOFF' ||
      typeof policy.requireClosedWeek !== 'boolean'
    )
      reasons.push('TEMPORAL_POLICY_REQUIRED');
    if (policy.oneRm !== 'DESCRIPTIVE_CONTEXT_ONLY')
      reasons.push('ONE_RM_DECISION_POLICY_REQUIRED');
    if (!policy.grid || !key(policy.grid.source)) reasons.push('GRID_REQUIRED');
    if (
      !policy.cohort ||
      !['SAME_PRESCRIPTION', 'EXPLICIT_TASK_SET'].includes(policy.cohort.mode)
    )
      reasons.push('COHORT_POLICY_REQUIRED');
    if (
      policy.cohort?.mode === 'EXPLICIT_TASK_SET' &&
      (!Array.isArray(policy.cohort.taskIds) ||
        !policy.cohort.taskIds.length ||
        policy.cohort.taskIds.length > 100 ||
        policy.cohort.taskIds.some((id) => !key(id)) ||
        new Set(policy.cohort.taskIds).size !== policy.cohort.taskIds.length)
    )
      reasons.push('EXPLICIT_TASK_SET_INVALID');
    try {
      validateAssessmentOptions(policy.assessment);
    } catch {
      reasons.push('ASSESSMENT_POLICY_INVALID');
    }
    if (!policy.assessment?.compliance?.basic)
      reasons.push('BASIC_POLICY_REQUIRED');
    if (!policy.assessment?.compliance?.readiness)
      reasons.push('READINESS_POLICY_REQUIRED');
    if (!policy.assessment?.count) reasons.push('COUNT_POLICY_REQUIRED');
    else if (policy.assessment.count.basis !== policy.basis)
      reasons.push('COUNT_BASIS_MISMATCH');
    if (
      policy.review !== 'NOT_REQUIRED_EXPLICIT' &&
      (!policy.assessment?.signal ||
        policy.assessment.signal.basis !== policy.basis)
    )
      reasons.push('SIGNAL_POLICY_REQUIRED');
    if (policy.review === 'TEMPORAL_SIGNAL' && !policy.assessment?.persistence)
      reasons.push('PERSISTENCE_POLICY_REQUIRED');
  }
  if (selected) {
    const lower = readDecimal(selected.targetRpeMin),
      upper = readDecimal(selected.targetRpeMax),
      cap = readDecimal(selected.maxIncrementPercent),
      max = selected.maxLoad === null ? null : readDecimal(selected.maxLoad);
    if (
      !Number.isSafeInteger(selected.minSuccessfulSessions) ||
      selected.minSuccessfulSessions < 1 ||
      !lower.ok ||
      !upper.ok ||
      lower.value.lt(0) ||
      upper.value.gt(10) ||
      lower.value.gt(upper.value) ||
      !cap.ok ||
      cap.value.lt(0) ||
      (max && (!max.ok || max.value.lte(0)))
    )
      reasons.push('SETTING_VALUES_INVALID');
    if (
      selected.incrementAbsolute !== null &&
      selected.incrementPercent !== null &&
      !policy?.incrementMode
    )
      reasons.push('AMBIGUOUS_INCREMENT_MODE');
    else
      mode =
        policy?.incrementMode ??
        (selected.incrementAbsolute !== null
          ? 'ABSOLUTE'
          : selected.incrementPercent !== null
            ? 'PERCENT'
            : null);
    if (mode !== 'ABSOLUTE' && mode !== 'PERCENT') {
      mode = null;
      reasons.push('INCREMENT_MODE_REQUIRED');
    } else {
      const value = readDecimal(
        mode === 'ABSOLUTE'
          ? selected.incrementAbsolute
          : selected.incrementPercent,
      );
      if (!value.ok || value.value.lte(0)) reasons.push('INCREMENT_REQUIRED');
      if (mode === 'PERCENT' && value.ok && cap.ok && value.value.gt(cap.value))
        reasons.push('INCREMENT_EXCEEDS_CONFIGURED_CAP');
    }
    if (
      (mode === 'ABSOLUTE' || selected.maxLoad !== null) &&
      !['KG', 'LB'].includes(policy?.settingLoadUnit ?? '')
    )
      reasons.push('SETTING_LOAD_UNIT_REQUIRED');
    if (
      policy?.settingLoadUnit &&
      policy.grid &&
      policy.settingLoadUnit !== policy.grid.unit
    )
      reasons.push('UNIT_POLICY_MISMATCH');
    if (
      policy?.assessment?.count &&
      policy.assessment.count.minimumSessions !== selected.minSuccessfulSessions
    )
      reasons.push('MINIMUM_SETTING_MISMATCH');
    if (policy?.settingRpeUse === 'REQUIRE_INTERVAL') {
      const rpe = policy.assessment?.compliance?.readiness?.rpe;
      if (!rpe || typeof rpe === 'string') reasons.push('RPE_SETTING_MISMATCH');
      else {
        const min = readDecimal(rpe.minimum),
          max = readDecimal(rpe.maximum);
        if (
          !min.ok ||
          !max.ok ||
          !lower.ok ||
          !upper.ok ||
          !min.value.eq(lower.value) ||
          !max.value.eq(upper.value)
        )
          reasons.push('RPE_SETTING_MISMATCH');
      }
    }
  }
  return {
    schemaVersion: 'effective-settings-v1',
    status: reasons.length
      ? ('CONFIGURATION_REQUIRED' as const)
      : ('VALID' as const),
    scope,
    selected,
    mode,
    reasons: [...new Set(reasons)].sort(),
    provenance: {
      persisted: selected
        ? { id: selected.id, revision: selected.updatedAt }
        : null,
      external: policy?.provenance ?? null,
    },
    policy,
  };
}
