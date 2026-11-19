// Launched by the isolated backend HTTP suite, credentials only through stdin.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api } from '../src/services/api.ts'
import { progressionService as service } from '../src/services/progression.service.ts'
async function verify() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const { url, token, origin, command, activityId } = JSON.parse(raw)
  assert.equal(new URL(url).hostname, '127.0.0.1')
  api.defaults.baseURL = url + '/api/v1'
  api.defaults.headers.common.Authorization = 'Bearer ' + token
  api.defaults.headers.common.Origin = origin
  const context = await service.context(command)
  assert.equal(context.destination.targets.targetLoad, '80.000')
  const subset = structuredClone(command)
  subset.policy.cohort = {
    mode: 'EXPLICIT_TASK_SET',
    taskIds: [command.policy.assessment.count.anchorTaskId],
  }
  const partial = await service.preview(subset)
  assert.ok(
    partial.evidence.excludedTasks.some((t) =>
      t.reasons.includes('OUTSIDE_EXPLICIT_COHORT'),
    ),
  )
  const preview = await service.preview(command)
  assert.equal(preview.decision, 'INCREASE')
  assert.equal(preview.increment.proposedLoad, '82.500000')
  const saved = await service.save({
      command,
      expectedSemanticKey: preview.semanticKey,
      expectedDependencyKeys: preview.dependencyKeys,
    }),
    view = await service.inspect(saved.id)
  assert.equal(view.proposal.status, 'PENDING')
  assert.equal(view.validity.state, 'CURRENT')
  await service.validity(saved.id)
  await service.review(saved.id, {
    intentId: randomUUID(),
    action: 'APPROVE',
    expectedStatus: 'PENDING',
    expectedVersion: null,
    expectedSemanticKey: preview.semanticKey,
    expectedCycleKey: view.cycle.key,
    expectedDependencyKeys: preview.dependencyKeys,
    acceptance: {
      ...view.acceptanceChallenge,
      acceptPolicy: true,
      acceptEvidence: true,
    },
  })
  const ready = await service.readiness(saved.id, activityId, randomUUID())
  assert.equal(ready.eligible, true)
  const applied = await service.apply(saved.id, ready.command)
  assert.equal(applied.appliedLoad, '82.500000')
  assert.equal((await service.get(saved.id)).status, 'APPLIED')
  assert.deepEqual(await service.receipt(saved.id), applied)
  assert.equal((await service.list()).items[0].id, saved.id)
  assert.equal(
    (await service.recipe(saved.id)).command.history.limit,
    command.history.limit,
  )
  console.log('Axios/Zod HTTP/PostgreSQL manual flow PASS')
}
try {
  await verify()
} catch (error) {
  console.error(
    'Progression HTTP contract verification failed:',
    error?.name ?? 'Error',
  )
  if (Array.isArray(error?.issues))
    console.error(
      JSON.stringify(error.issues.map((i) => ({ path: i.path, code: i.code }))),
    )
  process.exitCode = 1
}
