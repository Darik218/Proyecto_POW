<script setup lang="ts">
import StatusBadge from '../ui/StatusBadge.vue'
import { computed, ref, watch } from 'vue'
import type {
  ProgressionInspection,
  ReviewRequest,
} from '../../types/progression'
const props = defineProps<{
    value: ProgressionInspection
    busy: boolean
    session: string
  }>(),
  emit = defineEmits<{ decide: [request: ReviewRequest] }>()
const policy = ref(false),
  evidence = ref(false),
  justification = ref('')
watch(
  () => [props.value, props.session],
  () => {
    policy.value = false
    evidence.value = false
    justification.value = ''
  },
  { immediate: true },
)
const canApprove = computed(
  () =>
    props.value.proposal.status === 'PENDING' &&
    props.value.approvalBlockers.length === 0 &&
    !!props.value.acceptanceChallenge &&
    policy.value &&
    evidence.value &&
    !props.busy,
)
function decide(action: 'APPROVE' | 'REJECT') {
  if (
    props.busy ||
    props.value.proposal.status !== 'PENDING' ||
    (action === 'APPROVE' && !canApprove.value) ||
    (action === 'REJECT' && !justification.value.trim())
  )
    return
  const v = props.value,
    p = v.proposal
  emit('decide', {
    intentId: crypto.randomUUID(),
    action,
    expectedStatus: 'PENDING',
    expectedVersion: p.reviewVersion,
    expectedSemanticKey: p.generation?.semanticKey ?? null,
    expectedCycleKey: v.cycle.key,
    expectedDependencyKeys: p.generation?.dependencyKeys ?? null,
    justification: justification.value.trim() || undefined,
    ...(action === 'APPROVE' && v.acceptanceChallenge
      ? {
          acceptance: {
            ...v.acceptanceChallenge,
            acceptPolicy: true,
            acceptEvidence: true,
          },
        }
      : {}),
  })
}
</script>
<template>
  <section class="progression-card progression-review">
    <div class="progression-section-heading"><h2>Revisión humana</h2><StatusBadge :status="value.proposal.status" /></div>
    <p>
      Vigencia: {{ value.validity.state }}. Revisión:
      {{ value.proposal.reviewVersion ?? 'Sin revisar' }}. Compatibilidad:
      {{ value.compatibility.compatible ? 'Compatible' : 'No compatible' }}.
    </p>
    <p
      v-for="reason in [
        ...value.approvalBlockers,
        ...value.compatibility.reasons,
      ]"
      :key="reason"
      class="progression-warning"
    >
      {{ reason }}
    </p>
    <template v-if="value.proposal.status === 'PENDING'"
      ><p>
        La aceptación se limita a esta propuesta (THIS_PROPOSAL_ONLY). No
        habilita progresión recurrente. Aprobar registra tu decisión y no
        modifica la planificación.
      </p>
      <label
        ><input
          v-model="policy"
          data-testid="acceptPolicy"
          type="checkbox"
          :disabled="busy"
        />
        Reconozco la política, sus parámetros y sus límites para esta
        propuesta.</label
      ><label
        ><input
          v-model="evidence"
          data-testid="acceptEvidence"
          type="checkbox"
          :disabled="busy"
        />
        Reconozco la evidencia, advertencias, carga, unidad y destino
        presentados.</label
      ><label
        >Justificación de la decisión (obligatoria para rechazar)<textarea
          v-model="justification"
          data-testid="justification"
          maxlength="2000"
          :disabled="busy"
        ></textarea>
      </label>
      <div class="progression-actions">
        <button
          type="button"
          class="primary-button"
          data-testid="approve"
          :disabled="!canApprove"
          @click="decide('APPROVE')"
        >
          Aprobar solo esta propuesta</button
        ><button
          type="button"
          class="secondary-button"
          data-testid="reject"
          :disabled="busy || !justification.trim()"
          @click="decide('REJECT')"
        >
          Rechazar propuesta
        </button>
      </div></template
    >
    <p v-else>
      No se ofrece una segunda revisión. Una aprobación requiere una
      comprobación nueva antes de aplicar.
    </p>
    <details>
      <summary>Auditoría de revisión</summary>
      <p v-for="event in value.events" :key="event.id">
        {{ event.decidedAt }} · {{ event.action }} · revisión
        {{ event.version }} · {{ event.justification ?? 'Sin comentario' }} ·
        {{ event.acceptance?.scope ?? 'Sin aceptación' }}
      </p>
    </details>
  </section>
</template>
