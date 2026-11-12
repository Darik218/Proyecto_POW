<script setup lang="ts">
import LoadingState from '../ui/LoadingState.vue'
import { useAutomationConsentStore } from '../../stores/automation-consent.store'
const store = useAutomationConsentStore()
</script>
<template>
  <div class="progression-feedback" aria-live="polite">
    <LoadingState v-if="store.busy" label="Consultando el servidor…" :rows="2" />
    <p v-if="store.notice" role="status">{{ store.notice }}</p>
    <section v-if="store.error" role="alert">
      <p>{{ store.error.message }}</p>
      <p v-for="r in store.error.reasons" :key="r">{{ r }}</p>
    </section>
    <section v-if="store.pending" class="progression-warning">
      <h2>Resultado pendiente de verificación</h2>
      <p>
        Operación {{ store.pending.action }} · intención
        {{ store.pending.intentId }}. No se presume rechazo ni éxito.
      </p>
      <button
        type="button"
        class="secondary-button"
        data-testid="consentRecover"
        :disabled="store.busy"
        @click="store.recover"
      >
        Consultar intención original</button
      ><button
        v-if="store.canRetry()"
        type="button"
        class="secondary-button"
        data-testid="consentRetry"
        :disabled="store.busy"
        @click="store.retry"
      >
        Reenviar el mismo contrato e intención
      </button>
      <p v-else>
        Después de recargar solo se recuperan identificadores. No se
        reconstruirá ni enviará un contrato automáticamente.
      </p>
      <button
        v-if="!store.canRetry() && store.canReconfirm"
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        @click="store.reconfirm"
      >
        Retirar identificador local tras consultar y volver a revisar
      </button>
    </section>
  </div>
</template>
