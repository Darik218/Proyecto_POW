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

test('logout global renueva una sola vez tras 401 y usa el bearer y CSRF nuevos', async () => {
  const store = createAuthStore(true)
  const calls = []
  let attempts = 0
  api.defaults.adapter = async config => {
    calls.push(config.url)
    if (config.url === '/auth/logout-all') {
      if (++attempts === 1) { assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-old'); throw httpError(config) }
      assert.equal(config.headers.get('Authorization'), 'Bearer access-new')
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-new')
      return response(config, undefined, 204)
    }
    if (config.url === '/auth/refresh') return response(config, authResponse('access-new', 'csrf-new'))
    if (config.url === '/auth/me') { assert.equal(config.headers.get('Authorization'), 'Bearer access-new'); return response(config, account) }
    throw new Error('Unexpected request')
  }
  await within(store.logoutAll())
  assert.deepEqual(calls, ['/auth/logout-all', '/auth/refresh', '/auth/me', '/auth/logout-all'])
  assert.equal(store.status, 'anonymous'); assert.equal(store.accessToken, null)
})

test('logout global propaga fallos de refresh y red sin confirmar una revocación inexistente', async () => {
  for (const failure of [401, 503, 'network']) {
    const store = createAuthStore(true)
    let logoutCalls = 0, refreshCalls = 0
    api.defaults.adapter = async config => {
      if (config.url === '/auth/logout-all') { logoutCalls++; throw httpError(config) }
      if (config.url === '/auth/refresh') { refreshCalls++; if (failure === 'network') throw new AxiosError('Connection failed', AxiosError.ERR_NETWORK, config); throw httpError(config, failure) }
      throw new Error('Unexpected request')
    }
    await within(assert.rejects(store.logoutAll(), error => failure === 'network'
      ? !error.response && /conectar/.test(apiErrorMessage(error, 'fallback'))
      : error.response?.status === failure))
    assert.equal(logoutCalls, 1); assert.equal(refreshCalls, 1)
    assert.equal(store.status, 'anonymous')
  }
})

test('logout global no reintenta errores de red, CSRF ni un segundo 401 indefinidamente', async () => {
  for (const failure of [403, 503, 'network', 'twice401']) {
    const store = createAuthStore(true)
    let logouts = 0, refreshes = 0
    api.defaults.adapter = async config => {
      if (config.url === '/auth/logout-all') { logouts++; if (failure === 'network') throw new AxiosError('Connection failed', AxiosError.ERR_NETWORK, config); throw httpError(config, failure === 'twice401' ? 401 : failure) }
      if (config.url === '/auth/refresh') { refreshes++; return response(config, authResponse('access-new', 'csrf-new')) }
      if (config.url === '/auth/me') return response(config, account)
      throw new Error('Unexpected request')
    }
    await within(assert.rejects(store.logoutAll()))
    assert.equal(logouts, failure === 'twice401' ? 2 : 1)
    assert.equal(refreshes, failure === 'twice401' ? 1 : 0)
  }
})

const tick = () => new Promise(resolve => setImmediate(resolve))
test('logout global comparte un refresh ya iniciado por una petición privada', async () => {
  const store = createAuthStore(true)
  let release, refreshes = 0, logouts = 0
  api.defaults.adapter = async config => {
    if (config.url === '/auth/refresh') { refreshes++; await new Promise(resolve => { release = resolve }); return response(config, authResponse('access-new', 'csrf-new')) }
    if (config.url === '/auth/me') return response(config, account)
    if (config.url === '/auth/logout-all') { logouts++; assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-new'); return response(config, undefined, 204) }
    if (config.headers.get('Authorization') !== 'Bearer access-new') throw httpError(config)
    return response(config, {})
  }
  const pending = api.get('/athletes/me'); await tick()
  const closing = store.logoutAll(); await tick()
  release(); await within(Promise.all([pending, closing]))
  assert.equal(refreshes, 1); assert.equal(logouts, 1); assert.equal(store.status, 'anonymous')
})

test('dos cierres globales comparten la operación y reutilizan credenciales renovadas mientras esperaban', async () => {
  const store = createAuthStore(true)
  let rejectFirst, logouts = 0, refreshes = 0
  api.defaults.adapter = async config => {
    if (config.url === '/auth/logout-all') {
      if (++logouts === 1) return new Promise((_resolve, reject) => { rejectFirst = () => reject(httpError(config)) })
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-new'); return response(config, undefined, 204)
    }
    if (config.url === '/auth/refresh') { refreshes++; return response(config, authResponse('access-new', 'csrf-new')) }
    if (config.url === '/auth/me') return response(config, account)
    throw new Error('Unexpected request')
  }
  const first = store.logoutAll(); const second = store.logoutAll(); await tick()
  await store.refreshSession(); rejectFirst()
  await within(Promise.all([first, second]))
  assert.equal(logouts, 2); assert.equal(refreshes, 1)
})

test('un refresh tardío no restaura la sesión después de logout global ni elimina un login posterior', async () => {
  const store = createAuthStore(true)
  let finishLogout, finishVerification
  api.defaults.adapter = async config => {
    if (config.url === '/auth/logout-all') return new Promise(resolve => { finishLogout = () => resolve(response(config, undefined, 204)) })
    if (config.url === '/auth/refresh') return response(config, authResponse('access-new', 'csrf-new'))
    if (config.url === '/auth/login') return response(config, authResponse('access-last', 'csrf-last'))
    if (config.url === '/auth/me' && config.headers.get('Authorization') === 'Bearer access-new') return new Promise(resolve => { finishVerification = () => resolve(response(config, account)) })
    if (config.url === '/auth/me') return response(config, account)
    if (config.url === '/athletes/me') throw httpError(config)
    throw new Error('Unexpected request')
  }
  const closing = store.logoutAll(); await tick()
  const renewing = api.get('/athletes/me'); const outcome = assert.rejects(renewing); await tick()
  finishLogout(); await within(closing)
  assert.equal(store.status, 'anonymous')
  await store.login({ email: account.email, password: 'valid-password' })
  finishVerification(); await within(outcome)
  assert.equal(store.accessToken, 'access-last'); assert.equal(store.status, 'authenticated')
})

test('un cierre global pendiente no reintenta ni limpia un login posterior, incluso para la misma cuenta', async () => {
  for (const statusCode of [401, 403, 204]) {
    for (const sameAccount of [true, false]) {
      const store = createAuthStore(true)
      const laterAccount = sameAccount ? account : { ...account, id: '8205d8f8-e294-4235-aaf4-d9d59453e6a3', email: 'otra@example.test' }
      let finish, logouts = 0
      api.defaults.adapter = async config => {
        if (config.url === '/auth/logout-all') {
          logouts++
          if (logouts > 1) return response(config, undefined, 204)
          return new Promise((resolve, reject) => { finish = () => statusCode === 204
            ? resolve(response(config, undefined, 204)) : reject(httpError(config, statusCode)) })
        }
        if (config.url === '/auth/login') return response(config, { ...authResponse('access-last', 'csrf-last'), user: laterAccount })
        if (config.url === '/auth/me') return response(config, laterAccount)
        throw new Error('Unexpected request')
      }
      const closing = store.logoutAll()
      const outcome = statusCode === 204 ? closing : assert.rejects(closing, error => error.response?.status === statusCode)
      await tick()
      await store.login({ email: laterAccount.email, password: 'valid-password' })
      finish(); await within(outcome)
      assert.equal(logouts, 1, 'an old logout must not target a later login')
      assert.equal(store.accessToken, 'access-last')
      assert.equal(store.user.id, laterAccount.id)
      assert.equal(store.status, 'authenticated')
    }
  }
})

test('logout global actualiza un CSRF obsoleto solo si hubo una renovación concurrente conocida', async () => {
  const store = createAuthStore(true)
  let rejectFirst, calls = 0, refreshes = 0
  api.defaults.adapter = async config => {
    if (config.url === '/auth/logout-all') {
      if (++calls === 1) return new Promise((_resolve, reject) => { rejectFirst = () => reject(httpError(config, 403)) })
      assert.equal(config.headers.get('X-CSRF-Token'), 'csrf-new'); return response(config, undefined, 204)
    }
    if (config.url === '/auth/refresh') { refreshes++; return response(config, authResponse('access-new', 'csrf-new')) }
    if (config.url === '/auth/me') return response(config, account)
    throw new Error('Unexpected request')
  }
  const closing = store.logoutAll(); await tick(); await store.refreshSession(); rejectFirst()
  await within(closing); assert.equal(calls, 2); assert.equal(refreshes, 1)
})

after(() => {
  api.defaults.adapter = undefined
})
