import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError } from 'axios'
import { consentAcceptSchema } from '../src/schemas/automation-consent.schema.ts'
import { automationConsentService as service } from '../src/services/automation-consent.service.ts'
import { useAutomationConsentStore } from '../src/stores/automation-consent.store.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
import {
  rememberConsentIntent,
  recoverConsentIntent,
} from '../src/utils/consent-intents.ts'
import { cid, consentFixture } from './automation-consent.fixtures.mjs'
const original = { ...service }
after(() => Object.assign(service, original))
const acks = () => ({
  policy: true,
  limits: true,
  destinations: true,
  validity: true,
  revocation: true,
})
const challenge = () => ({
  id: cid(8),
  consentId: cid(9),
  version: 1,
  state: 'PENDING_CONFIRMATION',
  contractKey: 'a'.repeat(64),
  conditionsKey: 'b'.repeat(64),
  contextKey: 'c'.repeat(64),
  termsVersion: 'test-v1',
  presentationVersion: 'recurring-consent-presentation-v1',
  snapshot: consentFixture(),
  expiresAt: '2099-01-01T00:00:00Z',
})
function setup() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = { id: cid(1) }
  auth.status = 'authenticated'
  auth.accessToken = 'memory-only'
  auth.getSessionContextId = () => 'session-context'
  const store = useAutomationConsentStore()
  store.detail = {
    id: cid(9),
    version: 1,
    state: 'PENDING_CONFIRMATION',
    acceptance: { available: true },
  }
  return { auth, store }
}
test('acceptance rejects unchecked acknowledgments and raw accepted state', () => {
  const c = challenge(),
    { id, version, ...other } = c
  const input = {
    intentId: cid(10),
    challengeId: id,
    expectedVersion: version,
    expectedState: c.state,
    contractKey: c.contractKey,
    conditionsKey: c.conditionsKey,
    contextKey: c.contextKey,
    termsVersion: c.termsVersion,
    presentationVersion: c.presentationVersion,
    conditionsPresented: true,
    acknowledgments: acks(),
  }
  assert.ok(consentAcceptSchema.parse(input))
  for (const k of Object.keys(acks()))
    assert.equal(
      consentAcceptSchema.safeParse({
        ...input,
        acknowledgments: { ...acks(), [k]: false },
      }).success,
      false,
    )
  assert.equal(
    consentAcceptSchema.safeParse({ ...input, state: 'ACCEPTED_INACTIVE' })
      .success,
    false,
  )
})
test('a delayed challenge is discarded on session change', async () => {
  const { auth, store } = setup()
  let resolve
  service.challenge = () => new Promise((r) => (resolve = r))
  const pending = store.loadChallenge()
  auth.clearSession()
  resolve(challenge())
  await pending
  assert.equal(store.challenge, null)
})
test('lost acceptance keeps one intention and recovers the actual revoked state', async () => {
  const { store } = setup()
  store.challenge = challenge()
  let calls = 0
  service.accept = async () => {
    calls++
    throw new AxiosError('lost')
  }
  await store.accept(acks(), true)
  assert.equal(calls, 1)
  assert.equal(store.pending.action, 'ACCEPT')
  const intent = store.pending.intentId
  service.operation = async (id) => ({
    id: cid(11),
    intentId: id,
    consentId: cid(9),
    state: 'ACCEPTED_INACTIVE',
    action: 'ACCEPT',
  })
  service.inspect = async () => ({ id: cid(9), version: 3, state: 'REVOKED' })
  await store.recover()
  assert.equal(store.pending, null)
  assert.equal(store.detail.state, 'REVOKED')
  assert.equal(store.receipt.intentId, intent)
  assert.equal(calls, 1)
  Object.assign(service, original)
})
test('an ACCEPT identifier cache never retains acknowledgments or terms', () => {
  let value
  const storage = {
    setItem: (_, v) => (value = v),
    getItem: () => value,
    removeItem: () => (value = null),
  }
  rememberConsentIntent(storage, {
    accountId: cid(1),
    sessionContext: 'context',
    intentId: cid(2),
    consentId: cid(9),
    action: 'ACCEPT',
    createdAt: 100,
    acknowledgments: acks(),
    contract: { private: true },
  })
  assert.doesNotMatch(value, /acknowledgments|private|contract/)
  assert.equal(
    recoverConsentIntent(storage, cid(1), 'context', 101).action,
    'ACCEPT',
  )
})

test('successful acceptance shows the confirmed inactive state and clears the challenge', async () => {
  const { store } = setup()
  store.challenge = challenge()
  let sent
  service.accept = async (id, input) => {
    sent = input
    return {
      id: cid(11),
      consentId: id,
      intentId: input.intentId,
      action: 'ACCEPT',
      state: 'ACCEPTED_INACTIVE',
    }
  }
  service.inspect = async () => ({
    id: cid(9),
    version: 2,
    state: 'ACCEPTED_INACTIVE',
    executionAuthorized: false,
  })
  await store.accept(acks(), true)
  assert.equal(sent.expectedState, 'PENDING_CONFIRMATION')
  assert.deepEqual(sent.acknowledgments, acks())
  assert.equal(store.detail.state, 'ACCEPTED_INACTIVE')
  assert.equal(store.detail.executionAuthorized, false)
  assert.equal(store.pending, null)
  assert.equal(store.challenge, null)
  Object.assign(service, original)
})
