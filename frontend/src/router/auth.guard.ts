import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { pinia } from '../stores/pinia'

export async function authRouteGuard(to: RouteLocationNormalized) {
  const auth = useAuthStore(pinia)
  await auth.initialize()
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) return { name: 'home' }
  return true
}
