import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError } from 'axios'
import { api } from '../src/services/api.ts'
import {
  progressionService,
  progressionError,
} from '../src/services/progression.service.ts'
import {
  progressionCommandSchema,
  progressionPolicySchema,
  receiptSchema,
} from '../src/schemas/progression.schema.ts'
import {
  setPositions,
  buildProgressionPolicy,
} from '../src/utils/progression-inputs.ts'
import {
  rememberProgressionIntent,
  recoverProgressionIntent,
} from '../src/utils/progression-intents.ts'
import { useProgressionStore } from '../src/stores/progression.store.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const command = {
  history: {
    exerciseId: id(1),
    from: '2026-01-01',
    to: '2026-01-11',
    timeZone: 'UTC',
    limit: 100,
  },
  period: {
    start: '2026-01-05',
    endExclusive: '2026-01-12',
    cutoffOn: '2026-01-11',
    timeZone: 'UTC',
    weekStartsOn: 1,
  },
  destination: {
    kind: 'PRESCRIPTION',
    planId: id(2),
    weekId: id(3),
    dayId: id(4),
    prescriptionId: id(5),
  },
}
const receipt = {
  id: id(6),
  auditId: id(6),
  recommendationId: id(7),
  intentId: id(8),
  status: 'APPLIED',
  origin: 'MANUAL',
  previousLoad: '80.000000',
  appliedLoad: '82.500000',
  loadUnit: 'KG',
  planExerciseId: id(5),
  scheduledActivityId: id(9),
  reviewId: id(10),
  effectiveAt: '2026-01-20T00:00:00.000Z',
  destination: {
    planId: id(2),
    weekId: id(3),
    dayId: id(4),
    prescriptionId: id(5),
    planVersionBefore: 0,
    planVersionAfter: 1,
  },
  temporal: { scheduledOn: '2026-01-21', timeZone: 'UTC' },
}
const proposal = {
  id: id(7),
  exerciseId: id(1),
  status: 'APPLIED',
  createdAt: '2026-01-01T00:00:00.000Z',
  reviewVersion: 1,
  reviewedAt: null,
  expiresAt: null,
  previousLoad: '80.000000',
  recommendedLoad: '82.500000',
  loadUnit: 'KG',
  generation: null,
  cycleKey: null,
  generationState: 'LEGACY_UNKNOWN',
}
const response = (config, data) => ({
  config,
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
})
const oldAdapter = api.defaults.adapter,
  originals = { ...progressionService }
after(() => {
  api.defaults.adapter = oldAdapter
  Object.assign(progressionService, originals)
})
test('contratos: conserva cadenas decimales y rechaza números o campos internos', () => {
  assert.equal(receiptSchema.parse(receipt).appliedLoad, '82.500000')
  for (const extra of [
    { appliedLoad: 82.5 },
    { loadUnit: 'unknown' },
    { passwordHash: 'internal' },
  ])
    assert.throws(() => receiptSchema.parse({ ...receipt, ...extra }))
})
test('entrada: no admite propietario, snapshots ni cambios genéricos de estado', () => {
  assert.deepEqual(progressionCommandSchema.parse(command), command)
  for (const extra of [
    { athleteId: id(1) },
    { snapshot: {} },
    { status: 'APPROVED' },
  ])
    assert.throws(() =>
      progressionCommandSchema.parse({ ...command, ...extra }),
    )
  assert.throws(() =>
    progressionCommandSchema.parse({
      ...command,
      history: { ...command.history, limit: 101 },
    }),
  )
})
test('las posiciones son explícitas, enteras y únicas', () => {
  assert.deepEqual(setPositions('1, 3,2'), [1, 3, 2])
  for (const v of ['', '0', '1,1', '1.5', '-2'])
    assert.throws(() => setPositions(v))
})
test('la política requiere configuración real y no inventa mínimos operativos', () => {
  assert.throws(() => buildProgressionPolicy({}, {}, [], '', null))
  assert.throws(() => progressionPolicySchema.parse({}))
  const f = {
    id: 'human',
    version: 'v1',
    reference: 'explicit',
    basis: 'ADJUSTED',
    basicReps: 'MINIMUM',
    basicLoad: 'AT_LEAST_TARGET',
    readinessReps: 'UPPER_BOUND',
    readinessLoad: 'AT_LEAST_TARGET',
    rpeMin: '6',
    rpeMax: '8',
    criterion: 'BASIC',
    mode: 'ACCUMULATED',
    sameDate: 'DISTINCT_SESSIONS',
    settingRpeUse: 'REQUIRE_INTERVAL',
    review: 'NOT_REQUIRED_EXPLICIT',
    incrementMode: 'ABSOLUTE',
    unit: 'KG',
    step: '2.5',
    origin: '0',
    gridSource: 'declared',
    closed: 'true',
  }
  const p = buildProgressionPolicy(
    f,
    { [id(1)]: { original: '1', adjusted: '1' } },
    [id(1)],
    id(1),
    { minSuccessfulSessions: 4 },
  )
  assert.equal(p.assessment.count.minimumSessions, 4)
  assert.equal(p.grid.step, '2.5')
  assert.equal(p.oneRm, 'DESCRIPTIVE_CONTEXT_ONLY')
})
function cache() {
  const data = new Map()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    data,
  }
}
const pending = {
  accountId: id(1),
  sessionContext: 'actual-session-context',
  kind: 'APPLY',
  recommendationId: id(7),
  intentId: id(8),
  semanticKey: 'a'.repeat(64),
  createdAt: 1000,
}
test('roundtrip: cache solo de identificadores, sin secretos, caduca', () => {
  const s = cache()
  rememberProgressionIntent(s, {
    ...pending,
    accessToken: 'secret',
    snapshot: { private: 'data' },
  })
  assert.doesNotMatch([...s.data.values()][0], /secret|snapshot|private/)
  assert.deepEqual(
    recoverProgressionIntent(s, id(1), pending.sessionContext, 1001),
    pending,
  )
  assert.equal(
    recoverProgressionIntent(
      s,
      id(1),
      pending.sessionContext,
      1000 + 31 * 60000,
    ),
    null,
  )
})
test('otra cuenta o nueva sesión de la misma cuenta no recupera intenciones anteriores', () => {
  for (const [account, context] of [
    [id(2), pending.sessionContext],
    [id(1), 'new-session'],
  ]) {
    const s = cache()
    rememberProgressionIntent(s, pending)
    assert.equal(recoverProgressionIntent(s, account, context, 1001), null)
    assert.equal(s.data.size, 0)
  }
})
test('Axios usa el cliente existente y valida el recibo', async () => {
  let sent
  api.defaults.adapter = async (config) => {
    sent = config
    return response(config, receipt)
  }
  assert.deepEqual(await progressionService.receipt(id(7)), receipt)
  assert.equal(sent.url, `/progression/recommendations/${id(7)}/application`)
  assert.equal(sent.method, 'get')
})
test('errores: red no equivale a rechazo y no expone SQL', () => {
  assert.equal(progressionError(new AxiosError('secret')).uncertain, true)
  const e = new AxiosError(
    'Prisma SQL internal',
    undefined,
    undefined,
    undefined,
    {
      status: 409,
      data: {
        code: 'INTENT_REUSED',
        message: 'SQL password',
        reasons: ['CONFLICT'],
      },
    },
  )
  assert.match(progressionError(e).message, /intención/)
  assert.doesNotMatch(progressionError(e).message, /SQL|password/)
  assert.deepEqual(progressionError(e).reasons, ['CONFLICT'])
})
function store() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.status = 'authenticated'
  auth.user = {
    id: id(1),
    email: 'fixture@test',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
  auth.accessToken = 'memory-fixture'
  auth.getSessionContextId = () => pending.sessionContext
  return { auth, state: useProgressionStore() }
}
test('respuesta tardía no sustituye datos tras cambiar de cuenta', async () => {
  const { state, auth } = store()
  let finish
  progressionService.list = () => new Promise((r) => (finish = r))
  const op = state.loadList()
  auth.clearSession()
  auth.user = { id: id(2) }
  finish({ items: [], page: 1, limit: 20, total: 0 })
  await op
  assert.equal(state.list, null)
  Object.assign(progressionService, originals)
})
test('selección más reciente prevalece ante consultas fuera de orden', async () => {
  const { state } = store()
  let first
  progressionService.list = ({ page }) =>
    page === 1
      ? new Promise((r) => (first = r))
      : Promise.resolve({ items: [], page: 2, limit: 20, total: 25 })
  const old = state.loadList(1)
  await state.loadList(2)
  first({ items: [], page: 1, limit: 20, total: 25 })
  await old
  assert.equal(state.list.page, 2)
  Object.assign(progressionService, originals)
})
test('respuesta perdida: conserva intención y recupera recibo sin segunda aplicación', async () => {
  const { state } = store()
  state.readiness = {
    eligible: true,
    command: {
      recommendationId: id(7),
      intentId: id(8),
      appliedLoad: '82.500000',
    },
  }
  let writes = 0
  progressionService.apply = async () => {
    writes++
    throw new AxiosError('Network response lost')
  }
  progressionService.receipt = async () => receipt
  progressionService.inspect = async () => ({ proposal, events: [] })
  await state.apply()
  assert.equal(state.pending.intentId, id(8))
  assert.equal(state.error.uncertain, true)
  assert.equal(state.receipt, null)
  await state.recover()
  assert.equal(state.receipt.appliedLoad, '82.500000')
  assert.equal(state.pending, null)
  await state.retry()
  assert.equal(writes, 1)
  Object.assign(progressionService, originals)
})
test('doble clic y reintento mantienen el payload original aunque cambie la selección', async () => {
  const { state } = store()
  state.readiness = {
    eligible: true,
    command: {
      recommendationId: id(7),
      intentId: id(8),
      appliedLoad: '82.500000',
    },
  }
  const requests = []
  let finish
  progressionService.apply = (id, input) => {
    requests.push(structuredClone(input))
    return new Promise(
      (_, reject) => (finish = () => reject(new AxiosError('lost'))),
    )
  }
  const op = state.apply()
  await state.apply()
  finish()
  await op
  state.readiness.command.appliedLoad = '90'
  progressionService.apply = async (id, input) => {
    requests.push(input)
    return receipt
  }
  progressionService.get = async () => proposal
  progressionService.inspect = async () => ({ proposal, events: [] })
  await state.retry()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].appliedLoad, '82.500000')
  assert.equal(state.receipt.id, receipt.id)
  assert.equal(state.inspection.proposal.status, 'APPLIED')
  assert.equal(state.readiness, null)
  Object.assign(progressionService, originals)
})
test('invalidar selección no deja busy bloqueado al descartar una respuesta tardía', async () => {
  const { state } = store()
  let finish
  progressionService.readiness = () => new Promise((r) => (finish = r))
  const op = state.prepareApplication(id(7), id(9), id(8))
  state.clearApplication()
  finish({ eligible: true, command: {} })
  await op
  assert.equal(state.busy, false)
  assert.equal(state.readiness, null)
  Object.assign(progressionService, originals)
})

test('un HTTP 504 conserva el resultado incierto y no expone mensajes del proxy', () => {
  const e = new AxiosError('upstream', undefined, undefined, undefined, {
    status: 504,
    data: {},
  })
  assert.equal(progressionError(e).uncertain, true)
  assert.doesNotMatch(progressionError(e).message, /upstream/)
})
test('confirmed 6A apply retains its receipt when a later inspection fails', async () => {
  const { state } = store()
  state.readiness = {
    eligible: true,
    command: {
      recommendationId: id(7),
      intentId: id(8),
      appliedLoad: '82.500000',
    },
  }
  progressionService.apply = async () => receipt
  progressionService.inspect = async () => {
    throw new AxiosError('read failed', undefined, undefined, undefined, {
      status: 422,
      data: { code: 'SNAPSHOT_INVALID' },
    })
  }
  await state.apply()
  assert.equal(state.receipt.id, receipt.id)
  assert.ok(state.pending)
  assert.equal(state.error.uncertain, true)
  Object.assign(progressionService, originals)
})
