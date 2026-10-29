import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { useExercisesCatalog } from '../src/composables/useExercisesCatalog.ts'
import {
  exerciseErrorMessage,
  exerciseInputSchema,
  exercisesService,
} from '../src/services/exercises.service.ts'

const exerciseId = '20000000-0000-4000-8000-000000000001'
const firstExercise = {
  id: exerciseId, name: 'Press de banca con barra', description: 'Empuje horizontal con barra.',
  equipment: 'Barra olímpica y banco plano', equipmentType: 'BARBELL', machineType: null,
  resistanceType: 'FREE_WEIGHT', movementType: 'COMPOUND', movementPattern: 'HORIZONTAL_PUSH',
  grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE', laterality: 'BILATERAL',
  movementPlane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'SUITABLE',
  instructions: 'Mantén las escápulas estables.', origin: 'GLOBAL', isOwner: false,
  primaryMuscleGroup: { key: 'pectorales', name: 'Pectorales' },
  secondaryMuscleGroups: [{ key: 'triceps', name: 'Tríceps' }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

function page(items = [firstExercise], total = items.length, limit = 20, offset = 0) {
  return { items, total, limit, offset }
}
function response(config, data, status = 200) {
  return { config, data, status, statusText: 'OK', headers: {} }
}

installAuthInterceptors({
  getAccessToken: () => 'exercise-test-token',
  refreshSession: async () => {},
  clearSession: () => {},
})

test('requests the public paginated contract through the shared client', async () => {
  let request
  api.defaults.adapter = async (config) => {
    request = config
    return response(config, page([firstExercise], 41))
  }
  assert.deepEqual(await exercisesService.list(), page([firstExercise], 41))
  assert.equal(request.url, '/exercises')
  assert.deepEqual(request.params, { limit: 20, offset: 0 })
  assert.equal(request.headers.get('Authorization'), 'Bearer exercise-test-token')
})

test('sends filters and pages to the owner-only route', async () => {
  const calls = []
  const personal = { ...firstExercise, origin: 'PERSONAL', isOwner: true }
  api.defaults.adapter = async (config) => {
    calls.push(config)
    return response(config, page([personal], 1, 7, 14))
  }
  const result = await exercisesService.list({
    limit: 7, offset: 14, search: 'remo', primaryMuscleGroupKey: 'dorsales',
    equipmentType: 'CABLE', movementType: 'COMPOUND',
  }, 'mine')
  assert.equal(result.items[0].isOwner, true)
  assert.equal(calls[0].url, '/exercises/mine')
  assert.deepEqual(calls[0].params, {
    limit: 7, offset: 14, search: 'remo', primaryMuscleGroupKey: 'dorsales',
    equipmentType: 'CABLE', movementType: 'COMPOUND',
  })
})

test('rejects invalid parameters, paginated response mismatches, and internal response fields', async () => {
  let requests = 0
  api.defaults.adapter = async (config) => {
    requests += 1
    return response(config, page())
  }
  await assert.rejects(exercisesService.list({ limit: 0 }))
  await assert.rejects(exercisesService.list({ limit: 101 }))
  await assert.rejects(exercisesService.list({ offset: -1 }))
  await assert.rejects(exercisesService.list({ limit: 10, unknown: true }))
  await assert.rejects(exercisesService.list({ equipmentType: 'imaginary' }))
  assert.equal(requests, 0)
  api.defaults.adapter = async (config) => response(config, [firstExercise])
  await assert.rejects(exercisesService.list())
  api.defaults.adapter = async (config) => response(config, page([{ ...firstExercise, ownerId: 'secret' }]))
  await assert.rejects(exercisesService.list())
})

test('fetches muscle group options and exercise detail by UUID', async () => {
  const calls = []
  api.defaults.adapter = async (config) => {
    calls.push(config)
    if (config.url === '/exercises/muscle-groups') {
      return response(config, [{ key: 'pectorales', name: 'Pectorales', description: null }])
    }
    return response(config, firstExercise)
  }
  assert.deepEqual(await exercisesService.listMuscleGroups(), [{ key: 'pectorales', name: 'Pectorales', description: null }])
  assert.deepEqual(await exercisesService.getById(exerciseId), firstExercise)
  await assert.rejects(exercisesService.getById('bad-id'))
  assert.equal(calls.length, 2)
})

test('creates, updates, and retires a personal exercise through authenticated endpoints', async () => {
  const calls = []
  const created = { ...firstExercise, origin: 'PERSONAL', isOwner: true }
  api.defaults.adapter = async (config) => {
    calls.push(config)
    if (config.method === 'post') return response(config, created, 201)
    if (config.method === 'patch') return response(config, { ...created, name: 'Actualizado' })
    return response(config, { deactivated: true })
  }
  const input = {
    name: 'Ejercicio propio', primaryMuscleGroupKey: 'pectorales', secondaryMuscleGroupKeys: ['triceps'],
    equipment: 'Mancuernas', equipmentType: 'DUMBBELL', resistanceType: null, description: null,
  }
  await exercisesService.create(input)
  await exercisesService.update(exerciseId, { name: 'Actualizado' })
  await exercisesService.deactivate(exerciseId)
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['post', '/exercises'], ['patch', '/exercises/' + exerciseId], ['delete', '/exercises/' + exerciseId],
  ])
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer exercise-test-token')
  assert.equal(calls[0].data.ownerId, undefined)
  assert.throws(() => exerciseInputSchema.parse({ ...input, ownerId: 'untrusted' }))
  assert.throws(() => exerciseInputSchema.parse({ ...input, secondaryMuscleGroupKeys: ['pectorales'] }))
})

test('translates missing resources, connection errors, and server failures', () => {
  const notFound = new AxiosError('Not found', AxiosError.ERR_BAD_REQUEST, undefined, undefined, response({}, {}, 404))
  const serverError = new AxiosError('Server error', AxiosError.ERR_BAD_RESPONSE, undefined, undefined, response({}, {}, 503))
  assert.match(exerciseErrorMessage(notFound, 'fallback'), /No se encontró el ejercicio/)
  assert.match(exerciseErrorMessage({ isAxiosError: true }, 'fallback'), /No se pudo conectar/)
  assert.match(exerciseErrorMessage(serverError, 'fallback'), /no está disponible/)
})

test('regression: an initial failure clears loading and can be retried', async () => {
  const catalog = useExercisesCatalog()
  let requests = 0
  assert.equal(catalog.loading.value, true)
  api.defaults.adapter = async (config) => {
    requests += 1
    const failedResponse = response(config, { message: 'unavailable' }, 503)
    throw new AxiosError('Unavailable', AxiosError.ERR_BAD_RESPONSE, config, undefined, failedResponse)
  }
  await catalog.load({}, 'global', 0)
  assert.equal(requests, 1)
  assert.equal(catalog.loading.value, false)
  assert.match(catalog.errorMessage.value, /no está disponible/)
  api.defaults.adapter = async (config) => {
    requests += 1
    return response(config, page([], 0))
  }
  await catalog.retry()
  assert.equal(requests, 2)
  assert.equal(catalog.loading.value, false)
  assert.deepEqual(catalog.exercises.value, [])
  assert.equal(catalog.errorMessage.value, '')
})

test('coalesces concurrent requests with the same catalog parameters', async () => {
  const catalog = useExercisesCatalog()
  let requests = 0
  api.defaults.adapter = async (config) => {
    requests += 1
    return response(config, page([], 0))
  }
  await Promise.all([
    catalog.load({ search: 'press' }, 'global'),
    catalog.load({ search: 'press' }, 'global'),
  ])
  assert.equal(requests, 1)
  assert.equal(catalog.loading.value, false)
})

test('an older request cannot overwrite newer filter results', async () => {
  const catalog = useExercisesCatalog()
  const originalList = exercisesService.list
  let resolveOld
  let resolveNew
  let calls = 0
  exercisesService.list = () => new Promise((resolve) => {
    calls += 1
    if (calls === 1) resolveOld = resolve
    else resolveNew = resolve
  })
  const oldRequest = catalog.load({ search: 'press' }, 'global')
  const newRequest = catalog.load({ search: 'remo' }, 'global')
  resolveNew(page([], 0))
  await newRequest
  resolveOld(page([firstExercise], 1))
  await oldRequest
  exercisesService.list = originalList
  assert.equal(catalog.exercises.value.length, 0)
  assert.equal(catalog.total.value, 0)
  assert.equal(catalog.loading.value, false)
})

after(() => {
  api.defaults.adapter = undefined
})
