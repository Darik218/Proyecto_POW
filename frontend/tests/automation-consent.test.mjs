import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError } from 'axios'
import {
  consentRequestSchema,
  consentContractSchema,
  consentInspectionSchema,
} from '../src/schemas/automation-consent.schema.ts'
import {
  rememberConsentIntent,
  recoverConsentIntent,
} from '../src/utils/consent-intents.ts'
import { policyFormValues, contractFields } from '../src/utils/consent-form.ts'
import {
  automationConsentService as service,
  consentError,
} from '../src/services/automation-consent.service.ts'
import { useAutomationConsentStore } from '../src/stores/automation-consent.store.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  original = { ...service }
after(() => Object.assign(service, original))
function cache() {
  const m = new Map()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    m,
  }
}
const pending = {
  accountId: id(1),
  sessionContext: 'real-context',
  intentId: id(2),
  consentId: null,
  action: 'CREATE',
  createdAt: 1000,
}
test('consent identifiers roundtrip with account/session isolation, TTL and no payload', () => {
  const s = cache()
  rememberConsentIntent(s, {
    ...pending,
    contract: { private: 'not persisted' },
    accessToken: 'secret',
  })
  assert.doesNotMatch([...s.m.values()][0], /private|secret|contract/)
  assert.deepEqual(
    recoverConsentIntent(s, id(1), 'real-context', 1001),
    pending,
  )
  assert.equal(recoverConsentIntent(s, id(1), 'another-session', 1001), null)
  rememberConsentIntent(s, pending)
  assert.equal(recoverConsentIntent(s, id(3), 'real-context', 1001), null)
  rememberConsentIntent(s, pending)
  assert.equal(
    recoverConsentIntent(s, id(1), 'real-context', 1000 + 31 * 60000),
    null,
  )
})
test('blank forms invent neither limits, unit, dates nor policy', () => {
  const v = contractFields(undefined)
  for (const value of Object.values(v)) assert.equal(value, '')
  assert.deepEqual(policyFormValues(undefined), {})
  assert.throws(() => consentContractSchema.parse({}))
  assert.throws(() =>
    consentRequestSchema.parse({
      intentId: id(1),
      state: 'ACTIVE',
      snapshot: {},
    }),
  )
})
test('server/proxy ambiguity preserves unknown outcome while overlap remains a known conflict', () => {
  assert.equal(consentError(new AxiosError('lost')).uncertain, true)
  assert.equal(
    consentError(
      new AxiosError('proxy', undefined, undefined, undefined, {
        status: 504,
        data: {},
      }),
    ).uncertain,
    true,
  )
  const r = consentError(
    new AxiosError('SQL details', undefined, undefined, undefined, {
      status: 409,
      data: { code: 'AMBIGUOUS_AUTOMATION_CONSENT' },
    }),
  )
  assert.equal(r.uncertain, false)
  assert.match(r.message, /superpuestas/)
  assert.doesNotMatch(r.message, /SQL/)
})
function setup() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.status = 'authenticated'
  auth.user = { id: id(1) }
  auth.accessToken = 'memory-only'
  auth.getSessionContextId = () => pending.sessionContext
  return { auth, store: useAutomationConsentStore() }
}
const detail = (state = 'PENDING_CONFIRMATION', version = 1) => ({
  id: id(4),
  state,
  version,
  snapshot: { contract: { termsVersion: 'v1' } },
  executionAuthorized: false,
})
test('late owned reads cannot expose old private data after account change', async () => {
  const { auth, store } = setup()
  let finish
  service.inspect = () => new Promise((r) => (finish = r))
  const promise = store.open(id(4))
  auth.clearSession()
  auth.user = { id: id(9) }
  finish(detail())
  await promise
  assert.equal(store.detail, null)
  Object.assign(service, original)
})
test('lost create is recovered through original intent and current revoked state, not old receipt state', async () => {
  const { store } = setup()
  store.preview = { snapshot: {} }
  service.request = async () => {
    throw new AxiosError('lost')
  }
  await store.submit('CREATE', { termsVersion: 'v1' })
  const intent = store.pending.intentId
  assert.equal(store.error.uncertain, true)
  service.operation = async (sent) => {
    assert.equal(sent, intent)
    return {
      id: id(6),
      intentId: intent,
      consentId: id(4),
      state: 'PENDING_CONFIRMATION',
      version: 1,
    }
  }
  service.inspect = async () => detail('REVOKED', 2)
  await store.recover()
  assert.equal(store.pending, null)
  assert.equal(store.detail.state, 'REVOKED')
  assert.equal(store.receipt.state, 'PENDING_CONFIRMATION')
  Object.assign(service, original)
})
test('duplicate clicks and retry keep the exact original revision and intent', async () => {
  const { store } = setup()
  store.detail = detail()
  store.preview = { snapshot: {} }
  let finish,
    calls = []
  service.revise = (id, input) => {
    calls.push(structuredClone(input))
    return new Promise(
      (_, reject) => (finish = () => reject(new AxiosError('lost'))),
    )
  }
  const contract = { termsVersion: 'v1', limits: { maximumLoad: '80.000001' } },
    first = store.submit('REVISE', contract)
  await store.submit('REVISE', contract)
  finish()
  await first
  contract.limits.maximumLoad = '100'
  service.revise = async (id, input) => {
    calls.push(input)
    return { id: 'event', consentId: id }
  }
  service.inspect = async () => detail('PENDING_CONFIRMATION', 2)
  await store.retry()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[1].contract.limits.maximumLoad, '80.000001')
  assert.equal(store.detail.version, 2)
  Object.assign(service, original)
})
test('revoked requests have no new revise/revoke action, and old sessions cannot overwrite new state', async () => {
  const { store, auth } = setup()
  store.detail = detail('REVOKED', 2)
  let count = 0
  service.revoke = async () => {
    count++
  }
  await store.submit('REVOKE')
  assert.equal(count, 0)
  store.detail = detail()
  let finish
  service.revoke = () => new Promise((r) => (finish = r))
  const p = store.submit('REVOKE')
  auth.clearSession()
  auth.user = { id: id(8) }
  finish({ consentId: id(4) })
  await p
  assert.equal(store.detail, null)
  assert.equal(store.pending, null)
  Object.assign(service, original)
})
test('invalidating a deferred preview frees busy without applying stale conditions', async () => {
  const { store } = setup()
  let finish
  service.preview = () => new Promise((r) => (finish = r))
  const p = store.generate({})
  store.invalidate()
  finish({ snapshot: {} })
  await p
  assert.equal(store.preview, null)
  assert.equal(store.busy, false)
  Object.assign(service, original)
})
test('a confirmed mutation survives a known inspection error with its receipt and original intention', async () => {
  const { store } = setup()
  store.preview = { snapshot: {} }
  service.request = async (input) => ({
    id: id(7),
    intentId: input.intentId,
    consentId: id(4),
    state: 'PENDING_CONFIRMATION',
  })
  service.inspect = async () => {
    throw new AxiosError('read failed', undefined, undefined, undefined, {
      status: 422,
      data: { code: 'CONSENT_CORRUPT' },
    })
  }
  await store.submit('CREATE', { termsVersion: 'v1' })
  assert.equal(store.receipt.id, id(7))
  assert.ok(store.pending)
  assert.equal(store.error.uncertain, true)
  Object.assign(service, original)
})
test('Zod preserves exact load strings and offset instants, rejecting active state injection', async () => {
  const { consentFixture } = await import('./automation-consent.fixtures.mjs'),
    v = consentFixture(),
    parsed = consentContractSchema.parse(v.contract)
  assert.equal(parsed.limits.maximumLoad, '200.000001')
  assert.equal(parsed.validity.startsAt, '2026-12-01T09:00:00-05:00')
  assert.throws(() =>
    consentContractSchema.parse({
      ...v.contract,
      limits: { ...v.contract.limits, maximumLoad: 200 },
    }),
  )
  assert.throws(() =>
    consentRequestSchema.parse({
      intentId: id(2),
      contract: v.contract,
      humanAcceptance: 'ACCEPTED',
    }),
  )
})
