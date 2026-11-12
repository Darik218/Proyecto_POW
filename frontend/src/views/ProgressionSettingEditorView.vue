<script setup lang="ts">
import PageHeader from "../components/ui/PageHeader.vue";
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth.store";
import { useProgressionSettingsStore } from "../stores/progression-settings.store";
import SettingForm from "../components/progression/SettingForm.vue";
import SettingStatus from "../components/progression/SettingStatus.vue";
import "../assets/progression.css";
const route = useRoute(),
  auth = useAuthStore(),
  store = useProgressionSettingsStore(),
  id = computed(() =>
    typeof route.params.id === "string" ? route.params.id : "",
  ),
  query = computed(() => ({ ...route.query })),
  session = computed(
    () => `${auth.user?.id}:${auth.status}:${auth.getSessionGeneration()}`,
  );
watch(
  () => [id.value, auth.user?.id, auth.status],
  () => {
    if (id.value) void store.open(id.value);
    else store.beginCreate();
  },
  { immediate: true },
);
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'progression-settings', query }"
      >Volver a configuraciones</RouterLink
    >
    <PageHeader
      :title="id ? 'Editar fila de configuración' : 'Nueva configuración'"
      description="Conserva el ámbito y revisa el impacto antes de sustituir una fila completa."
      icon="settings"
    />
    <SettingStatus />
    <SettingForm
      v-if="!id || store.detail?.id === id"
      :key="`${session}:${id}:${store.detail?.revision ?? 'new'}`"
      :initial="id ? (store.detail ?? undefined) : undefined"
      :session="session"
      :busy="store.busy || !!store.pending"
      :impact="store.impact"
      :initial-exercise-id="
        typeof route.query.exerciseId === 'string'
          ? route.query.exerciseId
          : undefined
      "
      :initial-plan-id="
        typeof route.query.planId === 'string' ? route.query.planId : undefined
      "
      @change="store.invalidateImpact"
      @create="store.create"
      @preview="store.previewImpact"
      @replace="store.replace"
    />
    <section
      v-if="store.receipt"
      class="progression-card"
      data-testid="settingSaved"
    >
      <h2>Escritura confirmada</h2>
      <p>
        Intención {{ store.receipt.intentId }} · registro
        {{ store.receipt.settingId }} · revisión del recibo
        {{ store.receipt.revision }}. Ningún incremento fue aplicado.
      </p>
      <p>
        Consulta la configuración efectiva actual; este recibo histórico no
        sustituye ediciones posteriores.
      </p>
      <RouterLink
        class="secondary-button"
        :to="{ name: 'progression-settings', query }"
        >Consultar resultado efectivo</RouterLink
      ><RouterLink
        v-if="route.query.returnTo === 'progression-new'"
        data-testid="returnToProgression"
        :to="{ name: 'progression-new' }"
        >Volver al contexto anterior y volver a consultar</RouterLink
      >
    </section>
  </section>
</template>
