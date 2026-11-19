import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import {
  authService, forgetCsrfToken,
  type AuthForm, type AuthResponse, type PublicAccount,
} from '../services/auth.service'
import { createAuthCoordination } from '../services/auth-coordination'

export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous'
let nextStoreScope = 0

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const csrfToken = ref<string | null>(null)
  const user = ref<PublicAccount | null>(null)
  const status = ref<AuthStatus>('unknown')
  const isAuthenticated = computed(
    () => status.value === 'authenticated' && accessToken.value !== null && user.value !== null,
  )
  let initialization: Promise<void> | undefined
  let refreshOperation: { generation: number; promise: Promise<void> } | undefined
  let logoutAllOperation: { generation: number; promise: Promise<void> } | undefined
  let sessionGeneration = 0
  const storeScope = ++nextStoreScope
  let cookieContext: string | null = null
  const getSessionGeneration = () => `${storeScope}:${sessionGeneration}`
  const coordination = createAuthCoordination(clearSession, () => { csrfToken.value = null })
  onScopeDispose(coordination.close)

  function assertGeneration(generation: number): void {
    if (generation !== sessionGeneration) throw new Error('La sesión cambió. Inténtalo de nuevo con la cuenta actual.')
  }

  function clearSession(): void {
    sessionGeneration += 1
    accessToken.value = null
    csrfToken.value = null
    user.value = null
    cookieContext = null
    status.value = 'anonymous'
    forgetCsrfToken() // Remove the previous per-tab CSRF cache; credentials stay in memory.
  }

  async function currentContext(generation: number) {
    assertGeneration(generation)
    const context = await authService.context()
    assertGeneration(generation)
    if (cookieContext && context.contextId !== cookieContext) {
      throw new Error('La sesión del navegador cambió. Vuelve a iniciar sesión.')
    }
    return context
  }

  async function acceptResponse(response: AuthResponse, generation: number, contextId: string): Promise<void> {
    assertGeneration(generation)
    const verifiedUser = await authService.me(response.accessToken)
    assertGeneration(generation)
    if (verifiedUser.id !== response.user.id) {
      throw new Error('La cuenta verificada no coincide con la respuesta de autenticación.')
    }
    accessToken.value = response.accessToken
    csrfToken.value = response.csrfToken
    forgetCsrfToken()
    cookieContext = contextId
    user.value = verifiedUser
    status.value = 'authenticated'
  }

  async function authenticate(form: AuthForm, operation: 'login' | 'register'): Promise<void> {
    clearSession()
    const generation = sessionGeneration
    status.value = 'loading'
    try {
      await coordination.run(async () => {
        assertGeneration(generation)
        coordination.boundary()
        const response = await authService[operation](form)
        assertGeneration(generation)
        const context = await currentContext(generation)
        await acceptResponse(response, generation, context.contextId)
      })
    } catch (error) {
      if (generation === sessionGeneration) clearSession()
      throw error
    }
  }
  const login = (form: AuthForm) => authenticate(form, 'login')
  const register = (form: AuthForm) => authenticate(form, 'register')

  // Called only while holding the browser cookie lock. Keeping this private
  // avoids recursively acquiring that lock when logout-all needs a refresh.
  async function refreshUnlocked(generation: number): Promise<void> {
    const accountId = user.value?.id
    const context = await currentContext(generation)
    const response = await authService.refresh(context.csrfToken)
    assertGeneration(generation)
    if (accountId && response.user.id !== accountId) throw new Error('La cuenta de la sesión cambió.')
    await acceptResponse(response, generation, context.contextId)
    coordination.rotation()
  }

  function refreshSession(): Promise<void> {
    const generation = sessionGeneration
    if (refreshOperation?.generation === generation) return refreshOperation.promise
    const promise = coordination.run(() => refreshUnlocked(generation)).catch((error: unknown) => {
      if (generation === sessionGeneration) clearSession()
      throw error
    }).finally(() => {
      if (refreshOperation?.promise === promise) refreshOperation = undefined
    })
    refreshOperation = { generation, promise }
    return promise
  }

  function initialize(): Promise<void> {
    if (status.value === 'authenticated' || status.value === 'anonymous') return Promise.resolve()
    const generation = sessionGeneration
    initialization ??= (async () => {
      status.value = 'loading'
      try { await refreshSession() }
      catch { if (generation === sessionGeneration) clearSession() }
    })().finally(() => { initialization = undefined })
    return initialization
  }

  async function logout(): Promise<void> {
    const generation = sessionGeneration
    try {
      await coordination.run(async () => {
        const context = await currentContext(generation)
        coordination.boundary()
        await authService.logout(context.csrfToken)
      })
    } finally {
      if (generation === sessionGeneration) clearSession()
    }
  }

  function logoutAll(): Promise<void> {
    const generation = sessionGeneration
    if (logoutAllOperation?.generation === generation) return logoutAllOperation.promise
    const promise = (async () => {
      try {
        // A refresh already running in this tab owns the same browser lock.
        if (refreshOperation?.generation === generation) await refreshOperation.promise
        await coordination.run(async () => {
          const context = await currentContext(generation)
          const tokenBefore = accessToken.value
          coordination.boundary()
          try {
            await authService.logoutAll(context.csrfToken)
          } catch (error) {
            if (generation !== sessionGeneration) throw error
            const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined
            const credentialsChanged = accessToken.value !== tokenBefore
            if (statusCode !== 401 && !(statusCode === 403 && credentialsChanged)) throw error
            // One bounded refresh, under the existing lock, with fresh CSRF.
            if (!credentialsChanged) await refreshUnlocked(generation)
            assertGeneration(generation)
            const current = await currentContext(generation)
            await authService.logoutAll(current.csrfToken)
          }
        })
      } finally { if (generation === sessionGeneration) clearSession() }
    })().finally(() => {
      if (logoutAllOperation?.promise === promise) logoutAllOperation = undefined
    })
    logoutAllOperation = { generation, promise }
    return promise
  }

  return {
    accessToken, csrfToken, user, status, isAuthenticated,
    initialize, login, register, refreshSession, logout, logoutAll, clearSession, getSessionGeneration,
    getSessionContextId: () => cookieContext,
  }
})
