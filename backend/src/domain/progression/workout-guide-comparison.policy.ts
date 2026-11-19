import type { RecommendationContext } from '../../models/progression/recommendation-draft.model';
import type { RecordedTargets } from '../../models/progression/performance-analysis.model';
import type {
  GuideComparisonSourceEvidence,
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
