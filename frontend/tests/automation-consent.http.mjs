import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api } from '../src/services/api.ts'
import { automationConsentService as service } from '../src/services/automation-consent.service.ts'
async function verify() {
  let raw = ''
  for await (const part of process.stdin) raw += part
  const cfg = JSON.parse(raw)
  assert.equal(new URL(cfg.url).hostname, '127.0.0.1')
  api.defaults.baseURL = cfg.url + '/api/v1'
  api.defaults.headers.common.Authorization = 'Bearer ' + cfg.token
  api.defaults.headers.common.Origin = cfg.origin
  const candidates = await service.candidates({
    exerciseId: cfg.contract.exerciseId,
    unit: 'KG',
  })
  assert.equal(candidates.futureApplicabilityVerified, false)
  assert.ok(
    candidates.items.some((i) =>
      cfg.contract.selector.prescriptionIds.includes(i.prescriptionId),
    ),
  )
  const p = await service.preview(cfg.contract)
  assert.equal(p.snapshot.humanAcceptance, 'NOT_RECORDED')
  assert.equal(p.acceptanceAvailable, false)
  const input = { intentId: randomUUID(), contract: cfg.contract },
    created = await service.request(input)
  assert.equal(created.state, 'PENDING_CONFIRMATION')
  assert.equal((await service.operation(input.intentId)).id, created.id)
  let v = await service.inspect(created.consentId)
  assert.equal(v.acceptance.available, true)
  assert.equal(v.acceptance.humanAcceptance, 'NOT_RECORDED')
  assert.equal(v.currentConfiguration, 'MATCH')
  assert.equal((await service.list()).items[0].id, created.consentId)
  const contract = structuredClone(cfg.contract)
  contract.limits.maximumLoad = '190.000001'
  await service.revise(created.consentId, {
    intentId: randomUUID(),
    expectedVersion: 1,
    contract,
  })
  await service.revoke(created.consentId, {
    intentId: randomUUID(),
    expectedVersion: 2,
    reason: 'OWNER_REQUEST',
  })
  v = await service.inspect(created.consentId)
  assert.equal(v.state, 'REVOKED')
  assert.equal(v.version, 3)
  assert.equal(v.events[1].snapshot.contract.limits.maximumLoad, '190.000001')
  assert.equal(v.executionAuthorized, false)
  console.log('Consent Axios/Zod/HTTP/PostgreSQL PASS')
}
try {
  await verify()
} catch (e) {
  console.error('Consent HTTP verification failed:', e?.name ?? 'Error')
  if (Array.isArray(e?.issues))
    console.error(
      JSON.stringify(e.issues.map((i) => ({ path: i.path, code: i.code }))),
    )
  process.exitCode = 1
}
