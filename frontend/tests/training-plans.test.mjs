import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { trainingPlansService as service, createTrainingPlanSchema, updateTrainingPlanSchema, createPlanWeekSchema, createPrescriptionSchema, updatePrescriptionSchema, trainingPlanErrorMessage } from '../src/services/training-plans.service.ts'
import { useTrainingPlan, useTrainingPlans } from '../src/composables/useTrainingPlans.ts'
import { plan, detail, planning, day, dayId, dailyPrescription, week, prescription, planId, weekId, exerciseId, prescriptionId, response } from './training-plans.fixtures.mjs'

installAuthInterceptors({ getSessionGeneration: () => 0, getAccessToken: () => 'memory-access', refreshSession: async () => { throw new Error('Session expired') }, clearSession: () => {} })
const failure = (config, status, message = '') => new AxiosError('HTTP failure', AxiosError.ERR_BAD_RESPONSE, config, undefined, response(config, { message }, status))

test('uses the authenticated direct array and nested detail contracts', async () => {
  const calls = []
  api.defaults.adapter = async config => {
    calls.push(config)
    return response(config, config.url === '/training-plans' ? [plan] : detail)
  }
  assert.deepEqual(await service.list(), [plan])
  assert.deepEqual(await service.get(planId), detail)
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer memory-access')
  assert.equal(calls[1].url, '/training-plans/' + planId)
})

test('creates and updates plans and weeks without sending ownership or state', async () => {
  const calls = []
  api.defaults.adapter = async config => { calls.push(config); return response(config, config.url.includes('/weeks') ? week : plan) }
  await service.create({ name: ' Fuerza base ', startsOn: '2026-11-01' })
  await service.update(planId, { name: 'Cambio', endsOn: null })
  await service.createWeek(planId, { weekNumber: 1 })
  await service.updateWeek(planId, weekId, { objective: null })
  assert.deepEqual(calls.map(c => c.method), ['post', 'patch', 'post', 'patch'])
  assert.deepEqual(JSON.parse(calls[0].data), { name: 'Fuerza base', startsOn: '2026-11-01' })
  assert.deepEqual(JSON.parse(calls[3].data), { objective: null })
  assert.equal(calls[3].url, `/training-plans/${planId}/weeks/${weekId}`)
})

test('prescribes catalog IDs and normalizes the extra relation returned by writes', async () => {
  const calls = []
  api.defaults.adapter = async config => {
    calls.push(config)
    return response(config, { ...prescription, exercise: { ...prescription.exercise, primaryMuscleGroup: { name: 'Pectorales' } } })
  }
  assert.deepEqual(await service.createPrescription(planId, weekId, { exerciseId, position: 1, targetSets: 3, targetReps: 8 }), prescription)
  assert.deepEqual(await service.updatePrescription(planId, weekId, prescriptionId, { targetLoad: null }), prescription)
  assert.equal(calls[1].url, `/training-plans/${planId}/weeks/${weekId}/exercises/${prescriptionId}`)
  assert.deepEqual(JSON.parse(calls[1].data), { targetLoad: null })
})

test('rejects invalid forms, empty changes, unknown fields and immutable exercise IDs before HTTP', async () => {
  let calls = 0
  api.defaults.adapter = async config => { calls++; return response(config, {}) }
  const invalidPlans = [{ name: '', startsOn: '2026-11-01' }, { name: 'Plan', startsOn: '2026-02-30' }, { name: 'Plan', startsOn: '2026-11-02', endsOn: '2026-11-01' }, { name: 'Plan', startsOn: '2026-11-01', athleteId: planId }]
  for (const input of invalidPlans) assert.equal(createTrainingPlanSchema.safeParse(input).success, false)
  assert.equal(updateTrainingPlanSchema.safeParse({}).success, false)
  assert.equal(updateTrainingPlanSchema.safeParse({ status: 'ACTIVE' }).success, false)
  assert.equal(createPlanWeekSchema.safeParse({ weekNumber: 521 }).success, false)
  assert.equal(createPlanWeekSchema.safeParse({ weekNumber: 1, objective: '' }).success, false)
  const input = { exerciseId, position: 1, targetSets: 3, targetReps: 8 }
  for (const extra of [{ targetRpe: 10.1 }, { targetRpe: 7.55 }, { targetLoad: 2.0001 }, { targetSets: 0 }, { targetReps: 1.5 }, { notes: 'x'.repeat(4001) }]) assert.equal(createPrescriptionSchema.safeParse({ ...input, ...extra }).success, false)
  assert.equal(updatePrescriptionSchema.safeParse({ exerciseId }).success, false)
  await assert.rejects(service.get('invalid'), error => /identificador/.test(trainingPlanErrorMessage(error, '')))
  await assert.rejects(service.update(planId, {}))
  await assert.rejects(service.createPrescription(planId, weekId, { ...input, userId: planId }))
  assert.equal(calls, 0)
})

test('rejects incompatible responses and maps authorization, history and duplicate errors', async () => {
  api.defaults.adapter = async config => response(config, { items: [] })
  await assert.rejects(service.list())
  assert.match(trainingPlanErrorMessage(failure({}, 403), ''), /permiso/)
  assert.match(trainingPlanErrorMessage(failure({}, 401), ''), /sesión/)
  assert.match(trainingPlanErrorMessage(failure({}, 404), ''), /acceso/)
  assert.match(trainingPlanErrorMessage(failure({}, 409, 'A week with this number already exists'), ''), /número/)
  assert.match(trainingPlanErrorMessage(failure({}, 409, 'linked to training history'), ''), /historial/)
  assert.match(trainingPlanErrorMessage(new AxiosError('network'), ''), /conectar/)
})

test('list loading, empty state and duplicate submissions settle correctly', async () => {
  const state = useTrainingPlans()
  let resolveRead
  let resolveWrite
  let reads = 0
  let writes = 0
  api.defaults.adapter = config => new Promise(resolve => {
    if (config.method === 'get') { reads++; resolveRead = () => resolve(response(config, [])) }
    else { writes++; resolveWrite = () => resolve(response(config, plan)) }
  })
  const first = state.load()
  const second = state.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.loading.value, true)
  resolveRead(); await Promise.all([first, second])
  assert.equal(reads, 1)
  assert.deepEqual(state.plans.value, [])
  const created = state.create({ name: 'Plan', startsOn: '2026-11-01' })
  await state.create({ name: 'Plan', startsOn: '2026-11-01' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.creating.value, true)
  resolveWrite(); await created
  assert.equal(writes, 1)
  assert.equal(state.creating.value, false)
  assert.deepEqual(state.plans.value, [plan])
})

test('updates planning only with validated server results and retains daily prescriptions', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => {
    if (config.method === 'get') return response(config, planning)
    if (config.url.endsWith('/days/' + dayId + '/exercises/' + prescriptionId)) return response(config, { ...planning, weeks: [{ ...planning.weeks[0], days: [{ ...day, exercises: [{ ...dailyPrescription, targetSets: 4 }] }] }] })
    if (config.url.endsWith('/weeks/' + weekId)) return response(config, { ...week, objective: 'Base' })
    if (config.url.endsWith('/weeks')) return response(config, { ...week, id: '20000000-0000-4000-8000-000000000002', weekNumber: 2 })
    return response(config, { ...plan, name: 'Actualizado' })
  }
  await state.load(planId)
  await state.update({ name: 'Actualizado' })
  await state.createWeek({ weekNumber: 2 })
  await state.updateWeek(weekId, { objective: 'Base' })
  assert.equal(state.plan.value.name, 'Actualizado')
  assert.equal(state.plan.value.weeks.length, 2)
  assert.equal(state.plan.value.weeks[0].objective, 'Base')
  assert.deepEqual(state.plan.value.weeks[1].days, [])
  await state.saveDailyPrescription(weekId, dayId, { targetSets: 4 }, prescriptionId)
  assert.equal(state.plan.value.weeks[0].days[0].exercises[0].targetSets, 4)
  assert.match(state.notice.value, /guardaron/)
})

test('concurrent writes cannot produce a second success without a server response', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => response(config, planning)
  await state.load(planId)
  let finish
  let calls = 0
  api.defaults.adapter = config => new Promise(resolve => { calls++; finish = () => resolve(response(config, { ...plan, name: 'Guardado' })) })
  const pending = state.update({ name: 'Guardado' })
  await assert.rejects(state.update({ name: 'Duplicado' }), /cambio en curso/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(state.notice.value, '')
  finish(); await pending
  assert.equal(state.saving.value, false)
  assert.equal(state.plan.value.name, 'Guardado')
})

test('ignores late detail responses and rejects writes on non-draft plans', async () => {
  const state = useTrainingPlan()
  const original = service.getPlanning
  const otherId = '10000000-0000-4000-8000-000000000002'
  let finishOld
  service.getPlanning = id => id === planId ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve({ ...planning, id: otherId, status: 'ACTIVE' })
  try {
    const stale = state.load(planId)
    await state.load(otherId)
    finishOld(planning); await stale
    assert.equal(state.plan.value.id, otherId)
    assert.equal(state.editable.value, false)
    await assert.rejects(state.update({ name: 'No permitido' }))
  } finally { service.getPlanning = original; state.dispose() }
})

test('failed reads and writes reset loading and saving without optimistic success', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => { throw failure(config, 404) }
  await state.load(planId)
  assert.equal(state.loading.value, false)
  assert.match(state.error.value, /acceso/)
  api.defaults.adapter = async config => response(config, planning)
  await state.load(planId)
  api.defaults.adapter = async config => { throw failure(config, 409, 'linked to training history') }
  await assert.rejects(state.update({ name: 'No guardado' }))
  assert.equal(state.plan.value.name, plan.name)
  assert.equal(state.saving.value, false)
  assert.equal(state.notice.value, '')
})

after(() => { api.defaults.adapter = undefined })
