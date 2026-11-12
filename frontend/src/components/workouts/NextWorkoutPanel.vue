<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import {
  workoutSessionsService,
  type WorkoutSuggestion,
  type WorkoutSummary,
} from "../../services/workout-sessions.service";
import { localTrainingDate } from "../../utils/dates";
const auth = useAuthStore(),
  ongoing = ref<WorkoutSummary | null>(null),
  suggestions = ref<WorkoutSuggestion[]>([]),
  error = ref(""),
  busy = ref(false);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  date = ref(localTrainingDate(timeZone));
let mounted = false,
  generation = 0,
  controller: AbortController | undefined;
async function load() {
  if (!auth.isAuthenticated) return;
  date.value = localTrainingDate(timeZone);
  controller?.abort();
  controller = new AbortController();
  const n = ++generation,
    signal = controller.signal;
  ongoing.value = null;
  suggestions.value = [];
  error.value = "";
  busy.value = true;
  const results = await Promise.allSettled([
    workoutSessionsService.list({ status: "IN_PROGRESS", limit: 1 }, signal),
    workoutSessionsService.suggestions(date.value, timeZone, signal),
  ]);
  if (n !== generation || signal.aborted) return;
  const [running, planned] = results;
  if (running.status === "fulfilled")
    ongoing.value = running.value.items[0] ?? null;
  if (planned.status === "fulfilled")
    suggestions.value = planned.value.candidates;
  if (results.some((r) => r.status === "rejected"))
    error.value =
      "No pudimos consultar toda tu programación. Puedes entrenar libremente o volver a consultar.";
  busy.value = false;
}
onMounted(() => {
  mounted = true;
  void load();
});
watch(
  () =>
    [auth.user?.id, auth.isAuthenticated, auth.getSessionGeneration()].join(
      ":",
    ),
  () => {
    generation++;
    controller?.abort();
    ongoing.value = null;
    suggestions.value = [];
    error.value = "";
    busy.value = false;
    if (mounted && auth.isAuthenticated) void load();
  },
  { flush: "sync" },
);
onUnmounted(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section
    class="ui-panel next-training"
    aria-labelledby="next-training-title"
    :aria-busy="busy"
  >
    <div>
      <span class="ui-eyebrow">Tu siguiente paso</span>
      <h2 id="next-training-title">
        {{
          ongoing
            ? "Tu entrenamiento sigue aquí"
            : suggestions.length
              ? "Lo que toca hoy"
              : "¿Listo para entrenar?"
        }}
      </h2>
      <p>{{ date }} · {{ timeZone }}</p>
    </div>
    <RouterLink
      v-if="ongoing"
      class="primary-button"
      :to="{
        name: 'workout-session-detail',
        params: { sessionId: ongoing.id },
      }"
      >Continuar {{ ongoing.name || "entrenamiento" }}</RouterLink
    >
    <div v-else-if="suggestions.length" class="next-training__choices">
      <RouterLink
        v-for="s in suggestions"
        :key="s.scheduledActivityId || s.planDayId"
        class="secondary-button"
        :to="{
          name: 'workout-sessions',
          query: {
            planId: s.trainingPlanId,
            weekId: s.planWeekId,
            dayId: s.planDayId,
            ...(s.scheduledActivityId
              ? { activityId: s.scheduledActivityId }
              : {}),
          },
        }"
        >Comenzar {{ s.name }} · {{ s.planName }}</RouterLink
      >
    </div>
    <div v-else-if="!busy" class="plan-actions">
      <RouterLink
        class="primary-button"
        :to="{ name: 'workout-sessions', query: { new: 'free' } }"
        >Entrenar ahora</RouterLink
      ><RouterLink
        class="secondary-button"
        :to="{ name: 'home', query: { create: 'true' } }"
        >Crear mi rutina</RouterLink
      >
    </div>
    <p v-if="busy" role="status">Buscando tu próxima sesión…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button type="button" class="text-button" @click="load">
        Reintentar
      </button>
    </p>
  </section>
</template>
<style scoped>
.next-training {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
  border-left: 3px solid var(--color-primary);
}
.next-training h2 {
  margin: 0.35rem 0;
}
.next-training p {
  color: var(--color-text-secondary);
  margin: 0.3rem 0;
}
.next-training__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.next-training__choices a {
  white-space: normal;
}
</style>
