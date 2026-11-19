<script setup lang="ts">
import EmptyState from "../components/ui/EmptyState.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import { onMounted, ref } from "vue";
import { useAutomationConsentStore } from "../stores/automation-consent.store";
import ConsentStatus from "../components/automation/ConsentStatus.vue";
import "../assets/progression.css";
const store = useAutomationConsentStore(),
  state = ref("");
onMounted(() => store.loadList());
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'progression' }">Volver a progresión</RouterLink>
    <PageHeader
      title="Consentimiento recurrente"
      description="Consulta las condiciones de cada solicitud, su aceptación y su historial."
      icon="shield"
    >
      <template #actions
        ><RouterLink class="primary-button" :to="{ name: 'automation-new' }"
          >Nueva solicitud</RouterLink
        ></template
      >
    </PageHeader>
    <p>
      La solicitud, la aceptación humana y el permiso operativo son registros
      separados. Consulta su vigencia y las revocaciones en el detalle.
    </p>
    <ConsentStatus /><label
      >Estado<select
        v-model="state"
        @change="store.loadList(1, state || undefined)"
      >
        <option value="">Todos</option>
        <option>PENDING_CONFIRMATION</option>
        <option>ACCEPTED_INACTIVE</option>
        <option>REVOKED</option>
      </select></label
    >
    <EmptyState
      v-if="store.list && !store.list.items.length && !store.busy"
      title="Sin solicitudes en este filtro"
      description="Puedes consultar otro estado o preparar una nueva solicitud. Ningún destino se incluye por defecto."
      icon="shield"
    />
    <article
      v-for="c in store.list?.items"
      :key="c.id"
      class="progression-card progression-list-card"
    >
      <h2>
        <RouterLink :to="{ name: 'automation-detail', params: { id: c.id } }">{{
          c.exerciseName
        }}</RouterLink>
      </h2>
      <StatusBadge :status="c.state" />
      <p>
        {{
          c.planName ?? "Solo las prescripciones explícitas, sin plan global"
        }}
        · versión {{ c.version }}
      </p>
      <p>
        [{{ c.startsAt }}, {{ c.endsAt }}) · última revisión {{ c.updatedAt }}
      </p>
      <p>Esta solicitud por sí sola no habilita ejecución automática.</p>
    </article>
    <div v-if="store.list" class="progression-actions">
      <button
        type="button"
        class="secondary-button"
        :disabled="store.busy || store.list.page === 1"
        @click="store.loadList(store.list.page - 1, state || undefined)"
      >
        Anterior</button
      ><span
        >Página {{ store.list.page }} · {{ store.list.total }} solicitudes</span
      ><button
        type="button"
        class="secondary-button"
        :disabled="
          store.busy || store.list.page * store.list.limit >= store.list.total
        "
        @click="store.loadList(store.list.page + 1, state || undefined)"
      >
        Siguiente
      </button>
    </div>
  </section>
</template>
