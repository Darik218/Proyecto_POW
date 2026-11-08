<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { computed, ref } from 'vue'
import PlanDayForm from './PlanDayForm.vue'
import PrescriptionForm from './PrescriptionForm.vue'
import { repsLabel, weekdayLabel, trainingPlanErrorMessage, type PlanDay, type CreateDailyPrescription, type UpdateDailyPrescription } from '../../services/training-plans.service'
import type { useTrainingPlan } from '../../composables/useTrainingPlans'
const props = defineProps<{ day: PlanDay; weekId: string; editable: boolean; busy: boolean; copyPosition: number; actions: ReturnType<typeof useTrainingPlan> }>()
const sessionLink = computed(() => !props.day.retiredAt && props.actions.plan?.value ? {name:'routine-day',params:{planId:props.actions.plan.value.id,weekId:props.weekId,dayId:props.day.id}} : null)
const editing = ref(false)
const adding = ref(false)
const editingPrescription = ref('')
const removing = ref('')
const error = ref('')
async function run(operation: () => Promise<unknown>) {
  if (props.busy) return
  error.value = ''
  try { await operation(); removing.value = '' } catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo guardar el cambio.') }
}
function move(id: string, direction: number) {
  const ids = props.day.exercises.map(item => item.id)
  const from = ids.indexOf(id)
  const to = from + direction
  if (to < 0 || to >= ids.length) return
  ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
  return run(() => props.actions.reorderExercises(props.weekId, props.day.id, ids))
}
function save(input: CreateDailyPrescription | UpdateDailyPrescription, id?: string) {
  return props.actions.saveDailyPrescription(props.weekId, props.day.id, input, id)
}
</script>
<template>
  <article class="plan-day-card">
    <header class="plan-section-heading"><div><h3>{{ day.position }}. {{ day.name }}</h3><span class="plan-status">{{ weekdayLabel(day.weekday) }}{{ day.weekday ? ' · Fijo' : '' }}</span></div><div v-if="editable" class="plan-actions"><button class="text-button" type="button" :disabled="busy || day.hasHistory" @click="editing = !editing">Editar día</button><button class="secondary-button" type="button" :disabled="busy || copyPosition > 1000" @click="run(() => actions.copyDay(weekId, day.id, copyPosition))">Duplicar día</button></div></header>
    <RouterLink v-if="sessionLink" class="back-link" :to="sessionLink">Abrir día y entrenar →</RouterLink>
    <p v-if="day.hasHistory" class="field-hint">Con historial: conserva su programación. Duplica el día para realizar cambios.</p>
    <PlanDayForm v-if="editing && editable" :initial="day" :busy="busy" :save="input => actions.updateDay(weekId, day.id, input)" @saved="editing = false" @cancel="editing = false" />
    <p v-if="!day.exercises.length" class="state-message">Este día todavía no tiene ejercicios prescritos.</p>
    <ol v-else class="prescription-list">
      <li v-for="(item, index) in day.exercises" :key="item.id">
        <h4>{{ item.position }}. {{ item.exercise.name }}</h4><p class="field-hint">{{ item.exercise.muscleGroup }} · {{ item.exercise.equipment }}</p>
        <dl class="prescription-values"><div><dt>Series</dt><dd>{{ item.targetSets }}</dd></div><div><dt>Repeticiones</dt><dd>{{ repsLabel(item) }}</dd></div><div><dt>Carga objetivo</dt><dd>{{ item.targetLoad === null ? 'Sin especificar' : item.targetLoad + ' ' + (item.targetLoadUnit ?? '(unidad desconocida)') }}</dd></div><div><dt>RPE objetivo</dt><dd>{{ item.targetRpe ?? 'Sin especificar' }}</dd></div></dl>
        <p v-if="item.notes" class="plan-copy">{{ item.notes }}</p><p v-if="item.hasHistory" class="field-hint">Prescripción protegida por historial.</p>
        <div v-if="editable" class="plan-actions"><button class="text-button" type="button" :disabled="busy || item.hasHistory" @click="editingPrescription = item.id">Editar objetivos</button><button class="text-button" type="button" :aria-label="'Subir ' + item.exercise.name" :disabled="busy || day.hasHistory || index === 0" @click="move(item.id, -1)">↑ Subir</button><button class="text-button" type="button" :aria-label="'Bajar ' + item.exercise.name" :disabled="busy || day.hasHistory || index === day.exercises.length - 1" @click="move(item.id, 1)">↓ Bajar</button><button class="text-button" type="button" :disabled="busy || item.hasHistory" @click="removing = item.id">Quitar prescripción</button></div>
        <div v-if="removing === item.id" class="plan-actions"><p>¿Quitar esta prescripción de la planificación?</p><button class="secondary-button" type="button" :disabled="busy" @click="run(() => actions.removePrescription(weekId, day.id, item.id))">Confirmar</button><button class="text-button" type="button" @click="removing = ''">Cancelar</button></div>
        <PrescriptionForm v-if="editable && editingPrescription === item.id" daily :initial="item" :busy="busy" :save="input => save(input, item.id)" @saved="editingPrescription = ''" @cancel="editingPrescription = ''" />
      </li>
    </ol>
    <button v-if="editable && !adding" class="secondary-button" type="button" :disabled="busy" @click="adding = true">Añadir ejercicio a este día</button>
    <PrescriptionForm v-if="editable && adding" daily :busy="busy" :next-position="Math.max(0, ...day.exercises.map(item => item.position)) + 1" :save="input => save(input)" @saved="adding = false" @cancel="adding = false" />
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </article>
</template>
