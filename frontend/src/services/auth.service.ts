import { z } from 'zod'
import { api } from './api'

export const registerSchema = z.object({
  email: z.string().trim().email('Introduce un correo válido.').max(320),
  password: z
    .string()
    .min(12, 'La contraseña debe tener al menos 12 caracteres.')
    .max(128, 'La contraseña no puede superar 128 caracteres.'),
})

export const loginSchema = z.object({
  email: z.string().trim().email('Introduce un correo válido.').max(320),
  password: z
    .string()
    .min(1, 'Introduce tu contraseña.')
    .max(128, 'La contraseña no puede superar 128 caracteres.'),
})

export type AuthForm = { email: string; password: string }
export type PublicAccount = {
  id: string
  email: string
  status: string
  createdAt: string
  updatedAt: string
}
export type AuthResponse = {
  user: PublicAccount
  accessToken: string
  accessTokenExpiresAt: string
  csrfToken: string
}

const authPath = '/auth'
const csrfStorageKey = 'pow_csrf_token'
const browserContextSchema = z.object({
  contextId: z.string().regex(/^[a-f0-9]{64}$/),
  csrfToken: z.string().min(1),
}).strict()

export const authService = {
  async context() {
    const { data } = await api.post(`${authPath}/context`, {})
    return browserContextSchema.parse(data)
  },
  async register(form: AuthForm): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>(`${authPath}/register`, form)
    return data
  },

  async login(form: AuthForm): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>(`${authPath}/login`, form)
    return data
  },

  async refresh(csrfToken: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>(
      `${authPath}/refresh`,
      {},
      { headers: { 'X-CSRF-Token': csrfToken } },
    )
    return data
  },

  async me(accessToken: string): Promise<PublicAccount> {
    const { data } = await api.get<PublicAccount>(`${authPath}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return data
  },

  async logout(csrfToken: string): Promise<void> {
    await api.post(`${authPath}/logout`, {}, {
      headers: { 'X-CSRF-Token': csrfToken },
    })
  },

  async logoutAll(csrfToken: string): Promise<void> {
    await api.post(`${authPath}/logout-all`, {}, {
      headers: { 'X-CSRF-Token': csrfToken },
    })
  },
}

export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const csrfPair = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('pow_csrf='))
  if (!csrfPair) return null
  try {
    return decodeURIComponent(csrfPair.slice('pow_csrf='.length)) || null
  } catch {
    return null
  }
}

export function readCsrfToken(): string | null {
  return readCsrfCookie()
}

export function forgetCsrfToken(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(csrfStorageKey)
  } catch {
    // Clearing in-memory state still prevents use in the current page.
  }
}
