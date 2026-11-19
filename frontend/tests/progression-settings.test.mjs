import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError } from 'axios'
import { useProgressionSettingsStore } from '../src/stores/progression-settings.store.ts'
import { progressionSettingsService as service } from '../src/services/progression-settings.service.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
import { settingParametersSchema } from '../src/schemas/progression-settings.schema.ts'
import {
  settingFormValues,
  settingFormParameters,
} from '../src/utils/setting-form.ts'
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  original = { ...service }
after(() => Object.assign(service, original))
function setup() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = { id: id(1) }
  auth.status = 'authenticated'
  auth.accessToken = 'memory-only'
  auth.getSessionContextId = () => 'real-context'
  return { auth, store: useProgressionSettingsStore() }
}
const p = () => ({
  minSuccessfulSessions: 3,
  targetRpeMin: '6.0',
  targetRpeMax: '8.0',
  incrementAbsolute: '2.500',
  incrementPercent: null,
  maxIncrementPercent: '5.000',
  maxLoad: null,
})
test('blank settings form invents no training parameters and preserves original decimal strings', () => {
  assert.ok(Object.values(settingFormValues()).every((v) => v === ''))
  assert.deepEqual(settingFormValues(p()), {
    ...p(),
    minSuccessfulSessions: '3',
    incrementPercent: '',
    maxLoad: '',
  })
  assert.equal(
    settingFormParameters({
      ...settingFormValues(p()),
      incrementAbsolute: '1.250',
    }).incrementAbsolute,
    '1.250',
  )
  assert.equal(
    settingParametersSchema.safeParse({ ...p(), incrementAbsolute: 2.5 })
      .success,
    false,
  )
})
test('a delayed private row cannot populate the new identity context', async () => {
  const { auth, store } = setup()
  let resolve
  service.get = () => new Promise((r) => (resolve = r))
  const reading = store.open(id(2))
  auth.clearSession()
  resolve({ id: id(2), revision: 'a'.repeat(64) })
  await reading
  assert.equal(store.detail, null)
  Object.assign(service, original)
})
test('lost creation is recovered by original intention and current row, not old receipt', async () => {
  const { store } = setup()
  let count = 0
  service.create = async () => {
    count++
    throw new AxiosError('lost')
  }
  await store.create({ exerciseId: null, trainingPlanId: null }, p())
  const intent = store.pending.intentId
  service.operation = async () => ({
    id: id(3),
    intentId: intent,
    settingId: id(2),
    result: { id: id(2), revision: 'a'.repeat(64) },
  })
  service.get = async () => ({
    id: id(2),
    revision: 'b'.repeat(64),
    parameters: p(),
  })
  await store.recover()
  assert.equal(store.pending, null)
  assert.equal(store.detail.revision, 'b'.repeat(64))
  assert.equal(store.receipt.result.revision, 'a'.repeat(64))
  assert.equal(count, 1)
  Object.assign(service, original)
})
test('a committed replacement keeps receipt and intention when current-row read fails', async () => {
  const { store } = setup()
  store.detail = { id: id(2), revision: 'a'.repeat(64) }
  store.impact = { settingId: id(2), expectedRevision: 'a'.repeat(64) }
  service.replace = async (_, input) => ({
    id: id(3),
    intentId: input.intentId,
    settingId: id(2),
    result: { id: id(2), revision: 'b'.repeat(64) },
  })
  service.get = async () => {
    throw new AxiosError('known read error', undefined, undefined, undefined, {
      status: 422,
      data: { code: 'INVALID_SETTING' },
    })
  }
  await store.replace(p(), true)
  assert.equal(store.receipt.result.revision, 'b'.repeat(64))
  assert.equal(store.pending.action, 'REPLACE')
  assert.equal(store.error.uncertain, true)
  Object.assign(service, original)
})

test('recovery preserves a confirmed receipt when the current resource is unavailable, and reads it once', async () => {
  const { store } = setup()
  service.create = async () => {
    throw new AxiosError('lost')
  }
  await store.create({ exerciseId: null, trainingPlanId: null }, p())
  const intent = store.pending.intentId
  service.operation = async () => ({
    id: id(3),
    intentId: intent,
    settingId: id(2),
    result: { id: id(2), revision: 'a'.repeat(64) },
  })
  let reads = 0
  service.get = async () => {
    reads++
    throw new AxiosError('resource removed', undefined, undefined, undefined, {
      status: 404,
      data: { code: 'SOURCE_NOT_FOUND' },
    })
  }
  await store.recover()
  assert.equal(store.receipt?.intentId, intent)
  assert.equal(store.pending.intentId, intent)
  assert.equal(store.error.uncertain, true)
  assert.equal(store.canReconfirm, false)
  assert.equal(reads, 1)
  Object.assign(service, original)
})
test('a replay receipt never becomes the displayed current effective configuration', async () => {
  const { store } = setup()
  store.detail = { id: id(2), revision: 'a'.repeat(64) }
  store.impact = { settingId: id(2), expectedRevision: 'a'.repeat(64) }
  service.replace = async (_, input) => ({
    id: id(3),
    intentId: input.intentId,
    settingId: id(2),
    result: { id: id(2), revision: 'a'.repeat(64) },
    effective: { selected: { revision: 'a'.repeat(64) } },
  })
  service.get = async () => ({ id: id(2), revision: 'b'.repeat(64) })
  await store.replace(p(), true)
  assert.equal(store.detail.revision, 'b'.repeat(64))
  assert.notEqual(store.resolution?.selected?.revision, 'a'.repeat(64))
  Object.assign(service, original)
})
