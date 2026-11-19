import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { api, installAuthInterceptors } from '../src/services/api.ts'
import {
  athleteErrorMessage,
  athletesService,
} from '../src/services/athletes.service.ts'

const profile = {
  id: '20000000-0000-4000-8000-000000000001',
  birthDate: '1995-06-15T00:00:00.000Z',
  preferredUnit: 'KG',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const measurement = {
  id: '30000000-0000-4000-8000-000000000001',
  bodyWeight: 72.125,
  measuredAt: '2026-02-01T00:00:00.000Z',
  notes: 'Medición de prueba',
}

function response(config, data, status = 200) {
  return { config, data, status, statusText: 'OK', headers: {} }
}

test('consulta y actualiza el perfil usando la respuesta directa del backend', async () => {
  installAuthInterceptors({ getSessionGeneration: () => 0,
    getAccessToken: () => 'athlete-test-access-token',
    refreshSession: async () => {},
    clearSession: () => {},
  })
  const calls = []
  api.defaults.adapter = async (config) => {
    calls.push(config)
    if (config.method === 'get') return response(config, profile)
    return response(config, { ...profile, birthDate: null, preferredUnit: 'LB' })
  }

  assert.deepEqual(await athletesService.getProfile(), profile)
  const updated = await athletesService.updateProfile({ birthDate: null, preferredUnit: 'LB' })
  assert.equal(updated.birthDate, null)
  assert.equal(updated.preferredUnit, 'LB')
  assert.equal(calls[0].url, '/athletes/me')
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer athlete-test-access-token')
  assert.deepEqual(JSON.parse(calls[1].data), { birthDate: null, preferredUnit: 'LB' })
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer athlete-test-access-token')
})

test('consulta historial vacío y mediciones ordenadas tal como las entrega la API', async () => {
  const results = [[], [measurement]]
  api.defaults.adapter = async (config) => response(config, results.shift())
  assert.deepEqual(await athletesService.getMeasurements(), [])
  assert.deepEqual(await athletesService.getMeasurements(), [measurement])
})

test('registra mediciones sin enviar propietario ni unidad inventados', async () => {
  let request
  api.defaults.adapter = async (config) => {
    request = config
    return response(config, measurement, 201)
  }

  const result = await athletesService.addMeasurement({
    bodyWeight: 72.125,
    measuredAt: '2026-02-01',
    notes: 'Medición de prueba',
  })
  assert.deepEqual(result, measurement)
  assert.equal(request.url, '/athletes/me/measurements')
  assert.deepEqual(JSON.parse(request.data), {
    bodyWeight: 72.125,
    measuredAt: '2026-02-01',
    notes: 'Medición de prueba',
  })
})

test('rechaza actualizaciones vacías, campos desconocidos y mediciones fuera del DTO', async () => {
  let networkCalls = 0
  api.defaults.adapter = async (config) => {
    networkCalls += 1
    return response(config, {})
  }

  await assert.rejects(athletesService.updateProfile({}))
  await assert.rejects(athletesService.updateProfile({ preferredUnit: 'KG', id: profile.id }))
  await assert.rejects(athletesService.addMeasurement({
    bodyWeight: 70.1234,
    measuredAt: '2026-02-01',
  }))
  await assert.rejects(athletesService.addMeasurement({
    bodyWeight: 0,
    measuredAt: 'not-a-date',
    athleteId: profile.id,
  }))
  await assert.rejects(athletesService.addMeasurement({
    bodyWeight: 70,
    measuredAt: '2026-02-01',
    notes: 'x'.repeat(1001),
  }))
  assert.equal(networkCalls, 0)
})

test('traduce errores de sesión y del perfil en mensajes comprensibles', () => {
  assert.equal(
    athleteErrorMessage({ isAxiosError: true, response: { status: 401 } }, 'fallback'),
    'Tu sesión expiró o ya no está disponible. Inicia sesión de nuevo.',
  )
  assert.equal(
    athleteErrorMessage({ isAxiosError: true, response: { status: 404 } }, 'fallback'),
    'No se encontró el perfil del atleta.',
  )
  assert.match(
    athleteErrorMessage({ isAxiosError: true }, 'fallback'),
    /No se pudo conectar/,
  )
})

test('si el refresh falla ante un 401, limpia sesión y no reintenta en bucle', async () => {
  let refreshCalls = 0
  let clearCalls = 0
  let requestCalls = 0
  installAuthInterceptors({ getSessionGeneration: () => 0,
    getAccessToken: () => 'expired-access-token',
    refreshSession: async () => {
      refreshCalls += 1
      throw new Error('refresh expired')
    },
    clearSession: () => {
      clearCalls += 1
    },
  })
  api.defaults.adapter = async (config) => {
    requestCalls += 1
    const unauthorized = response(config, { statusCode: 401 }, 401)
    throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, undefined, unauthorized)
  }

  await assert.rejects(athletesService.getProfile())
  assert.equal(requestCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(clearCalls, 1)
})

after(() => {
  api.defaults.adapter = undefined
})
