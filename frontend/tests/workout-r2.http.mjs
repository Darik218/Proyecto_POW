import assert from 'node:assert/strict'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { workoutSessionsService as service } from '../src/services/workout-sessions.service.ts'
import { trainingPlansService } from '../src/services/training-plans.service.ts'
import { useWorkoutSession } from '../src/composables/useWorkoutSessions.ts'
let stage = 'input'
try {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk
  const { baseURL, token, planId, weekId, pushId, pullId } = JSON.parse(raw)
  api.defaults.baseURL = baseURL
  installAuthInterceptors({ getSessionGeneration: () => 0, getAccessToken: () => token, refreshSession: async () => { throw new Error('Fixture access expired') }, clearSession: () => {} })
  const input = { id: crypto.randomUUID(), performedOn:'2026-01-08',timeZone:'America/Bogota',recordingMode:'RETROSPECTIVE',trainingPlanId:planId,planWeekId:weekId,planDayId:pushId }
  stage='prepare'; const created = await service.create(input); assert.equal(created.status,'PLANNED'); assert.equal(created.exercises.length,1)
  const state = useWorkoutSession(); await state.load(created.id)
  const exerciseId = state.session.value.exercises[0].id
  stage='adjust'; await state.updateExercise(exerciseId,{targetLoad:'77.5',targetLoadUnit:'KG'})
  assert.equal(state.session.value.exercises[0].original.targets.targetLoad,'80')
  stage='start'; await state.start()
  stage='set'; await state.recordSet(exerciseId,{setNumber:1,status:'COMPLETED',kind:'WORK',load:'77.5',loadUnit:'KG',repetitions:8,rpe:8},undefined,undefined,crypto.randomUUID())
  await state.load(created.id); assert.equal(state.session.value.exercises[0].sets[0].load,'77.5')
  const recorded = state.session.value.exercises[0].sets
  stage='associate'; await state.associate({trainingPlanId:planId,planWeekId:weekId,planDayId:pullId})
  assert.deepEqual(state.session.value.exercises[0].sets,recorded)
  stage='explicit import'; await state.importDay(crypto.randomUUID()); assert.equal(state.session.value.exercises.length,2)
  stage='complete'; await state.complete(); assert.equal(state.session.value.status,'COMPLETED')
  const repeated = await service.create({id:crypto.randomUUID(),performedOn:'2026-01-09',timeZone:'UTC',recordingMode:'RETROSPECTIVE',repeatFromId:created.id})
  assert.equal(repeated.exercises.every(item=>item.sets.length===0),true)
  stage='export'; const saved=await service.saveAsDay(created.id,{id:crypto.randomUUID(),trainingPlanId:planId,planWeekId:weekId,name:'HTTP routine',position:3})
  const planning=await trainingPlansService.getPlanning(planId)
  assert.equal(planning.weeks[0].days.find(day=>day.id===saved.id).exercises[0].targetLoad,77.5)
  stage='retry intent'; const replay=await service.create(input); assert.equal(replay.status,'COMPLETED'); assert.equal(replay.exercises[0].targets.targetLoad,'77.5')
  state.dispose(); console.log(JSON.stringify({workoutR2HttpFlow:'passed'}))
} catch(error) { console.error(JSON.stringify({workoutR2HttpFlow:'failed',stage,error:error.name,status:error.response?.status,issuePaths:error.issues?.map(issue=>issue.path.join('.'))})); process.exitCode=1 }
