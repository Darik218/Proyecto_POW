import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { workoutSessionsService as service, createWorkoutSchema, addWorkoutExerciseSchema, workoutErrorMessage, workoutStatusLabel } from '../src/services/workout-sessions.service.ts'
import { useWorkoutSession, useWorkoutSessions } from '../src/composables/useWorkoutSessions.ts'
import { id, intent, exerciseId, operationId, summary, detail, exercise, response } from './workout-sessions.fixtures.mjs'

installAuthInterceptors({ getSessionGeneration: () => 0, getAccessToken: () => 'memory-workout-access', refreshSession: async () => { throw new Error('Expired') }, clearSession: () => {} })
const fail = (config, status) => new AxiosError('HTTP', AxiosError.ERR_BAD_RESPONSE, config, undefined, response(config, {}, status))
test('uses authenticated paginated reads and explicit lifecycle endpoints', async () => {
  const calls = []
  api.defaults.adapter = async config => { calls.push(config); return response(config, config.url === '/workout-sessions' ? { items: [summary], total: 1, limit: 20, offset: 0 } : detail) }
  await service.list({ status: 'IN_PROGRESS' }); await service.get(id); await service.start(id); await service.complete(id)
  assert.deepEqual(calls[0].params, { limit: 20, offset: 0, status: 'IN_PROGRESS' })
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer memory-workout-access')
  assert.deepEqual(calls.slice(2).map(c => [c.url, JSON.parse(c.data)]), [[`/workout-sessions/${id}/start`, { expectedVersion: 0 }], [`/workout-sessions/${id}/complete`, { expectedVersion: 0, confirmWithoutResults: false }]])
})
test('retains creation identifiers in retries and accepts the direct detail contract', async () => {
  const calls = []
  api.defaults.adapter = async config => { calls.push(config); return response(config, detail) }
  const input = { ...intent, notes: 'Inicio' }
  await service.create(input); await service.create(input)
  await service.addExercise(id, { id: operationId, exerciseId })
  assert.equal(JSON.parse(calls[0].data).id, JSON.parse(calls[1].data).id)
  assert.deepEqual(JSON.parse(calls[2].data), { id: operationId, exerciseId, expectedVersion: 0 })
})
test('rejects unmatched sources, owners, lifecycle and F07 fields before HTTP', async () => {
  assert.equal(createWorkoutSchema.safeParse({ id, trainingPlanId: id }).success, false)
  assert.equal(createWorkoutSchema.safeParse({ ...intent, trainingPlanId: id, planWeekId: operationId, planDayId: exerciseId }).success, true)
  for (const fields of [{ athleteId: id }, { status: 'COMPLETED' }, { startedAt: '2026-01-01' }, { repetitions: 8 }]) assert.equal(createWorkoutSchema.safeParse({ id, ...fields }).success, false)
  assert.equal(addWorkoutExerciseSchema.safeParse({ id, exerciseId, rpe: 8 }).success, false)
  assert.equal(addWorkoutExerciseSchema.safeParse({ id, exerciseId, notes: 'x'.repeat(4001) }).success, false)
  let calls = 0
  api.defaults.adapter = async config => { calls++; return response(config, detail) }
  await assert.rejects(service.get('invalid'))
  await assert.rejects(service.list({ limit: 101 }))
  await assert.rejects(service.create({ id, athleteId: id }))
  assert.equal(calls, 0)
})
test('invalid responses and HTTP errors are visible and do not become empty success', async () => {
  api.defaults.adapter = async config => response(config, [])
  await assert.rejects(service.list())
  assert.match(workoutErrorMessage(fail({}, 401), ''), /acceso expiró/)
  assert.match(workoutErrorMessage(fail({}, 404), ''), /acceso/)
  assert.match(workoutErrorMessage(fail({}, 409), ''), /no admiten/)
  assert.match(workoutErrorMessage(new AxiosError('network'), ''), /misma solicitud/)
  assert.equal(workoutStatusLabel('CANCELLED'), 'Cancelada')
})
test('empty and failed lists finish loading and allow retry with filters', async () => {
  const state = useWorkoutSessions()
  api.defaults.adapter = async config => { throw fail(config, 503) }
  await state.load({ status: 'COMPLETED' })
  assert.equal(state.loading.value, false); assert.notEqual(state.error.value, '')
  api.defaults.adapter = async config => { assert.equal(config.params.status, 'COMPLETED'); return response(config, { items: [], total: 0, limit: 20, offset: 0 }) }
  await state.load()
  assert.equal(state.error.value, ''); assert.deepEqual(state.sessions.value, [])
})
test('deduplicates list requests and ignores obsolete responses', async () => {
  const original = service.list
  let first, second, calls = 0
  service.list = () => new Promise(resolve => { calls++; if (calls === 1) first = resolve; else second = resolve })
  try {
    const state = useWorkoutSessions()
    const old = state.load({ status: 'IN_PROGRESS' }); const duplicate = state.load({ status: 'IN_PROGRESS' })
    assert.equal(calls, 1)
    const current = state.load({ status: 'COMPLETED' })
    second({ items: [], total: 0, limit: 20, offset: 0 }); await current
    first({ items: [summary], total: 1, limit: 20, offset: 0 }); await Promise.all([old, duplicate])
    assert.deepEqual(state.sessions.value, []); assert.equal(state.loading.value, false)
  } finally { service.list = original }
})
test('detail state changes only after a validated response and resets after failed actions', async () => {
  const state = useWorkoutSession()
  api.defaults.adapter = async config => response(config, detail)
  await state.load(id); assert.equal(state.editable.value, true)
  api.defaults.adapter = async config => { throw fail(config, 409) }
  await assert.rejects(state.complete())
  assert.equal(state.session.value.status, 'IN_PROGRESS'); assert.equal(state.saving.value, false); assert.equal(state.notice.value, '')
  api.defaults.adapter = async config => response(config, { ...detail, exerciseCount: 1, exercises: [exercise], status: 'COMPLETED', finishedAt: '2026-11-05T13:00:00.000Z' })
  await state.complete()
  assert.equal(state.session.value.status, 'COMPLETED'); assert.equal(state.editable.value, false); assert.notEqual(state.notice.value, '')
})
test('a delayed detail response cannot restore a previous session', async () => {
  const original = service.get
  let finish
  service.get = key => key === id ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ...detail, id: operationId })
  try {
    const state = useWorkoutSession(); const old = state.load(id)
    await state.load(operationId); finish(detail); await old
    assert.equal(state.session.value.id, operationId)
  } finally { service.get = original }
})
after(() => { api.defaults.adapter = undefined })
