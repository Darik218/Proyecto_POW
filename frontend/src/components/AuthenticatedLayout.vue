<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'

const auth = useAuthStore()
const router = useRouter()
const route=useRoute()
const routineRoutes=['home','routine-day','training-plans','training-plan-detail','workout-sessions','workout-session-detail','exercise-catalog','exercise-detail']
const signingOut = ref(false)

async function signOut(allSessions = false): Promise<void> {
  if (signingOut.value) return
  signingOut.value = true
  try {
    if (allSessions) await auth.logoutAll()
    else await auth.logout()
    await router.replace({ name: 'login' })
  } catch {
    await router.replace({ name: 'login', query: { reason: 'logout-failed' } })
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__top">
        <RouterLink class="brand" :to="{ name: 'home' }" aria-label="PULSO, inicio">
          PULSO<span>.</span>
        </RouterLink>
        <p v-if="auth.user" class="app-account" :title="auth.user.email">
          <span class="session-dot" aria-hidden="true"></span>
          {{ auth.user.email }}
        </p>
        <div class="app-session-actions">
          <button class="logout-button" type="button" :disabled="signingOut" @click="signOut()">
            {{ signingOut ? 'Cerrando…' : 'Cerrar sesión' }}
          </button>
          <button class="logout-all-button" type="button" :disabled="signingOut" @click="signOut(true)">
            Cerrar todas las sesiones
          </button>
        </div>
      </div>
      <nav class="app-nav" aria-label="Navegación principal">
        <RouterLink class="app-nav__link" active-class="app-nav__link--active" :class="{'app-nav__link--active':routineRoutes.includes(String(route.name))}" :to="{name:'home'}">Mi rutina</RouterLink>
        <RouterLink class="app-nav__link" active-class="app-nav__link--active" :to="{name:'workout-history'}">Historial</RouterLink>
        <RouterLink class="app-nav__link" active-class="app-nav__link--active" :class="{'app-nav__link--active':route.name==='measurements'}" :to="{name:'profile'}">Perfil</RouterLink>
      </nav>
    </header>
    <slot />
  </div>
</template>
