<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  exerciseEnumLabel,
  exerciseErrorMessage,
  exercisesService,
  isExerciseUnavailableError,
  type Exercise,
} from '../services/exercises.service'

const route = useRoute()
const exercise = ref<Exercise | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const notFound = ref(false)
let requestId = 0
let controller: AbortController | undefined
const exerciseId = computed(() => {
  const value = route.params.exerciseId
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
})

async function loadExercise(): Promise<void> {
  controller?.abort()
  const activeController = new AbortController()
  controller = activeController
  const currentRequest = ++requestId
  loading.value = true
  errorMessage.value = ''
  notFound.value = false
  exercise.value = null
  try {
    exercise.value = await exercisesService.getById(exerciseId.value, activeController.signal)
  } catch (error) {
    if (currentRequest === requestId) {
      errorMessage.value = exerciseErrorMessage(error, 'No se pudo cargar el ejercicio.')
      notFound.value = isExerciseUnavailableError(error)
    }
  } finally {
    if (currentRequest === requestId) {
      loading.value = false
      controller = undefined
    }
  }
}

watch(exerciseId, () => void loadExercise())
onMounted(() => void loadExercise())
onUnmounted(() => {
  requestId += 1
  controller?.abort()
})
</script>

<template>
  <section class="page-view exercise-detail-page" aria-labelledby="exercise-detail-title">
    <RouterLink class="back-link" :to="{ name: 'exercise-catalog' }">← Volver a ejercicios</RouterLink>
    <div v-if="loading" class="state-card detail-state" role="status" aria-live="polite"><p>Cargando ejercicio…</p></div>
    <div v-else-if="errorMessage" class="state-card state-card--error detail-state" role="alert">
      <p>{{ errorMessage }}</p>
      <RouterLink v-if="notFound" class="secondary-button detail-back-button" :to="{ name: 'exercise-catalog' }">Volver al catálogo</RouterLink>
      <button v-else class="secondary-button" type="button" @click="loadExercise">Reintentar</button>
    </div>
    <article v-else-if="exercise" class="exercise-detail-card">
      <div class="exercise-detail-topline">
        <p class="eyebrow">DETALLE DEL EJERCICIO</p>
        <span class="exercise-origin-badge" :class="exercise.origin === 'PERSONAL' ? 'exercise-origin-badge--personal' : ''">
          {{ exercise.origin === 'PERSONAL' ? 'Ejercicio propio' : 'Catálogo PULSO' }}
        </span>
      </div>
      <h1 id="exercise-detail-title">{{ exercise.name }}</h1>
      <p v-if="exercise.description" class="exercise-detail-card__description">{{ exercise.description }}</p>

      <dl class="details-list exercise-detail-list">
        <div><dt>Grupo muscular principal</dt><dd>{{ exercise.primaryMuscleGroup.name }}</dd></div>
        <div v-if="exercise.secondaryMuscleGroups.length"><dt>Grupos secundarios</dt><dd>{{ exercise.secondaryMuscleGroups.map(({ name }) => name).join(', ') }}</dd></div>
        <div><dt>Equipamiento</dt><dd>{{ exercise.equipment }}</dd></div>
        <div><dt>Tipo de equipamiento</dt><dd>{{ exerciseEnumLabel(exercise.equipmentType) }}</dd></div>
        <div v-if="exercise.machineType"><dt>Tipo de máquina</dt><dd>{{ exerciseEnumLabel(exercise.machineType) }}</dd></div>
        <div v-if="exercise.resistanceType"><dt>Resistencia</dt><dd>{{ exerciseEnumLabel(exercise.resistanceType) }}</dd></div>
        <div v-if="exercise.movementType"><dt>Tipo de movimiento</dt><dd>{{ exerciseEnumLabel(exercise.movementType) }}</dd></div>
        <div v-if="exercise.movementPattern"><dt>Patrón de movimiento</dt><dd>{{ exerciseEnumLabel(exercise.movementPattern) }}</dd></div>
        <div v-if="exercise.grip"><dt>Agarre</dt><dd>{{ exerciseEnumLabel(exercise.grip) }}</dd></div>
        <div v-if="exercise.gripWidth"><dt>Anchura del agarre</dt><dd>{{ exerciseEnumLabel(exercise.gripWidth) }}</dd></div>
        <div v-if="exercise.bodyPosition"><dt>Posición corporal</dt><dd>{{ exerciseEnumLabel(exercise.bodyPosition) }}</dd></div>
        <div v-if="exercise.laterality"><dt>Lateralidad</dt><dd>{{ exerciseEnumLabel(exercise.laterality) }}</dd></div>
        <div v-if="exercise.movementPlane"><dt>Plano</dt><dd>{{ exerciseEnumLabel(exercise.movementPlane) }}</dd></div>
        <div v-if="exercise.difficulty"><dt>Dificultad</dt><dd>{{ exerciseEnumLabel(exercise.difficulty) }}</dd></div>
        <div><dt>Aptitud para estimar 1RM</dt><dd>{{ exerciseEnumLabel(exercise.oneRmSuitability) }}</dd></div>
      </dl>
      <section v-if="exercise.instructions" class="exercise-instructions">
        <h2>Instrucciones técnicas</h2>
        <p>{{ exercise.instructions }}</p>
      </section>
    </article>
  </section>
</template>

<style scoped>
.exercise-detail-topline{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.exercise-origin-badge{border-radius:999px;background:#e9f2df;padding:.35rem .65rem;color:#285639;font-size:.78rem;font-weight:700}
.exercise-origin-badge--personal{background:#e9edf8;color:#394a75}
.exercise-instructions{margin-top:1.5rem;border-top:1px solid #e1e7e2;padding-top:1rem}
.exercise-instructions h2{margin:0 0 .5rem;color:#173e31;font-size:1.1rem}
.exercise-instructions p{color:#435149;line-height:1.65;white-space:pre-line}
@media(max-width:600px){.exercise-detail-topline{align-items:flex-start;flex-direction:column;gap:.25rem}}
</style>
