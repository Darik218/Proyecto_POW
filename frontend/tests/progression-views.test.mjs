import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { createRenderer, createSSRApp, nextTick } from 'vue'
import { renderToString } from '@vue/server-renderer'
let server
before(async () => {
  server = await createServer({
    configFile: resolve('vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: 'error',
    plugins: [
      {
        name: 'progression-test-router',
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
  (await server.ssrLoadModule(`/src/components/progression/${name}.vue`))
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
function mount(Component, props, t) {
  const app = renderer.createApp({ ...Component, render: () => null }, props)
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const instance = app.mount({})
  t.after(() => app.unmount())
  return { state: instance.$.setupState, props: instance.$.props }
}
const id = '10000000-0000-4000-8000-000000000001',
  hash = 'a'.repeat(64)
const value = () => ({
  proposal: {
    id,
    status: 'PENDING',
    reviewVersion: null,
    generation: {
      semanticKey: hash,
      dependencyKeys: {
        configuration: hash,
        period: hash,
        destination: hash,
        evidence: hash,
      },
    },
  },
  events: [],
  validity: { state: 'CURRENT' },
  compatibility: { compatible: true, reasons: [] },
  cycle: { key: hash },
  approvalBlockers: [],
  acceptanceChallenge: {
    schemaVersion: 'manual-proposal-acceptance-v1',
    scope: 'THIS_PROPOSAL_ONLY',
    authorizationKey: hash,
    policyKey: hash,
  },
})
test('las confirmaciones comienzan desmarcadas y ambas acciones humanas son necesarias', async (t) => {
  const sent = [],
    { state } = mount(
      await component('RecommendationReview'),
      {
        value: value(),
        busy: false,
        session: 's1',
        onDecide: (input) => sent.push(input),
      },
      t,
    )
  assert.equal(state.policy, false)
  assert.equal(state.evidence, false)
  state.decide('APPROVE')
  state.policy = true
  state.decide('APPROVE')
  assert.equal(sent.length, 0)
  state.evidence = true
  state.decide('APPROVE')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].acceptance.scope, 'THIS_PROPOSAL_ONLY')
  assert.equal(sent[0].acceptance.acceptPolicy, true)
  assert.equal(sent[0].acceptance.authorizationKey, hash)
})
test('cambiar propuesta o sesión invalida las confirmaciones anteriores', async (t) => {
  const { state, props } = mount(
    await component('RecommendationReview'),
    { value: value(), busy: false, session: 's1' },
    t,
  )
  state.policy = true
  state.evidence = true
  props.value = {
    ...value(),
    proposal: {
      ...value().proposal,
      id: '20000000-0000-4000-8000-000000000001',
    },
  }
  await nextTick()
  assert.equal(state.policy, false)
  assert.equal(state.evidence, false)
  state.policy = true
  state.evidence = true
  props.session = 's2'
  await nextTick()
  assert.equal(state.policy, false)
})
test('un rechazo requiere justificación y no contiene aceptación ni aplicación', async (t) => {
  const sent = [],
    { state } = mount(
      await component('RecommendationReview'),
      {
        value: value(),
        busy: false,
        session: 's1',
        onDecide: (v) => sent.push(v),
      },
      t,
    )
  state.decide('REJECT')
  assert.equal(sent.length, 0)
  state.justification = 'No corresponde.'
  state.decide('REJECT')
  assert.equal(sent[0].action, 'REJECT')
  assert.equal(sent[0].acceptance, undefined)
})
test('bloqueos, revisiones consumidas y peticiones en curso impiden aprobar', async (t) => {
  for (const extra of [
    { approvalBlockers: ['OBSOLETE'] },
    { proposal: { ...value().proposal, status: 'APPROVED' } },
  ]) {
    const sent = [],
      { state } = mount(
        await component('RecommendationReview'),
        {
          value: { ...value(), ...extra },
          busy: false,
          session: 's1',
          onDecide: (v) => sent.push(v),
        },
        t,
      )
    state.policy = true
    state.evidence = true
    state.decide('APPROVE')
    assert.equal(sent.length, 0)
  }
})
test('aprobar no renderiza una aplicación automática y el formulario conserva etiquetas accesibles', async () => {
  const html = await renderToString(
    createSSRApp(await component('RecommendationReview'), {
      value: value(),
      busy: false,
      session: 's1',
    }),
  )
  assert.match(html, /Aprobar solo esta propuesta/)
  assert.match(html, /Rechazar propuesta/)
  assert.match(html, /type="checkbox"/)
  assert.doesNotMatch(html, / checked/)
  assert.match(html, /no modifica la planificación/)
})
test('el recibo conserva la precisión oficial y la identificación de auditoría', async () => {
  const html = await renderToString(
    createSSRApp(await component('ApplicationReceipt'), {
      value: {
        id,
        auditId: id,
        recommendationId: id,
        intentId: id,
        status: 'APPLIED',
        previousLoad: '80.000000',
        appliedLoad: '80.000001',
        loadUnit: 'KG',
        planExerciseId: id,
        scheduledActivityId: id,
        destination: { planVersionBefore: 0, planVersionAfter: 1 },
        temporal: { scheduledOn: '2026-02-01', timeZone: 'UTC' },
        effectiveAt: '2026-01-01T00:00:00Z',
      },
    }),
  )
  assert.match(html, /80\.000001 KG/)
  assert.match(html, /auditoría/)
  assert.match(html, /APPLIED/)
})
test('las rutas nuevas heredan los guards y layouts reales', async () => {
  const { router } = await server.ssrLoadModule('/src/router/index.ts')
  for (const path of [
    '/app/progression',
    '/app/progression/new',
    '/app/progression/recommendations/' + id,
  ])
    assert.equal(router.resolve(path).meta.requiresAuth, true)
  await router.push('/app/progression')
  assert.equal(router.currentRoute.value.name, 'login')
})

test('todos los componentes nuevos compilan para navegador con la transformación Vite real', async () => {
  for (const name of [
    'RecommendationApply',
    'RecommendationReview',
    'ApplicationReceipt',
    'ProgressionStatus',
    'ProgressionEvidence',
    'ProgressionForm',
  ]) {
    const result = await server.transformRequest(
      '/src/components/progression/' + name + '.vue',
    )
    assert.ok(result?.code.includes('export default'))
  }
})
