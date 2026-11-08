import axios from 'axios'
import { computed, ref } from 'vue'
import { workoutSessionsService as service, workoutErrorMessage, type Workout, type WorkoutSummary, type WorkoutQuery, type SetInput, type WorkoutTargetsInput, type UpdateWorkout, type AddWorkoutExercise } from '../services/workout-sessions.service'

export function useWorkoutSessions() {
  const sessions = ref<WorkoutSummary[]>([])
  const total = ref(0)
  const offset = ref(0)
  const loading = ref(true)
  const error = ref('')
  let version = 0
  let controller: AbortController | undefined
  let active: Promise<void> | undefined
  let signature = ''
  let last: WorkoutQuery = {}
  function load(query: WorkoutQuery = last): Promise<void> {
    const key = JSON.stringify(query)
    if (active && signature === key) return active
    controller?.abort(); controller = new AbortController()
    const signal = controller.signal
    const current = ++version
    signature = key; last = { ...query }; loading.value = true; error.value = ''
    active = (async () => {
      try {
        const result = await service.list({ limit: 20, ...query }, signal)
        if (current === version) { sessions.value = result.items; total.value = result.total; offset.value = result.offset }
      } catch (cause) { if (current === version && !axios.isCancel(cause)) error.value = workoutErrorMessage(cause, 'No se pudieron cargar tus entrenamientos.') }
      finally { if (current === version) { loading.value = false; active = undefined } }
    })()
    return active
  }
  function dispose() { version++; controller?.abort() }
  return { sessions, total, offset, loading, error, load, dispose, previous: () => load({ ...last, offset: Math.max(0, offset.value - 20) }), next: () => load({ ...last, offset: offset.value + 20 }) }
}

export function useWorkoutSession() {
  const session = ref<Workout | null>(null)
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const notice = ref('')
  const editable = computed(() => Boolean(session.value && ['PLANNED', 'IN_PROGRESS'].includes(session.value.status)) && !loading.value)
  let version = 0
  let controller: AbortController | undefined
  async function load(id: string) {
    controller?.abort(); controller = new AbortController()
    const current = ++version
    session.value = null; loading.value = true; error.value = ''; notice.value = ''
    try { const result = await service.get(id, controller.signal); if (current === version) session.value = result }
    catch (cause) { if (current === version && !axios.isCancel(cause)) error.value = workoutErrorMessage(cause, 'No se pudo cargar el entrenamiento.') }
    finally { if (current === version) loading.value = false }
  }
  async function action(operation: (id: string) => Promise<Workout>) {
    if (!session.value || saving.value) throw new Error('Ya hay una operación en curso o no se ha cargado la sesión.')
    const current = version
    saving.value = true; notice.value = ''
    try { const result = await operation(session.value.id); if (current === version) { session.value = result; notice.value = 'Entrenamiento actualizado.' } }
    finally { saving.value = false }
  }
  function dispose() { version++; controller?.abort() }
  const revision = () => session.value?.version ?? 0
  return { session, loading, saving, editable, error, notice, load, dispose,
    update: (input: Omit<UpdateWorkout, 'expectedVersion'>) => action(id => service.update(id, { ...input, expectedVersion: revision() })),
    associate: (input: { trainingPlanId: string; planWeekId: string; planDayId: string }) => action(id => service.associate(id, { ...input, expectedVersion: revision() })),
    updateExercise: (exerciseId: string, input: Partial<WorkoutTargetsInput> & { isOmitted?: boolean }) => action(id => service.updateExercise(id, exerciseId, { ...input, expectedVersion: revision() })),
    reorder: (ids: string[]) => action(id => service.reorder(id, ids, revision())),
    importDay: (operationId: string) => action(id => service.importDay(id, operationId, revision(), session.value?.planDay?.id ?? '')),
    recordSet: (exerciseId: string, input: SetInput, setId?: string, expectedSetVersion?: number, creationId?: string) => action(id => setId
      ? service.updateSet(id, exerciseId, setId, { ...input, expectedVersion: revision(), expectedSetVersion: expectedSetVersion ?? 0 })
      : service.createSet(id, exerciseId, { ...input, id: creationId ?? crypto.randomUUID(), expectedVersion: revision() })),
    cancel: () => action(id => service.cancel(id, revision())),
    start: () => action(id => service.start(id, revision())), complete: (confirmWithoutResults = false) => action(id => service.complete(id, revision(), confirmWithoutResults)), addExercise: (input: AddWorkoutExercise) => action(id => service.addExercise(id, { ...input, expectedVersion: input.expectedVersion ?? revision() })) }
}
