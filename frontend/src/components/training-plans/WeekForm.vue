<script setup lang="ts">
import { ref, useId } from 'vue'
import { createPlanWeekSchema, updatePlanWeekSchema, trainingPlanErrorMessage, type PlanWeek } from '../../services/training-plans.service'
const props = defineProps<{ initial?: Pick<PlanWeek, 'id' | 'weekNumber' | 'objective' | 'startsOn'>; nextNumber?: number; busy?: boolean; save: (input: { weekNumber: number; startsOn?: string | null; objective?: string | null }) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const number = ref(String(props.initial?.weekNumber ?? props.nextNumber ?? 1))
const startsOn = ref(props.initial?.startsOn?.slice(0, 10) ?? '')
const objective = ref(props.initial?.objective ?? '')
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  const value = { weekNumber: Number(number.value), ...(startsOn.value ? { startsOn: startsOn.value } : props.initial?.startsOn ? { startsOn: null } : {}), ...(objective.value.trim() ? { objective: objective.value.trim() } : props.initial ? { objective: null } : {}) }
  const parsed = (props.initial ? updatePlanWeekSchema : createPlanWeekSchema).safeParse(value)
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los campos.'; return }
  pending.value = true
  try { await props.save(value); emit('saved') }
  catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo guardar la semana.') }
  finally { pending.value = false }
}
</script>

<template>
  <form class="plan-form training-editor" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h2>{{ initial ? 'Editar semana' : 'Nueva semana' }}</h2>
    <fieldset :disabled="pending || busy"><legend class="training-section-legend">Semana y objetivo</legend>
      <label class="field-label" :for="id + '-number'">Número de semana</label><input :id="id + '-number'" v-model="number" class="form-control" type="number" min="1" max="520" step="1" required>
      <label class="field-label" :for="id + '-starts'">Inicio de la semana en el calendario (opcional)</label><input :id="id + '-starts'" v-model="startsOn" class="form-control" type="date"><p class="field-hint">Define un intervalo de siete días para sugerir entrenamientos por fecha. El número de semana no asigna fechas.</p>
      <label class="field-label" :for="id + '-objective'">Objetivo (opcional)</label><textarea :id="id + '-objective'" v-model="objective" class="form-control form-control--textarea" maxlength="4000" />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar semana' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cancelar</button></div>
    </fieldset>
  </form>
</template>
