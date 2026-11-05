import assert from 'node:assert/strict'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { trainingPlansService } from '../src/services/training-plans.service.ts'
import { useTrainingPlan } from '../src/composables/useTrainingPlans.ts'
import { workoutSessionsService } from '../src/services/workout-sessions.service.ts'
let stage = 'input'
try {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk
  const { baseURL, token, exerciseId, planId, weekId } = JSON.parse(raw)
  api.defaults.baseURL = baseURL
  installAuthInterceptors({ getAccessToken: () => token, refreshSession: async () => { throw new Error('Fixture access expired') }, clearSession: () => {} })
  const state = useTrainingPlan()
  stage = 'load'; await state.load(planId); assert.equal(state.error.value, '')
  stage = 'days'
  await state.createDay(weekId, { name: 'Superior A', position: 1, weekday: 1 })
  const day = state.plan.value.weeks[0].days[0]
  await state.updateDay(weekId, day.id, { weekday: null })
  stage = 'prescription'
  await state.saveDailyPrescription(weekId, day.id, { exerciseId, position: 1, targetSets: 3, targetRepsMin: 6, targetRepsMax: 10, targetLoad: 50, targetLoadUnit: 'KG' })
  const prescription = state.plan.value.weeks[0].days[0].exercises[0]
  await state.saveDailyPrescription(weekId, day.id, { targetSets: 4 }, prescription.id)
  stage = 'copies'
  await state.copyDay(weekId, day.id, 2)
  await state.reorderDays(weekId, state.plan.value.weeks[0].days.map(day => day.id).reverse())
  await state.copyWeek(weekId, 2)
  assert.equal(state.plan.value.weeks[1].days.length, 2)
  const legacy = await trainingPlansService.get(planId)
  assert.equal(legacy.weeks[0].exercises.length, 2)
  stage = 'f06'
  const session = await workoutSessionsService.create({ id: crypto.randomUUID(), trainingPlanId: planId, planWeekId: weekId })
  assert.deepEqual(session.exercises.map(item => item.orderInSession), [1, 2])
  assert.equal(session.exercises[0].prescription.targetReps, null)
  assert.equal(session.exercises[0].prescription.targetLoadUnit, 'KG')
  await state.load(planId)
  assert.equal(state.plan.value.weeks[0].days.every(day => day.hasHistory), true)
  state.dispose()
  console.log(JSON.stringify({ dailyHttpFlow: 'passed' }))
} catch (error) {
  console.error(JSON.stringify({ dailyHttpFlow: 'failed', stage, error: error.name, status: error.response?.status, issuePaths: error.issues?.map(issue => issue.path.join('.')) }))
  process.exitCode = 1
}
