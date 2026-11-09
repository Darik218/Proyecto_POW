import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import {
  authService,
  forgetCsrfToken,
  readCsrfToken,
  rememberCsrfToken,
  type AuthForm,
  type AuthResponse,
  type PublicAccount,
} from '../services/auth.service'

export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const csrfToken = ref<string | null>(null)
  const user = ref<PublicAccount | null>(null)
  const status = ref<AuthStatus>('unknown')
  const isAuthenticated = computed(
    () => status.value === 'authenticated' && accessToken.value !== null && user.value !== null,
  )
  let initialization: Promise<void> | undefined
  let refreshOperation: Promise<void> | undefined
  let logoutAllOperation: Promise<void> | undefined
  let sessionGeneration = 0

  function clearSession(): void {
    sessionGeneration += 1
    accessToken.value = null
    csrfToken.value = null
    user.value = null
    status.value = 'anonymous'
    forgetCsrfToken()
  }

  async function acceptResponse(response: AuthResponse, generation = sessionGeneration): Promise<void> {
    const verifiedUser = await authService.me(response.accessToken)
    if (generation !== sessionGeneration) {
      throw new Error('La sesión cambió durante la renovación.')
    }
    if (verifiedUser.id !== response.user.id) {
      throw new Error('La cuenta verificada no coincide con la respuesta de autenticación.')
    }
    accessToken.value = response.accessToken
    csrfToken.value = response.csrfToken
    rememberCsrfToken(response.csrfToken)
    user.value = verifiedUser
    status.value = 'authenticated'
  }

  async function login(form: AuthForm): Promise<void> {
    const generation = ++sessionGeneration
    status.value = 'loading'
    try {
      await acceptResponse(await authService.login(form), generation)
    } catch (error) {
      if (generation === sessionGeneration) clearSession()
      throw error
    }
  }

  async function register(form: AuthForm): Promise<void> {
    const generation = ++sessionGeneration
    status.value = 'loading'
    try {
      await acceptResponse(await authService.register(form), generation)
    } catch (error) {
      if (generation === sessionGeneration) clearSession()
      throw error
    }
  }

  function refreshSession(): Promise<void> {
    if (refreshOperation) return refreshOperation
    const generation = sessionGeneration
    refreshOperation = (async () => {
      const csrf = csrfToken.value ?? readCsrfToken()
      if (!csrf) throw new Error('No hay una cookie CSRF disponible para renovar la sesión.')
      const response = await authService.refresh(csrf)
      if (generation !== sessionGeneration) throw new Error('La sesión cambió durante la renovación.')
      await acceptResponse(response, generation)
    })().catch((error: unknown) => {
      if (generation === sessionGeneration) clearSession()
      throw error
    }).finally(() => {
      refreshOperation = undefined
    })
    return refreshOperation
  }

  function initialize(): Promise<void> {
    if (status.value === 'authenticated' || status.value === 'anonymous') {
      return Promise.resolve()
    }
    initialization ??= (async () => {
      status.value = 'loading'
      try {
        await refreshSession()
      } catch {
        clearSession()
      }
    })().finally(() => {
      initialization = undefined
    })
    return initialization
  }

  async function logout(): Promise<void> {
    const csrf = csrfToken.value ?? readCsrfToken()
    try {
      if (!csrf) throw new Error('No se pudo validar la protección CSRF para cerrar sesión.')
      await authService.logout(csrf)
    } finally {
      clearSession()
    }
  }

  function logoutAll(): Promise<void> {
    if (logoutAllOperation) return logoutAllOperation
    const generation = sessionGeneration
    logoutAllOperation = (async () => {
      try {
        // Join an existing rotation before reading either credential.
        if (refreshOperation) await refreshOperation
        if (generation !== sessionGeneration) throw new Error('La sesión cambió durante el cierre global.')
        const tokenBefore = accessToken.value
        const csrfBefore = csrfToken.value ?? readCsrfToken()
        if (!csrfBefore) throw new Error('No se pudo validar la protección CSRF para cerrar las sesiones.')
        try {
          await authService.logoutAll(csrfBefore)
        } catch (error) {
          const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined
          if (statusCode !== 401 && statusCode !== 403) throw error
          if (refreshOperation) await refreshOperation
          if (generation !== sessionGeneration) throw error
          const credentialsChanged = accessToken.value !== tokenBefore || csrfToken.value !== csrfBefore
          if (statusCode === 401 && !credentialsChanged) await refreshSession()
          else if (!credentialsChanged) throw error
          if (generation !== sessionGeneration) throw error
          const csrf = csrfToken.value ?? readCsrfToken()
          if (!accessToken.value || !csrf) throw error
          // One explicit retry, with the current bearer from the existing interceptor
          // and the CSRF issued by that same rotation. No recursive Axios retry.
          await authService.logoutAll(csrf)
        }
      } finally {
        if (generation === sessionGeneration) clearSession()
      }
    })().finally(() => { logoutAllOperation = undefined })
    return logoutAllOperation
  }

  return {
    accessToken,
    csrfToken,
    user,
    status,
    isAuthenticated,
    initialize,
    login,
    register,
    refreshSession,
    logout,
    logoutAll,
    clearSession,
  }
})
