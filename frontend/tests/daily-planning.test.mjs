import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { trainingPlansService as service, createPlanDaySchema, updatePlanDaySchema, createDailyPrescriptionSchema, updateDailyPrescriptionSchema, planningSchema, repsLabel, weekdayLabel } from '../src/services/training-plans.service.ts'
import { useTrainingPlan } from '../src/composables/useTrainingPlans.ts'
import { planning, day, dayId, dailyPrescription, prescriptionId, planId, weekId, exerciseId, response } from './training-plans.fixtures.mjs'
installAuthInterceptors({ getSessionGeneration: () => 0, getAccessToken: () => 'in-memory-fixture', refreshSession: async () => { throw new Error('Expired') }, clearSession: () => {} })
after(() => { api.defaults.adapter = undefined })

test('reads the daily hierarchy with separate pending prescriptions and stable range labels', async () => {
  let call
  api.defaults.adapter = async config => { call = config; return response(config, planning) }
  assert.deepEqual(await service.getPlanning(planId), planning)
  assert.equal(call.url, `/training-plans/${planId}/planning`)
  assert.equal(call.headers.get('Authorization'), 'Bearer in-memory-fixture')
  assert.equal(repsLabel({ targetReps: null, targetRepsMin: 6, targetRepsMax: 10 }), '6–10')
  assert.equal(weekdayLabel(null), 'Flexible'); assert.equal(weekdayLabel(1), 'Lunes')
  assert.equal(planningSchema.safeParse({ ...planning, weeks: [{ ...planning.weeks[0], days: [{ ...day, exercises: [{ ...dailyPrescription, targetReps: 8, targetRepsMin: 6, targetRepsMax: 10 }] }] }] }).success, false)
})

test('validates fixed/flexible days, unknown fields, empty edits, ranges and explicit load units', async () => {
  for (const weekday of [null, 1, 7]) assert.equal(createPlanDaySchema.safeParse({ name: 'A', position: 1, weekday }).success, true)
  for (const input of [{ name: '', position: 1 }, { name: 'A', position: 0 }, { name: 'A', position: 1, weekday: 8 }, { name: 'A', position: 1, athleteId: planId }]) assert.equal(createPlanDaySchema.safeParse(input).success, false)
  assert.equal(updatePlanDaySchema.safeParse({}).success, false)
  const input = { exerciseId, position: 1, targetSets: 3, targetRepsMin: 6, targetRepsMax: 10 }
  assert.equal(createDailyPrescriptionSchema.safeParse(input).success, true)
  for (const extra of [{ targetRepsMin: 11 }, { targetReps: 8 }, { targetLoad: 20 }, { targetLoadUnit: 'KG' }, { targetRpe: 10.1 }, { targetLoad: 20.0001, targetLoadUnit: 'LB' }, { planDayId: dayId }]) assert.equal(createDailyPrescriptionSchema.safeParse({ ...input, ...extra }).success, false)
  assert.equal(updateDailyPrescriptionSchema.safeParse({}).success, false)
  assert.equal(updateDailyPrescriptionSchema.safeParse({ targetRepsMin: 6 }).success, false)
})

test('writes only real daily endpoints, validates IDs and handles all planning operations', async () => {
  const calls = []
  api.defaults.adapter = async config => { calls.push(config); return response(config, planning) }
  await service.createDay(planId, weekId, { name: ' A ', position: 1 })
  await service.updateDay(planId, weekId, dayId, { weekday: null })
  await service.reorderDays(planId, weekId, [dayId])
  await service.copyDay(planId, weekId, dayId, 2)
  await service.copyWeek(planId, weekId, 2)
  await service.createDailyPrescription(planId, weekId, dayId, { exerciseId, position: 1, targetSets: 3, targetRepsMin: 6, targetRepsMax: 10, targetLoad: 20, targetLoadUnit: 'KG' })
  await service.updateDailyPrescription(planId, weekId, dayId, prescriptionId, { notes: 'Técnica' })
  await service.reorderExercises(planId, weekId, dayId, [prescriptionId])
  await service.removeDailyPrescription(planId, weekId, dayId, prescriptionId)
  await service.distribute(planId, weekId, prescriptionId, dayId, 2, true)
  assert.deepEqual(calls.map(call => call.method), ['post', 'patch', 'patch', 'post', 'post', 'post', 'patch', 'patch', 'delete', 'post'])
  assert.equal(calls[2].url, `/training-plans/${planId}/weeks/${weekId}/days/order`)
  assert.equal(calls[7].url, `/training-plans/${planId}/weeks/${weekId}/days/${dayId}/exercises/order`)
  assert.deepEqual(JSON.parse(calls[0].data), { name: 'A', position: 1 })
  assert.deepEqual(JSON.parse(calls[9].data), { dayId, position: 2, copy: true })
  const count = calls.length
  await assert.rejects(service.copyWeek(planId, weekId, 521))
  await assert.rejects(service.reorderDays(planId, weekId, [dayId, dayId]))
  await assert.rejects(service.createDay(planId, 'invalid', { name: 'A', position: 1 }))
  assert.equal(calls.length, count)
})

test('guards duplicate daily writes and updates the complete hierarchy from the server', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => response(config, planning)
  await state.load(planId)
  let finish
  let calls = 0
  api.defaults.adapter = config => new Promise(resolve => { calls++; finish = () => resolve(response(config, { ...planning, weeks: [{ ...planning.weeks[0], days: [{ ...day, name: 'Guardado' }] }] })) })
  const pending = state.updateDay(weekId, dayId, { name: 'Guardado' })
  await assert.rejects(state.updateDay(weekId, dayId, { name: 'Duplicado' }), /curso/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1); assert.equal(state.saving.value, true)
  assert.equal(state.plan.value.weeks[0].days[0].name, day.name)
  finish(); await pending
  assert.equal(state.saving.value, false); assert.equal(state.plan.value.weeks[0].days[0].name, 'Guardado')
})

test('failed daily writes reset saving without hiding historical errors or presenting success', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => response(config, planning)
  await state.load(planId)
  api.defaults.adapter = async config => { throw new AxiosError('Conflict', 'ERR_BAD_RESPONSE', config, undefined, response(config, { message: 'training history' }, 409)) }
  await assert.rejects(state.removePrescription(weekId, dayId, prescriptionId))
  assert.equal(state.saving.value, false); assert.equal(state.notice.value, '')
  assert.equal(state.plan.value.weeks[0].days[0].exercises.length, 1)
})

test('rejects invalid aggregate responses and allows recovery after a failed planning load', async () => {
  const state = useTrainingPlan()
  api.defaults.adapter = async config => response(config, { weeks: [] })
  await state.load(planId)
  assert.equal(state.loading.value, false); assert.match(state.error.value, /formato inesperado/)
  api.defaults.adapter = async config => response(config, { ...planning, weeks: [] })
  await state.load(planId)
  assert.equal(state.error.value, ''); assert.deepEqual(state.plan.value.weeks, [])
})
