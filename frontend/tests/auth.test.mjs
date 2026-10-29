import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { createPinia } from 'pinia'
import { api, apiErrorMessage, installAuthInterceptors } from '../src/services/api.ts'
import { loginSchema, registerSchema } from '../src/services/auth.service.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'

const account = {
  id: 'a22ee5dc-c22b-4ba9-81b4-0abbd3c1a312',
  email: 'atleta@example.test',
  status: 'ACTIVE',
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
}

function authResponse(token, csrfToken) {
  return {
    user: account,
    accessToken: token,
    accessTokenExpiresAt: '2026-10-29T00:15:00.000Z',
    csrfToken,
  }
}

function response(config, data, status = 200) {
  return { config, data, status, statusText: 'OK', headers: {} }
}

test('valida entrada y conserva mensajes HTTP útiles', () => {
  assert.equal(registerSchema.safeParse({ email: 'no-es-correo', password: '123456789012' }).success, false)
  assert.equal(registerSchema.safeParse({ email: account.email, password: '123456789012' }).success, true)
  assert.equal(loginSchema.safeParse({ email: account.email, password: '' }).success, false)
  assert.equal(
    apiErrorMessage({ response: { data: { message: ['Correo inválido', 'Intenta otra vez'] } }, isAxiosError: true }, 'fallback'),
    'Correo inválido Intenta otra vez',
  )
})

test('autentica verificando /me, envía bearer y comparte una renovación concurrente', async () => {
  const store = useAuthStore(createPinia())
  installAuthInterceptors({
    getAccessToken: () => store.accessToken,
    refreshSession: () => store.refreshSession(),
    clearSession: () => store.clearSession(),
  })

  let refreshCalls = 0
  let oldTokenRequests = 0
  let newTokenRequests = 0
  let receivedBearer = ''
  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    const bearer = config.headers.get('Authorization') ?? ''
    if (path === 'auth/login') return response(config, authResponse('access-old', 'csrf-old'))
    if (path === 'auth/me') {
      assert.match(bearer, /^Bearer access-/)
      return response(config, account)
    }
    if (path === 'athletes/me' || path === 'athletes/me/measurements') {
      receivedBearer = bearer
      if (bearer === 'Bearer access-old') {
        oldTokenRequests += 1
        const unauthorized = response(config, { statusCode: 401, message: 'Authentication required.' }, 401)
        throw new AxiosError('Request failed with status code 401', AxiosError.ERR_BAD_REQUEST, config, undefined, unauthorized)
      }
      newTokenRequests += 1
      return response(config, { ok: true })
    }
    if (path === 'auth/refresh') {
      refreshCalls += 1
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-old')
      await new Promise((resolve) => setTimeout(resolve, 5))
      return response(config, authResponse('access-new', 'csrf-new'))
    }
    throw new Error(`Unexpected request in test: ${path}`)
  }

  await store.login({ email: account.email, password: 'valid-password' })
  assert.equal(store.isAuthenticated, true)
  assert.equal(store.user.email, account.email)
  assert.deepEqual(Object.keys(store.$state).sort(), ['accessToken', 'csrfToken', 'status', 'user'])

  const results = await Promise.all([
    api.get('/athletes/me'),
    api.get('/athletes/me/measurements'),
  ])
  assert.equal(results.length, 2)
  assert.equal(oldTokenRequests, 2)
  assert.equal(newTokenRequests, 2)
  assert.equal(refreshCalls, 1)
  assert.equal(receivedBearer, 'Bearer access-new')
  assert.equal(store.accessToken, 'access-new')

  api.defaults.adapter = async (config) => {
    assert.equal(config.url, '/auth/logout-all')
    assert.equal(config.headers.get('Authorization'), 'Bearer access-new')
    assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-new')
    return response(config, undefined, 204)
  }
  await store.logoutAll()
  assert.equal(store.isAuthenticated, false)
  assert.equal(store.accessToken, null)

  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    if (path === 'auth/login') return response(config, authResponse('access-last', 'csrf-last'))
    if (path === 'auth/me') return response(config, account)
    if (path === 'auth/logout') {
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-last')
      return response(config, undefined, 204)
    }
    throw new Error(`Unexpected request in test: ${path}`)
  }
  await store.login({ email: account.email, password: 'valid-password' })
  await store.logout()
  assert.equal(store.isAuthenticated, false)
  assert.equal(store.accessToken, null)
  assert.equal(store.status, 'anonymous')
})

test('registra por HTTP y confirma la cuenta con /me', async () => {
  const store = useAuthStore(createPinia())
  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    if (path === 'auth/register') return response(config, authResponse('access-registered', 'csrf-registered'), 201)
    if (path === 'auth/me') return response(config, account)
    throw new Error(`Unexpected request in test: ${path}`)
  }
  await store.register({ email: account.email, password: 'valid-password-123' })
  assert.equal(store.isAuthenticated, true)
  assert.equal(store.accessToken, 'access-registered')
  assert.equal(api.defaults.withCredentials, true)
})

test('no intenta renovar después de un 401 de login', async () => {
  const store = useAuthStore(createPinia())
  let refreshCalls = 0
  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    if (path === 'auth/login') {
      const unauthorized = response(config, { statusCode: 401, message: 'Invalid email or password.' }, 401)
      throw new AxiosError('Request failed with status code 401', AxiosError.ERR_BAD_REQUEST, config, undefined, unauthorized)
    }
    if (path === 'auth/refresh') refreshCalls += 1
    throw new Error(`Unexpected request in test: ${path}`)
  }

  await assert.rejects(store.login({ email: account.email, password: 'wrong-password' }))
  assert.equal(refreshCalls, 0)
  assert.equal(store.status, 'anonymous')
  assert.equal(store.accessToken, null)
})

test('recupera la sesión al iniciar con el CSRF emitido por backend', async () => {
  const store = useAuthStore(createPinia())
  const values = new Map([['pow_csrf_token', 'csrf-from-cookie']])
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  globalThis.document = { cookie: '' }
  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    if (path === 'auth/refresh') {
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-from-cookie')
      return response(config, authResponse('access-restored', 'csrf-rotated'))
    }
    if (path === 'auth/me') return response(config, account)
    throw new Error(`Unexpected request in test: ${path}`)
  }

  await store.initialize()
  assert.equal(store.isAuthenticated, true)
  assert.equal(store.accessToken, 'access-restored')
  assert.equal(store.csrfToken, 'csrf-rotated')
  assert.equal(values.get('pow_csrf_token'), 'csrf-rotated')
  assert.equal(values.has('accessToken'), false)
  store.clearSession()
  assert.equal(values.has('pow_csrf_token'), false)
  delete globalThis.document
  delete globalThis.sessionStorage
})

after(() => {
  api.defaults.adapter = undefined
})
