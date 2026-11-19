<script setup lang="ts">
import LoadingState from '../ui/LoadingState.vue'
import { useProgressionStore } from '../../stores/progression.store'
const store = useProgressionStore()
</script>
<template>
  <div class="progression-feedback" aria-live="polite">
    <LoadingState v-if="store.busy" label="Consultando el servidor…" :rows="2" />
    <div v-if="store.error" role="alert">
      <p>{{ store.error.message }}</p>
      <RouterLink
        v-if="
          store.error.reasons.some((r) =>
            [
              'SETTING_REQUIRED',
              'SETTING_VALUES_INVALID',
              'INCREMENT_REQUIRED',
              'AMBIGUOUS_SETTING_SCOPE',
            ].includes(r),
          )
        "
        :to="{ name: 'progression-settings' }"
        >Consultar parámetros persistidos. Guardarlos no sustituye política ni
        evidencia.</RouterLink
      >
      <p v-for="reason in store.error.reasons" :key="reason">{{ reason }}</p>
    </div>
    <p v-if="store.notice" role="status">{{ store.notice }}</p>
    <section v-if="store.pending" class="progression-warning">
      <h2>Operación pendiente de confirmación</h2>
      <p>
        No se conoce todavía el resultado de {{ store.pending.kind }}. Intención
        {{ store.pending.intentId ?? store.pending.semanticKey }}. Comprueba el
        estado antes de volver a enviar.
      </p>
      <button
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        data-testid="recover"
        @click="store.recover"
      >
        Consultar resultado de la intención</button
      ><button
        v-if="store.canRetry()"
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        data-testid="retry"
        @click="store.retry"
      >
        Reenviar exactamente la misma intención</button
      ><button
        v-if="!store.canRetry() && store.canReconfirm"
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        @click="store.reconfirm"
      >
        Retirar identificador local y volver a confirmar
      </button>
      <p v-if="!store.canRetry()">
        Después de recargar se conservan solo identificadores. Este registro no
        permite reconstruir ni reenviar una aceptación.
      </p>
    </section>
  </div>
</template>
