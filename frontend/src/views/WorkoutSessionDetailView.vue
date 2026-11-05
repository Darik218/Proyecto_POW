<script setup lang="ts">
import { repsLabel } from '../services/training-plans.service'
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AddWorkoutExerciseForm from '../components/workouts/AddWorkoutExerciseForm.vue'
import CompleteWorkoutForm from '../components/workouts/CompleteWorkoutForm.vue'
import { useWorkoutSession } from '../composables/useWorkoutSessions'
import { workoutDate, workoutErrorMessage, workoutStatusLabel } from '../services/workout-sessions.service'
import '../assets/training-plans.css'
import '../assets/workouts.css'
const route = useRoute()
const id = computed(() => String(route.params.sessionId ?? ''))
const { session, loading, saving, editable, error, notice, load, start, complete, addExercise, dispose } = useWorkoutSession()
const adding = ref(false)
const confirming = ref(false)
const actionError = ref('')
watch(id, value => { adding.value = false; confirming.value = false; actionError.value = ''; void load(value) }, { immediate: true })
async function begin() { actionError.value = ''; try { await start() } catch (cause) { actionError.value = workoutErrorMessage(cause, 'No se pudo iniciar el entrenamiento.') } }
onUnmounted(dispose)
</script>

<template>
  <section class="page-view training-plans workouts" aria-labelledby="workout-title">
    <RouterLink class="back-link" :to="{ name: 'workout-sessions' }">← Volver a entrenamientos</RouterLink><h1 id="workout-title">Sesión de entrenamiento</h1>
    <p v-if="loading" class="state-message" role="status">Cargando entrenamiento…</p><div v-else-if="error" class="state-card state-card--error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="load(id)">Reintentar</button></div>
    <template v-else-if="session">
      <div class="workout-summary"><span class="plan-status">{{ workoutStatusLabel(session.status) }}</span><p>Inicio: {{ workoutDate(session.startedAt) }}</p><p v-if="session.finishedAt">Finalización: {{ workoutDate(session.finishedAt) }}</p><p>{{ session.trainingPlan?.name ?? 'Entrenamiento independiente' }}{{ session.planWeek ? ' · Semana ' + session.planWeek.weekNumber : '' }}</p><p v-if="session.notes" class="plan-copy">{{ session.notes }}</p></div>
      <p v-if="notice" class="success-message" role="status">{{ notice }}</p><p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      <div class="plan-actions"><button v-if="session.status === 'PLANNED'" class="primary-button" type="button" :disabled="saving" @click="begin">Iniciar esta sesión</button><button v-if="editable && !adding && !confirming" class="secondary-button" type="button" :disabled="saving" @click="adding = true">Añadir ejercicio</button><button v-if="editable && !confirming" class="primary-button" type="button" :disabled="saving || adding || !session.exerciseCount" @click="confirming = true">Finalizar entrenamiento</button><button class="refresh-button" type="button" :disabled="saving" @click="load(id)">Actualizar detalle</button></div>
      <p v-if="editable && !session.exerciseCount" class="field-hint">Añade al menos un ejercicio antes de finalizar.</p><p v-if="['COMPLETED', 'CANCELLED'].includes(session.status)" class="plan-policy">Este entrenamiento está cerrado y se conserva para consulta.</p>
      <AddWorkoutExerciseForm v-if="editable && adding" :save="addExercise" :busy="saving" @saved="adding = false" @cancel="adding = false" />
      <CompleteWorkoutForm v-if="editable && confirming" :save="complete" :busy="saving" @saved="confirming = false" @cancel="confirming = false" />
      <h2 class="weeks-heading">Ejercicios de la sesión</h2><p v-if="!session.exercises.length" class="state-card">Todavía no hay ejercicios en este entrenamiento.</p>
      <ol class="prescription-list workout-exercises"><li v-for="item in session.exercises" :key="item.id"><h3>{{ item.orderInSession }}. {{ item.exercise.name }}</h3><p>{{ item.exercise.muscleGroup }} · {{ item.exercise.equipment }}</p><p v-if="item.prescription" class="field-hint">Prescripción del plan: {{ item.prescription.targetSets }} series × {{ repsLabel(item.prescription) }} repeticiones{{ item.prescription.targetLoad !== null ? ' · Carga objetivo ' + item.prescription.targetLoad + ' ' + (item.prescription.targetLoadUnit ?? '(unidad desconocida)') : '' }}{{ item.prescription.targetRpe !== null ? ' · RPE objetivo ' + item.prescription.targetRpe : '' }}</p><p v-if="item.notes" class="plan-copy">{{ item.notes }}</p></li></ol>
    </template>
  </section>
</template>
