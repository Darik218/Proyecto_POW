<script setup lang="ts">
import { ref } from 'vue'
import { workoutErrorMessage } from '../../services/workout-sessions.service'
const props = defineProps<{ busy?: boolean; save: () => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const confirmed = ref(false)
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  if (!confirmed.value) { error.value = 'Confirma que deseas finalizar el entrenamiento.'; return }
  error.value = ''; pending.value = true
  try { await props.save(); emit('saved') }
  catch (cause) { error.value = workoutErrorMessage(cause, 'No se pudo finalizar el entrenamiento.') }
  finally { pending.value = false }
}
</script>

<template>
  <form class="plan-form" :aria-busy="pending" @submit.prevent="submit"><h2>Finalizar entrenamiento</h2><p>El entrenamiento quedará guardado como finalizado y no podrás añadir ejercicios.</p><fieldset :disabled="pending || busy"><label class="field-label"><input v-model="confirmed" type="checkbox"> Confirmo que deseo finalizar este entrenamiento.</label><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="plan-actions"><button class="primary-button" type="submit" :disabled="!confirmed">{{ pending ? 'Finalizando…' : 'Confirmar finalización' }}</button><button class="text-button" type="button" @click="emit('cancel')">Seguir entrenando</button></div></fieldset></form>
</template>
