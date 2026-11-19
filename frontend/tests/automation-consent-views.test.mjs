import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { createPinia } from 'pinia'
import { createRenderer, createSSRApp, nextTick } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { consentFixture, cid } from './automation-consent.fixtures.mjs'
let server
before(async () => {
  server = await createServer({
    configFile: resolve('vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: 'error',
    plugins: [
      {
        name: 'consent-memory-router',
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
const component = async (name) =>
  (await server.ssrLoadModule(`/src/components/automation/${name}.vue`)).default
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
function mount(Component, props, t, pinia = createPinia()) {
  const app = renderer.createApp({ ...Component, render: () => null }, props)
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  app.use(pinia)
  const instance = app.mount({})
  t.after(() => app.unmount())
  return { state: instance.$.setupState, app, pinia }
}
test('all consent components and views compile for real browser rendering', async () => {
  for (const path of [
    'components/automation/ConsentAcceptance',
    'components/automation/ConsentForm',
    'components/automation/ConsentConditions',
    'components/automation/ConsentStatus',
    'views/AutomationConsentsView',
    'views/NewAutomationConsentView',
    'views/AutomationConsentDetailView',
  ])
    assert.ok(
      (await server.transformRequest('/src/' + path + '.vue')).code.includes(
        'export default',
      ),
    )
})
test('new consent form does not select a target, dates, unit, policy or declaration', async (t) => {
  const { state } = mount(await component('ConsentForm'), { busy: false }, t)
  assert.equal(state.form.unit, '')
  assert.equal(state.form.maximumLoad, '')
  assert.equal(state.form.startsAt, '')
  assert.equal(state.declaration, false)
  assert.deepEqual(state.targetIds, [])
  assert.deepEqual(state.policy, {})
})
test('partial historical policy opens with empty correctable slots instead of fabricated evidence or a crash', async (t) => {
  const initial = consentFixture()
  initial.contract.policy.assessment.compliance.slots = []
  const { state } = mount(
    await component('ConsentForm'),
    { initial, busy: false },
    t,
  )
  assert.deepEqual(state.slots[cid(2)], { original: '', adjusted: '' })
  assert.equal(state.declaration, false)
})
test('form discards a late plan result after unmount', async (t) => {
  const m = await server.ssrLoadModule(
      '/src/services/training-plans.service.ts',
    ),
    original = m.trainingPlansService.list
  let finish
  m.trainingPlansService.list = () => new Promise((r) => (finish = r))
  const { state, app } = mount(
    await component('ConsentForm'),
    { busy: false },
    t,
  )
  app.unmount()
  finish([{ id: cid(3), name: 'old private data' }])
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(state.plans, [])
  m.trainingPlansService.list = original
})
test('exact contract conditions retain offsets, decimals, scope and no acceptance claim', async () => {
  const html = await renderToString(
    createSSRApp(await component('ConsentConditions'), {
      value: consentFixture(),
    }),
  )
  assert.match(html, /200\.000001 KG/)
  assert.match(html, /2026-12-01T09:00:00-05:00/)
  assert.match(html, /EXACT_PRESCRIPTION_ALLOWLIST/)
  assert.match(html, /NOT_RECORDED/)
  assert.match(html, /captura histórica de configuración/)
  assert.match(html, /consulta el permiso operativo actual por separado/)
  assert.doesNotMatch(html, /type="checkbox"|ACTIVE/)
})
test('new routes inherit the real auth guard and layout without replacing progression', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  for (const path of [
    '/app/progression/automation',
    '/app/progression/automation/new',
    '/app/progression/automation/' + cid(1),
  ])
    assert.equal(router.resolve(path).meta.requiresAuth, true)
  await router.push('/app/progression/automation')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(
    router.resolve('/app/progression/recommendations/' + cid(1)).name,
    'progression-detail',
  )
})
test('cambiar filtros de candidatos no cancela la carga independiente de planes de la misma sesión', async (t) => {
  const module = await server.ssrLoadModule(
      '/src/services/training-plans.service.ts',
    ),
    original = module.trainingPlansService.list
  let finish
  module.trainingPlansService.list = () => new Promise((r) => (finish = r))
  try {
    const { state } = mount(await component('ConsentForm'), { busy: false }, t)
    state.form.exerciseId = cid(1)
    await new Promise((r) => setImmediate(r))
    finish([{ id: cid(3), name: 'same-session plan' }])
    await new Promise((r) => setImmediate(r))
    assert.equal(state.plans[0]?.id, cid(3))
  } finally {
    module.trainingPlansService.list = original
  }
})

test('human acknowledgment component starts unchecked, requires all five, and emits only after explicit confirmation', async (t) => {
  const C = await component('ConsentAcceptance'),
    snapshot = consentFixture(),
    challenge = {
      id: cid(8),
      consentId: cid(9),
      version: 1,
      termsVersion: 'terms-v1',
      presentationVersion: 'recurring-consent-presentation-v1',
      expiresAt: '2099-01-01T00:00:00Z',
      contractKey: 'a'.repeat(64),
      conditionsKey: 'b'.repeat(64),
      snapshot,
    }
  const { state, app } = mount(C, { challenge, busy: false, session: 'one' }, t)
  assert.deepEqual(
    { ...state.acknowledgments },
    {
      policy: false,
      limits: false,
      destinations: false,
      validity: false,
      revocation: false,
    },
  )
  state.acknowledgments.policy = true
  assert.equal(state.ready, false)
  state.confirm()
  for (const k of Object.keys(state.acknowledgments))
    state.acknowledgments[k] = true
  assert.equal(state.ready, true)
  state.confirm()
  assert.equal(state.ready, false)
  assert.equal(state.acknowledgments.policy, false)
  state.acknowledgments.policy = true
  app._instance.props.session = 'new-session'
  await nextTick()
  assert.equal(state.acknowledgments.policy, false)
  state.acknowledgments.limits = true
  app._instance.props.challenge = { ...challenge, id: cid(30) }
  await nextTick()
  assert.equal(state.acknowledgments.limits, false)
})
