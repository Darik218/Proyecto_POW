<script setup lang="ts">
import { ref, useId } from 'vue'
import { RouterLink } from 'vue-router'
import PlanDaySelector from './PlanDaySelector.vue'
import { workoutSessionsService, workoutWriteRejected, workoutErrorMessage } from '../../services/workout-sessions.service'
const props = defineProps<{ sessionId: string; busy?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()
const id = useId()
const selection = ref({ trainingPlanId: '', planWeekId: '', planDayId: '' })
const name = ref('')
const position = ref(1)
const weekday = ref('')
const pending = ref(false)
const saved = ref('')
const error = ref('')
let creationId = crypto.randomUUID()
let submitted: Parameters<typeof workoutSessionsService.saveAsDay>[1] | undefined
async function submit() {
  if (pending.value || props.busy || saved.value) return
  error.value = ''
  if (!name.value.trim() || !selection.value.trainingPlanId || !selection.value.planWeekId || position.value < 1 || position.value > 1000 || !Number.isInteger(Number(position.value))) { error.value = 'Selecciona un plan en borrador, su semana, un nombre y una posición válida.'; return }
  submitted ??= { id: creationId, trainingPlanId: selection.value.trainingPlanId, planWeekId: selection.value.planWeekId, name: name.value.trim(), position: Number(position.value), weekday: weekday.value ? Number(weekday.value) : null }
  pending.value = true
  try { const result = await workoutSessionsService.saveAsDay(props.sessionId, submitted); saved.value = result.trainingPlanId }
  catch (cause) { if (workoutWriteRejected(cause)) { submitted = undefined; creationId = crypto.randomUUID() } error.value = workoutErrorMessage(cause, 'No se pudo guardar la rutina.') }
  finally { pending.value = false }
}
</script>
<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit"><h3>Guardar estructura como día de un plan</h3><p>Solo se copiarán los ejercicios incluidos y sus objetivos, sin resultados. El destino debe ser un plan en borrador.</p><fieldset :disabled="pending || busy || Boolean(submitted)"><PlanDaySelector v-model="selection" week-only draft-only @next-position="position = $event" /><label class="field-label" :for="id+'-name'">Nombre del nuevo día</label><input :id="id+'-name'" v-model="name" class="form-control" maxlength="160" required><label class="field-label" :for="id+'-position'">Posición</label><input :id="id+'-position'" v-model="position" class="form-control" type="number" min="1" max="1000" step="1"><label class="field-label" :for="id+'-weekday'">Programación</label><select :id="id+'-weekday'" v-model="weekday" class="form-control"><option value="">Flexible</option><option v-for="(label,index) in ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']" :key="index" :value="String(index+1)">{{ label }}</option></select></fieldset><p v-if="error" role="alert" class="form-error">{{ error }}</p><p v-if="saved" role="status" class="success-message">Rutina guardada. <RouterLink :to="{ name: 'training-plan-detail', params: { planId: saved } }">Ver plan</RouterLink></p><div class="plan-actions"><button v-if="!saved" class="primary-button" type="submit" :disabled="pending || busy">{{ pending ? 'Guardando…' : submitted ? 'Reintentar' : 'Guardar nuevo día' }}</button><button class="text-button" type="button" :disabled="pending" @click="emit('cancel')">Cerrar</button><RouterLink :to="{ name: 'training-plans' }">Elegir o crear un plan editable</RouterLink></div></form>
</template>
