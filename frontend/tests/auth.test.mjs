import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AxiosError } from 'axios'
import { createPinia } from 'pinia'
import { api, apiErrorMessage, installAuthInterceptors } from '../src/services/api.ts'
import { loginSchema, registerSchema } from '../src/services/auth.service.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'
import { useExercisesCatalog } from '../src/composables/useExercisesCatalog.ts'

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

function httpError(config, status = 401) {
  return new AxiosError(`HTTP ${status}`, AxiosError.ERR_BAD_RESPONSE, config, undefined,
    response(config, { message: 'Authentication required.' }, status))
}

async function within(operation) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Authentication operation did not settle within 1 second.')), 1000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

let currentStore
installAuthInterceptors({
  getAccessToken: () => currentStore?.accessToken ?? null,
  refreshSession: () => currentStore.refreshSession(),
  clearSession: () => currentStore?.clearSession(),
})

function createAuthStore(authenticated = false) {
  const store = useAuthStore(createPinia())
  currentStore = store
  if (authenticated) {
    store.accessToken = 'access-old'
    store.csrfToken = 'csrf-old'
    store.user = account
    store.status = 'authenticated'
  }
  return store
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
  const store = createAuthStore()

  let refreshCalls = 0
  let oldTokenRequests = 0
  let newTokenRequests = 0
  let receivedBearer = ''
  const verifiedBearers = []
  api.defaults.adapter = async (config) => {
    const path = config.url?.replace(/^\/+/, '')
    const bearer = config.headers.get('Authorization') ?? ''
    if (path === 'auth/login') return response(config, authResponse('access-old', 'csrf-old'))
    if (path === 'auth/me') {
      if (bearer !== (refreshCalls === 0 ? 'Bearer access-old' : 'Bearer access-new')) {
        throw httpError(config)
      }
      verifiedBearers.push(bearer)
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

  const results = await within(Promise.all([
    api.get('/athletes/me'),
    api.get('/athletes/me/measurements'),
  ]))
  assert.equal(results.length, 2)
  assert.equal(oldTokenRequests, 2)
  assert.equal(newTokenRequests, 2)
  assert.equal(refreshCalls, 1)
  assert.equal(receivedBearer, 'Bearer access-new')
  assert.equal(store.accessToken, 'access-new')
  assert.deepEqual(verifiedBearers, ['Bearer access-old', 'Bearer access-new'])
  await within(assert.rejects(
    api.get('/auth/me', { headers: { Authorization: 'Bearer access-old' } }),
    (error) => error.response?.status === 401,
  ))
  assert.equal(refreshCalls, 1)

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
  const store = createAuthStore()
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
  const store = createAuthStore()
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
  const store = createAuthStore()
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

test('un 401 de verificación termina las peticiones concurrentes y la carga del catálogo', async () => {
  const store = createAuthStore(true)
  const catalog = useExercisesCatalog()
  let refreshCalls = 0
  let verificationCalls = 0
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/refresh') {
      refreshCalls += 1
      return response(config, authResponse('access-new', 'csrf-new'))
    }
    if (config.url === '/auth/me') {
      verificationCalls += 1
      assert.equal(config.headers.get('Authorization'), 'Bearer access-new')
    }
    throw httpError(config)
  }

  const results = await within(Promise.allSettled([
    catalog.load({}, 'mine'),
    api.get('/athletes/me'),
  ]))
  assert.deepEqual(results.map(({ status }) => status), ['fulfilled', 'rejected'])
  assert.equal(refreshCalls, 1)
  assert.equal(verificationCalls, 1)
  assert.equal(catalog.loading.value, false)
  assert.match(catalog.errorMessage.value, /sesión expiró/)
  assert.equal(store.status, 'anonymous')
  assert.equal(store.accessToken, null)
  assert.equal(store.csrfToken, null)
  assert.equal(store.user, null)
})

test('la inicialización finaliza como anónima si falla la verificación del token recuperado', async (t) => {
  const store = createAuthStore()
  globalThis.document = { cookie: 'pow_csrf=csrf-initial' }
  t.after(() => { delete globalThis.document })
  const calls = []
  api.defaults.adapter = async (config) => {
    calls.push(config.url)
    if (config.url === '/auth/refresh') return response(config, authResponse('access-new', 'csrf-new'))
    throw httpError(config)
  }
  await within(store.initialize())
  assert.deepEqual(calls, ['/auth/refresh', '/auth/me'])
  assert.equal(store.status, 'anonymous')
  assert.equal(store.accessToken, null)
})

test('un fallo de refresh rechaza todas las peticiones sin reintentos indefinidos', async () => {
  for (const status of [401, 503]) {
    const store = createAuthStore(true)
    let refreshCalls = 0
    let protectedCalls = 0
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1
        throw httpError(config, status)
      }
      protectedCalls += 1
      throw httpError(config)
    }
    const results = await within(Promise.allSettled([
      api.get('/athletes/me'), api.get('/exercises/mine'),
    ]))
    assert.equal(results.every(({ status: outcome }) => outcome === 'rejected'), true)
    assert.equal(refreshCalls, 1)
    assert.equal(protectedCalls, 2)
    assert.equal(store.status, 'anonymous')
    assert.equal(store.accessToken, null)
  }
})

test('un segundo 401 tras renovar rechaza la petición y limpia la sesión', async () => {
  const store = createAuthStore(true)
  let refreshCalls = 0
  let protectedCalls = 0
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/refresh') {
      refreshCalls += 1
      return response(config, authResponse('access-new', 'csrf-new'))
    }
    if (config.url === '/auth/me') {
      assert.equal(config.headers.get('Authorization'), 'Bearer access-new')
      return response(config, account)
    }
    protectedCalls += 1
    throw httpError(config)
  }
  await within(assert.rejects(api.get('/exercises/mine'), (error) => error.response?.status === 401))
  assert.equal(refreshCalls, 1)
  assert.equal(protectedCalls, 2)
  assert.equal(store.status, 'anonymous')
  assert.equal(store.accessToken, null)
})

after(() => {
  api.defaults.adapter = undefined
})
