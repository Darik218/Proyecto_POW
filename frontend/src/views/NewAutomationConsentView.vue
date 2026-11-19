<script setup lang="ts">
import PageHeader from "../components/ui/PageHeader.vue";
import { onMounted, ref, shallowRef } from "vue";
import { useAuthStore } from "../stores/auth.store";
import { useAutomationConsentStore } from "../stores/automation-consent.store";
import type { ConsentContract } from "../types/automation-consent";
import ConsentForm from "../components/automation/ConsentForm.vue";
import ConsentConditions from "../components/automation/ConsentConditions.vue";
import ConsentStatus from "../components/automation/ConsentStatus.vue";
import "../assets/progression.css";
const auth = useAuthStore(),
  store = useAutomationConsentStore(),
  contract = shallowRef<ConsentContract | null>(null),
  confirmed = ref(false);
onMounted(() => {
  store.invalidate();
  store.detail = null;
});
function change() {
  contract.value = null;
  confirmed.value = false;
  store.invalidate();
}
async function prepare(value: ConsentContract) {
  confirmed.value = false;
  contract.value = structuredClone(value);
  await store.generate(value);
}
async function save() {
  if (
    !confirmed.value ||
    !contract.value ||
    !store.preview ||
    store.busy ||
    store.pending
  )
    return;
  confirmed.value = false;
  await store.submit("CREATE", contract.value);
}
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'automation-consents' }"
      >Volver a solicitudes</RouterLink
    >
    <PageHeader
      title="Nueva solicitud recurrente"
      description="Delimita las prescripciones, la evidencia, los límites y la vigencia."
      icon="shield"
    />
    <p>
      Preparar una solicitud no equivale a aceptarla ni autoriza modificar
      cargas.
    </p>
    <ConsentStatus /><ConsentForm
      :key="`${auth.user?.id ?? ''}:${auth.status}:${auth.getSessionGeneration()}`"
      :busy="store.busy || !!store.pending"
      @change="change"
      @preview="prepare"
    /><template v-if="store.preview && contract"
      ><ConsentConditions
        :value="store.preview.snapshot"
        title="Condiciones comprobadas, todavía no registradas"
      />
      <section
        class="progression-card progression-acceptance"
        aria-label="Confirmación de la solicitud pendiente"
      >
        <h2>Registrar la solicitud pendiente</h2>
        <label
          ><input
            v-model="confirmed"
            data-testid="confirmConsentRequest"
            type="checkbox"
            :disabled="store.busy || !!store.pending"
          />
          Confirmo que quiero registrar únicamente esta solicitud pendiente con
          las condiciones mostradas. No es aceptación recurrente
          efectiva.</label
        ><button
          class="primary-button"
          type="button"
          data-testid="createConsent"
          :disabled="!confirmed || store.busy || !!store.pending"
          @click="save"
        >
          Crear solicitud pendiente
        </button>
      </section></template
    ><RouterLink
      v-if="store.detail"
      class="secondary-button"
      data-testid="consentSaved"
      :to="{ name: 'automation-detail', params: { id: store.detail.id } }"
      >Consultar solicitud registrada</RouterLink
    >
  </section>
</template>
