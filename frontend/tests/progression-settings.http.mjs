import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api } from '../src/services/api.ts'
import { progressionSettingsService as service } from '../src/services/progression-settings.service.ts'
async function verify() {
  let raw = ''
  for await (const p of process.stdin) raw += p
  const c = JSON.parse(raw)
  assert.equal(new URL(c.url).hostname, '127.0.0.1')
  api.defaults.baseURL = c.url + '/api/v1'
  api.defaults.headers.common.Authorization = 'Bearer ' + c.token
  api.defaults.headers.common.Origin = c.origin
  const parameters = {
    minSuccessfulSessions: 3,
    targetRpeMin: '6',
    targetRpeMax: '8',
    incrementAbsolute: '2.5',
    incrementPercent: null,
    maxIncrementPercent: '5',
    maxLoad: null,
  }
  const a = await service.create({
    intentId: randomUUID(),
    scope: { exerciseId: null, trainingPlanId: null },
    parameters,
  })
  assert.equal(a.result.parameters.incrementAbsolute, '2.500')
  const r = await service.effective({
    exerciseId: c.exerciseId,
    trainingPlanId: c.planId,
  })
  assert.equal(r.scope, 'ATHLETE')
  assert.equal(r.selected.id, a.settingId)
  assert.ok(r.externalRequirements.includes('POLICY_PROVENANCE_REQUIRED'))
  assert.equal(r.executionAuthorized, false)
  const impact = await service.impact(a.settingId, a.revision, parameters)
  assert.equal(impact.parametersChanged, false)
  const b = await service.replace(a.settingId, {
    intentId: randomUUID(),
    expectedRevision: a.revision,
    parameters: { ...parameters, maxLoad: '123.456' },
    confirmImpact: true,
  })
  assert.equal(b.result.parameters.maxLoad, '123.456')
  assert.equal((await service.operation(a.intentId)).revision, a.revision)
  assert.equal((await service.get(a.settingId)).revision, b.revision)
  console.log('Axios/Zod settings contract verified')
}
verify().catch(() => {
  console.log(
    'Settings HTTP contract verification failed without logging request credentials',
  )
  process.exitCode = 1
})
