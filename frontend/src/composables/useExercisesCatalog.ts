import axios from 'axios'
import { ref } from 'vue'
import {
  exerciseErrorMessage,
  exercisesService,
  listExercisesQuerySchema,
  type Exercise,
  type ExerciseScope,
  type ListExercisesQuery,
} from '../services/exercises.service'

export const exercisePageSize = 20
type CatalogFilters = Omit<ListExercisesQuery, 'limit' | 'offset'>

export function useExercisesCatalog() {
  const exercises = ref<Exercise[]>([])
  const offset = ref(0)
  const total = ref(0)
  const scope = ref<ExerciseScope>('global')
  const query = ref<CatalogFilters>({})
  const loading = ref(true)
  const errorMessage = ref('')
  let latestRequest = 0
  let activeController: AbortController | undefined
  let activeSignature = ''
  let activePromise: Promise<void> | undefined
  let successfulSignature = ''
  let lastRequest: { scope: ExerciseScope; query: CatalogFilters; offset: number } = {
    scope: 'global',
    query: {},
    offset: 0,
  }

  async function load(
    filters: CatalogFilters = query.value,
    selectedScope: ExerciseScope = scope.value,
    nextOffset = 0,
    force = false,
  ): Promise<void> {
    const parsed = listExercisesQuerySchema.safeParse({ ...filters, limit: exercisePageSize, offset: nextOffset })
    if (!parsed.success) {
      errorMessage.value = 'Los filtros del catálogo no son válidos.'
      loading.value = false
      return
    }
    const signature = JSON.stringify({ scope: selectedScope, ...parsed.data })
    lastRequest = { scope: selectedScope, query: filters, offset: nextOffset }
    if (!force && signature === successfulSignature && !loading.value) return
    if (!force && signature === activeSignature && activePromise) return activePromise

    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    activeSignature = signature
    const requestId = ++latestRequest
    scope.value = selectedScope
    query.value = filters
    loading.value = true
    errorMessage.value = ''

    const requestPromise = (async () => {
      try {
        const result = await exercisesService.list(parsed.data, selectedScope, controller.signal)
        if (requestId !== latestRequest) return
        exercises.value = result.items
        total.value = result.total
        offset.value = result.offset
        successfulSignature = signature
      } catch (error) {
        if (requestId === latestRequest && !axios.isCancel(error)) {
          errorMessage.value = exerciseErrorMessage(error, 'No se pudo cargar el catálogo.')
        }
      } finally {
        if (requestId === latestRequest) {
          loading.value = false
          activeController = undefined
          activeSignature = ''
          activePromise = undefined
        }
      }
    })()
    activePromise = requestPromise
    return requestPromise
  }

  function retry(): Promise<void> {
    return load(lastRequest.query, lastRequest.scope, lastRequest.offset, true)
  }

  function refresh(): Promise<void> {
    return load(query.value, scope.value, offset.value, true)
  }

  function previousPage(): Promise<void> {
    if (offset.value === 0) return Promise.resolve()
    return load(query.value, scope.value, Math.max(0, offset.value - exercisePageSize))
  }

  function nextPage(): Promise<void> {
    if (offset.value + exercises.value.length >= total.value) return Promise.resolve()
    return load(query.value, scope.value, offset.value + exercisePageSize)
  }

  function dispose(): void {
    latestRequest += 1
    activeController?.abort()
    activeController = undefined
    activePromise = undefined
    activeSignature = ''
  }

  return {
    exercises,
    offset,
    total,
    scope,
    query,
    pageSize: exercisePageSize,
    loading,
    errorMessage,
    load,
    retry,
    refresh,
    previousPage,
    nextPage,
    dispose,
  }
}
