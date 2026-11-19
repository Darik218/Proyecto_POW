<script setup lang="ts">
import PageHeader from "../components/ui/PageHeader.vue";
import { onMounted, shallowRef, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.store";
import { useProgressionStore } from "../stores/progression.store";
import type { ProgressionCommand } from "../types/progression";
import ProgressionForm from "../components/progression/ProgressionForm.vue";
import ProgressionEvidence from "../components/progression/ProgressionEvidence.vue";
import ProgressionStatus from "../components/progression/ProgressionStatus.vue";
import "../assets/progression.css";
const auth = useAuthStore(),
  store = useProgressionStore(),
  command = shallowRef<ProgressionCommand | null>(null),
  form = ref<InstanceType<typeof ProgressionForm> | null>(null),
  router = useRouter();
onMounted(store.beginDraft);
function change() {
  command.value = null;
  store.invalidatePreview();
}
async function generate(value: ProgressionCommand) {
  command.value = structuredClone(value);
  await store.generate(value);
}
function configure() {
  const d = form.value?.getDraft();
  if (!d) return;
  store.keepSettingsDraft(d);
  const exerciseId = store.context?.exerciseId ?? store.preview?.exerciseId;
  void router.push({
    name: "progression-settings",
    query: {
      ...(exerciseId ? { exerciseId } : {}),
      planId: d.planId,
      returnTo: "progression-new",
    },
  });
}
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'progression' }">Volver a progresión</RouterLink>
    <PageHeader
      title="Nueva propuesta"
      description="Construye un análisis con destino, período, evidencia y política explícitos."
      icon="plus"
    />
    <p>
      Configura el análisis explícitamente. El cálculo oficial se realiza en el
      servidor.
    </p>
    <ProgressionStatus /><ProgressionForm
      :key="`${auth.user?.id}:${auth.status}:${auth.getSessionGeneration()}`"
      ref="form"
      :initial-draft="store.settingsDraft"
      :session="`${auth.user?.id}:${auth.status}:${auth.getSessionGeneration()}`"
      @restored="store.clearSettingsDraft"
      @configure="configure"
      :context="store.context"
      :busy="store.busy || !!store.pending"
      @reset-context="store.clearContext"
      @context="store.loadContext"
      @preview="generate"
      @change="change"
    /><ProgressionEvidence v-if="store.preview" :value="store.preview" /><button
      v-if="store.preview && command"
      type="button"
      class="primary-button"
      data-testid="save"
      :disabled="
        store.busy || !!store.pending || store.preview.decision !== 'INCREASE'
      "
      @click="store.save(command)"
    >
      Guardar esta propuesta
    </button>
    <p v-if="store.preview && store.preview.decision !== 'INCREASE'">
      Esta decisión no permite guardar una propuesta de incremento con el
      contrato actual.
    </p>
    <RouterLink
      v-if="store.proposal"
      class="secondary-button"
      data-testid="savedDetail"
      :to="{ name: 'progression-detail', params: { id: store.proposal.id } }"
      >Revisar propuesta guardada</RouterLink
    >
  </section>
</template>
