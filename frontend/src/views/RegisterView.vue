<script setup lang="ts">
import PulsoBrand from "../components/ui/PulsoBrand.vue";
import SportLineArt from "../components/account/SportLineArt.vue";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { apiErrorMessage } from "../services/api";
import { registerSchema } from "../services/auth.service";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const router = useRouter();
const email = ref("");
const password = ref("");
const submitting = ref(false);
const errorMessage = ref("");
const fieldErrors = ref<Record<string, string>>({});

async function submit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = "";
  fieldErrors.value = {};
  const parsed = registerSchema.safeParse({
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
    await auth.register(parsed.data);
    await router.replace({ name: "home", query: { create: "true" } });
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, "No se pudo crear la cuenta.");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="register-title">
      <a class="brand" href="/" aria-label="PULSO, inicio"><PulsoBrand /></a>

      <h1 id="register-title">Tu próximo capítulo.</h1>
      <p class="intro">
        Crea tu cuenta y construye un entrenamiento a tu medida.
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

        <label for="password">Contraseña</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="128"
          required
        />
        <p class="hint">Usa entre 12 y 128 caracteres.</p>
        <p v-if="fieldErrors.password" class="field-error">
          {{ fieldErrors.password }}
        </p>
        <p v-if="errorMessage" class="form-error" role="alert">
          {{ errorMessage }}
        </p>
        <button class="primary-button" type="submit" :disabled="submitting">
          {{ submitting ? "Creando cuenta…" : "Crear cuenta" }}
        </button>
      </form>
      <p class="auth-switch">
        ¿Ya tienes una cuenta?
        <RouterLink to="/login">Inicia sesión</RouterLink>
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
