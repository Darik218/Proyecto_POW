<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import StartWorkoutForm from '../components/workouts/StartWorkoutForm.vue'
import { useWorkoutSessions } from '../composables/useWorkoutSessions'
import { workoutSessionsService, workoutDate, workoutStatusLabel, workoutStatuses, type CreateWorkout, type WorkoutSummary } from '../services/workout-sessions.service'
import '../assets/training-plans.css'
import '../assets/workouts.css'
const route = useRoute()
const router = useRouter()
const initialPlanId = typeof route.query.planId === 'string' ? route.query.planId : undefined
const showingForm = ref(Boolean(initialPlanId))
const status = ref<WorkoutSummary['status'] | ''>('')
const { sessions, total, offset, loading, error, load, next, previous, dispose } = useWorkoutSessions()
watch(status, value => void load(value ? { status: value } : {}))
async function start(input: CreateWorkout) { const result = await workoutSessionsService.create(input); await router.push({ name: 'workout-session-detail', params: { sessionId: result.id } }) }
onMounted(() => void load())
onUnmounted(dispose)
</script>

<template>
  <section class="page-view training-plans workouts" aria-labelledby="workouts-title">
    <header class="page-heading plan-section-heading"><div><p class="eyebrow">TU ENTRENAMIENTO</p><h1 id="workouts-title">Entrenamientos</h1><p class="intro">Continúa una sesión en progreso o consulta tu historial.</p></div><button class="primary-button" type="button" @click="showingForm = !showingForm">{{ showingForm ? 'Cerrar formulario' : 'Iniciar entrenamiento' }}</button></header>
    <StartWorkoutForm v-if="showingForm" :initial-plan-id="initialPlanId" :save="start" @cancel="showingForm = false" />
    <label class="field-label" for="workout-status">Estado</label><select id="workout-status" v-model="status" class="form-control workout-filter"><option value="">Todos</option><option v-for="value in workoutStatuses" :key="value" :value="value">{{ workoutStatusLabel(value) }}</option></select>
    <p v-if="loading" role="status" class="state-message">Cargando entrenamientos…</p>
    <div v-else-if="error" class="state-card state-card--error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="load()">Reintentar</button></div>
    <p v-else-if="!sessions.length" class="state-card">No hay entrenamientos con estos criterios.</p>
    <ul v-else class="plan-list"><li v-for="session in sessions" :key="session.id"><RouterLink class="plan-summary-card" :to="{ name: 'workout-session-detail', params: { sessionId: session.id } }"><div class="plan-section-heading"><h2>{{ workoutDate(session.startedAt ?? session.createdAt) }}</h2><span class="plan-status">{{ workoutStatusLabel(session.status) }}</span></div><p>{{ session.trainingPlan?.name ?? 'Entrenamiento independiente' }}{{ session.planWeek ? ' · Semana ' + session.planWeek.weekNumber : '' }}</p><p>{{ session.exerciseCount }} ejercicios</p><p v-if="session.notes" class="plan-copy">{{ session.notes }}</p><span class="plan-link">{{ session.status === 'IN_PROGRESS' ? 'Continuar entrenamiento →' : 'Ver detalle →' }}</span></RouterLink></li></ul>
    <nav v-if="total > 20" class="plan-actions" aria-label="Páginas de entrenamientos"><button class="secondary-button" type="button" :disabled="loading || offset === 0" @click="previous">Anterior</button><span>{{ offset + 1 }}–{{ Math.min(offset + sessions.length, total) }} de {{ total }}</span><button class="secondary-button" type="button" :disabled="loading || offset + sessions.length >= total" @click="next">Siguiente</button></nav>
  </section>
</template>
