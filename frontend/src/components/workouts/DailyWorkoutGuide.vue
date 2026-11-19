<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useWorkoutGuide } from "../../composables/useWorkoutGuide";
import type {
  WorkoutGuide,
  WorkoutGuideQuery,
} from "../../schemas/workout-guide.schema";
import WorkoutRepetitionGuide from "./WorkoutRepetitionGuide.vue";
import WorkoutPreparationSummary from "./WorkoutPreparationSummary.vue";
const props = defineProps<{
  query: WorkoutGuideQuery;
  compact?: boolean;
  exerciseId?: string;
}>();
const emit = defineEmits<{ loaded: [value: WorkoutGuide] }>();
const { guide, error, loading, load, calculated } = useWorkoutGuide({
  query: () => props.query,
  fallbackError:
    "No se pudo consultar la guía. Puedes registrar tus resultados manualmente.",
  onUpdate: (value) => emit("loaded", value),
});
const checking = shallowRef<ReadonlySet<string>>(new Set());
function setChecking(id: string, active: boolean) {
  const next = new Set(checking.value);
  if (active) next.add(id);
  else next.delete(id);
  checking.value = next;
}
const visibleExercises = computed(
  () =>
    guide.value?.exercises.filter(
      (exercise) =>
        !props.exerciseId || exercise.exerciseId === props.exerciseId,
    ) ?? [],
);
</script>
<template>
  <section
    class="daily-guide"
    aria-label="Guía para este entrenamiento"
    :aria-busy="loading || checking.size > 0"
  >
    <h3>{{ compact ? "Antes de empezar" : "Tu guía para esta sesión" }}</h3>
    <p class="field-hint">
      Usa la guía para preparar tus series. Puedes ajustar los valores al
      entrenar.
    </p>
    <p v-if="loading" role="status">
      {{
        guide
          ? "Verificando la orientación…"
          : "Consultando objetivos e historial…"
      }}
    </p>
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
        <WorkoutPreparationSummary
          :exercise="exercise"
          :verifying="checking.has(exercise.id)"
        >
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
              :occurrence-id="exercise.id"
              :disabled="loading"
              :context="
                (exercise.progressiveContext ?? exercise.repetitionContext)!
              "
              compact
              @calculated="calculated"
              @checking="setChecking"
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
