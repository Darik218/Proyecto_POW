<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import ExercisePicker from './ExercisePicker.vue'
import { createPrescriptionSchema, updatePrescriptionSchema, createDailyPrescriptionSchema, updateDailyPrescriptionSchema, type CreateDailyPrescription, type UpdateDailyPrescription, trainingPlanErrorMessage, type Prescription, type CreatePrescription, type UpdatePrescription } from '../../services/training-plans.service'
const props = defineProps<{ initial?: Prescription; nextPosition?: number; busy?: boolean; daily?: boolean; save: (input: CreatePrescription | UpdatePrescription | CreateDailyPrescription | UpdateDailyPrescription) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const exerciseId = ref('')
const form = reactive({ position: String(props.initial?.position ?? props.nextPosition ?? 1), targetSets: String(props.initial?.targetSets ?? ''), targetReps: String(props.initial?.targetReps ?? ''), targetRepsMin: String(props.initial?.targetRepsMin ?? props.initial?.targetReps ?? ''), targetRepsMax: String(props.initial?.targetRepsMax ?? props.initial?.targetReps ?? ''), targetLoadUnit: props.initial?.targetLoadUnit ?? '', targetLoad: props.initial?.targetLoad?.toString() ?? '', targetRpe: props.initial?.targetRpe?.toString() ?? '', notes: props.initial?.notes ?? '' })
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  if (!props.initial && !exerciseId.value) { error.value = 'Selecciona un ejercicio del catálogo.'; return }
  const value = {
    ...(!props.initial ? { exerciseId: exerciseId.value } : {}), position: Number(form.position), targetSets: Number(form.targetSets), ...(props.daily ? { targetRepsMin: Number(form.targetRepsMin), targetRepsMax: Number(form.targetRepsMax), targetLoadUnit: String(form.targetLoad).trim() ? form.targetLoadUnit || null : null } : { targetReps: Number(form.targetReps) }),
    targetLoad: String(form.targetLoad).trim() ? Number(form.targetLoad) : null, targetRpe: String(form.targetRpe).trim() ? Number(form.targetRpe) : null, notes: form.notes.trim() || null,
  }
  if (props.daily && value.targetLoad !== null && !form.targetLoadUnit && !(props.initial && props.initial.targetLoadUnit == null && value.targetLoad === props.initial.targetLoad)) { error.value = 'Selecciona la unidad de la carga.'; return }
  const schema = props.daily ? (props.initial ? updateDailyPrescriptionSchema : createDailyPrescriptionSchema) : (props.initial ? updatePrescriptionSchema : createPrescriptionSchema)
  const parsed = schema.safeParse(value)
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los campos.'; return }
  pending.value = true
  try { await props.save(parsed.data); emit('saved') }
  catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo guardar la prescripción.') }
  finally { pending.value = false }
}
</script>

<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h2>{{ initial ? 'Editar prescripción' : 'Añadir ejercicio' }}</h2>
    <fieldset :disabled="pending || busy">
      <p v-if="initial"><strong>{{ initial.exercise.name }}</strong></p>
      <ExercisePicker v-else v-model="exerciseId" :disabled="pending || busy" />
      <div class="plan-form-grid">
        <div><label class="field-label" :for="id + '-position'">Posición {{ daily ? 'en el día' : 'en la semana' }}</label><input :id="id + '-position'" v-model="form.position" class="form-control" type="number" min="1" max="1000" step="1" required></div>
        <div><label class="field-label" :for="id + '-sets'">Series objetivo</label><input :id="id + '-sets'" v-model="form.targetSets" class="form-control" type="number" min="1" max="1000" step="1" required></div>
        <div v-if="!daily"><label class="field-label" :for="id + '-reps'">Repeticiones por serie</label><input :id="id + '-reps'" v-model="form.targetReps" class="form-control" type="number" min="1" max="10000" step="1" required></div>
        <template v-if="daily">
          <div><label class="field-label" :for="id + '-min'">Repeticiones mínimas</label><input :id="id + '-min'" v-model="form.targetRepsMin" class="form-control" type="number" min="1" max="10000" step="1" required></div>
          <div><label class="field-label" :for="id + '-max'">Repeticiones máximas</label><input :id="id + '-max'" v-model="form.targetRepsMax" class="form-control" type="number" min="1" max="10000" step="1" required><p class="field-hint">Para repeticiones exactas, utiliza el mismo valor en ambos campos.</p></div>
        </template>
        <div><label class="field-label" :for="id + '-load'">Carga objetivo (opcional)</label><input :id="id + '-load'" v-model="form.targetLoad" class="form-control" type="number" min="0" max="99999.999" step="0.001"></div>
        <div v-if="daily"><label class="field-label" :for="id + '-unit'">Unidad de la carga</label><select :id="id + '-unit'" v-model="form.targetLoadUnit" class="form-control"><option value="">Sin especificar</option><option value="KG">Kilogramos (kg)</option><option value="LB">Libras (lb)</option></select><p v-if="initial?.targetLoad != null && !initial.targetLoadUnit" class="field-hint">Carga histórica con unidad desconocida: consérvala o indica su unidad si la conoces.</p></div>
        <div><label class="field-label" :for="id + '-rpe'">RPE objetivo (opcional)</label><input :id="id + '-rpe'" v-model="form.targetRpe" class="form-control" type="number" min="0" max="10" step="0.1"></div>
      </div>
      <label class="field-label" :for="id + '-notes'">Notas (opcional)</label><textarea :id="id + '-notes'" v-model="form.notes" class="form-control form-control--textarea" maxlength="4000" />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar prescripción' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cancelar</button></div>
    </fieldset>
  </form>
</template>
