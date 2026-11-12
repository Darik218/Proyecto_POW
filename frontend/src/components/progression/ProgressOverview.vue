<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import {
  workoutSessionsService,
  type WorkoutSummary,
} from "../../services/workout-sessions.service";
import WorkoutInsightsPanel from "../workouts/WorkoutInsightsPanel.vue";
const auth = useAuthStore(),
  sessions = ref<WorkoutSummary[]>([]),
  selected = ref(""),
  busy = ref(false),
  error = ref("");
let controller: AbortController | undefined,
  generation = 0,
  mounted = false;
async function load() {
  if (!auth.isAuthenticated) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    n = ++generation;
  sessions.value = [];
  selected.value = "";
  busy.value = true;
  error.value = "";
  try {
    const result = await workoutSessionsService.list(
      { status: "COMPLETED", limit: 10 },
      signal,
    );
    if (n !== generation || signal.aborted) return;
    sessions.value = result.items;
    selected.value = result.items[0]?.id ?? "";
  } catch {
    if (n === generation && !signal.aborted)
      error.value =
        "No se pudo consultar tu rendimiento. Tus entrenamientos siguen guardados.";
  } finally {
    if (n === generation) busy.value = false;
  }
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
    sessions.value = [];
    selected.value = "";
    error.value = "";
    busy.value = false;
    if (mounted && auth.isAuthenticated) void load();
  },
  { flush: "sync" },
);
onUnmounted(() => {
  mounted = false;
  generation++;
  controller?.abort();
});
</script>
<template>
  <section aria-labelledby="my-performance">
    <h2 id="my-performance">Tu rendimiento, desde la primera sesión</h2>
    <p>
      Consulta lo que hiciste y la referencia para volver a entrenar. Las
      estimaciones no son mediciones de tu máximo real.
    </p>
    <p v-if="busy" role="status">Buscando tus resultados…</p>
    <p v-if="error" role="alert">
      {{ error }} <button class="text-button" @click="load">Reintentar</button>
    </p>
    <div v-if="!busy && !error && !sessions.length" class="ui-panel">
      <h3>Comienza tu progreso</h3>
      <p>
        Una serie de trabajo con carga, unidad, repeticiones y esfuerzo ya
        aporta una primera referencia.
      </p>
      <RouterLink
        class="primary-button"
        :to="{ name: 'workout-sessions', query: { new: 'free' } }"
        >Registrar mi primer entrenamiento</RouterLink
      >
    </div>
    <label v-if="sessions.length" class="performance-selector"
      >Entrenamiento a consultar<select v-model="selected">
        <option
          v-for="session in sessions"
          :key="session.id"
          :value="session.id"
        >
          {{ session.performedOn?.slice(0, 10) || "Fecha no registrada" }} ·
          {{
            session.name ||
            session.sourceSnapshot?.day?.name ||
            "Entrenamiento libre"
          }}
        </option>
      </select></label
    >
    <WorkoutInsightsPanel
      v-if="selected"
      :key="selected"
      :session-id="selected"
    />
    <RouterLink class="back-link" :to="{ name: 'workout-history' }"
      >Ver todo mi historial →</RouterLink
    >
  </section>
</template>
<style scoped>
.performance-selector {
  display: grid;
  gap: 0.5rem;
  margin: 1.25rem 0;
  max-width: 42rem;
}
</style>
