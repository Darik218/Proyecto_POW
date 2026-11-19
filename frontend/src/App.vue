<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth.store";

const auth = useAuthStore();
const route = useRoute();
const content = ref<HTMLElement | null>(null);
const paused = ref(false);
const failure = ref(false);
const protectedRoute = computed(() => route.meta.requiresAuth === true);
let revision = 0;
let checking: number | undefined;

function suspendPrivateView() {
  if (!protectedRoute.value || !auth.isAuthenticated) return;
  revision++;
  paused.value = true;
  failure.value = false;
  // Hide synchronously so the browser cannot snapshot a visible private view.
  if (content.value) content.value.hidden = true;
}

async function verifyPrivateView() {
  if (
    !paused.value ||
    !protectedRoute.value ||
    !auth.isAuthenticated ||
    checking === revision
  )
    return;
  const requested = revision;
  checking = requested;
  failure.value = false;
  try {
    await auth.verifySession();
    if (requested === revision && !document.hidden && auth.isAuthenticated)
      paused.value = false;
  } catch {
    if (requested === revision && auth.isAuthenticated) failure.value = true;
  } finally {
    if (requested === checking) checking = undefined;
  }
}

function onVisibilityChange() {
  if (document.hidden) suspendPrivateView();
  else void verifyPrivateView();
}

function onPageShow(event: PageTransitionEvent) {
  if (!event.persisted) return;
  if (!paused.value) suspendPrivateView();
  void verifyPrivateView();
}

watch(
  () => auth.status,
  (status) => {
    if (status === "anonymous") {
      revision++;
      paused.value = false;
      failure.value = false;
    }
  },
);

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", suspendPrivateView);
  window.addEventListener("pageshow", onPageShow);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", suspendPrivateView);
  window.removeEventListener("pageshow", onPageShow);
});
</script>

<template>
  <div
    ref="content"
    class="app-route-content"
    :hidden="protectedRoute && (paused || !auth.isAuthenticated)"
  >
    <RouterView />
  </div>
  <section
    v-if="protectedRoute && paused"
    class="session-check"
    aria-label="Verificación de sesión"
  >
    <template v-if="failure">
      <p role="alert">
        No pudimos verificar tu sesión. Comprueba la conexión e inténtalo de
        nuevo.
      </p>
      <button type="button" class="primary-button" @click="verifyPrivateView">
        Reintentar
      </button>
    </template>
    <p v-else role="status">Verificando tu sesión…</p>
  </section>
</template>

<style scoped>
.app-route-content[hidden] {
  display: none;
}
.session-check {
  padding: var(--space-6);
  text-align: center;
}
</style>
