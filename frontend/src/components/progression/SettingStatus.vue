<script setup lang="ts">
import LoadingState from '../ui/LoadingState.vue'
import { useProgressionSettingsStore } from '../../stores/progression-settings.store'
const store = useProgressionSettingsStore()
</script>
<template>
  <div class="progression-feedback" aria-live="polite">
    <LoadingState v-if="store.busy" label="Consultando configuraciones…" :rows="2" />
    <div v-if="store.error" role="alert">
      <p>{{ store.error.message }}</p>
      <p v-for="r in store.error.reasons" :key="r">{{ r }}</p>
    </div>
    <p v-if="store.notice" role="status">{{ store.notice }}</p>
    <section v-if="store.pending" class="progression-warning">
      <h2>Resultado pendiente de confirmar</h2>
      <p>
        Intención {{ store.pending.intentId }}. Una respuesta perdida no
        significa que PostgreSQL haya rechazado la operación.
      </p>
      <button
        type="button"
        class="secondary-button"
        data-testid="recoverSetting"
        :disabled="store.busy"
        @click="store.recover"
      >
        Consultar resultado</button
      ><button
        v-if="store.canRetry()"
        type="button"
        class="secondary-button"
        data-testid="retrySetting"
        :disabled="store.busy"
        @click="store.retry"
      >
        Reintentar exactamente la intención</button
      ><button
        v-if="!store.canRetry() && store.canReconfirm"
        type="button"
        class="secondary-button"
        :disabled="store.busy"
        @click="store.reconfirm"
      >
        Retirar identificador tras consultar
      </button>
      <p>
        Tras recargar solo hay identificadores: no se reconstruyen ni reenvían
        parámetros privados.
      </p>
    </section>
  </div>
</template>
