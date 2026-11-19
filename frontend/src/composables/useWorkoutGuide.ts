import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type {
  WorkoutGuide,
  WorkoutGuideQuery,
} from "../schemas/workout-guide.schema";
import { workoutGuideService } from "../services/workout-guide.service";
import { workoutErrorMessage } from "../services/workout-sessions.service";
import { useAuthStore } from "../stores/auth.store";

type Exercise = WorkoutGuide["exercises"][number];
type Preview = { exercise: Exercise; contextKey: string };
const contexts = [
  "repetitionContext",
  "progressiveContext",
  "calculationContext",
] as const;
function matchingContext(exercise: Exercise, key: string) {
  return contexts.find((field) => exercise[field]?.contextKey === key);
}

function sameSource(previous: WorkoutGuide, next: WorkoutGuide) {
  const a = previous.source;
  const b = next.source;
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.activityId === b.activityId &&
    a.planDayId === b.planDayId &&
    a.sessionId === b.sessionId &&
    a.trainingPlanId === b.trainingPlanId &&
    a.planWeekId === b.planWeekId &&
    a.performedOn === b.performedOn &&
    a.timeZone === b.timeZone &&
    a.status === b.status &&
    previous.status === next.status &&
    previous.historyCutoffOn === next.historyCutoffOn
  );
}

function applyPreview(current: Exercise, { exercise, contextKey }: Preview) {
  const field = matchingContext(current, contextKey);
  if (
    !field ||
    exercise.id !== current.id ||
    exercise.exerciseId !== current.exerciseId ||
    exercise[field]?.contextKey !== contextKey
  )
    return undefined;
  // Repetition previews omit the optional load calculation context.
  const preparation = exercise.preparation;
  return {
    ...current,
    [field]: exercise[field],
    lastReference: exercise.lastReference,
    guidance: exercise.guidance,
    guidanceSuggested: exercise.guidanceSuggested,
    preparation:
      preparation?.diagnostics?.load === null &&
      current.preparation?.diagnostics?.load
        ? {
            ...preparation,
            diagnostics: {
              ...preparation.diagnostics,
              load: current.preparation.diagnostics.load,
            },
          }
        : preparation,
  };
}

export function useWorkoutGuide(options: {
  query: () => WorkoutGuideQuery;
  evidenceVersion?: () => string;
  fallbackError: string;
  onUpdate?: (value: WorkoutGuide) => void;
}) {
  const auth = useAuthStore();
  const scope = computed(() => {
    if (!auth.isAuthenticated) return null;
    const { activityId, planDayId, sessionId, performedOn, timeZone } =
      options.query();
    return JSON.stringify([
      auth.user?.id,
      auth.getSessionGeneration(),
      activityId,
      planDayId,
      sessionId,
      performedOn,
      timeZone,
    ]);
  });
  const current = shallowRef<{ scope: string; value: WorkoutGuide } | null>(
    null,
  );
  const guide = computed(() =>
    current.value?.scope === scope.value ? current.value!.value : null,
  );
  const loading = shallowRef(false);
  const error = shallowRef("");
  const previews = new Map<string, Preview>();
  let revision = 0;
  let controller: AbortController | undefined;
  let requestedScope: string | null = null;
  let acceptedEvidenceVersion: string | undefined;

  function publish(value: WorkoutGuide, activeScope: string) {
    current.value = { scope: activeScope, value };
    options.onUpdate?.(value);
  }

  async function load() {
    const n = ++revision;
    controller?.abort();
    const newScope = scope.value;
    const evidenceVersion = options.evidenceVersion?.();
    if (requestedScope !== newScope) {
      current.value = null;
      previews.clear();
      requestedScope = newScope;
    }
    error.value = "";
    loading.value = newScope !== null;
    if (!newScope) return;
    controller = new AbortController();
    const signal = controller.signal;
    const isCurrent = () =>
      n === revision && newScope === scope.value && !signal.aborted;
    try {
      const value = await workoutGuideService.get(options.query(), signal);
      if (!isCurrent()) return;
      if (!guide.value || !sameSource(guide.value, value)) previews.clear();
      acceptedEvidenceVersion = evidenceVersion;
      publish(
        {
          ...value,
          exercises: value.exercises.map((exercise) => {
            const cached = previews.get(exercise.id);
            if (!cached) return exercise;
            const confirmed =
              exercise.guidanceSuggested?.origin !== "PERSISTED_PROPOSAL"
                ? applyPreview(exercise, cached)
                : undefined;
            if (confirmed) return confirmed;
            previews.delete(exercise.id);
            return exercise;
          }),
        },
        newScope,
      );
    } catch (cause) {
      if (isCurrent())
        error.value = workoutErrorMessage(cause, options.fallbackError);
    } finally {
      if (isCurrent()) loading.value = false;
    }
  }

  function calculated(
    value: WorkoutGuide,
    occurrenceId: string,
    contextKey: string,
  ) {
    const activeScope = scope.value;
    const existing = guide.value;
    if (
      !activeScope ||
      !existing ||
      !sameSource(existing, value) ||
      acceptedEvidenceVersion !== options.evidenceVersion?.()
    )
      return false;
    const previous = existing.exercises.find((e) => e.id === occurrenceId);
    const exercise = value.exercises.find((e) => e.id === occurrenceId);
    if (!previous || !exercise) return false;
    const preview = { exercise, contextKey };
    const updated = applyPreview(previous, preview);
    if (!updated) return false;
    previews.set(occurrenceId, preview);
    publish(
      {
        ...existing,
        exercises: existing.exercises.map((e) =>
          e.id === occurrenceId ? updated : e,
        ),
      },
      activeScope,
    );
    return true;
  }

  watch([scope, () => options.evidenceVersion?.()], () => void load(), {
    immediate: true,
  });
  onScopeDispose(() => {
    revision++;
    controller?.abort();
    previews.clear();
  });
  return { guide, error, loading, load, calculated };
}
