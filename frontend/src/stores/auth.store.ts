import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
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

  function clearSession(): void {
    accessToken.value = null
    csrfToken.value = null
    user.value = null
    status.value = 'anonymous'
    forgetCsrfToken()
  }

  async function acceptResponse(response: AuthResponse): Promise<void> {
    const verifiedUser = await authService.me(response.accessToken)
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
    status.value = 'loading'
    try {
      await acceptResponse(await authService.login(form))
    } catch (error) {
      clearSession()
      throw error
    }
  }

  async function register(form: AuthForm): Promise<void> {
    status.value = 'loading'
    try {
      await acceptResponse(await authService.register(form))
    } catch (error) {
      clearSession()
      throw error
    }
  }

  function refreshSession(): Promise<void> {
    if (refreshOperation) return refreshOperation
    refreshOperation = (async () => {
      const csrf = csrfToken.value ?? readCsrfToken()
      if (!csrf) throw new Error('No hay una cookie CSRF disponible para renovar la sesión.')
      const response = await authService.refresh(csrf)
      await acceptResponse(response)
    })().catch((error: unknown) => {
      clearSession()
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

  async function logoutAll(): Promise<void> {
    const csrf = csrfToken.value ?? readCsrfToken()
    try {
      if (!csrf) throw new Error('No se pudo validar la protección CSRF para cerrar las sesiones.')
      await authService.logoutAll(csrf)
    } finally {
      clearSession()
    }
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
