<script setup lang="ts">
import ProgressOverview from "../components/progression/ProgressOverview.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import { onMounted, ref } from "vue";
import { useProgressionStore } from "../stores/progression.store";
import ProgressionStatus from "../components/progression/ProgressionStatus.vue";
import "../assets/progression.css";
const store = useProgressionStore(),
  status = ref("");
onMounted(() => store.loadList());
</script>
<template>
  <section class="page-view progression-page">
    <PageHeader
      title="Mi progreso"
      description="Mira tus resultados y decide tu próximo objetivo. Los ajustes avanzados siguen disponibles cuando los necesites."
      icon="chart"
    >
      <template #actions
        ><RouterLink class="primary-button" :to="{ name: 'progression-new' }"
          >Nueva propuesta</RouterLink
        ></template
      >
    </PageHeader>
    <ProgressOverview />
    <details class="ui-panel" style="margin: 1.5rem 0">
      <summary>Ajustes avanzados de progresión y automatización</summary>
      <nav class="progression-actions" aria-label="Gestión de progresión">
        <RouterLink
          class="secondary-button"
          data-testid="settingsLink"
          :to="{ name: 'progression-settings' }"
          >Configuración de progresión</RouterLink
        >
        <RouterLink
          class="secondary-button"
          :to="{ name: 'automation-consents' }"
          >Gestionar consentimiento recurrente</RouterLink
        >
      </nav>
      <p>
        Una configuración no es un consentimiento. Aceptar condiciones,
        habilitar ejecución y aplicar un objetivo conservan sus confirmaciones
        independientes.
      </p>
    </details>
    <h2>Próximos objetivos · recomendaciones formales</h2>
    <p class="progression-flow-note">
      Propuesta → revisión humana → aplicación manual. Cada etapa conserva su
      propia evidencia y confirmación.
    </p>
    <ProgressionStatus /><label
      >Estado<select
        v-model="status"
        @change="store.loadList(1, status || undefined)"
      >
        <option value="">Todos</option>
        <option
          v-for="s in [
            'PENDING',
            'APPROVED',
            'REJECTED',
            'APPLIED',
            'BLOCKED',
            'EXPIRED',
          ]"
          :key="s"
        >
          {{ s }}
        </option>
      </select></label
    >
    <EmptyState
      v-if="store.list && !store.list.items.length && !store.busy"
      title="Sin propuestas en este filtro"
      description="Selecciona otro estado o crea una propuesta con evidencia explícita."
      icon="chart"
    />
    <article
      v-for="p in store.list?.items"
      :key="p.id"
      class="progression-card progression-list-card"
    >
      <h2>
        <RouterLink
          :to="{ name: 'progression-detail', params: { id: p.id } }"
          >{{ p.exerciseName }}</RouterLink
        >
      </h2>
      <StatusBadge :status="p.status" />
      <div class="progression-load-comparison">
        <div>
          <span>Carga anterior</span
          ><strong
            >{{ p.previousLoad ?? "Desconocida" }}
            <small>{{ p.loadUnit ?? "Unidad desconocida" }}</small></strong
          >
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span>Carga propuesta</span
          ><strong
            >{{ p.recommendedLoad ?? "Sin carga" }}
            <small>{{ p.loadUnit ?? "Unidad desconocida" }}</small></strong
          >
        </div>
      </div>
      <p>
        {{ p.createdAt }} ·
        {{
          p.generationKnown
            ? "Evidencia capturada"
            : "Procedencia histórica no disponible"
        }}
      </p>
    </article>
    <div v-if="store.list" class="progression-actions">
      <button
        type="button"
        class="secondary-button"
        :disabled="store.busy || store.list.page === 1"
        @click="store.loadList(store.list.page - 1, status || undefined)"
      >
        Anterior</button
      ><span
        >Página {{ store.list.page }} · {{ store.list.total }} propuestas</span
      ><button
        type="button"
        class="secondary-button"
        :disabled="
          store.busy || store.list.page * store.list.limit >= store.list.total
        "
        @click="store.loadList(store.list.page + 1, status || undefined)"
      >
        Siguiente
      </button>
    </div>
  </section>
</template>
