import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { createPinia } from 'pinia'
import { createRenderer, nextTick } from 'vue'
let server
before(async () => {
  server = await createServer({
    configFile: resolve('vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: 'error',
    plugins: [
      {
        name: 'settings-memory-router',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('/src/router/index.ts'))
            return code.replaceAll('createWebHistory', 'createMemoryHistory')
        },
      },
    ],
  })
})
after(() => server?.close())
const component = async (n) =>
  (await server.ssrLoadModule('/src/components/progression/' + n + '.vue'))
    .default
const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})
function mount(C, props, t) {
  const app = renderer.createApp({ ...C, render: () => null }, props)
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  app.use(createPinia())
  const vm = app.mount({})
  t.after(() => app.unmount())
  return { state: vm.$.setupState, app }
}
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const parameters = {
  minSuccessfulSessions: 3,
  targetRpeMin: '6.0',
  targetRpeMax: '8.0',
  incrementPercent: null,
  incrementAbsolute: '2.500',
  maxIncrementPercent: '5.000',
  maxLoad: null,
}
test('settings forms/status/pages and modified progression form compile for actual Vue rendering', async () => {
  for (const path of [
    'components/progression/SettingForm',
    'components/progression/SettingStatus',
    'components/progression/ProgressionForm',
    'views/ProgressionSettingsView',
    'views/ProgressionSettingEditorView',
    'views/NewProgressionView',
  ])
    assert.ok(
      (await server.transformRequest('/src/' + path + '.vue')).code.includes(
        'export default',
      ),
    )
})
test('creation starts without scope, target or training defaults and no auto-authorization control', async (t) => {
  const { state } = mount(
    await component('SettingForm'),
    { busy: false, impact: null, session: 'one' },
    t,
  )
  assert.equal(state.scopeKind, '')
  assert.equal(state.exerciseId, '')
  assert.equal(state.planId, '')
  assert.equal(state.confirmed, false)
  assert.ok(Object.values(state.fields).every((v) => v === ''))
  const code = (
    await server.transformRequest('/src/components/progression/SettingForm.vue')
  ).code
  assert.doesNotMatch(code, /v-model=.[^\n]*autoApplyAuthorized/)
})
test('editing uses persisted decimals and requires renewed confirmation after parameter or session changes', async (t) => {
  const { state, app } = mount(
    await component('SettingForm'),
    {
      initial: {
        id: id(1),
        scope: 'ATHLETE',
        exerciseId: null,
        trainingPlanId: null,
        parameters,
      },
      busy: false,
      impact: { expectedRevision: 'a'.repeat(64) },
      session: 'one',
    },
    t,
  )
  assert.equal(state.fields.incrementAbsolute, '2.500')
  assert.equal(state.confirmed, false)
  state.confirmed = true
  state.fields.incrementAbsolute = '1.250'
  await nextTick()
  assert.equal(state.confirmed, false)
  state.confirmed = true
  app._instance.props.session = 'two'
  await nextTick()
  assert.equal(state.confirmed, false)
})
test('settings routes retain authentication, layout and existing progression routes', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  for (const path of [
    '/app/progression/settings',
    '/app/progression/settings/new',
    '/app/progression/settings/' + id(1),
  ])
    assert.equal(router.resolve(path).meta.requiresAuth, true)
  await router.push('/app/progression/settings')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.resolve('/app/progression/new').name, 'progression-new')
})
test('return from settings restores private draft only in memory and requires fresh declaration/context', async (t) => {
  const m = await server.ssrLoadModule(
      '/src/services/training-plans.service.ts',
    ),
    oldList = m.trainingPlansService.list,
    oldPlanning = m.trainingPlansService.getPlanning
  const draft = {
    planId: id(1),
    weekId: id(2),
    dayId: id(3),
    prescriptionId: id(4),
    dates: {
      start: '2026-12-07',
      endExclusive: '2026-12-14',
      cutoffOn: '2026-12-06',
      from: '2026-11-01',
      timeZone: 'America/Bogota',
      weekStartsOn: '1',
    },
    fields: { closed: 'true' },
    slots: {},
    selection: [id(5)],
    anchor: id(5),
    protocol: 'explicit',
    equipment: 'bar',
  }
  m.trainingPlansService.list = async () => [{ id: id(1) }]
  m.trainingPlansService.getPlanning = async () => ({
    version: 1,
    weeks: [
      {
        id: id(2),
        days: [
          { id: id(3), exercises: [{ id: id(4), exercise: { id: id(6) } }] },
        ],
      },
    ],
  })
  try {
    const { state } = mount(
      await component('ProgressionForm'),
      { busy: false, context: null, session: 'one', initialDraft: draft },
      t,
    )
    await new Promise((r) => setImmediate(r))
    assert.equal(state.planId, draft.planId)
    assert.equal(state.prescriptionId, draft.prescriptionId)
    assert.deepEqual({ ...state.dates }, draft.dates)
    assert.equal(state.declared, false)
    assert.equal(state.getDraft().equipment, 'bar')
  } finally {
    m.trainingPlansService.list = oldList
    m.trainingPlansService.getPlanning = oldPlanning
  }
})
