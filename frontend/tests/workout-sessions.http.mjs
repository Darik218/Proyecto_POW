import assert from 'node:assert/strict'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { workoutSessionsService } from '../src/services/workout-sessions.service.ts'
import { useWorkoutSession, useWorkoutSessions } from '../src/composables/useWorkoutSessions.ts'
let stage = 'input'
try {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk
  const { baseURL, token, exerciseId, trainingPlanId, planWeekId } = JSON.parse(raw)
  api.defaults.baseURL = baseURL
  installAuthInterceptors({ getAccessToken: () => token, refreshSession: async () => { throw new Error('Fixture access expired') }, clearSession: () => {} })
  const input = { id: crypto.randomUUID(), trainingPlanId, planWeekId }
  stage = 'start'
  const created = await workoutSessionsService.create(input)
  const replay = await workoutSessionsService.create(input)
  assert.equal(created.id, replay.id); assert.equal(created.exercises.length, 1)
  const state = useWorkoutSession(); await state.load(created.id)
  const addition = { id: crypto.randomUUID(), exerciseId, notes: 'Calentamiento previsto' }
  stage = 'exercise'
  await state.addExercise(addition); await state.addExercise(addition)
  assert.equal(state.session.value.exercises.length, 2)
  stage = 'complete'
  await state.complete(); const endedAt = state.session.value.finishedAt
  await state.complete(); assert.equal(state.session.value.finishedAt, endedAt)
  assert.equal(state.session.value.status, 'COMPLETED'); assert.equal(state.editable.value, false)
  const list = useWorkoutSessions(); await list.load({ status: 'COMPLETED' })
  assert.equal(list.sessions.value.some(session => session.id === created.id), true)
  assert.equal(list.loading.value, false); state.dispose(); list.dispose()
  console.log(JSON.stringify({ workoutHttpFlow: 'passed' }))
} catch (error) {
  console.error(JSON.stringify({ workoutHttpFlow: 'failed', stage, error: error.name, status: error.response?.status, issuePaths: error.issues?.map(issue => issue.path.join('.')) }))
  process.exitCode = 1
}
