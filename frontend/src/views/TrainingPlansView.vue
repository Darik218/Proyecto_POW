<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import PlanForm from '../components/training-plans/PlanForm.vue'
import { useTrainingPlans } from '../composables/useTrainingPlans'
import { planDate, planStatusLabel, type CreateTrainingPlan } from '../services/training-plans.service'
import '../assets/training-plans.css'
const router = useRouter()
const { plans, loading, creating, error, load, create, dispose } = useTrainingPlans()
const showingForm = ref(false)
async function save(input: CreateTrainingPlan) {
  const result = await create(input)
  if (result) await router.push({ name: 'training-plan-detail', params: { planId: result.id } })
}
onMounted(() => void load())
onUnmounted(dispose)
</script>

<template>
  <section class="page-view training-plans" aria-labelledby="plans-title">
    <header class="page-heading plan-section-heading"><div><p class="eyebrow">PLANIFICACIÓN</p><h1 id="plans-title">Planes de entrenamiento</h1><p class="intro">Organiza tus semanas y prescribe los ejercicios de cada plan.</p></div><button class="primary-button" type="button" :disabled="loading || creating" @click="showingForm = !showingForm">{{ showingForm ? 'Cerrar formulario' : 'Crear plan' }}</button></header>
    <PlanForm v-if="showingForm" :save="save" :busy="creating || loading" @cancel="showingForm = false" />
    <p v-if="loading" class="state-message" role="status">Cargando planes…</p>
    <div v-else-if="error" class="state-card state-card--error" role="alert"><p>{{ error }}</p><button type="button" class="secondary-button" :disabled="creating" @click="load">Reintentar</button></div>
    <div v-else-if="!plans.length" class="empty-state state-card"><strong>Todavía no tienes planes</strong><p>Crea tu primer plan para empezar a organizar tus entrenamientos.</p></div>
    <ul v-else class="plan-list">
      <li v-for="plan in plans" :key="plan.id"><RouterLink class="plan-summary-card" :to="{ name: 'training-plan-detail', params: { planId: plan.id } }"><div class="plan-section-heading"><h2>{{ plan.name }}</h2><span class="plan-status">{{ planStatusLabel(plan.status) }}</span></div><p>{{ planDate(plan.startsOn) }} · {{ plan.endsOn ? 'Hasta ' + planDate(plan.endsOn) : 'Sin fecha final' }}</p><span class="plan-link">Ver plan →</span></RouterLink></li>
    </ul>
  </section>
</template>
