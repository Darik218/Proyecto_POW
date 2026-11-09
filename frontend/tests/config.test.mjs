import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api } from '../src/services/api.ts'

test('el cliente Axios existente utiliza la configuración compartida sin cambiar sus opciones', async () => {
  const { apiConfig } = await import('../src/config/api.config.ts')
  assert.equal(apiConfig.baseURL, '/api/v1')
  assert.equal(apiConfig.timeout, 15_000)
  assert.equal(apiConfig.withCredentials, true)
  assert.equal(apiConfig.headers['Content-Type'], 'application/json')
  assert.equal(api.defaults.baseURL, apiConfig.baseURL)
  assert.equal(api.defaults.timeout, apiConfig.timeout)
  assert.equal(api.defaults.withCredentials, apiConfig.withCredentials)
  assert.equal(api.defaults.headers['Content-Type'], apiConfig.headers['Content-Type'])
})
