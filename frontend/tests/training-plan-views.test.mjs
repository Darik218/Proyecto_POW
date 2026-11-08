import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { resolve } from 'node:path'
import { createRenderer, createSSRApp, nextTick } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createPinia } from 'pinia'
import { createServer } from 'vite'
import { api } from '../src/services/api.ts'
import { plan, week, day, dailyPrescription, prescription, exerciseId, response } from './training-plans.fixtures.mjs'

let server
before(async () => {
  server = await createServer({
    configFile: resolve('vite.config.ts'), appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error',
    plugins: [{ name: 'test-memory-router', enforce: 'pre', transform(code, id) {
      if (id.endsWith('/src/router/index.ts')) return code.replaceAll('createWebHistory', 'createMemoryHistory')
    } }],
  })
})
after(async () => { await server?.close(); api.defaults.adapter = undefined })
const component = async name => (await server.ssrLoadModule(`/src/components/training-plans/${name}.vue`)).default

// Run component setup and handlers in Vue; SSR below separately checks the templates.
const renderer = createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
})
function mount(Component, props, t) {
  const app = renderer.createApp({ ...Component, render: () => null }, props)
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const instance = app.mount({})
  t.after(() => app.unmount())
  return instance.$.setupState
}

test('actual plan routes inherit authentication and redirect anonymous users', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  for (const path of ['/app/training-plans', '/app/training-plans/' + plan.id]) assert.equal(router.resolve(path).meta.requiresAuth, true)
  await router.push('/app/training-plans')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.redirect, '/app/training-plans')
})

test('renders new forms and read-only weeks with no editing or lifecycle actions', async () => {
  const html = await renderToString(createSSRApp(await component('PlanForm'), { initial: plan, save: async () => {} }))
  assert.match(html, /Editar plan/)
  assert.match(html, /2026-11-01/)
  assert.match(html, /Fecha final/)
  const readonly = await renderToString(createSSRApp(await component('PlanWeekCard'), {
    week: { ...week, days: [day], pendingExercises: [] }, editable: false, busy: false, nextWeekNumber: 2, actions: {},
  }))
  assert.match(readonly, /Press de banca/)
  assert.match(readonly, /42.125/)
  assert.doesNotMatch(readonly, /Editar prescripción|Añadir ejercicio|Editar semana|Eliminar|Activar|Finalizar/)
  const empty = await renderToString(createSSRApp(await component('PlanWeekCard'), {
    week: { ...week, days: [], pendingExercises: [] }, editable: true, busy: true, nextWeekNumber: 2, actions: {},
  }))
  assert.match(empty, /todavía no tiene días/)
  assert.match(empty, /disabled/)
})

test('plan form validates dates and prevents duplicate saves', async (t) => {
  let calls = 0
  let finish
  const state = mount(await component('PlanForm'), { save: () => { calls++; return new Promise(resolve => { finish = resolve }) } }, t)
  state.form.name = 'Plan'
  state.form.startsOn = '2026-11-02'
  state.form.endsOn = '2026-11-01'
  await state.submit()
  assert.equal(calls, 0)
  assert.match(state.error, /anterior/)
  state.form.endsOn = ''
  const pending = state.submit()
  await state.submit()
  assert.equal(calls, 1)
  assert.equal(state.pending, true)
  finish(); await pending
  assert.equal(state.pending, false)
})

test('week and prescription forms validate inputs and send only permitted fields', async (t) => {
  let saved
  const weekForm = mount(await component('WeekForm'), { nextNumber: 2, save: async input => { saved = input } }, t)
  await weekForm.submit()
  assert.deepEqual(saved, { weekNumber: 2 })
  weekForm.number = '521'
  await weekForm.submit()
  assert.match(weekForm.error, /520/)

  const edit = mount(await component('PrescriptionForm'), { initial: prescription, save: async input => { saved = input } }, t)
  edit.form.targetSets = 0
  await edit.submit()
  assert.match(edit.error, /mínimo/)
  edit.form.targetSets = 4
  edit.form.targetLoad = '42.1234'
  await edit.submit()
  assert.match(edit.error, /decimales/)
  edit.form.targetLoad = '42.125'
  await edit.submit()
  assert.equal(saved.targetSets, 4)
  assert.equal(saved.targetLoad, 42.125)
  assert.equal('exerciseId' in saved, false)

  const create = mount(await component('PrescriptionForm'), { save: async input => { saved = input } }, t)
  await create.submit()
  assert.match(create.error, /Selecciona/)
  create.exerciseId = exerciseId
  create.form.targetSets = '3'
  create.form.targetReps = '8'
  await create.submit()
  assert.equal(saved.exerciseId, exerciseId)
})

test('failed saves display an error and reset the submitting state', async (t) => {
  const state = mount(await component('PlanForm'), {
    initial: plan, save: async () => { throw { isAxiosError: true, response: { status: 409, data: { message: 'linked to training history' } } } },
  }, t)
  await state.submit()
  assert.equal(state.pending, false)
  assert.match(state.error, /historial/)
})

test('exercise picker loads the real catalog service contract on mount', async (t) => {
  // The SFC runs through Vite's module graph, so install the adapter there too.
  const { api: viewApi } = await server.ssrLoadModule('/src/services/api.ts')
  const requests=[]
  viewApi.defaults.adapter = async config => { requests.push(config); return response(config, config.url.endsWith('muscle-groups')?[]:{ items: [], total: 0, limit: 20, offset: 0 }) }
  t.after(() => { viewApi.defaults.adapter = undefined })
  const picker = mount(await component('ExercisePicker'), { modelValue: '' }, t)
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  const request=requests.find(r=>r.url==='/exercises/visible')
  assert.ok(request)
  assert.deepEqual(request.params, { limit: 20, offset: 0,selection:'FEATURED' })
  assert.equal(picker.loading, false)
  assert.equal(picker.errorMessage, '')
})

test('day form supports fixed/flexible schedules, validates input and prevents duplicate submissions', async t => {
  let saved
  let finish
  let calls = 0
  const state = mount(await component('PlanDayForm'), { busy: false, nextPosition: 2, save: input => { saved = input; calls++; return new Promise(resolve => { finish = resolve }) } }, t)
  await state.submit(); assert.match(state.error, /nombre/); assert.equal(calls, 0)
  state.form.name = 'Superior B'; state.form.weekday = '1'
  const pending = state.submit(); await state.submit()
  assert.equal(calls, 1); assert.equal(state.pending, true)
  assert.deepEqual(saved, { name: 'Superior B', position: 2, weekday: 1 })
  finish(); await pending; assert.equal(state.pending, false)
  const html = await renderToString(createSSRApp(await component('PlanDayForm'), { busy: false, save: async () => {} }))
  assert.match(html, /Flexible/); assert.match(html, /Lunes/); assert.match(html, /varios bloques/)
})

test('daily prescription form validates ranges and units, preserves unknown historical loads and resets errors', async t => {
  let saved
  const state = mount(await component('PrescriptionForm'), { daily: true, initial: dailyPrescription, save: async input => { saved = input } }, t)
  state.form.targetRepsMin = '10'; state.form.targetRepsMax = '6'
  await state.submit(); assert.match(state.error, /rango/)
  state.form.targetRepsMin = '6'; state.form.targetRepsMax = '10'; state.form.targetLoad = '45'
  await state.submit(); assert.match(state.error, /unidad/)
  state.form.targetLoadUnit = 'LB'
  await state.submit(); assert.equal(saved.targetLoadUnit, 'LB'); assert.equal(saved.targetRepsMax, 10)
  assert.equal('targetReps' in saved, false); assert.equal('exerciseId' in saved, false)
  const legacy = mount(await component('PrescriptionForm'), { daily: true, initial: dailyPrescription, save: async input => { saved = input } }, t)
  await legacy.submit(); assert.equal(saved.targetLoad, 42.125); assert.equal(saved.targetLoadUnit, null)
})

test('renders fixed, flexible, pending and historical programming without enabling destructive historical edits', async () => {
  const html = await renderToString(createSSRApp(await component('PlanWeekCard'), {
    week: { ...week, days: [{ ...day, weekday: 1, hasHistory: true, exercises: [{ ...dailyPrescription, hasHistory: true }] }, { ...day, id: exerciseId, position: 2, exercises: [] }], pendingExercises: [{ ...dailyPrescription, hasHistory: true }] },
    editable: true, busy: false, nextWeekNumber: 2, actions: {},
  }))
  assert.match(html, /Lunes/); assert.match(html, /Fijo/); assert.match(html, /Flexible/)
  assert.match(html, /pendientes de distribuir/); assert.match(html, /unidad desconocida/)
  assert.match(html, /Duplicar día/); assert.match(html, /Duplicar semana completa/)
  assert.match(html, /disabled[^>]*>Editar objetivos/); assert.doesNotMatch(html, /Mover al día/)
})

test('day actions report rejected history operations and reorder only their own prescriptions', async t => {
  let order
  const state = mount(await component('PlanDayCard'), { day: { ...day, exercises: [dailyPrescription, { ...dailyPrescription, id: exerciseId, position: 2 }] }, weekId: week.id, editable: true, busy: false, copyPosition: 2, actions: { reorderExercises: async (...args) => { order = args } } }, t)
  await state.move(dailyPrescription.id, 1)
  assert.deepEqual(order, [week.id, day.id, [exerciseId, dailyPrescription.id]])
  await state.run(async () => { throw { isAxiosError: true, response: { status: 409, data: { message: 'training history' } } } })
  assert.match(state.error, /historial/)
})

test('week duplication validates the destination before calling the API and reports failures', async t => {
  let copied
  const state = mount(await component('PlanWeekCard'), { week: { ...week, days: [], pendingExercises: [] }, editable: true, busy: false, nextWeekNumber: 2, actions: { copyWeek: async (...args) => { copied = args } } }, t)
  state.copyNumber = '521'; await state.duplicateWeek()
  assert.equal(copied, undefined); assert.match(state.error, /520/)
  state.copyNumber = '2'; await state.duplicateWeek()
  assert.deepEqual(copied, [week.id, 2]); assert.equal(state.error, '')
})
