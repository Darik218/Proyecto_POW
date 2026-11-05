// Invoked by the backend E2E suite with credentials for its own disposable fixture.
import assert from 'node:assert/strict'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { exercisesService } from '../src/services/exercises.service.ts'
import { trainingPlansService } from '../src/services/training-plans.service.ts'
import { useTrainingPlan, useTrainingPlans } from '../src/composables/useTrainingPlans.ts'

let stage = 'input'
try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const { baseURL, token, name, exerciseId, exerciseName } = JSON.parse(input)
  api.defaults.baseURL = baseURL
  installAuthInterceptors({ getAccessToken: () => token, refreshSession: async () => { throw new Error('Fixture session unexpectedly expired.') }, clearSession: () => {} })
  const list = useTrainingPlans()
  stage = 'list'
  await list.load()
  assert.deepEqual(list.plans.value, [])
  stage = 'create plan'
  const created = await list.create({ name, startsOn: '2026-11-01' })
  const state = useTrainingPlan()
  stage = 'detail'
  await state.load(created.id)
  assert.equal(state.error.value, '')
  stage = 'update plan'
  await state.update({ name: name + ' edited', endsOn: '2026-12-01' })
  stage = 'create week'
  await state.createWeek({ weekNumber: 1, objective: 'Base' })
  const weekId = state.plan.value.weeks[0].id
  stage = 'update week'
  await state.updateWeek(weekId, { objective: 'Strength' })
  stage = 'catalog'
  const catalog = await exercisesService.list({ search: exerciseName })
  assert.equal(catalog.items.some(item => item.id === exerciseId), true)
  await state.createDay(weekId, { name: 'Superior A', position: 1 })
  const dayId = state.plan.value.weeks[0].days[0].id
  stage = 'create prescription'
  await state.saveDailyPrescription(weekId, dayId, { exerciseId, position: 1, targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRpe: 7.5, targetLoad: 42.125, targetLoadUnit: 'KG' })
  const prescriptionId = state.plan.value.weeks[0].days[0].exercises[0].id
  stage = 'update prescription'
  await state.saveDailyPrescription(weekId, dayId, { targetSets: 4 }, prescriptionId)
  stage = 'verify persistence'
  const persisted = await trainingPlansService.get(created.id)
  assert.equal(persisted.name, name + ' edited')
  assert.equal(persisted.weeks[0].objective, 'Strength')
  assert.equal(persisted.weeks[0].exercises[0].targetSets, 4)
  assert.equal(persisted.weeks[0].exercises[0].targetLoad, 42.125)
  assert.equal(state.loading.value, false)
  assert.equal(state.saving.value, false)
  list.dispose(); state.dispose()
  console.log(JSON.stringify({ planId: created.id, frontendHttpFlow: 'passed' }))
} catch (error) {
  // Axios errors can contain credentials in config; never print the error object.
  console.error(JSON.stringify({ frontendHttpFlow: 'failed', stage, error: error.name, status: error.response?.status, issuePaths: error.issues?.map(issue => issue.path.join('.')) }))
  process.exitCode = 1
}
