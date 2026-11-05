import axios from 'axios'
import { computed, ref } from 'vue'
import { workoutSessionsService as service, workoutErrorMessage, type Workout, type WorkoutSummary, type WorkoutQuery, type AddWorkoutExercise } from '../services/workout-sessions.service'

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
  const editable = computed(() => session.value?.status === 'IN_PROGRESS' && !loading.value)
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
  return { session, loading, saving, editable, error, notice, load, dispose, start: () => action(id => service.start(id)), complete: () => action(id => service.complete(id)), addExercise: (input: AddWorkoutExercise) => action(id => service.addExercise(id, input)) }
}
