import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authRouteGuard } from '../src/router/auth.guard.ts'
import { pinia } from '../src/stores/pinia.ts'
import { useAuthStore } from '../src/stores/auth.store.ts'

test('redirige visitas privadas a login y usuarios autenticados fuera de rutas guest', async () => {
  const auth = useAuthStore(pinia)
  auth.clearSession()
  const privateRedirect = await authRouteGuard({ meta: { requiresAuth: true }, fullPath: '/app' })
  assert.deepEqual(privateRedirect, { name: 'login', query: { redirect: '/app' } })

  auth.status = 'authenticated'
  auth.accessToken = 'memory-only-token'
  auth.user = {
    id: 'a22ee5dc-c22b-4ba9-81b4-0abbd3c1a312',
    email: 'atleta@example.test',
    status: 'ACTIVE',
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
  }
  assert.deepEqual(
    await authRouteGuard({ meta: { guestOnly: true }, fullPath: '/login' }),
    { name: 'home' },
  )
})
