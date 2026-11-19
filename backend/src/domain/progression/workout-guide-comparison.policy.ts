import type { RecommendationContext } from '../../models/progression/recommendation-draft.model';
import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import type {
  GuideComparisonSourceEvidence,
  GuidePlannedComparisonEvidence,
  WorkoutGuideSource,
} from '../../models/progression/workout-guide.model';
import { recommendationIdentity } from './recommendation-evidence.policy';

// This fingerprints the exact comparison, not an authorization, stored claim or
// inferred variant/equipment identity. Different preview methods can share it
// only when they compare exactly the same physical records and destination.
export function guideComparisonKey(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  cutoff: string,
  sourceTargets: RecordedTargets | null,
  taskIds: readonly string[],
  provenance?: GuideComparisonSourceEvidence,
): string | null {
  const occurrence = source.activityId
    ? { kind: 'ACTIVITY', id: source.activityId }
    : source.sessionId
      ? { kind: 'SESSION', id: source.sessionId }
      : source.kind === 'PLAN_DAY'
        ? { kind: 'PLAN_DAY', id: source.id }
        : null;
  if (
    !occurrence ||
    !source.performedOn ||
    !source.timeZone ||
    !context.target.prescriptionId ||
    !taskIds.length
  )
    return null;
  const selected = new Set(taskIds);
  const tasks = context.history.tasks.filter((t) => selected.has(t.id));
  if (tasks.length !== taskIds.length) return null;
  return recommendationIdentity({
    schemaVersion: 'workout-guide-comparison-v1',
    athleteId: context.history.athleteId,
    exerciseId: context.history.exerciseId,
    exerciseIsActive: context.history.exerciseIsActive,
    occurrence,
    occurrenceVersion: provenance?.occurrenceVersion ?? null,
    sourceExercise: {
      originalExerciseId:
        provenance?.originalExerciseId ?? context.history.exerciseId,
      replacesWorkoutExerciseId: provenance?.replacesWorkoutExerciseId ?? null,
      isOmitted: provenance?.isOmitted ?? false,
      ...(provenance?.equipmentKey
        ? { equipmentKey: provenance.equipmentKey }
        : {}),
    },
    sourceDestination: {
      planId: source.trainingPlanId ?? null,
      weekId: source.planWeekId ?? null,
      dayId: source.planDayId ?? null,
      performedOn: source.performedOn,
      timeZone: source.timeZone,
    },
    sourceTargets,
    destination: context.target,
    cutoff,
    settings: [...context.settings].sort((a, b) => a.id.localeCompare(b.id)),
    truncated: context.history.truncated,
    tasks,
    sets: context.history.sets.filter((s) => selected.has(s.workoutExerciseId)),
  });
}

/** Limits automatic comparison to the recorded nominal number in an owned plan.
 * This does not attest physical machine identity or total external resistance. */
export function hasPlannedNominalComparison(
  context: RecommendationContext,
  source: WorkoutGuideSource,
  tasks: readonly string[],
  evidence?: GuidePlannedComparisonEvidence,
): boolean {
  if (
    !evidence?.destinationCaptured ||
    !source.trainingPlanId ||
    source.trainingPlanId !== context.target.planId ||
    !tasks.length
  )
    return false;
  const { exercise } = evidence;
  if (
    exercise.id !== context.history.exerciseId ||
    exercise.origin !== 'GLOBAL' ||
    !exercise.catalogKey ||
    !exercise.equipment.trim()
  )
    return false;
  const supportedEquipment =
    (exercise.equipmentType === 'SMITH_MACHINE' &&
      exercise.machineType === 'SMITH' &&
      exercise.resistanceType === 'PLATE_LOADED') ||
    (exercise.equipmentType === 'BARBELL' &&
      exercise.machineType === null &&
      exercise.resistanceType === 'FREE_WEIGHT');
  if (!supportedEquipment) return false;
  return tasks.every((taskId) => {
    const snapshot = evidence.tasks.find((item) => item.taskId === taskId);
    return (
      snapshot?.exerciseId === exercise.id &&
      snapshot.planId === source.trainingPlanId &&
      snapshot.equipment === exercise.equipment
    );
  });
}
