<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.store";
import {
  navigation,
  primaryNavigation,
  navigationSection,
} from "../config/navigation";
import PulsoIcon from "./ui/PulsoIcon.vue";
import PulsoBrand from "./ui/PulsoBrand.vue";
const auth = useAuthStore(),
  router = useRouter(),
  route = useRoute();
const signingOut = ref(false),
  mobileOpen = ref(false),
  isMobile = ref(false);
const sidebar = ref<HTMLElement | null>(null),
  menuButton = ref<HTMLButtonElement | null>(null);
const section = computed(() => navigationSection(route.name));
const parentSections: Record<string, string> = {
  history: "progression",
  settings: "progression",
  automation: "progression",
  plans: "routine",
};
const primarySection = computed(
  () => parentSections[section.value] ?? section.value,
);
const current = computed(
  () => navigation.find((item) => item.key === section.value) ?? navigation[0],
);
const initials = computed(() =>
  (auth.user?.email?.slice(0, 2) ?? "TU").toUpperCase(),
);
let media: MediaQueryList | undefined,
  savedOverflow = "";
function syncMedia() {
  isMobile.value = media?.matches ?? false;
  if (!isMobile.value) mobileOpen.value = false;
}
onMounted(() => {
  media = window.matchMedia("(max-width: 900px)");
  syncMedia();
  media.addEventListener("change", syncMedia);
});
onBeforeUnmount(() => {
  media?.removeEventListener("change", syncMedia);
  if (mobileOpen.value) document.body.style.overflow = savedOverflow;
});
watch(mobileOpen, async (value) => {
  if (typeof document === "undefined") return;
  if (value) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await nextTick();
    sidebar.value?.querySelector<HTMLButtonElement>("button")?.focus();
  } else {
    document.body.style.overflow = savedOverflow;
    if (isMobile.value) await nextTick().then(() => menuButton.value?.focus());
  }
});
watch(
  () => route.path,
  () => {
    mobileOpen.value = false;
  },
);
function containFocus(event: KeyboardEvent) {
  if (!mobileOpen.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    mobileOpen.value = false;
    return;
  }
  if (event.key !== "Tab") return;
  const list = [
    ...(sidebar.value?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), summary",
    ) ?? []),
  ].filter((element) => {
    const closed = element.closest("details:not([open])");
    return (
      element.getClientRects().length > 0 &&
      (!closed || element === closed.querySelector(":scope > summary"))
    );
  });
  if (!list?.length) return;
  const first = list[0]!,
    last = list[list.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
async function signOut(allSessions = false): Promise<void> {
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    if (allSessions) await auth.logoutAll();
    else await auth.logout();
    await router.replace({ name: "login" });
  } catch {
    await router.replace({ name: "login", query: { reason: "logout-failed" } });
  } finally {
    signingOut.value = false;
  }
}
</script>
<template>
  <div class="app-shell">
    <a href="#main-content" class="pulso-skip">Saltar al contenido</a>
    <div
      v-if="mobileOpen"
      class="nav-scrim"
      aria-hidden="true"
      @click="mobileOpen = false"
    ></div>
    <aside
      id="pulso-navigation"
      ref="sidebar"
      class="app-sidebar"
      :class="{ 'app-sidebar--open': mobileOpen }"
      :role="mobileOpen ? 'dialog' : undefined"
      :aria-modal="mobileOpen ? 'true' : undefined"
      :aria-label="mobileOpen ? 'Menú de PULSO' : undefined"
      :inert="isMobile && !mobileOpen"
      @keydown="containFocus"
    >
      <button
        v-if="isMobile"
        class="mobile-sidebar-close"
        type="button"
        aria-label="Cerrar menú"
        @click="mobileOpen = false"
      >
        <PulsoIcon name="close" />
      </button>
      <RouterLink
        class="brand sidebar-brand"
        :to="{ name: 'dashboard' }"
        aria-label="PULSO, inicio"
        ><PulsoBrand
      /></RouterLink>
      <nav class="app-nav" aria-label="Navegación principal">
        <template v-for="(item, index) in primaryNavigation" :key="item.name">
          <span v-if="index === 0" class="app-nav__group"
            >Tu entrenamiento</span
          >
          <RouterLink
            :to="{ name: item.name }"
            class="app-nav__link"
            :class="{ 'app-nav__link--active': primarySection === item.key }"
            active-class=""
            :aria-current="primarySection === item.key ? 'page' : undefined"
            ><PulsoIcon :name="item.icon" :size="19" /><span>{{
              item.label
            }}</span
            ><i
              v-if="primarySection === item.key"
              class="nav-active-marker"
              aria-hidden="true"
            ></i
          ></RouterLink>
        </template>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-account">
          <div v-if="auth.user" class="sidebar-identity">
            <span class="avatar" aria-hidden="true">{{ initials }}</span>
            <div>
              <p class="app-account" :title="auth.user.email">
                {{ auth.user.email }}
              </p>
              <small class="ui-muted">Tu espacio personal</small>
            </div>
          </div>
          <details>
            <summary>Gestionar mi sesión</summary>
            <div class="app-session-actions">
              <button
                class="logout-button"
                type="button"
                :disabled="signingOut"
                @click="signOut()"
              >
                <PulsoIcon name="logout" :size="16" />{{
                  signingOut ? "Cerrando…" : "Cerrar sesión"
                }}</button
              ><button
                class="logout-all-button"
                type="button"
                :disabled="signingOut"
                @click="signOut(true)"
              >
                Cerrar todas las sesiones
              </button>
            </div>
          </details>
        </div>
      </div>
    </aside>
    <div :inert="mobileOpen">
      <header class="app-header">
        <button
          ref="menuButton"
          class="mobile-menu-button"
          type="button"
          aria-label="Abrir menú"
          aria-controls="pulso-navigation"
          :aria-expanded="mobileOpen"
          @click="mobileOpen = true"
        >
          <PulsoIcon name="menu" />
        </button>
        <div class="app-header__context">
          <strong>{{ current.label }}</strong
          ><small>{{ current.section }} / PULSO</small>
        </div>
        <span v-if="auth.status === 'authenticated'" class="session-label"
          ><span class="session-dot" aria-hidden="true"></span>Sesión
          actual</span
        >
      </header>
      <slot />
    </div>
  </div>
</template>
