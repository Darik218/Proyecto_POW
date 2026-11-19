import assert from 'node:assert/strict'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { routineService } from '../src/services/routine.service.ts'
import { trainingPlansService } from '../src/services/training-plans.service.ts'
import { workoutSessionsService } from '../src/services/workout-sessions.service.ts'
let stage = 'input'
try {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const { baseURL, token, exerciseId } = JSON.parse(raw)
  api.defaults.baseURL = baseURL
  installAuthInterceptors({ getSessionGeneration: () => 0,
    getAccessToken: () => token,
    refreshSession: async () => {
      throw new Error('Fixture session expired')
    },
    clearSession: () => {},
  })
  stage = 'wizard'
  const intent = {
    id: crypto.randomUUID(),
    name: 'UX real HTTP routine',
    durationWeeks: 8,
    frequency: 3,
    timeZone: 'UTC',
    days: [
      { name: 'Push', weekday: 1 },
      { name: 'Pull', weekday: 3 },
      { name: 'Flexible', weekday: null },
    ],
  }
  const generated = await routineService.generate(intent)
  assert.equal((await routineService.generate(intent)).id, generated.id)
  let plan = await trainingPlansService.getPlanning(generated.id)
  assert.equal(plan.weeks.length, 8)
  assert.equal(plan.weeks.flatMap((w) => w.days).length, 24)
  const week = plan.weeks[0],
    day = week.days[0]
  stage = 'prescription'
  plan = await trainingPlansService.createDailyPrescription(
    plan.id,
    week.id,
    day.id,
    {
      exerciseId,
      position: 1,
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetLoad: 25,
      targetLoadUnit: 'KG',
    },
    plan.version,
  )
  stage = 'calendar'
  const activity = await routineService.createActivity({
    id: crypto.randomUUID(),
    planWeekId: week.id,
    planDayId: day.id,
    scheduledOn: '2026-01-01',
    timeZone: 'UTC',
    title: 'Push',
    status: 'PLANNED',
  })
  assert.equal(activity.workouts.length, 0)
  stage = 'execute'
  const prepared = await workoutSessionsService.create({
    id: crypto.randomUUID(),
    trainingPlanId: plan.id,
    planWeekId: week.id,
    planDayId: day.id,
    scheduledActivityId: activity.id,
    performedOn: '2026-01-01',
    timeZone: 'UTC',
    recordingMode: 'RETROSPECTIVE',
  })
  assert.equal(prepared.exercises.length, 1)
  assert.equal(prepared.sourceSnapshot.schedule.id, activity.id)
  const started = await workoutSessionsService.start(prepared.id, prepared.version)
  const recorded = await workoutSessionsService.createSet(started.id, started.exercises[0].id, {
    id: crypto.randomUUID(),
    expectedVersion: started.version,
    setNumber: 1,
    repetitions: 7,
    load: '22.5',
    loadUnit: 'KG',
    kind: 'WORK',
    status: 'COMPLETED',
  })
  const completed = await workoutSessionsService.complete(recorded.id, recorded.version)
  stage = 'history'
  assert.equal((await workoutSessionsService.get(completed.id)).exercises[0].sets[0].load, '22.5')
  const page = await workoutSessionsService.list({
    trainingPlanId: plan.id,
    planDayId: day.id,
    from: '2026-01-01',
    to: '2026-01-01',
    status: 'COMPLETED',
  })
  assert.deepEqual(
    page.items.map((item) => item.id),
    [completed.id],
  )
  const calendar = await routineService.activities({
    weekId: week.id,
    from: '2026-01-01',
    to: '2026-01-01',
    timeZone: 'UTC',
  })
  assert.equal(calendar.find((a) => a.id === activity.id).workouts[0].status, 'COMPLETED')
  stage = 'copy'
  const copied = await routineService.copy(plan.id, {
    id: crypto.randomUUID(),
    expectedVersion: plan.version,
    sourceDayId: day.id,
    mode: 'NEW_DAY',
    weekIds: [plan.weeks[1].id, plan.weeks[2].id],
  })
  assert.equal(copied.dayIds.length, 2)
  assert.equal((await workoutSessionsService.get(completed.id)).exercises[0].sets.length, 1)
  console.log(
    JSON.stringify({ routineHttpFlow: 'passed', generatedDays: 24, copiedDays: 2, actualSets: 1 }),
  )
} catch (error) {
  console.error(
    JSON.stringify({
      routineHttpFlow: 'failed',
      stage,
      error: error.name,
      status: error.response?.status,
      issuePaths: error.issues?.map((issue) => issue.path.join('.')),
    }),
  )
  process.exitCode = 1
}
