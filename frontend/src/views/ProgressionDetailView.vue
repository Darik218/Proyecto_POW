<script setup lang="ts">
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import { watch, shallowRef, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth.store";
import { useProgressionStore } from "../stores/progression.store";
import ProgressionStatus from "../components/progression/ProgressionStatus.vue";
import ProgressionEvidence from "../components/progression/ProgressionEvidence.vue";
import RecommendationReview from "../components/progression/RecommendationReview.vue";
import RecommendationApply from "../components/progression/RecommendationApply.vue";
import ApplicationReceipt from "../components/progression/ApplicationReceipt.vue";
import { operationalProgressionService } from "../services/operational-progression.service";
import { progressionError } from "../services/progression.service";
import type { AutomaticApplication } from "../types/operational-progression";
import "../assets/progression.css";
const route = useRoute(),
  auth = useAuthStore(),
  store = useProgressionStore(),
  automaticReceipt = shallowRef<AutomaticApplication | null>(null),
  receiptError = ref(""),
  receiptResolved = ref(false);
let receiptEpoch = 0;
watch(
  () => [
    route.params.id,
    auth.user?.id,
    auth.status,
    auth.getSessionGeneration(),
  ],
  async () => {
    const n = ++receiptEpoch;
    automaticReceipt.value = null;
    receiptError.value = "";
    receiptResolved.value = false;
    const id = String(route.params.id);
    await store.open(id);
    if (n !== receiptEpoch) return;
    if (store.proposal?.id === id && store.proposal.status === "APPLIED") {
      try {
        const value = await operationalProgressionService.application(id);
        if (n === receiptEpoch) {
          automaticReceipt.value = value;
          receiptResolved.value = true;
        }
      } catch (e) {
        if (n !== receiptEpoch) return;
        if (
          progressionError(e).code === "SOURCE_NOT_FOUND" ||
          (e as { response?: { status?: number } })?.response?.status === 404
        ) {
          receiptResolved.value = true;
          // Recovery owns its active read and may already have supplied the manual receipt.
          if (!store.pending && !store.receipt) await store.loadReceipt(id);
        } else
          receiptError.value =
            "No se pudo consultar el recibo automático. Vuelve a abrir esta recomendación para consultar su origen.";
      }
    } else receiptResolved.value = true;
  },
  { immediate: true },
);
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'progression' }">Volver a progresión</RouterLink>
    <PageHeader
      title="Recomendación"
      description="Evidencia capturada, revisión humana y aplicación en etapas separadas."
      icon="activity"
    />
    <nav
      class="progression-context-nav"
      aria-label="Secciones de la recomendación"
      v-if="store.proposal && store.inspection"
    >
      <a v-if="store.proposal.generation" href="#proposal-evidence">Evidencia</a
      ><a v-if="receiptResolved && !automaticReceipt" href="#proposal-review"
        >Revisión humana</a
      ><a
        v-if="receiptResolved && !automaticReceipt"
        href="#proposal-application"
        >Aplicación</a
      >
    </nav>
    <ProgressionStatus /><template v-if="store.proposal && store.inspection"
      ><p class="progression-state-panel">
        <StatusBadge :status="store.proposal.status" /> ·
        {{ store.proposal.generationState }} ·
        {{ store.proposal.id }}
      </p>
      <button
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        data-testid="revalidate"
        @click="store.check(store.proposal.id)"
      >
        Volver a inspeccionar vigencia</button
      ><ProgressionEvidence
        id="proposal-evidence"
        v-if="store.proposal.generation"
        :value="store.proposal.generation" />
      <p v-else>
        La captura histórica no está disponible. No se reconstruirá desde el
        plan actual.
      </p>
      <p v-if="receiptError" role="alert">{{ receiptError }}</p>
      <section
        v-if="automaticReceipt"
        class="progression-card"
        data-testid="automaticApplicationReceipt"
      >
        <h2>Aplicación automática</h2>
        <p>
          {{ automaticReceipt.run.result }} ·
          {{ automaticReceipt.run.recordedAt }} · permiso
          {{ automaticReceipt.run.grantId }}
        </p>
        <p>
          Carga {{ automaticReceipt.run.previousLoad }} →
          {{ automaticReceipt.run.appliedLoad }}
          {{ automaticReceipt.run.unit }} · aplicación
          {{ automaticReceipt.run.applicationId }}
        </p>
        <p v-for="reason in automaticReceipt.run.reasons" :key="reason">
          {{ reason }}
        </p>
        <RouterLink
          :to="{
            name: 'automation-detail',
            params: { id: automaticReceipt.consentId },
            hash: '#automatic-history',
          }"
          >Ver permiso e historial automático</RouterLink
        >
      </section>
      <template v-if="receiptResolved && !automaticReceipt">
        <RecommendationReview
          id="proposal-review"
          :value="store.inspection"
          :session="auth.getSessionGeneration()"
          :busy="store.busy || !!store.pending"
          @decide="store.review" /><RecommendationApply
          id="proposal-application"
          :proposal="store.proposal"
          :readiness="store.readiness"
          :busy="store.busy || !!store.pending"
          @invalidate="store.clearApplication"
          @prepare="
            (activity, intent) =>
              store.prepareApplication(store.proposal!.id, activity, intent)
          "
          @apply="store.apply" /><ApplicationReceipt
          v-if="store.receipt"
          :value="store.receipt" /></template
    ></template>
  </section>
</template>
