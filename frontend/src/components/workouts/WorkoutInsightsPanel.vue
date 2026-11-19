<script setup lang="ts">
import ExerciseReferenceComparison from "./ExerciseReferenceComparison.vue";
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import {
  workoutInsightsService,
  type WorkoutInsights,
} from "../../services/workout-insights.service";
import {
  workoutErrorMessage,
  setStatusLabel,
} from "../../services/workout-sessions.service";
const props = defineProps<{ sessionId: string }>(),
  auth = useAuthStore();
const result = ref<WorkoutInsights | null>(null),
  error = ref(""),
  busy = ref(false);
let mounted = false,
  generation = 0,
  controller: AbortController | undefined;
async function load() {
  if (!auth.isAuthenticated) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    n = ++generation,
    session = props.sessionId;
  error.value = "";
  busy.value = true;
  try {
    const value = await workoutInsightsService.get(session, undefined, signal);
    if (n !== generation || signal.aborted) return;
    result.value = value;
  } catch (cause) {
    if (n === generation && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "No pudimos consultar tu referencia. Tus resultados siguen guardados.",
      );
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
    [
      props.sessionId,
      auth.user?.id,
      auth.status,
      auth.getSessionGeneration(),
    ].join(":"),
  () => {
    generation++;
    controller?.abort();
    result.value = null;
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
    class="ui-panel workout-insights"
    aria-labelledby="workout-insights-title"
    :aria-busy="busy"
  >
    <header class="insight-heading">
      <h2 id="workout-insights-title">Referencia para la próxima sesión</h2>
      <p class="ui-muted">Orientación basada en tus resultados registrados.</p>
    </header>
    <p v-if="busy" role="status">Preparando tu referencia…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="load()">
        Volver a consultar
      </button>
    </p>
    <article
      v-for="exercise in result?.exercises"
      :key="exercise.workoutExerciseId"
      class="insight-exercise"
    >
      <h3>{{ exercise.name }}</h3>
      <ul v-if="exercise.actualSets.length" class="insight-sets">
        <li v-for="set in exercise.actualSets" :key="set.id">
          Serie {{ set.setNumber }} ·
          {{
            set.kind === "WORK"
              ? "Trabajo"
              : set.kind === "WARMUP"
                ? "Calentamiento"
                : "Tipo no registrado"
          }}
          · {{ setStatusLabel(set) }}:
          <strong
            >{{ set.load ?? "Carga no registrada" }}
            {{ set.loadUnit ?? "(unidad desconocida)" }} ×
            {{ set.repetitions ?? "—" }} repeticiones</strong
          ><span v-if="set.rpe !== null"> · RPE {{ set.rpe }}</span>
        </li>
      </ul>
      <p class="insight-orientation">{{ exercise.orientation.message }}</p>
      <p v-if="exercise.reference" class="ui-muted">
        Referencia anterior: {{ exercise.reference.sessionLabel }} ·
        {{ exercise.reference.performedOn ?? "Fecha no registrada" }}.
      </p>
      <p
        v-if="exercise.observedComparison"
        class="insight-observation"
        role="status"
      >
        {{ exercise.observedComparison.message }}
      </p>
      <ExerciseReferenceComparison
        :current="exercise.actualSets"
        :reference="exercise.reference"
      />
    </article>
    <p v-if="result && !result.exercises.length">
      No hay ejercicios registrados. Para obtener una referencia, completa una
      serie de trabajo con carga, unidad y repeticiones.
    </p>
  </section>
</template>
<style scoped>
.workout-insights {
  margin: 1.25rem 0;
  overflow-wrap: anywhere;
}
.insight-heading h2 {
  font-size: 1.25rem;
  margin: 0 0 0.35rem;
}
.insight-heading p {
  margin: 0 0 1rem;
}
.insight-exercise {
  border-top: 1px solid var(--color-border);
  padding-top: 0.85rem;
}
.insight-exercise + .insight-exercise {
  margin-top: 0.9rem;
}
.insight-exercise h3 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
}
.insight-sets {
  padding-left: 1.1rem;
  margin: 0.6rem 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.55;
  font-variant-numeric: tabular-nums;
}
.insight-sets strong {
  color: var(--color-text-primary);
}
.insight-orientation {
  padding: 0.65rem 0.85rem;
  border-inline-start: 2px solid var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
  line-height: 1.5;
}
</style>
