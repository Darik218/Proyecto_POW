<script setup lang="ts">
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import { ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth.store";
import { useAutomationConsentStore } from "../stores/automation-consent.store";
import type { ConsentContract } from "../types/automation-consent";
import OperationalProgression from "../components/automation/OperationalProgression.vue";
import ConsentAcceptance from "../components/automation/ConsentAcceptance.vue";
import ConsentForm from "../components/automation/ConsentForm.vue";
import ConsentConditions from "../components/automation/ConsentConditions.vue";
import ConsentStatus from "../components/automation/ConsentStatus.vue";
import "../assets/progression.css";
const route = useRoute(),
  auth = useAuthStore(),
  store = useAutomationConsentStore(),
  editing = ref(false),
  revokeConfirmed = ref(false),
  reviseConfirmed = ref(false),
  contract = shallowRef<ConsentContract | null>(null);
watch(
  () => [
    route.params.id,
    auth.user?.id,
    auth.status,
    auth.getSessionGeneration(),
  ],
  async () => {
    editing.value = false;
    revokeConfirmed.value = false;
    reviseConfirmed.value = false;
    contract.value = null;
    await store.open(String(route.params.id));
  },
  { immediate: true },
);
watch(
  () => store.detail,
  () => {
    revokeConfirmed.value = false;
    reviseConfirmed.value = false;
    editing.value = false;
  },
);
function change() {
  contract.value = null;
  reviseConfirmed.value = false;
  store.invalidate();
}
async function preview(value: ConsentContract) {
  contract.value = structuredClone(value);
  reviseConfirmed.value = false;
  await store.generate(value);
}
async function revise() {
  if (
    !reviseConfirmed.value ||
    !contract.value ||
    !store.preview ||
    store.busy ||
    store.pending
  )
    return;
  reviseConfirmed.value = false;
  await store.submit("REVISE", contract.value);
}
function toggleEditing() {
  editing.value = !editing.value;
  change();
}
async function revoke() {
  if (!revokeConfirmed.value || store.busy || store.pending) return;
  revokeConfirmed.value = false;
  await store.submit("REVOKE");
}
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'automation-consents' }"
      >Volver a solicitudes</RouterLink
    >
    <PageHeader
      title="Solicitud recurrente"
      description="Condiciones históricas, aceptación humana y permiso operativo con trazabilidad."
      icon="shield"
    />
    <nav
      class="progression-context-nav"
      aria-label="Secciones de la solicitud"
      v-if="store.detail"
    >
      <a href="#consent-overview">Resumen</a
      ><a href="#consent-contract">Condiciones</a
      ><a href="#operational-heading">Permiso operativo</a
      ><a href="#consent-audit">Auditoría</a>
    </nav>
    <ConsentStatus /><template v-if="store.detail"
      ><p
        id="consent-overview"
        class="progression-state-panel"
        data-testid="consentState"
      >
        <StatusBadge :status="store.detail.state" /> · versión
        {{ store.detail.version }} · vigencia efectiva
        {{ store.detail.effectiveState }}
      </p>
      <p>
        Configuración actual: {{ store.detail.currentConfiguration }} ·
        inspeccionada {{ store.detail.inspectedAt }}
      </p>
      <p v-for="d in store.detail.conditionChanges" :key="d">{{ d }}</p>
      <p
        v-if="store.detail.acceptance.humanAcceptance === 'RECORDED'"
        data-testid="acceptanceRecorded"
      >
        Aceptación registrada en el evento
        {{ store.detail.acceptance.recordedEventId }} el
        {{ store.detail.acceptance.recordedAt }}. Este evento por sí solo no
        habilita ejecución automática. La captura original permanece sin
        aceptación registrada en el momento de su creación.
      </p>
      <p v-if="store.detail.state === 'ACCEPTED_INACTIVE'">
        Aceptación registrada; consulta el permiso operativo por separado. No
        puedes revisar silenciosamente estas condiciones. Revoca y crea otra
        solicitud para cambiarlas.
      </p>
      <button
        type="button"
        class="secondary-button"
        data-testid="inspectConsent"
        :disabled="store.busy"
        @click="store.open(store.detail.id)"
      >
        Volver a inspeccionar</button
      ><ConsentConditions
        id="consent-contract"
        :value="store.detail.snapshot"
        title="Contrato persistido de esta versión" />
      <details v-if="store.detail.currentSnapshot">
        <summary>Comparar condiciones vigentes sin modificar el pasado</summary>
        <ConsentConditions
          :value="store.detail.currentSnapshot"
          title="Configuración y destinos vigentes al inspeccionar"
        />
      </details>
      <ConsentAcceptance
        v-if="
          store.detail.state === 'PENDING_CONFIRMATION' &&
          store.detail.acceptance.available &&
          !editing
        "
        :challenge="store.challenge"
        :busy="store.busy || !!store.pending"
        :session="`${auth.user?.id}:${auth.status}:${auth.getSessionGeneration()}`"
        @request="store.loadChallenge"
        @accept="store.accept" />
      <p
        v-if="
          store.detail.state === 'PENDING_CONFIRMATION' &&
          !store.detail.acceptance.available
        "
      >
        No se puede confirmar esta versión:
        {{ store.detail.acceptance.reason }}. Revisa la vigencia y las
        condiciones actuales.
      </p>
      <section v-if="store.detail.state !== 'REVOKED'" class="progression-card">
        <h2>Gestión y revocación de esta solicitud</h2>
        <button
          type="button"
          class="secondary-button"
          v-if="store.detail.state === 'PENDING_CONFIRMATION'"
          data-testid="editConsent"
          :disabled="store.busy || !!store.pending"
          @click="toggleEditing"
        >
          Revisar condiciones y generar otra versión</button
        ><label
          ><input
            v-model="revokeConfirmed"
            data-testid="confirmRevokeConsent"
            type="checkbox"
            :disabled="store.busy || !!store.pending"
          />
          Confirmo que quiero revocar esta solicitud y conservar su
          auditoría.</label
        ><button
          type="button"
          class="secondary-button"
          data-testid="revokeConsent"
          :disabled="!revokeConfirmed || store.busy || !!store.pending"
          @click="revoke"
        >
          Revocar solicitud
        </button>
      </section>
      <p v-else>
        REVOKED es terminal. Los reintentos antiguos no restablecen la
        solicitud.
      </p>
      <template v-if="editing && store.detail.state === 'PENDING_CONFIRMATION'"
        ><ConsentForm
          :key="store.detail.version"
          :initial="store.detail.snapshot"
          :busy="store.busy || !!store.pending"
          @change="change"
          @preview="preview"
        /><template v-if="store.preview && contract"
          ><ConsentConditions
            :value="store.preview.snapshot"
            title="Condiciones nuevas, aún no registradas"
          /><label
            ><input
              v-model="reviseConfirmed"
              data-testid="confirmConsentRevision"
              type="checkbox"
              :disabled="store.busy || !!store.pending"
            />
            Confirmo registrar una nueva versión pendiente, sin modificar el
            evento anterior ni aceptar progresión automática.</label
          ><button
            type="button"
            class="primary-button"
            data-testid="reviseConsent"
            :disabled="!reviseConfirmed || store.busy || !!store.pending"
            @click="revise"
          >
            Registrar nueva versión pendiente
          </button></template
        ></template
      >
      <OperationalProgression :consent="store.detail" />
      <section id="consent-audit" class="progression-card progression-audit">
        <h2>Auditoría inmutable</h2>
        <article v-for="event in store.detail.events" :key="event.id">
          <h3>
            Versión {{ event.version }} · {{ event.action }} · {{ event.state }}
          </h3>
          <p>
            {{ event.recordedAt }} · intención {{ event.intentId }} · evento
            {{ event.id }}
          </p>
          <details v-if="event.acceptanceEvidence">
            <summary>
              Evidencia de confirmación explícita de esta versión
            </summary>
            <p>
              Contrato {{ event.acceptanceEvidence.contractKey }} · versión
              aceptada {{ event.acceptanceEvidence.acceptedVersion }} · términos
              {{ event.acceptanceEvidence.termsVersion }} · presentación
              {{ event.acceptanceEvidence.presentationVersion }}.
            </p>
            <p>
              Huella de condiciones
              {{ event.acceptanceEvidence.conditionsKey }} · huella de
              aceptación {{ event.acceptanceEvidence.acceptanceKey }} ·
              procedencia {{ event.acceptanceEvidence.provenance }}.
            </p>
            <p>
              Confirmaciones registradas: política
              {{ event.acceptanceEvidence.acknowledgments.policy }}, límites
              {{ event.acceptanceEvidence.acknowledgments.limits }}, destinos
              {{ event.acceptanceEvidence.acknowledgments.destinations }},
              vigencia {{ event.acceptanceEvidence.acknowledgments.validity }} y
              revocación
              {{ event.acceptanceEvidence.acknowledgments.revocation }}. Este
              registro no acredita necesariamente lectura o comprensión.
            </p>
          </details>
          <details>
            <summary>Condiciones exactas de esta versión histórica</summary>
            <ConsentConditions :value="event.snapshot" />
          </details>
        </article></section
    ></template>
  </section>
</template>
