<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PlanForm from '../components/training-plans/PlanForm.vue'
import WeekForm from '../components/training-plans/WeekForm.vue'
import PlanWeekCard from '../components/training-plans/PlanWeekCard.vue'
import { useTrainingPlan } from '../composables/useTrainingPlans'
import { createPlanWeekSchema, planDate, planStatusLabel } from '../services/training-plans.service'
import '../assets/training-plans.css'
const route = useRoute()
const id = computed(() => String(route.params.planId ?? ''))
const actions = useTrainingPlan()
const { plan, loading, saving, editable, error, notice, load, update, createWeek, dispose } = actions
const editing = ref(false)
const addingWeek = ref(false)
function addWeek(input: { weekNumber: number; objective?: string | null }) {
  return createWeek(createPlanWeekSchema.parse(input))
}
watch(id, (value) => { editing.value = false; addingWeek.value = false; void load(value) }, { immediate: true })
onUnmounted(dispose)
</script>

<template>
  <section class="page-view training-plans" aria-labelledby="plan-title">
    <RouterLink class="back-link" :to="{ name: 'training-plans' }">← Volver a mis planes</RouterLink>
    <h1 v-if="loading || error" id="plan-title">Plan de entrenamiento</h1>
    <p v-if="loading" class="state-message" role="status">Cargando plan…</p>
    <div v-else-if="error" class="state-card state-card--error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="load(id)">Reintentar</button></div>
    <template v-else-if="plan">
      <header class="page-heading"><div class="plan-section-heading"><h1 id="plan-title">{{ plan.name }}</h1><span class="plan-status">{{ planStatusLabel(plan.status) }}</span></div><p class="intro">Desde {{ planDate(plan.startsOn) }} · {{ plan.endsOn ? 'Hasta ' + planDate(plan.endsOn) : 'Sin fecha final' }}</p></header>
      <p v-if="notice" class="success-message" role="status" aria-live="polite">{{ notice }}</p>
      <RouterLink v-if="['DRAFT', 'ACTIVE'].includes(plan.status)" class="back-link" :to="{ name: 'workout-sessions', query: { planId: plan.id } }">Ir a entrenamientos →</RouterLink>
      <p class="field-hint">Planifica por semana y día. Durante R1, iniciar desde un plan todavía incorpora la semana completa; la selección de un día llegará en R2.</p>
      <p class="plan-policy">{{ editable ? 'Puedes editar este borrador. Los elementos con historial asociado pueden estar protegidos frente a cambios.' : 'Este plan está disponible para consulta. Solo se pueden editar planes en borrador.' }}</p>
      <div class="plan-actions"><button v-if="editable" class="secondary-button" type="button" :disabled="saving" @click="editing = !editing">Editar plan</button><button v-if="editable" class="secondary-button" type="button" :disabled="saving" @click="addingWeek = !addingWeek">Crear semana</button><button class="refresh-button" type="button" :disabled="saving" @click="load(id)">Actualizar detalle</button></div>
      <PlanForm v-if="editable && editing" :initial="plan" :save="update" :busy="saving" @saved="editing = false" @cancel="editing = false" />
      <WeekForm v-if="editable && addingWeek" :next-number="Math.min(520, Math.max(0, ...plan.weeks.map(week => week.weekNumber)) + 1)" :busy="saving" :save="addWeek" @saved="addingWeek = false" @cancel="addingWeek = false" />
      <h2 class="weeks-heading">Semanas del plan</h2>
      <p v-if="!plan.weeks.length" class="state-card">Este plan todavía no tiene semanas.</p>
      <PlanWeekCard v-for="week in plan.weeks" :key="plan.id + week.id" :week="week" :editable="editable" :busy="saving" :next-week-number="Math.max(0, ...plan.weeks.map(item => item.weekNumber)) + 1" :actions="actions" />
    </template>
  </section>
</template>
