<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import { editWorkoutTargetsSchema, workoutErrorMessage, type WorkoutTargets, type WorkoutTargetsInput } from '../../services/workout-sessions.service'
const props = defineProps<{ initial?: WorkoutTargets; notes?: string | null; busy?: boolean; save: (input: WorkoutTargetsInput) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const fields = reactive({ targetSets: props.initial?.targetSets?.toString() ?? '', targetRepsMin: props.initial?.targetRepsMin?.toString() ?? '', targetRepsMax: props.initial?.targetRepsMax?.toString() ?? '', targetLoad: props.initial?.targetLoad ?? '', targetLoadUnit: props.initial?.targetLoadUnit ?? '', targetRpe: props.initial?.targetRpe?.toString() ?? '', notes: props.notes ?? '' })
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  const number = (value: unknown) => String(value).trim() ? Number(value) : null
  const value = { targetSets: number(fields.targetSets), targetRepsMin: number(fields.targetRepsMin), targetRepsMax: number(fields.targetRepsMax), targetLoad: fields.targetLoad.trim().replace(',', '.') || null, targetLoadUnit: fields.targetLoad.trim() ? fields.targetLoadUnit || null : null, targetRpe: number(fields.targetRpe), notes: fields.notes.trim() || null }
  const parsed = editWorkoutTargetsSchema.safeParse(value)
  error.value = ''
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los objetivos.'; return }
  if (value.targetLoad !== null && !value.targetLoadUnit && !(props.initial?.targetLoadUnit === null && value.targetLoad === props.initial.targetLoad)) { error.value = 'Selecciona la unidad de la carga objetivo.'; return }
  pending.value = true
  try { await props.save(parsed.data); emit('saved') } catch (cause) { error.value = workoutErrorMessage(cause, 'No se pudieron guardar los objetivos.') } finally { pending.value = false }
}
</script>
<template>
  <form class="plan-form training-editor" novalidate :aria-busy="pending" @submit.prevent="submit"><h4>Objetivos de esta sesión</h4><p>No modifican el plan ni representan series realizadas.</p><fieldset :disabled="pending || busy"><legend class="training-section-legend">Objetivos ajustados</legend><div class="plan-form-grid">
    <div><label class="field-label" :for="id+'-sets'">Series objetivo</label><input :id="id+'-sets'" v-model="fields.targetSets" class="form-control" type="number" min="1" max="1000" step="1"></div>
    <div><label class="field-label" :for="id+'-min'">Repeticiones mínimas</label><input :id="id+'-min'" v-model="fields.targetRepsMin" class="form-control" type="number" min="1" max="10000" step="1"></div>
    <div><label class="field-label" :for="id+'-max'">Repeticiones máximas</label><input :id="id+'-max'" v-model="fields.targetRepsMax" class="form-control" type="number" min="1" max="10000" step="1"><p class="field-hint">Para repeticiones exactas utiliza el mismo valor.</p></div>
    <div><label class="field-label" :for="id+'-load'">Carga objetivo</label><input :id="id+'-load'" v-model="fields.targetLoad" class="form-control" inputmode="decimal" placeholder="Ej. 77.5"></div>
    <div><label class="field-label" :for="id+'-unit'">Unidad</label><select :id="id+'-unit'" v-model="fields.targetLoadUnit" class="form-control"><option value="">Sin unidad conocida</option><option value="KG">kg</option><option value="LB">lb</option></select></div>
    <div><label class="field-label" :for="id+'-rpe'">RPE objetivo</label><input :id="id+'-rpe'" v-model="fields.targetRpe" class="form-control" type="number" min="0" max="10" step="0.1"></div>
  </div><label class="field-label" :for="id+'-notes'">Notas</label><textarea :id="id+'-notes'" v-model="fields.notes" class="form-control" maxlength="4000" /><p v-if="error" role="alert" class="form-error">{{ error }}</p><div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar objetivos' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cerrar</button></div></fieldset></form>
</template>
