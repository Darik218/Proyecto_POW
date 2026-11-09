import axios, {
  CanceledError,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios'
import { apiConfig } from '../config/api.config'

export interface AuthHttpContext {
  getAccessToken: () => string | null
  getSessionGeneration: () => number | string
  refreshSession: () => Promise<void>
  clearSession: () => void
}

type RetryableRequest = InternalAxiosRequestConfig & {
  _authRetry?: boolean
  _authGeneration?: number | string | null
  _authBearer?: string
  _authManaged?: boolean
  _authInstallation?: number
}
type ApiErrorBody = { message?: string | string[]; error?: string }

export const api = axios.create(apiConfig)

let authContext: AuthHttpContext | undefined
let installation = 0
let requestInterceptor: number | undefined
let responseInterceptor: number | undefined
// The store owns single-flight refresh. Keeping a second promise here could
// make a new login join the previous session's refresh.
function generation(): number | string | null {
  return authContext?.getSessionGeneration() ?? null
}

function assertCurrent(config: RetryableRequest): void {
  if (config._authInstallation !== installation || config._authGeneration !== generation()) {
    throw new CanceledError('La sesión cambió. La operación anterior no se reenviará.', config)
  }
}

function isAuthenticationEndpoint(url: string | undefined): boolean {
  // /me verifies newly issued tokens before the store accepts them. Its 401
  // must reject that operation rather than wait for the same refresh again.
  return /^\/?auth\/(login|register|refresh|logout|logout-all|me|context)(?:\?|$)/.test(
    url ?? '',
  )
}

export function installAuthInterceptors(context: AuthHttpContext): void {
  if (typeof context.getSessionGeneration !== 'function') {
    throw new Error('Authentication requires a stable session context.')
  }
  installation += 1
  if (requestInterceptor !== undefined) api.interceptors.request.eject(requestInterceptor)
  if (responseInterceptor !== undefined) api.interceptors.response.eject(responseInterceptor)
  authContext = context

  requestInterceptor = api.interceptors.request.use((config: RetryableRequest) => {
    if ('_authGeneration' in config) assertCurrent(config)
    else {
      config._authGeneration = generation()
      config._authInstallation = installation
    }
    const token = authContext?.getAccessToken()
    if (token && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
    if (!config._authRetry) {
      config._authBearer = String(config.headers.get('Authorization') ?? '')
      config._authManaged = token !== null && config._authBearer === `Bearer ${token}`
    }
    return config
  }, (error: unknown) => { throw error }, { synchronous: true })

  responseInterceptor = api.interceptors.response.use(
    (response) => {
      if (!isAuthenticationEndpoint(response.config.url)) {
        assertCurrent(response.config as RetryableRequest)
      }
      return response
    },
    async (error: AxiosError<ApiErrorBody>) => {
      const original = error.config as RetryableRequest | undefined
      if (
        error.response?.status !== 401 ||
        !original ||
        original._authRetry ||
        !original._authManaged ||
        isAuthenticationEndpoint(original.url) ||
        !authContext
      ) {
        return Promise.reject(error)
      }

      original._authRetry = true
      const origin = original._authGeneration
      try {
        assertCurrent(original)
        // A late 401 may have been sent before another request completed the
        // same session's rotation. Reuse that token instead of rotating twice.
        if (original._authBearer === `Bearer ${authContext.getAccessToken()}`) {
          await authContext.refreshSession()
        }
        assertCurrent(original)
        const token = authContext.getAccessToken()
        if (!token) throw new Error('Session refresh returned no access token.')
        original.headers.set('Authorization', `Bearer ${token}`)
        return await api.request(original)
      } catch (refreshError) {
        // A request from a session closed meanwhile must not clear a later login.
        if (original._authInstallation === installation && origin === generation()) authContext.clearSession()
        return Promise.reject(refreshError)
      }
    },
  )
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data
    if (Array.isArray(body?.message)) return body.message.join(' ')
    if (typeof body?.message === 'string' && body.message.trim()) {
      return body.message
    }
    if (typeof body?.error === 'string' && body.error.trim()) {
      return body.error
    }
    if (!error.response) return 'No se pudo conectar con el servidor. Inténtalo de nuevo.'
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
