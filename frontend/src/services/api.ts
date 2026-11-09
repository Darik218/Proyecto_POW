import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios'
import { apiConfig } from '../config/api.config'

export interface AuthHttpContext {
  getAccessToken: () => string | null
  refreshSession: () => Promise<void>
  clearSession: () => void
}

type RetryableRequest = InternalAxiosRequestConfig & { _authRetry?: boolean }
type ApiErrorBody = { message?: string | string[]; error?: string }

export const api = axios.create(apiConfig)

let authContext: AuthHttpContext | undefined
let refreshInFlight: Promise<void> | undefined

function isAuthenticationEndpoint(url: string | undefined): boolean {
  // /me verifies newly issued tokens before the store accepts them. Its 401
  // must reject that operation rather than wait for the same refresh again.
  return /^\/?auth\/(login|register|refresh|logout|logout-all|me)(?:\?|$)/.test(
    url ?? '',
  )
}

export function installAuthInterceptors(context: AuthHttpContext): void {
  authContext = context

  api.interceptors.request.use((config) => {
    const token = authContext?.getAccessToken()
    if (token && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${token}`)
    }
    return config
  })

  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const original = error.config as RetryableRequest | undefined
      if (
        error.response?.status !== 401 ||
        !original ||
        original._authRetry ||
        isAuthenticationEndpoint(original.url) ||
        !authContext
      ) {
        return Promise.reject(error)
      }

      original._authRetry = true
      let requestToken = authContext.getAccessToken()
      try {
        refreshInFlight ??= authContext.refreshSession().finally(() => {
          refreshInFlight = undefined
        })
        await refreshInFlight
        const token = authContext.getAccessToken()
        if (!token) throw new Error('Session refresh returned no access token.')
        requestToken = token
        original.headers.set('Authorization', `Bearer ${token}`)
        return await api.request(original)
      } catch (refreshError) {
        // A request from a session closed meanwhile must not clear a later login.
        if (authContext.getAccessToken() === requestToken) authContext.clearSession()
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
