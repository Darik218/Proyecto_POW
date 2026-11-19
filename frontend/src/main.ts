import { createApp, watch } from 'vue'
import { useAuthStore } from './stores/auth.store'
import { pinia } from './stores/pinia'
import { installAuthInterceptors } from './services/api'
import { router } from './router'
import './style.css'
import App from './App.vue'

const app = createApp(App)
app.use(pinia)
const auth = useAuthStore(pinia)
installAuthInterceptors({
  getAccessToken: () => auth.accessToken,
  getSessionGeneration: () => auth.getSessionGeneration(),
  refreshSession: () => auth.refreshSession(),
  clearSession: () => {
    auth.clearSession()
    if (router.currentRoute.value.meta.requiresAuth) {
      void router.replace({ name: 'login', query: { reason: 'session-expired' } })
    }
  },
})
watch(() => auth.status, (status) => {
  if (status === 'anonymous' && router.currentRoute.value.meta.requiresAuth) {
    void router.replace({ name: 'login', query: { reason: 'session-expired' } })
  }
})
app.use(router)
app.mount('#app')
