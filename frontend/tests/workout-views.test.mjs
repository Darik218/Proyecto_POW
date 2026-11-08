import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { resolve } from 'node:path'
import { createRenderer, createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import { exerciseId } from './workout-sessions.fixtures.mjs'
let server
before(async () => {
  server = await createServer({ configFile: resolve('vite.config.ts'), appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error', plugins: [{ name: 'workout-memory-router', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/router/index.ts')) return code.replaceAll('createWebHistory', 'createMemoryHistory') } }] })
})
after(async () => { await server?.close() })
const component = async name => (await server.ssrLoadModule(`/src/components/workouts/${name}.vue`)).default
const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null })
function mount(Component, props, t) {
  const app = renderer.createApp({ ...Component, render: () => null }, props)
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const instance = app.mount({}); t.after(() => app.unmount()); return instance.$.setupState
}
test('workout routes inherit the existing authentication guard', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  for (const path of ['/app/workouts', '/app/workouts/10000000-0000-4000-8000-000000000001']) assert.equal(router.resolve(path).meta.requiresAuth, true)
  await router.push('/app/workouts')
  assert.equal(router.currentRoute.value.name, 'login')
})
test('start form retries the same payload after a network failure', async (t) => {
  const inputs = []
  const state = mount(await component('StartWorkoutForm'), { save: async input => { inputs.push(input); if (inputs.length === 1) throw { isAxiosError: true } } }, t)
  state.notes = 'Mi entrenamiento'
  await state.submit()
  assert.equal(state.pending, false); assert.match(state.error, /misma solicitud/)
  state.notes = 'Not sent after the first attempt'
  await state.submit()
  assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1])
  assert.equal(inputs[1].notes, 'Mi entrenamiento')
  assert.equal('status' in inputs[0], false); assert.equal('athleteId' in inputs[0], false)
})
test('exercise form validates selection and preserves the creation UUID on retry', async (t) => {
  const inputs = []
  const state = mount(await component('AddWorkoutExerciseForm'), { save: async input => { inputs.push(input); if (inputs.length === 1) throw { isAxiosError: true } } }, t)
  await state.submit(); assert.equal(inputs.length, 0); assert.match(state.error, /Selecciona/)
  state.exerciseId = exerciseId
  await state.submit(); await state.submit()
  assert.deepEqual(inputs[0], inputs[1]); assert.equal(inputs[0].exerciseId, exerciseId)
  assert.equal('load' in inputs[0], false); assert.equal(state.pending, false)
})
test('completion requires confirmation and suppresses duplicate submits', async (t) => {
  let calls = 0, finish
  const state = mount(await component('CompleteWorkoutForm'), { save: () => { calls++; return new Promise(resolve => { finish = resolve }) } }, t)
  await state.submit(); assert.equal(calls, 0); assert.match(state.error, /Confirma/)
  state.confirmed = true
  const first = state.submit(); await state.submit()
  assert.equal(calls, 1); assert.equal(state.pending, true)
  finish(); await first; assert.equal(state.pending, false)
})
test('completion and creation controls have accessible labels and no executed-set inputs', async () => {
  const html = await renderToString(createSSRApp(await component('CompleteWorkoutForm'), { save: async () => {} }))
  assert.match(html, /Confirmo que deseo finalizar/); assert.match(html, /disabled/)
  const create = await renderToString(createSSRApp(await component('StartWorkoutForm'), { save: async () => {} }))
  assert.match(create, /Notas/); assert.match(create, /Desde un día del plan/); assert.match(create, /Repetir entrenamiento anterior/); assert.match(create, /Sugerencia por fecha/)
  assert.doesNotMatch(create, /Repeticiones realizadas|RPE por serie|Peso utilizado/)
})

test('daily origin requires an explicit plan/week/day and suggestions never auto-submit',async t=>{
  let writes=0
  const state=mount(await component('StartWorkoutForm'),{save:async()=>{writes++}},t)
  state.source='PLAN_DAY';state.selection={trainingPlanId:exerciseId,planWeekId:exerciseId,planDayId:''}
  await state.submit();assert.equal(writes,0);assert.notEqual(state.error,'')
  state.source='SUGGESTED';await state.submit();assert.equal(writes,0);assert.match(state.error,/sugerencia/)
  state.accept({trainingPlanId:exerciseId,planWeekId:exerciseId,planDayId:exerciseId})
  assert.equal(state.source,'PLAN_DAY');assert.equal(state.selection.planDayId,exerciseId);assert.equal(writes,0)
})
test('target edits validate ranges and retain unknown-unit historical values',async t=>{
  let saved
  const initial={targetSets:3,targetRepsMin:8,targetRepsMax:8,targetLoad:'42.125',targetLoadUnit:null,targetRpe:null}
  const state=mount(await component('WorkoutTargetsForm'),{initial,save:async input=>{saved=input}},t)
  state.fields.targetRepsMin='10';state.fields.targetRepsMax='6';await state.submit();assert.match(state.error,/rango/)
  state.fields.targetRepsMin='6';state.fields.targetRepsMax='10';await state.submit();assert.equal(saved.targetLoadUnit,null);assert.equal(saved.targetLoad,'42.125')
  state.fields.targetLoad='43';await state.submit();assert.match(state.error,/unidad/)
})
test('set form records actual values, prevents duplicate submits and keeps an uncertain retry immutable',async t=>{
  let calls=0;let finish;const payloads=[]
  const state=mount(await component('WorkoutSetForm'),{save:(input,id)=>{calls++;payloads.push({input,id});return new Promise(resolve=>{finish=resolve})}},t)
  await state.submit();assert.equal(calls,0)
  state.form.load='77.5';state.form.repetitions='8'
  const pending=state.submit();await state.submit();assert.equal(calls,1);assert.equal(state.pending,true)
  assert.equal(payloads[0].input.load,'77.5');assert.equal(payloads[0].input.repetitions,8);finish();await pending;assert.equal(state.pending,false)
})
test('historical unclassified sets are not rendered as failed attempts and closed sessions hide editing',async()=>{
  const item={id:exerciseId,orderInSession:1,notes:null,exercise:{id:exerciseId,name:'Press',equipment:'Barra',muscleGroup:'Pectorales'},prescription:null,original:null,targets:{targetSets:null,targetRepsMin:null,targetRepsMax:null,targetLoad:null,targetLoadUnit:null,targetRpe:null},isOmitted:false,sets:[{id:exerciseId,setNumber:1,status:null,kind:null,isCompleted:false,load:'42.125',loadUnit:null,loadKg:null,repetitions:5,rpe:null,notes:null,recordedAt:'2025-01-01T12:00:00Z',version:0}]}
  const html=await renderToString(createSSRApp(await component('WorkoutExerciseCard'),{item,status:'COMPLETED',busy:false,index:0,count:1,actions:{}}))
  assert.match(html,/Histórica sin clasificación/);assert.match(html,/unidad desconocida/);assert.doesNotMatch(html,/Intento fallido|Editar serie|Registrar serie|Omitir ejercicio/)
})
test('no-result completion sends explicit confirmation to the action',async t=>{
  let flag
  const state=mount(await component('CompleteWorkoutForm'),{hasResults:false,save:async value=>{flag=value}},t)
  state.confirmed=true;await state.submit();assert.equal(flag,true)
})
