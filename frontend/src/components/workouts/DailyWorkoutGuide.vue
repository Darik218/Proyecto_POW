<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { workoutGuideService } from "../../services/workout-guide.service";
import type {
  WorkoutGuide,
  WorkoutGuideQuery,
} from "../../schemas/workout-guide.schema";
import { workoutErrorMessage } from "../../services/workout-sessions.service";
import WorkoutRepetitionGuide from "./WorkoutRepetitionGuide.vue";
import WorkoutPreparationSummary from "./WorkoutPreparationSummary.vue";
const props = defineProps<{
  query: WorkoutGuideQuery;
  compact?: boolean;
  exerciseId?: string;
}>();
const emit = defineEmits<{ loaded: [value: WorkoutGuide] }>();
const auth = useAuthStore(),
  guide = ref<WorkoutGuide | null>(null),
  error = ref(""),
  loading = ref(false);
const visibleExercises = computed(
  () =>
    guide.value?.exercises.filter(
      (exercise) =>
        !props.exerciseId || exercise.exerciseId === props.exerciseId,
    ) ?? [],
);
let revision = 0,
  controller: AbortController | undefined;
async function load() {
  const n = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  guide.value = null;
  error.value = "";
  loading.value = true;
  if (!auth.isAuthenticated) {
    loading.value = false;
    return;
  }
  try {
    const value = await workoutGuideService.get(props.query, signal);
    if (n !== revision || signal.aborted) return;
    guide.value = value;
    emit("loaded", value);
  } catch (cause) {
    if (n === revision && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "No se pudo consultar la guía. Puedes registrar tus resultados manualmente.",
      );
  } finally {
    if (n === revision) loading.value = false;
  }
}
function calculated(value: WorkoutGuide) {
  guide.value = value;
  emit("loaded", value);
}
watch(
  () =>
    JSON.stringify([
      props.query,
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ]),
  () => void load(),
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
});
</script>
<template>
  <section
    class="daily-guide"
    aria-label="Guía para este entrenamiento"
    :aria-busy="loading"
  >
    <h3>{{ compact ? "Antes de empezar" : "Tu guía para esta sesión" }}</h3>
    <p class="field-hint">
      Usa la guía para preparar tus series. Puedes ajustar los valores al
      entrenar.
    </p>
    <p v-if="loading" role="status">Consultando objetivos e historial…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="load">
        Reintentar guía
      </button>
    </p>
    <template v-if="guide">
      <p
        v-if="
          guide.historyCutoffOn &&
          guide.source.performedOn &&
          guide.source.performedOn > guide.historyCutoffOn
        "
        class="field-hint"
      >
        Historial consultado hasta {{ guide.historyCutoffOn }}. Esta orientación
        futura se volverá a comprobar antes de entrenar.
      </p>
      <p v-if="guide.status === 'REST'">
        Descanso programado. No es una sesión omitida.
      </p>
      <p v-else-if="guide.status !== 'TRAINABLE'">
        Esta programación no está disponible para iniciar un entrenamiento.
      </p>
      <p v-if="!guide.exercises.length && guide.status === 'TRAINABLE'">
        Todavía no hay ejercicios previstos para este entrenamiento.
      </p>
      <article
        v-for="exercise in visibleExercises"
        :key="exercise.id"
        class="guide-exercise"
      >
        <h4>
          {{ exercise.name }} <span v-if="exercise.isOmitted">· Omitido</span>
        </h4>
        <WorkoutPreparationSummary :exercise="exercise">
          <template #comparison>
            <WorkoutRepetitionGuide
              v-if="
                (exercise.progressiveContext ?? exercise.repetitionContext) &&
                exercise.preparation?.stage !== 'REVIEW_REQUIRED' &&
                (exercise.preparation
                  ? exercise.preparation.stage === 'REPETITION_READY'
                  : exercise.guidanceSuggested?.load == null)
              "
              :query="query"
              :exercise-id="exercise.exerciseId"
              :context="
                (exercise.progressiveContext ?? exercise.repetitionContext)!
              "
              compact
              @calculated="calculated"
            />
          </template>
        </WorkoutPreparationSummary>
      </article>
    </template>
  </section>
</template>
<style scoped>
.daily-guide {
  display: grid;
  gap: 0.65rem;
  margin-block: 1rem;
  min-width: 0;
}
.daily-guide > :is(h3, p) {
  margin: 0;
}
.guide-exercise {
  padding: 0.75rem 0.85rem 0.45rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  overflow-wrap: anywhere;
}
.guide-exercise h4 {
  margin: 0 0 0.45rem;
  font-size: 1rem;
  line-height: 1.35;
}
@media (max-width: 420px) {
  .guide-exercise {
    padding-inline: 0.65rem;
  }
}
</style>
