import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import { workoutSessionsService as service, createWorkoutSchema, setInputSchema, setStatusLabel, workoutSchema, workoutWriteRejected, localTrainingDate } from '../src/services/workout-sessions.service.ts'
import { useWorkoutSession } from '../src/composables/useWorkoutSessions.ts'
import { detail, exercise, id, exerciseId, operationId, intent, response } from './workout-sessions.fixtures.mjs'
installAuthInterceptors({ getAccessToken:()=> 'memory-only-fixture',refreshSession:async()=>{throw new Error('Expired')},clearSession:()=>{} })
const targets={targetSets:3,targetRepsMin:8,targetRepsMax:8,targetLoad:'80',targetLoadUnit:'KG',targetRpe:8}
const modern={...detail,version:2,performedOn:'2026-01-01T00:00:00.000Z',timeZone:'UTC',recordingMode:'RETROSPECTIVE',completedAt:null,planDay:null,sourceSnapshot:{kind:'FREE',plan:null,week:null,day:null,session:null},actualSetCount:0,completedSetCount:0,exercises:[{...exercise,original:{source:{kind:'FREE',id:null},exercise:exercise.exercise,targets,position:1,notes:null},targets,isOmitted:false,replacesWorkoutExerciseId:null,sets:[]}]}
after(()=>{api.defaults.adapter=undefined})
test('validates daily and repeat origins and timezone semantics without creating execution fields',async()=>{
  assert.equal(createWorkoutSchema.safeParse({...intent,trainingPlanId:id,planWeekId:operationId,planDayId:exerciseId}).success,true)
  assert.equal(createWorkoutSchema.safeParse({...intent,repeatFromId:operationId}).success,true)
  for(const extra of [{trainingPlanId:id,planWeekId:operationId},{timeZone:'Not/AZone'},{timeZone:'+05:00'},{repeatFromId:id},{repeatFromId:operationId,planDayId:exerciseId},{completedAt:'2026-01-01'}]) assert.equal(createWorkoutSchema.safeParse({...intent,...extra}).success,false)
  assert.equal(localTrainingDate('America/Bogota',new Date('2026-01-02T01:00:00Z')),'2026-01-01')
})
test('calls suggestions without automatically creating a session',async()=>{
  const calls=[]
  api.defaults.adapter=async config=>{calls.push(config);return response(config,{performedOn:'2026-01-01',timeZone:'UTC',resolution:'NONE',candidates:[]})}
  const result=await service.suggestions('2026-01-01','UTC')
  assert.deepEqual(result.candidates,[]);assert.equal(calls.length,1);assert.equal(calls[0].method,'get');assert.equal(calls[0].url,'/workout-sessions/suggestions')
})
test('versioned edits, associations, explicit imports and reordering use the actual API paths',async()=>{
  const calls=[];api.defaults.adapter=async config=>{calls.push(config);return response(config,modern)}
  await service.updateExercise(id,operationId,{expectedVersion:2,targetLoad:'77.5',targetLoadUnit:'KG'})
  await service.associate(id,{expectedVersion:2,trainingPlanId:id,planWeekId:operationId,planDayId:exerciseId})
  await service.importDay(id,operationId,2,exerciseId)
  await service.reorder(id,[operationId],2)
  assert.deepEqual(calls.map(call=>call.method),['patch','patch','post','patch'])
  assert.equal(calls[0].url,`/workout-sessions/${id}/exercises/${operationId}`)
  assert.equal(JSON.parse(calls[0].data).targetLoad,'77.5')
  assert.equal(JSON.parse(calls[2].data).id,operationId)
})
test('validates performed sets, never interprets legacy false as failed, and preserves decimal strings',async()=>{
  const input={setNumber:1,status:'COMPLETED',kind:'WORK',load:'77.5',loadUnit:'KG',repetitions:8}
  assert.equal(setInputSchema.safeParse(input).success,true)
  for(const extra of [{load:'77.5555'},{load:77.5},{loadUnit:null},{status:'PENDING'},{status:'FAILED',repetitions:1},{repetitions:0},{rpe:10.1},{ownerId:id}]) assert.equal(setInputSchema.safeParse({...input,...extra}).success,false)
  assert.equal(setInputSchema.safeParse({setNumber:1,status:'PENDING',kind:'WARMUP'}).success,true)
  assert.equal(setStatusLabel({status:null,isCompleted:false}),'Histórica sin clasificación')
  const calls=[];api.defaults.adapter=async config=>{calls.push(config);return response(config,modern)}
  await service.createSet(id,operationId,{...input,id:exerciseId,expectedVersion:2})
  assert.equal(JSON.parse(calls[0].data).load,'77.5')
})
test('updates session state only after responses, suppresses concurrent writes and preserves original objectives',async()=>{
  const state=useWorkoutSession();api.defaults.adapter=async config=>response(config,modern);await state.load(id)
  let finish;let calls=0
  api.defaults.adapter=config=>new Promise(resolve=>{calls++;finish=()=>resolve(response(config,{...modern,version:3,exercises:[{...modern.exercises[0],targets:{...targets,targetLoad:'77.5'}}]}))})
  const pending=state.updateExercise(operationId,{targetLoad:'77.5',targetLoadUnit:'KG'})
  await assert.rejects(state.updateExercise(operationId,{targetLoad:'76',targetLoadUnit:'KG'}))
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(state.saving.value,true)
  finish();await pending
  assert.equal(state.session.value.exercises[0].targets.targetLoad,'77.5');assert.equal(state.session.value.exercises[0].original.targets.targetLoad,'80')
  assert.equal(state.saving.value,false)
})
test('rejects malformed snapshots, distinguishes definite rejections from uncertain network failures',async()=>{
  assert.equal(workoutSchema.safeParse({...modern,exercises:[{...modern.exercises[0],original:{untrusted:'shape'}}]}).success,false)
  assert.equal(workoutWriteRejected({isAxiosError:true,response:{status:400}}),true)
  assert.equal(workoutWriteRejected({isAxiosError:true}),false)
  api.defaults.adapter=async config=>response(config,{...modern,exercises:[{...modern.exercises[0],targets:{...targets,targetLoad:80}}]})
  await assert.rejects(service.get(id))
})
