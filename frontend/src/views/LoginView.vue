<script setup lang="ts">
import PulsoBrand from "../components/ui/PulsoBrand.vue";
import SportLineArt from "../components/account/SportLineArt.vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiErrorMessage } from "../services/api";
import { loginSchema } from "../services/auth.service";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const submitting = ref(false);
const errorMessage = ref("");
const fieldErrors = ref<Record<string, string>>({});
const infoMessage = computed(() => {
  if (route.query.reason === "session-expired")
    return "Tu sesión expiró. Inicia sesión de nuevo.";
  if (route.query.reason === "logout-failed")
    return "No se pudo confirmar el cierre en el servidor. Inicia sesión para volver a comprobar tu sesión.";
  return "";
});

function destination(): string {
  const requested = route.query.redirect;
  return typeof requested === "string" &&
    requested.startsWith("/") &&
    !requested.startsWith("//")
    ? requested
    : "/app/overview";
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = "";
  fieldErrors.value = {};
  const parsed = loginSchema.safeParse({
    email: email.value,
    password: password.value,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors.value[field]) {
        fieldErrors.value[field] = issue.message;
      }
    }
    return;
  }
  submitting.value = true;
  try {
    await auth.login(parsed.data);
    await router.replace(destination());
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, "No se pudo iniciar sesión.");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="login-title">
      <a class="brand" href="/" aria-label="PULSO, inicio"><PulsoBrand /></a>

      <h1 id="login-title">Qué bueno verte.</h1>
      <p class="intro">Inicia sesión para continuar con tu plan.</p>
      <p v-if="infoMessage" class="info-message" role="status">
        {{ infoMessage }}
      </p>

      <form class="auth-form" @submit.prevent="submit">
        <label for="email">Correo electrónico</label>
        <input
          id="email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
        />
        <p v-if="fieldErrors.email" class="field-error">
          {{ fieldErrors.email }}
        </p>

        <div class="label-row">
          <label for="password">Contraseña</label>
        </div>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
        <p v-if="fieldErrors.password" class="field-error">
          {{ fieldErrors.password }}
        </p>
        <p v-if="errorMessage" class="form-error" role="alert">
          {{ errorMessage }}
        </p>
        <button class="primary-button" type="submit" :disabled="submitting">
          {{ submitting ? "Ingresando…" : "Iniciar sesión" }}
        </button>
      </form>
      <p class="auth-switch">
        ¿Aún no tienes cuenta?
        <RouterLink to="/register">Regístrate</RouterLink>
      </p>
    </section>
    <aside class="auth-art" aria-label="Entrenamiento constante, progreso real">
      <a class="brand art-brand" href="/" aria-label="PULSO, inicio"
        ><PulsoBrand
      /></a>
      <SportLineArt />
      <div class="art-copy">
        <p>Entrena con intención.<br /><strong>Avanza con PULSO.</strong></p>
        <span>Tu plan. Tu registro. Tu siguiente paso.</span>
      </div>
    </aside>
  </main>
</template>

<style scoped src="../components/account/auth.css"></style>
