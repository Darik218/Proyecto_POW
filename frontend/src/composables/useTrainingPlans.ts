import axios from 'axios'
import { computed, ref } from 'vue'
import {
  trainingPlansService, trainingPlanErrorMessage,
  type TrainingPlan, type Planning, type CreatePlanDay, type UpdatePlanDay, type CreateDailyPrescription, type UpdateDailyPrescription, type CreateTrainingPlan, type UpdateTrainingPlan,
  type CreatePlanWeek, type UpdatePlanWeek,
} from '../services/training-plans.service'

export function useTrainingPlans() {
  const plans = ref<TrainingPlan[]>([])
  const loading = ref(true)
  const creating = ref(false)
  const error = ref('')
  let active: Promise<void> | undefined
  let controller: AbortController | undefined
  let disposed = false
  function load(): Promise<void> {
    if (active) return active
    controller = new AbortController()
    loading.value = true
    error.value = ''
    active = (async () => {
      try {
        const result = await trainingPlansService.list(controller?.signal)
        if (!disposed) plans.value = result
      } catch (cause) {
        if (!disposed && !axios.isCancel(cause)) error.value = trainingPlanErrorMessage(cause, 'No se pudieron cargar tus planes.')
      } finally {
        if (!disposed) loading.value = false
        active = undefined
      }
    })()
    return active
  }
  async function create(input: CreateTrainingPlan): Promise<TrainingPlan | undefined> {
    if (creating.value) return
    creating.value = true
    try {
      const created = await trainingPlansService.create(input)
      if (!disposed) plans.value = [created, ...plans.value].sort((a, b) => b.startsOn.localeCompare(a.startsOn) || b.id.localeCompare(a.id))
      return created
    } finally { creating.value = false }
  }
  function dispose() { disposed = true; controller?.abort() }
  return { plans, loading, creating, error, load, create, dispose }
}

export function useTrainingPlan() {
  const plan = ref<Planning | null>(null)
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const notice = ref('')
  const editable = computed(() => plan.value?.status === 'DRAFT' && !loading.value)
  let version = 0
  let controller: AbortController | undefined
  let pendingId = ''
  let pending: Promise<void> | undefined
  function load(id: string): Promise<void> {
    if (pending && pendingId === id) return pending
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const current = ++version
    pendingId = id
    plan.value = null
    loading.value = true
    error.value = ''
    notice.value = ''
    pending = (async () => {
      try {
        const result = await trainingPlansService.getPlanning(id, signal)
        if (current === version) plan.value = result
      } catch (cause) {
        if (current === version && !axios.isCancel(cause)) error.value = trainingPlanErrorMessage(cause, 'No se pudo cargar el plan.')
      } finally {
        if (current === version) { loading.value = false; pending = undefined }
      }
    })()
    return pending
  }
  async function mutate<T>(operation: (id: string) => Promise<T>, apply: (result: T, current: Planning) => void) {
    if (saving.value) throw new Error('Ya hay un cambio en curso.')
    if (!plan.value || !editable.value) throw new Error('Solo se pueden editar planes en borrador.')
    const id = plan.value.id
    const current = version
    saving.value = true
    notice.value = ''
    try {
      const result = await operation(id)
      if (current === version && plan.value?.id === id) {
        apply(result, plan.value)
        notice.value = 'Los cambios se guardaron correctamente.'
      }
    } finally { saving.value = false }
  }
  function update(input: UpdateTrainingPlan) {
    return mutate((id) => trainingPlansService.update(id, input), (result, current) => Object.assign(current, result))
  }
  function createWeek(input: CreatePlanWeek) {
    return mutate((id) => trainingPlansService.createWeek(id, input), (result, current) => {
      current.weeks.push({ ...result, days: [], pendingExercises: [] })
      current.weeks.sort((a, b) => a.weekNumber - b.weekNumber)
    })
  }
  function updateWeek(weekId: string, input: UpdatePlanWeek) {
    return mutate((id) => trainingPlansService.updateWeek(id, weekId, input), (result, current) => {
      const week = current.weeks.find((item) => item.id === weekId)
      if (week) Object.assign(week, result)
      current.weeks.sort((a, b) => a.weekNumber - b.weekNumber)
    })
  }
  function change(operation: (id: string) => Promise<Planning>) {
    return mutate(operation, (result, current) => Object.assign(current, result))
  }
  const createDay = (weekId: string, input: CreatePlanDay) => change(id => trainingPlansService.createDay(id, weekId, input))
  const updateDay = (weekId: string, dayId: string, input: UpdatePlanDay) => change(id => trainingPlansService.updateDay(id, weekId, dayId, input))
  const reorderDays = (weekId: string, ids: string[]) => change(id => trainingPlansService.reorderDays(id, weekId, ids))
  const copyDay = (weekId: string, dayId: string, position: number) => change(id => trainingPlansService.copyDay(id, weekId, dayId, position))
  const copyWeek = (weekId: string, weekNumber: number) => change(id => trainingPlansService.copyWeek(id, weekId, weekNumber))
  const saveDailyPrescription = (weekId: string, dayId: string, input: CreateDailyPrescription | UpdateDailyPrescription, prescriptionId?: string) => change(id => prescriptionId
    ? trainingPlansService.updateDailyPrescription(id, weekId, dayId, prescriptionId, input)
    : trainingPlansService.createDailyPrescription(id, weekId, dayId, input as CreateDailyPrescription))
  const removePrescription = (weekId: string, dayId: string, prescriptionId: string) => change(id => trainingPlansService.removeDailyPrescription(id, weekId, dayId, prescriptionId))
  const reorderExercises = (weekId: string, dayId: string, ids: string[]) => change(id => trainingPlansService.reorderExercises(id, weekId, dayId, ids))
  const distribute = (weekId: string, prescriptionId: string, dayId: string, position: number, copy: boolean) => change(id => trainingPlansService.distribute(id, weekId, prescriptionId, dayId, position, copy))
  function dispose() { version++; controller?.abort() }
  return { plan, loading, saving, editable, error, notice, load, update, createWeek, updateWeek, createDay, updateDay, reorderDays, copyDay, copyWeek, saveDailyPrescription, removePrescription, reorderExercises, distribute, dispose }
}
