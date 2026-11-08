<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { trainingPlansService, weekdayLabel, repsLabel, type Planning, type TrainingPlan } from '../../services/training-plans.service'
import { workoutErrorMessage } from '../../services/workout-sessions.service'
type DaySelection = { trainingPlanId: string; planWeekId: string; planDayId: string }
const props = defineProps<{ modelValue: DaySelection; disabled?: boolean; weekOnly?: boolean; draftOnly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: DaySelection]; 'next-position': [value: number] }>()
const id = useId()
const plans = ref<TrainingPlan[]>([])
const detail = ref<Planning | null>(null)
const loading = ref(false)
const error = ref('')
let version = 0
let controller: AbortController | undefined
const listController = new AbortController()
const week = computed(() => detail.value?.weeks.find(item => item.id === props.modelValue.planWeekId))
const day = computed(() => week.value?.days.find(item => item.id === props.modelValue.planDayId))
function choosePlan(value: string) { emit('update:modelValue', { trainingPlanId: value, planWeekId: '', planDayId: '' }) }
function chooseWeek(value: string) { emit('update:modelValue', { ...props.modelValue, planWeekId: value, planDayId: '' }) }
async function load() {
  controller?.abort(); controller = new AbortController(); const signal = controller.signal; const current = ++version
  detail.value = null; error.value = ''; loading.value = true
  try { if (props.modelValue.trainingPlanId) { const result = await trainingPlansService.getPlanning(props.modelValue.trainingPlanId, signal); if (current === version) detail.value = result } }
  catch (cause) { if (current === version && !signal.aborted) error.value = workoutErrorMessage(cause, 'No se pudo cargar la planificación.') }
  finally { if (current === version) loading.value = false }
}
async function loadPlans() {
  try { plans.value = await trainingPlansService.list(listController.signal) }
  catch (cause) { if (!listController.signal.aborted) error.value = workoutErrorMessage(cause, 'No se pudieron cargar tus planes.') }
}
watch(week, value => { if (value) emit('next-position', Math.max(0, ...value.days.map(day => day.position)) + 1) })
watch(() => props.modelValue.trainingPlanId, load, { immediate: true })
onMounted(loadPlans)
onUnmounted(() => { version++; controller?.abort(); listController.abort() })
</script>
<template>
  <div class="workout-day-selector">
    <label class="field-label" :for="id + '-plan'">Plan</label><select :id="id + '-plan'" :value="modelValue.trainingPlanId" class="form-control" :disabled="disabled" @change="choosePlan(($event.target as HTMLSelectElement).value)"><option value="">Selecciona un plan</option><option v-for="plan in plans.filter(item => (draftOnly ? item.status === 'DRAFT' : ['DRAFT', 'ACTIVE'].includes(item.status)))" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select>
    <p v-if="loading" role="status">Cargando planificación…</p>
    <label class="field-label" :for="id + '-week'">Semana</label><select :id="id + '-week'" :value="modelValue.planWeekId" class="form-control" :disabled="disabled || loading || !detail" @change="chooseWeek(($event.target as HTMLSelectElement).value)"><option value="">Selecciona una semana</option><option v-for="item in detail?.weeks ?? []" :key="item.id" :value="item.id">Semana {{ item.weekNumber }}{{ item.objective ? ' · ' + item.objective : '' }}</option></select>
    <template v-if="!weekOnly"><label class="field-label" :for="id + '-day'">Día o bloque</label><select :id="id + '-day'" :value="modelValue.planDayId" class="form-control" :disabled="disabled || !week" @change="emit('update:modelValue', { ...modelValue, planDayId: ($event.target as HTMLSelectElement).value })"><option value="">Selecciona un día</option><option v-for="item in week?.days ?? []" :key="item.id" :value="item.id">{{ item.name }} · {{ weekdayLabel(item.weekday) }}</option></select>
    <p v-if="week && !week.days.length" class="state-message">Esta semana no tiene días. Las prescripciones pendientes deben distribuirse desde Planes.</p>
    <div v-if="day" class="workout-preview"><h3>{{ day.name }}</h3><p>Solo se utilizarán los ejercicios de este día. Puedes entrenarlo en una fecha diferente.</p><ul><li v-for="item in day.exercises" :key="item.id">{{ item.exercise.name }} · {{ item.targetSets }} × {{ repsLabel(item) }}</li></ul><p v-if="!day.exercises.length">Este día no tiene prescripciones.</p></div>
    </template><p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-button" type="button" :disabled="disabled" @click="loadPlans(); load()">Reintentar</button></p>
  </div>
</template>
