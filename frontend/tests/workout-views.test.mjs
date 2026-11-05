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
  assert.match(create, /Notas generales/); assert.match(create, /Usar un plan/)
  assert.doesNotMatch(create, /Repeticiones realizadas|RPE por serie|Peso utilizado/)
})
