<script setup lang="ts">
import MuscleMark from "../components/account/MuscleMark.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  exerciseEnumLabel,
  exerciseErrorMessage,
  exercisesService,
  isExerciseUnavailableError,
  type Exercise,
} from "../services/exercises.service";

const route = useRoute();
const exercise = ref<Exercise | null>(null);
const loading = ref(true);
const errorMessage = ref("");
const notFound = ref(false);
let requestId = 0;
let controller: AbortController | undefined;
const exerciseId = computed(() => {
  const value = route.params.exerciseId;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
});

async function loadExercise(): Promise<void> {
  controller?.abort();
  const activeController = new AbortController();
  controller = activeController;
  const currentRequest = ++requestId;
  loading.value = true;
  errorMessage.value = "";
  notFound.value = false;
  exercise.value = null;
  try {
    const result = await exercisesService.getById(
      exerciseId.value,
      activeController.signal,
    );
    if (currentRequest === requestId) exercise.value = result;
  } catch (error) {
    if (currentRequest === requestId) {
      errorMessage.value = exerciseErrorMessage(
        error,
        "No se pudo cargar el ejercicio.",
      );
      notFound.value = isExerciseUnavailableError(error);
    }
  } finally {
    if (currentRequest === requestId) {
      loading.value = false;
      controller = undefined;
    }
  }
}

watch(exerciseId, () => void loadExercise());
onMounted(() => void loadExercise());
onUnmounted(() => {
  requestId += 1;
  controller?.abort();
});
</script>

<template>
  <section
    class="page-view exercise-detail-page"
    aria-labelledby="exercise-detail-title"
  >
    <RouterLink class="back-link" :to="{ name: 'exercise-catalog' }"
      >← Volver a ejercicios</RouterLink
    >
    <div
      v-if="loading"
      class="state-card detail-state"
      role="status"
      aria-live="polite"
    >
      <p>Cargando ejercicio…</p>
    </div>
    <div
      v-else-if="errorMessage"
      class="state-card state-card--error detail-state"
      role="alert"
    >
      <p>{{ errorMessage }}</p>
      <RouterLink
        v-if="notFound"
        class="secondary-button detail-back-button"
        :to="{ name: 'exercise-catalog' }"
        >Volver al catálogo</RouterLink
      >
      <button
        v-else
        class="secondary-button"
        type="button"
        @click="loadExercise"
      >
        Reintentar
      </button>
    </div>
    <article v-else-if="exercise" class="exercise-detail-card">
      <p v-if="exercise.aliases?.length" class="field-hint">
        También conocido como: {{ exercise.aliases.join(" · ") }}
      </p>
      <div class="exercise-detail-topline">
        <span
          class="exercise-origin-badge"
          :class="
            exercise.origin === 'PERSONAL'
              ? 'exercise-origin-badge--personal'
              : ''
          "
        >
          {{
            exercise.origin === "PERSONAL"
              ? "Ejercicio propio"
              : "Catálogo PULSO"
          }}
        </span>
      </div>
      <h1 id="exercise-detail-title">{{ exercise.name }}</h1>
      <p v-if="exercise.description" class="exercise-detail-card__description">
        {{ exercise.description }}
      </p>

      <section
        class="muscle-focus"
        aria-label="Grupos musculares del ejercicio"
      >
        <MuscleMark :group="exercise.primaryMuscleGroup.key" />
        <div>
          <span>Foco muscular</span>
          <h2>{{ exercise.primaryMuscleGroup.name }}</h2>
          <p v-if="exercise.secondaryMuscleGroups.length">
            Con participación de
            {{
              exercise.secondaryMuscleGroups.map(({ name }) => name).join(", ")
            }}
          </p>
        </div>
      </section>
      <dl class="details-list exercise-detail-list">
        <div>
          <dt>Grupo muscular principal</dt>
          <dd>{{ exercise.primaryMuscleGroup.name }}</dd>
        </div>
        <div v-if="exercise.secondaryMuscleGroups.length">
          <dt>Grupos secundarios</dt>
          <dd>
            {{
              exercise.secondaryMuscleGroups.map(({ name }) => name).join(", ")
            }}
          </dd>
        </div>
        <div>
          <dt>Equipamiento</dt>
          <dd>{{ exercise.equipment }}</dd>
        </div>
        <div>
          <dt>Tipo de equipamiento</dt>
          <dd>{{ exerciseEnumLabel(exercise.equipmentType) }}</dd>
        </div>
        <div v-if="exercise.machineType">
          <dt>Tipo de máquina</dt>
          <dd>{{ exerciseEnumLabel(exercise.machineType) }}</dd>
        </div>
        <div v-if="exercise.resistanceType">
          <dt>Resistencia</dt>
          <dd>{{ exerciseEnumLabel(exercise.resistanceType) }}</dd>
        </div>
        <div v-if="exercise.movementType">
          <dt>Tipo de movimiento</dt>
          <dd>{{ exerciseEnumLabel(exercise.movementType) }}</dd>
        </div>
        <div v-if="exercise.movementPattern">
          <dt>Patrón de movimiento</dt>
          <dd>{{ exerciseEnumLabel(exercise.movementPattern) }}</dd>
        </div>
        <div v-if="exercise.grip">
          <dt>Agarre</dt>
          <dd>{{ exerciseEnumLabel(exercise.grip) }}</dd>
        </div>
        <div v-if="exercise.gripWidth">
          <dt>Anchura del agarre</dt>
          <dd>{{ exerciseEnumLabel(exercise.gripWidth) }}</dd>
        </div>
        <div v-if="exercise.bodyPosition">
          <dt>Posición corporal</dt>
          <dd>{{ exerciseEnumLabel(exercise.bodyPosition) }}</dd>
        </div>
        <div v-if="exercise.laterality">
          <dt>Lateralidad</dt>
          <dd>{{ exerciseEnumLabel(exercise.laterality) }}</dd>
        </div>
        <div v-if="exercise.movementPlane">
          <dt>Plano</dt>
          <dd>{{ exerciseEnumLabel(exercise.movementPlane) }}</dd>
        </div>
        <div v-if="exercise.difficulty">
          <dt>Dificultad</dt>
          <dd>{{ exerciseEnumLabel(exercise.difficulty) }}</dd>
        </div>
        <div>
          <dt>Aptitud para estimar 1RM</dt>
          <dd>{{ exerciseEnumLabel(exercise.oneRmSuitability) }}</dd>
        </div>
      </dl>
      <section v-if="exercise.instructions" class="exercise-instructions">
        <h2>Instrucciones técnicas</h2>
        <p>{{ exercise.instructions }}</p>
      </section>
    </article>
  </section>
</template>

<style scoped>
.exercise-detail-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.exercise-origin-badge {
  border-radius: 999px;
  background: var(--color-surface-elevated);
  padding: 0.35rem 0.65rem;
  color: var(--color-primary);
  font-size: 0.78rem;
  font-weight: 700;
}
.exercise-origin-badge--personal {
  background: var(--color-surface-elevated);
  color: var(--color-secondary);
}
.exercise-instructions {
  margin-top: 1.5rem;
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}
.exercise-instructions h2 {
  margin: 0 0 0.5rem;
  color: var(--color-text-primary);
  font-size: 1.1rem;
}
.exercise-instructions p {
  color: var(--color-text-secondary);
  line-height: 1.65;
  white-space: pre-line;
}
@media (max-width: 600px) {
  .exercise-detail-topline {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.25rem;
  }
}
</style>

<style scoped src="../components/account/catalog.css"></style>
