import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as legacy from '../src/services/athletes.service.ts'

const profile = {
  id: '20000000-0000-4000-8000-000000000001', birthDate: null, preferredUnit: 'LB',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
}

test('los contratos compartidos conservan fechas, unidades, nulos y exportaciones existentes', async () => {
  const schemas = await import('../src/schemas/athletes.schema.ts')
  for (const key of ['athleteProfileSchema', 'bodyMeasurementSchema', 'measurementUnitSchema',
    'updateAthleteRequestSchema', 'createMeasurementRequestSchema']) assert.equal(schemas[key], legacy[key])
  assert.deepEqual(schemas.athleteProfileSchema.parse({ ...profile, internal: 'omitted' }), profile)
  assert.equal(schemas.athleteProfileSchema.safeParse({ ...profile, createdAt: '' }).success, false)
  assert.equal(schemas.athleteProfileSchema.safeParse({ ...profile, preferredUnit: 'UNKNOWN' }).success, false)
  const measurement = { id: profile.id, bodyWeight: 72.125, measuredAt: profile.createdAt, notes: null }
  assert.deepEqual(schemas.bodyMeasurementSchema.parse(measurement), measurement)
  assert.equal(schemas.bodyMeasurementSchema.safeParse({ ...measurement, bodyWeight: 0 }).success, false)
})

test('la actualización conserva campos omitidos y rechaza campos desconocidos, nulos indebidos y formularios vacíos', async () => {
  const { updateAthleteRequestSchema: schema } = await import('../src/schemas/athletes.schema.ts')
  assert.deepEqual(schema.parse({ birthDate: null }), { birthDate: null })
  assert.deepEqual(schema.parse({ preferredUnit: 'KG' }), { preferredUnit: 'KG' })
  assert.deepEqual(schema.parse({ birthDate: '2000-02-29' }), { birthDate: '2000-02-29' })
  for (const invalid of [{}, { id: profile.id }, { preferredUnit: null }, { birthDate: '2001-02-29' },
    { preferredUnit: 'KG', athleteId: profile.id }]) assert.equal(schema.safeParse(invalid).success, false)
})

test('las mediciones conservan límites, precisión, fecha y notas sin transformar valores', async () => {
  const { createMeasurementRequestSchema: schema } = await import('../src/schemas/athletes.schema.ts')
  for (const bodyWeight of [0.001, 9999.999, 72.125]) {
    const payload = { bodyWeight, measuredAt: '2026-01-01' }
    assert.deepEqual(schema.parse(payload), payload)
  }
  for (const invalid of [
    { bodyWeight: 0, measuredAt: '2026-01-01' },
    { bodyWeight: 10000, measuredAt: '2026-01-01' },
    { bodyWeight: 72.1251, measuredAt: '2026-01-01' },
    { bodyWeight: 72, measuredAt: 'invalid' },
    { bodyWeight: 72, measuredAt: '2026-01-01', notes: null },
    { bodyWeight: 72, measuredAt: '2026-01-01', notes: 'x'.repeat(1001) },
    { bodyWeight: 72, measuredAt: '2026-01-01', athleteId: profile.id },
  ]) assert.equal(schema.safeParse(invalid).success, false)
})
