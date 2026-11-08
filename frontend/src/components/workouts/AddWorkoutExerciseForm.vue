<script setup lang="ts">
import { ref, useId } from 'vue'
import ExercisePicker from '../training-plans/ExercisePicker.vue'
import { addWorkoutExerciseSchema, workoutWriteRejected, workoutErrorMessage, type AddWorkoutExercise } from '../../services/workout-sessions.service'
const props = defineProps<{ busy?: boolean; expectedVersion?: number; omittedExercises?: Array<{ id: string; exercise: { name: string } }>; save: (input: AddWorkoutExercise) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
let requestId = crypto.randomUUID()
const exerciseId = ref('')
const notes = ref('')
const replaces = ref('')
const pending = ref(false)
const submitted = ref<AddWorkoutExercise | null>(null)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  if (!submitted.value) {
    const parsed = addWorkoutExerciseSchema.safeParse({ id: requestId, expectedVersion: props.expectedVersion ?? 0, ...(replaces.value ? { replacesWorkoutExerciseId: replaces.value } : {}), exerciseId: exerciseId.value, notes: notes.value.trim() || null })
    if (!parsed.success) { error.value = 'Selecciona un ejercicio y revisa las notas.'; return }
    submitted.value = parsed.data
  }
  pending.value = true
  try { await props.save(submitted.value); emit('saved') }
  catch (cause) { if (workoutWriteRejected(cause)) { submitted.value = null; requestId = crypto.randomUUID() } error.value = workoutErrorMessage(cause, 'No se pudo añadir el ejercicio.') }
  finally { pending.value = false }
}
</script>

<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h2>Añadir ejercicio al entrenamiento</h2>
    <fieldset :disabled="pending || busy || Boolean(submitted)"><ExercisePicker v-model="exerciseId" :disabled="pending || busy || Boolean(submitted)" /><label v-if="omittedExercises?.length" class="field-label" :for="id + '-replaces'">Sustituye a un ejercicio omitido (opcional)</label><select v-if="omittedExercises?.length" :id="id + '-replaces'" v-model="replaces" class="form-control"><option value="">Ejercicio adicional</option><option v-for="item in omittedExercises" :key="item.id" :value="item.id">{{ item.exercise.name }}</option></select><label class="field-label" :for="id + '-notes'">Observaciones (opcional)</label><textarea :id="id + '-notes'" v-model="notes" class="form-control form-control--textarea" maxlength="4000" /></fieldset>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="submitted && error" class="field-hint">Reintentar conserva el identificador de esta solicitud para evitar duplicados.</p>
    <div class="plan-actions"><button class="primary-button" type="submit" :disabled="pending || busy">{{ pending ? 'Añadiendo…' : submitted ? 'Reintentar' : 'Añadir ejercicio' }}</button><button class="text-button" type="button" :disabled="pending" @click="emit('cancel')">Cerrar</button></div>
  </form>
</template>
