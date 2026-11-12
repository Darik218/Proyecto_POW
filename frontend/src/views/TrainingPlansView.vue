<script setup lang="ts">
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import GeneratePlanForm from "../components/training-plans/GeneratePlanForm.vue";
import { useTrainingPlans } from "../composables/useTrainingPlans";
import { planDate, planStatusLabel } from "../services/training-plans.service";
import "../assets/training-plans.css";
const router = useRouter();
const { plans, loading, creating, error, load, dispose } = useTrainingPlans();
const showingForm = ref(false);
async function created(id: string) {
  await router.push({ name: "home", query: { planId: id } });
}
onMounted(() => void load());
onUnmounted(dispose);
</script>

<template>
  <section class="page-view training-plans" aria-labelledby="plans-title">
    <PageHeader
      id="plans-title"
      title="Planes de entrenamiento"
      description="Organiza tus semanas y prescribe los ejercicios de cada plan."
      icon="layers"
      ><template #actions
        ><button
          class="primary-button"
          type="button"
          :disabled="loading || creating"
          @click="showingForm = !showingForm"
        >
          {{ showingForm ? "Cerrar formulario" : "Crear plan" }}
        </button></template
      ></PageHeader
    >
    <GeneratePlanForm
      v-if="showingForm"
      @created="created"
      @cancel="showingForm = false"
    />
    <LoadingState v-if="loading" label="Cargando planes…" :rows="3" />
    <div v-else-if="error" class="state-card state-card--error" role="alert">
      <p>{{ error }}</p>
      <button
        type="button"
        class="secondary-button"
        :disabled="creating"
        @click="load"
      >
        Reintentar
      </button>
    </div>
    <EmptyState
      v-else-if="!plans.length"
      title="Todavía no tienes planes"
      description="Crea tu primer plan para empezar a organizar tus entrenamientos."
      icon="layers"
    />
    <ul v-else class="plan-list">
      <li v-for="plan in plans" :key="plan.id">
        <RouterLink
          class="plan-summary-card"
          :to="{ name: 'training-plan-detail', params: { planId: plan.id } }"
          ><div class="plan-section-heading">
            <h2>{{ plan.name }}</h2>
            <StatusBadge
              :status="plan.status"
              :label="planStatusLabel(plan.status)"
            />
          </div>
          <p>
            {{ planDate(plan.startsOn) }} ·
            {{
              plan.endsOn ? "Hasta " + planDate(plan.endsOn) : "Sin fecha final"
            }}
          </p>
          <span class="plan-link">Ver plan →</span></RouterLink
        >
      </li>
    </ul>
  </section>
</template>
