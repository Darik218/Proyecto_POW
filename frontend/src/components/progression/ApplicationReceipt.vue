<script setup lang="ts">
import StatusBadge from '../ui/StatusBadge.vue'
import type { ApplicationReceipt } from '../../types/progression'
defineProps<{ value: ApplicationReceipt }>()
</script>
<template>
  <section class="progression-card progression-receipt" data-testid="receipt" role="status">
    <div class="progression-section-heading"><h2>Aplicación confirmada</h2><StatusBadge status="APPLIED" /></div>
    <p>Recibo {{ value.id }} · auditoría {{ value.auditId }}</p>
    <p>
      Recomendación {{ value.recommendationId }} · intención
      {{ value.intentId }}
    </p>
    <p>
      {{ value.previousLoad }} → {{ value.appliedLoad }} {{ value.loadUnit }}
    </p>
    <p>
      Prescripción {{ value.planExerciseId }} · actividad
      {{ value.scheduledActivityId }}
    </p>
    <p>
      Plan: versión {{ value.destination.planVersionBefore }} →
      {{ value.destination.planVersionAfter }}. {{ value.effectiveAt }}
    </p>
    <p>
      Fecha deportiva: {{ value.temporal.scheduledOn }} ·
      {{ value.temporal.timeZone }}. Este recibo confirma una única aplicación;
      las sesiones históricas no se modifican.
    </p>
  </section>
</template>
