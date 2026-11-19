<script setup lang="ts">
import { computed, reactive, ref, useId } from 'vue'
import WeekForm from './WeekForm.vue'
import PlanDayForm from './PlanDayForm.vue'
import PlanDayCard from './PlanDayCard.vue'
import { createPlanWeekSchema, repsLabel, trainingPlanErrorMessage, type PlanningWeek } from '../../services/training-plans.service'
import type { useTrainingPlan } from '../../composables/useTrainingPlans'
const props = defineProps<{ week: PlanningWeek; editable: boolean; busy: boolean; nextWeekNumber: number; actions: ReturnType<typeof useTrainingPlan> }>()
const days=computed(()=>props.week.days.filter(d=>!d.retiredAt))
const id = useId()
const editingWeek = ref(false)
const addingDay = ref(false)
const copyNumber = ref(String(props.nextWeekNumber))
const destinations = reactive<Record<string, string>>({})
const error = ref('')
async function run(operation: () => Promise<unknown>) {
  if (props.busy) return
  error.value = ''
  try { await operation() } catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo realizar el cambio.') }
}
function duplicateWeek() {
  const parsed = createPlanWeekSchema.safeParse({ weekNumber: Number(copyNumber.value) })
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa el número de semana.'; return }
  return run(() => props.actions.copyWeek(props.week.id, parsed.data.weekNumber))
}
function move(dayId: string, direction: number) {
  const ids = days.value.map(item => item.id)
  const from = ids.indexOf(dayId)
  const to = from + direction
  if (to < 0 || to >= ids.length) return
  ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
  return run(() => props.actions.reorderDays(props.week.id, ids))
}
function distribute(prescriptionId: string, copy: boolean) {
  const day = props.week.days.find(item => item.id === destinations[prescriptionId])
  if (!day) { error.value = 'Selecciona un día de destino.'; return }
  return run(() => props.actions.distribute(props.week.id, prescriptionId, day.id, Math.max(0, ...day.exercises.map(item => item.position)) + 1, copy))
}
</script>
<template>
  <article class="plan-week-card">
    <header class="plan-section-heading"><h2>Semana {{ week.weekNumber }}</h2><button v-if="editable" class="text-button" type="button" :disabled="busy" @click="editingWeek = !editingWeek">{{ editingWeek ? 'Cerrar edición' : 'Editar semana' }}</button></header>
    <p v-if="week.objective" class="plan-copy">{{ week.objective }}</p>
    <WeekForm v-if="editable && editingWeek" :initial="week" :busy="busy" :save="input => actions.updateWeek(week.id, input)" @saved="editingWeek = false" @cancel="editingWeek = false" />
    <div v-if="editable" class="plan-actions"><label class="field-label" :for="id + '-copy'">Número de la nueva semana</label><input :id="id + '-copy'" v-model="copyNumber" class="form-control copy-week-number" type="number" min="1" max="520" step="1" :disabled="busy"><button class="secondary-button" type="button" :disabled="busy" @click="duplicateWeek">Duplicar semana completa</button></div>
    <p v-if="!week.days.length" class="state-message">Esta semana todavía no tiene días de entrenamiento.</p>
    <div v-for="(day, index) in days" :key="day.id" class="plan-day-group">
      <div v-if="editable" class="plan-actions"><button class="text-button" type="button" :aria-label="'Subir día ' + day.name" :disabled="busy || days.some(item => item.hasHistory) || index === 0" @click="move(day.id, -1)">↑ Subir día</button><button class="text-button" type="button" :aria-label="'Bajar día ' + day.name" :disabled="busy || days.some(item => item.hasHistory) || index === days.length - 1" @click="move(day.id, 1)">↓ Bajar día</button></div>
      <PlanDayCard :day="day" :week-id="week.id" :editable="editable" :busy="busy" :copy-position="Math.max(0, ...week.days.map(item => item.position)) + 1" :actions="actions" />
    </div>
    <button v-if="editable && !addingDay" class="secondary-button" type="button" :disabled="busy" @click="addingDay = true">Crear día o bloque</button>
    <PlanDayForm v-if="editable && addingDay" :busy="busy" :next-position="Math.max(0, ...week.days.map(item => item.position)) + 1" :save="input => actions.createDay(week.id, input as Parameters<typeof actions.createDay>[1])" @saved="addingDay = false" @cancel="addingDay = false" />
    <section v-if="week.pendingExercises.length" class="pending-prescriptions" :aria-labelledby="id + '-pending'">
      <h3 :id="id + '-pending'">Prescripciones antiguas pendientes de distribuir</h3><p>Estas prescripciones conservan su identidad y no están asignadas a un día. Las que tienen historial solo pueden copiarse.</p>
      <ul class="prescription-list"><li v-for="item in week.pendingExercises" :key="item.id"><h4>{{ item.exercise.name }}</h4><p>{{ item.targetSets }} series × {{ repsLabel(item) }} repeticiones · {{ item.targetLoad === null ? 'Sin carga' : item.targetLoad + ' ' + (item.targetLoadUnit ?? '(unidad desconocida)') }}</p><p v-if="item.hasHistory" class="field-hint">Con historial: el original permanecerá aquí al copiarlo.</p>
        <div v-if="editable" class="plan-actions"><label class="field-label" :for="id + item.id">Día de destino</label><select :id="id + item.id" v-model="destinations[item.id]" class="form-control"><option value="">Selecciona un día</option><option v-for="day in week.days" :key="day.id" :value="day.id">{{ day.name }}</option></select><button v-if="!item.hasHistory" class="secondary-button" type="button" :disabled="busy || !destinations[item.id]" @click="distribute(item.id, false)">Mover al día</button><button class="secondary-button" type="button" :disabled="busy || !destinations[item.id]" @click="distribute(item.id, true)">Copiar al día</button></div>
      </li></ul>
    </section>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </article>
</template>
