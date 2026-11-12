<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { useOperationalProgressionStore } from "../../stores/operational-progression.store";
import type { ConsentInspection } from "../../types/automation-consent";
import ConsentConditions from "./ConsentConditions.vue";
const props = defineProps<{ consent: ConsentInspection }>(),
  auth = useAuthStore(),
  store = useOperationalProgressionStore(),
  activation = ref(false),
  revocation = ref(false);
watch(
  () => [
    props.consent,
    props.consent.version,
    props.consent.state,
    props.consent.effectiveState,
    auth.user?.id,
    auth.status,
    auth.accessToken,
    auth.getSessionGeneration(),
  ],
  () => {
    activation.value = false;
    revocation.value = false;
    void store.open(props.consent.id);
  },
  { immediate: true },
);
watch(
  () => store.status,
  () => {
    activation.value = false;
    revocation.value = false;
  },
);
const activationMatches = computed(
  () =>
    store.status?.consentVersion === props.consent.version &&
    props.consent.state === "ACCEPTED_INACTIVE" &&
    props.consent.acceptance.recordedEventId ===
      store.status?.acceptanceEventId,
);
async function activate() {
  if (!activation.value || !activationMatches.value) return;
  activation.value = false;
  await store.command("ACTIVATE", true);
}
async function revoke() {
  if (!revocation.value) return;
  revocation.value = false;
  await store.command("REVOKE", true);
}
</script>
<template>
  <section class="progression-card progression-operational" aria-labelledby="operational-heading">
    <h2 id="operational-heading">
      Progresión automática de recomendaciones guardadas
    </h2>
    <p>
      La aceptación humana y este permiso operativo son registros separados.
      autoApplyAuthorized no activa este permiso.
    </p>
    <p>
      El trabajador interno procesa periódicamente recomendaciones modernas ya
      guardadas, neutrales y PENDING cuando el servicio está habilitado. Cada
      ejecución valida vigencia, límites semanales, destinos y versión. No
      genera recomendaciones futuras ni cohortes. Procesar ahora ejecuta
      realmente el mismo motor y puede registrar bloqueos sin aplicar cargas.
    </p>
    <p>
      El máximo semanal aceptado se comparte por atleta y ejercicio entre
      aplicaciones manuales y automáticas. Se cuenta el instante efectivo de
      aplicación dentro de la semana civil en la zona IANA y con el día ISO de
      inicio indicados en las condiciones. Cambiar de consentimiento no reinicia
      este contador. Solo se aplica con un único destino válido de la lista
      permitida.
    </p>
    <p v-if="store.busy" role="status">Consultando o procesando…</p>
    <p v-if="store.error" role="alert">
      {{ store.error.message }} {{ store.error.code }}
      <span v-for="reason in store.error.reasons" :key="reason"
        >{{ reason }}
      </span>
    </p>
    <p v-if="store.notice" role="status">{{ store.notice }}</p>
    <template v-if="store.status && store.status.consentId === consent.id">
      <p class="progression-state-panel" data-testid="operationalState">
        {{ store.status.effectiveState }} · ejecución autorizada:
        {{ store.status.executionAuthorized ? "sí" : "no" }} · versión
        {{ store.status.consentVersion }}
      </p>
      <p v-if="store.status.consentVersion !== consent.version" role="alert">
        La versión operativa cambió. Vuelve a inspeccionar la solicitud antes de
        activar.
      </p>
      <p v-for="reason in store.status.reasons" :key="reason">{{ reason }}</p>
      <p v-if="store.status.grant">
        Permiso {{ store.status.grant.id }} · {{ store.status.grant.state }} ·
        versión {{ store.status.grant.version }}
      </p>
      <template
        v-if="
          store.status.effectiveState === 'INACTIVE' &&
          store.status.acceptanceEventId &&
          activationMatches
        "
      >
        <ConsentConditions
          :value="consent.snapshot"
          title="Condiciones exactas que autorizas para el procesamiento"
        />
        <p>
          Términos {{ store.status.activationTermsVersion }}. Puedes revocar sin
          borrar aplicaciones históricas.
        </p>
        <label
          ><input
            v-model="activation"
            type="checkbox"
            data-testid="confirmOperationalActivation"
            :disabled="store.busy || !!store.pending"
          />Confirmo activar expresamente el procesamiento automático bajo estas
          condiciones.</label
        >
        <button
          type="button"
          class="primary-button"
          data-testid="activateOperationalGrant"
          :disabled="!activation || store.busy || !!store.pending"
          @click="activate"
        >
          Activar permiso operativo
        </button>
      </template>
      <template v-if="store.status.grant?.state === 'ACTIVE'">
        <label
          ><input
            v-model="revocation"
            type="checkbox"
            data-testid="confirmOperationalRevoke"
            :disabled="store.busy || !!store.pending"
          />Confirmo revocar este permiso y conservar su historial.</label
        >
        <button
          type="button"
          class="secondary-button"
          data-testid="revokeOperationalGrant"
          :disabled="!revocation || store.busy || !!store.pending"
          @click="revoke"
        >
          Revocar permiso operativo
        </button>
      </template>
      <button
        type="button"
        class="primary-button"
        data-testid="processAutomaticRecommendations"
        :disabled="
          !store.status.executionAuthorized || store.busy || !!store.pending
        "
        @click="store.command('CHECK')"
      >
        Procesar recomendaciones guardadas ahora
      </button>
    </template>
    <button
      type="button"
      class="secondary-button"
      :disabled="store.busy"
      @click="store.open(consent.id)"
    >
      Consultar estado e historial
    </button>
    <button
      v-if="store.pending"
      type="button"
      class="secondary-button"
      data-testid="recoverOperationalResult"
      :disabled="store.busy"
      @click="store.recover"
    >
      {{
        store.pending.action === "CHECK"
          ? "Consultar resultado o reanudar el procesamiento pendiente"
          : "Consultar resultado de la intención pendiente"
      }}
    </button>
    <section
      v-if="store.receipt && store.receipt.consentId === consent.id"
      aria-label="Recibo confirmado"
    >
      <h3>Operación {{ store.receipt.action }} confirmada</h3>
      <p>
        {{ store.receipt.eventId }} · intención {{ store.receipt.intentId }} ·
        {{ store.receipt.recordedAt }}. Este recibo histórico no determina el
        permiso actual.
      </p>
      <p v-if="!store.receipt.results.length">
        Sin aplicaciones registradas en esta operación.
      </p>
      <p v-for="run in store.receipt.results" :key="run.id">
        {{ run.result }} · {{ run.recommendationId }} ·
        {{ run.reasons.join(", ") }}
      </p>
    </section>
    <section
      v-if="store.history && store.status?.consentId === consent.id"
      id="automatic-history"
      class="progression-audit"
      aria-label="Historial de procesamiento"
    >
      <h3>Historial de procesamiento</h3>
      <p v-if="!store.history.items.length">Sin ejecuciones registradas.</p>
      <article
        v-for="run in store.history.items"
        :key="run.id"
        data-testid="automaticRun"
      >
        <RouterLink
          :to="{
            name: 'progression-detail',
            params: { id: run.recommendationId },
          }"
          >{{ run.recommendationId }}</RouterLink
        >
        <p>
          {{ run.result }} · {{ run.recordedAt }} · {{ run.reasons.join(", ") }}
        </p>
        <p v-if="run.result === 'APPLIED'">
          Carga {{ run.previousLoad }} → {{ run.appliedLoad }} {{ run.unit }} ·
          aplicación {{ run.applicationId }}
        </p>
      </article>
      <p>
        Página {{ store.history.page }} · {{ store.history.total }} ejecuciones
      </p>
      <button
        type="button"
        class="secondary-button"
        :disabled="store.busy || store.history.page <= 1"
        @click="store.loadHistory(store.history.page - 1)"
      >
        Anterior</button
      ><button
        type="button"
        class="secondary-button"
        :disabled="
          store.busy ||
          store.history.page * store.history.limit >= store.history.total
        "
        @click="store.loadHistory(store.history.page + 1)"
      >
        Siguiente
      </button>
    </section>
  </section>
</template>
