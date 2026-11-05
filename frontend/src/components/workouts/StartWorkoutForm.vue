<script setup lang="ts">
import { repsLabel } from '../../services/training-plans.service'
import { onUnmounted, ref, useId, watch } from 'vue'
import { trainingPlansService, planStatusLabel, type TrainingPlan, type TrainingPlanDetail } from '../../services/training-plans.service'
import { createWorkoutSchema, workoutErrorMessage, type CreateWorkout } from '../../services/workout-sessions.service'
const props = defineProps<{ initialPlanId?: string; save: (input: CreateWorkout) => Promise<unknown> }>()
const emit = defineEmits<{ cancel: [] }>()
const id = useId()
const requestId = crypto.randomUUID()
const linked = ref(Boolean(props.initialPlanId))
const planId = ref(props.initialPlanId ?? '')
const weekId = ref('')
const notes = ref('')
const plans = ref<TrainingPlan[]>([])
const detail = ref<TrainingPlanDetail | null>(null)
const sourceLoading = ref(false)
const plansLoading = ref(false)
const sourceError = ref('')
const error = ref('')
const pending = ref(false)
const submitted = ref<CreateWorkout | null>(null)
const listController = new AbortController()
let controller: AbortController | undefined
let generation = 0
let plansLoaded = false
async function loadPlans() {
  if (plansLoaded || plansLoading.value) return
  plansLoading.value = true
  try { plans.value = await trainingPlansService.list(listController.signal); plansLoaded = true }
  catch (cause) { if (!listController.signal.aborted) sourceError.value = workoutErrorMessage(cause, 'No se pudieron cargar tus planes.') }
  finally { plansLoading.value = false }
}
async function loadWeekOptions() {
  controller?.abort(); controller = new AbortController()
  const current = ++generation
  weekId.value = ''; detail.value = null; sourceError.value = ''; sourceLoading.value = false
  if (!linked.value || !planId.value) return
  sourceLoading.value = true
  try { const result = await trainingPlansService.get(planId.value, controller.signal); if (current === generation) detail.value = result }
  catch (cause) { if (current === generation && !controller.signal.aborted) sourceError.value = workoutErrorMessage(cause, 'No se pudieron cargar las semanas.') }
  finally { if (current === generation) sourceLoading.value = false }
}
watch(linked, value => { if (value) void loadPlans(); void loadWeekOptions() }, { immediate: true })
watch(planId, () => void loadWeekOptions())
async function submit() {
  if (pending.value || sourceLoading.value || plansLoading.value) return
  error.value = ''
  if (!submitted.value) {
    const parsed = createWorkoutSchema.safeParse({ id: requestId, ...(linked.value ? { trainingPlanId: planId.value, planWeekId: weekId.value } : {}), notes: notes.value.trim() || null })
    if (!parsed.success) { error.value = 'Revisa el plan, la semana y las notas antes de iniciar.'; return }
    submitted.value = parsed.data
  }
  pending.value = true
  try { await props.save(submitted.value) }
  catch (cause) { error.value = workoutErrorMessage(cause, 'No se pudo iniciar el entrenamiento.') }
  finally { pending.value = false }
}
onUnmounted(() => { generation++; controller?.abort(); listController.abort() })
</script>

<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h2>Iniciar entrenamiento</h2>
    <fieldset :disabled="pending || Boolean(submitted)">
      <label class="field-label"><input v-model="linked" type="checkbox"> Usar un plan de entrenamiento</label>
      <template v-if="linked">
        <p v-if="plansLoading" class="state-message" role="status">Cargando planes…</p>
        <label class="field-label" :for="id + '-plan'">Plan</label><select :id="id + '-plan'" v-model="planId" class="form-control"><option value="">Selecciona un plan</option><option v-for="plan in plans" :key="plan.id" :value="plan.id" :disabled="!['DRAFT', 'ACTIVE'].includes(plan.status)">{{ plan.name }} · {{ planStatusLabel(plan.status) }}</option></select>
        <p v-if="sourceLoading" class="state-message" role="status">Cargando semanas…</p>
        <label class="field-label" :for="id + '-week'">Semana</label><select :id="id + '-week'" v-model="weekId" class="form-control" :disabled="sourceLoading || !detail"><option value="">Selecciona una semana</option><option v-for="week in detail?.weeks ?? []" :key="week.id" :value="week.id">Semana {{ week.weekNumber }}{{ week.objective ? ' · ' + week.objective : '' }}</option></select>
        <p v-if="detail && !detail.weeks.length" class="state-message">Este plan no tiene semanas. Crea una desde el detalle del plan.</p>
        <p v-if="sourceError" class="form-error" role="alert">{{ sourceError }} <button class="text-button" type="button" @click="loadPlans(); loadWeekOptions()">Reintentar</button></p>
        <div v-if="weekId" class="workout-preview"><h3>Ejercicios previstos</h3><p>Se incorporarán sin modificar las prescripciones del plan.</p><ul><li v-for="item in detail?.weeks.find(week => week.id === weekId)?.exercises ?? []" :key="item.id">{{ item.exercise.name }} · {{ item.targetSets }} × {{ repsLabel(item) }}</li></ul></div>
      </template>
      <label class="field-label" :for="id + '-notes'">Notas generales (opcional)</label><textarea :id="id + '-notes'" v-model="notes" class="form-control form-control--textarea" maxlength="4000" />
    </fieldset>
    <p v-if="submitted && error" class="field-hint">Los datos se conservan para reintentar la misma solicitud sin duplicarla. Comprueba el historial antes de iniciar otra.</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="plan-actions"><button class="primary-button" type="submit" :disabled="pending || sourceLoading || plansLoading">{{ pending ? 'Iniciando…' : submitted ? 'Reintentar inicio' : 'Iniciar entrenamiento' }}</button><button class="text-button" type="button" :disabled="pending" @click="emit('cancel')">Cerrar</button></div>
  </form>
</template>
