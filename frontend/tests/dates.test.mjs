import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localTrainingDate as legacyDate } from '../src/services/workout-sessions.service.ts'

test('la utilidad de fecha conserva la fecha local explícita y la exportación del servicio', async () => {
  const { localTrainingDate } = await import('../src/utils/dates.ts')
  assert.equal(localTrainingDate, legacyDate)
  const instant = new Date('2026-01-02T01:00:00Z')
  assert.equal(localTrainingDate('America/Bogota', instant), '2026-01-01')
  assert.equal(localTrainingDate('UTC', instant), '2026-01-02')
  assert.equal(localTrainingDate('Pacific/Kiritimati', instant), '2026-01-02')
  assert.equal(instant.toISOString(), '2026-01-02T01:00:00.000Z')
})

test('la utilidad respeta cambios horarios y propaga zonas o fechas inválidas como antes', async () => {
  const { localTrainingDate } = await import('../src/utils/dates.ts')
  assert.equal(localTrainingDate('America/New_York', new Date('2026-03-08T04:30:00Z')), '2026-03-07')
  assert.equal(localTrainingDate('America/New_York', new Date('2026-03-08T07:30:00Z')), '2026-03-08')
  assert.throws(() => localTrainingDate('Invalid/Zone', new Date()), RangeError)
  assert.throws(() => localTrainingDate('UTC', new Date('invalid')), RangeError)
})
