import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useAuthStore } from "../stores/auth.store";
import {
  workoutSessionsService,
  type WorkoutSummary,
} from "../services/workout-sessions.service";
import { trainingPlansService } from "../services/training-plans.service";
import { progressionService } from "../services/progression.service";
/** Read-only overview; totals come from API totals, never a page length. */
export function useDashboard() {
  const auth = useAuthStore(),
    recent = shallowRef<WorkoutSummary[]>([]),
    total = ref<number | null>(null),
    completed = ref<number | null>(null),
    pending = ref<number | null>(null),
    activePlans = ref<number | null>(null),
    loading = ref(false),
    errors = ref<string[]>([]);
  let generation = 0,
    mounted = false,
    controller: AbortController | undefined;
  const identity = () =>
    `${auth.user?.id ?? ""}:${auth.getSessionContextId() ?? ""}:${auth.getSessionGeneration()}`;
  function clear() {
    recent.value = [];
    total.value = null;
    completed.value = null;
    pending.value = null;
    activePlans.value = null;
    errors.value = [];
  }
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal,
      n = ++generation,
      context = identity();
    clear();
    loading.value = true;
    const results = await Promise.allSettled([
      workoutSessionsService.list({ limit: 5 }, signal),
      workoutSessionsService.list({ status: "COMPLETED", limit: 1 }, signal),
      progressionService.list({ status: "PENDING", limit: 1 }),
      trainingPlansService.list(signal),
    ]);
    if (n !== generation || context !== identity() || !mounted) return;
    const [sessions, finished, proposals, plans] = results;
    if (sessions.status === "fulfilled") {
      recent.value = sessions.value.items;
      total.value = sessions.value.total;
    } else
      errors.value.push("No se pudo consultar el historial de entrenamientos.");
    if (finished.status === "fulfilled") completed.value = finished.value.total;
    else
      errors.value.push(
        "No se pudo consultar el total de sesiones finalizadas.",
      );
    if (proposals.status === "fulfilled") pending.value = proposals.value.total;
    else
      errors.value.push(
        "No se pudieron consultar las recomendaciones pendientes.",
      );
    if (plans.status === "fulfilled")
      activePlans.value = plans.value.filter(
        (p) => p.status === "ACTIVE",
      ).length;
    else errors.value.push("No se pudieron consultar los planes activos.");
    loading.value = false;
  }
  onMounted(() => {
    mounted = true;
    void load();
  });
  watch(
    () => [auth.user?.id, auth.status, auth.getSessionGeneration()],
    () => {
      generation++;
      controller?.abort();
      clear();
      loading.value = false;
      if (mounted && auth.status === "authenticated") void load();
    },
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    mounted = false;
    generation++;
    controller?.abort();
  });
  return {
    recent,
    total,
    completed,
    pending,
    activePlans,
    loading,
    errors,
    load,
  };
}
