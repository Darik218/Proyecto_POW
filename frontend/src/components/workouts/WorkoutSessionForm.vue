<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import { updateWorkoutSchema, workoutErrorMessage, type Workout, type UpdateWorkout } from '../../services/workout-sessions.service'
const props = defineProps<{ session: Workout; busy: boolean; save: (input: Omit<UpdateWorkout, 'expectedVersion'>) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const fields = reactive({ name: props.session.name ?? '', notes: props.session.notes ?? '', performedOn: props.session.performedOn?.slice(0,10) ?? '', timeZone: props.session.timeZone ?? '', recordingMode: props.session.recordingMode ?? 'LIVE' })
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  const input = { ...(fields.name.trim() ? { name: fields.name.trim() } : {}), notes: fields.notes.trim() || null, ...(props.session.status === 'PLANNED' ? { performedOn: fields.performedOn, timeZone: fields.timeZone, recordingMode: fields.recordingMode as 'LIVE' | 'RETROSPECTIVE' } : {}) }
  const parsed = updateWorkoutSchema.safeParse({ ...input, expectedVersion: props.session.version ?? 0 })
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los datos del entrenamiento.'; return }
  pending.value = true
  try { const { expectedVersion: _version, ...values } = parsed.data; await props.save(values); emit('saved') }
  catch (cause) { error.value = workoutErrorMessage(cause, 'No se pudo guardar la sesión.') }
  finally { pending.value = false }
}
</script>
<template><form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit"><h3>Datos del entrenamiento</h3><fieldset :disabled="busy || pending"><label class="field-label" :for="id+'-name'">Nombre</label><input :id="id+'-name'" v-model="fields.name" class="form-control" maxlength="160"><template v-if="session.status === 'PLANNED'"><label class="field-label" :for="id+'-date'">Fecha del entrenamiento</label><input :id="id+'-date'" v-model="fields.performedOn" class="form-control" type="date"><label class="field-label" :for="id+'-zone'">Zona horaria IANA</label><input :id="id+'-zone'" v-model="fields.timeZone" class="form-control"><label class="field-label" :for="id+'-mode'">Tipo de registro</label><select :id="id+'-mode'" v-model="fields.recordingMode" class="form-control"><option value="LIVE">En directo</option><option value="RETROSPECTIVE">Entrenamiento anterior</option></select></template><label class="field-label" :for="id+'-notes'">Notas</label><textarea :id="id+'-notes'" v-model="fields.notes" class="form-control" maxlength="4000" /><p v-if="error" role="alert" class="form-error">{{ error }}</p><div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar datos' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cerrar</button></div></fieldset></form></template>
