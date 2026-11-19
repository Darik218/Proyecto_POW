<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../stores/auth.store";
import PulsoIcon from "../components/ui/PulsoIcon.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import { RouterLink } from "vue-router";
import {
  athleteErrorMessage,
  athletesService,
} from "../services/athletes.service";
import {
  measurementUnitSchema,
  updateAthleteRequestSchema,
} from "../schemas/athletes.schema";
import type { AthleteProfile, MeasurementUnit } from "../types/athletes";

const auth = useAuthStore();
const accountInitials = computed(
  () => auth.user?.email.slice(0, 2).toUpperCase() || "AT",
);
const profile = ref<AthleteProfile | null>(null);
const birthDate = ref("");
const preferredUnit = ref<MeasurementUnit>("KG");
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const validationError = ref("");
const requestError = ref("");
const successMessage = ref("");

function dateInputValue(value: string | null): string {
  if (!value) return "";
  const candidate = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function loadProfile(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    profile.value = await athletesService.getProfile();
    birthDate.value = dateInputValue(profile.value.birthDate);
    preferredUnit.value = profile.value.preferredUnit;
  } catch (error) {
    loadError.value = athleteErrorMessage(
      error,
      "No se pudo cargar tu perfil.",
    );
  } finally {
    loading.value = false;
  }
}

async function saveProfile(): Promise<void> {
  if (saving.value || !profile.value) return;
  validationError.value = "";
  requestError.value = "";
  successMessage.value = "";
  const parsed = updateAthleteRequestSchema.safeParse({
    birthDate: birthDate.value || null,
    preferredUnit: preferredUnit.value,
  });
  if (!parsed.success) {
    validationError.value =
      parsed.error.issues[0]?.message ?? "Revisa los datos del perfil.";
    return;
  }

  saving.value = true;
  try {
    profile.value = await athletesService.updateProfile(parsed.data);
    birthDate.value = dateInputValue(profile.value.birthDate);
    preferredUnit.value = profile.value.preferredUnit;
    successMessage.value = "Tu perfil se actualizó correctamente.";
  } catch (error) {
    requestError.value = athleteErrorMessage(
      error,
      "No se pudo guardar tu perfil.",
    );
  } finally {
    saving.value = false;
  }
}

onMounted(() => void loadProfile());
</script>

<template>
  <section class="page-view">
    <PageHeader
      title="Mi perfil"
      description="Datos del atleta, unidades y preferencias."
    />

    <LoadingState v-if="loading" label="Cargando perfil…" :rows="2" />
    <div
      v-else-if="loadError"
      class="state-card state-card--error"
      role="alert"
    >
      <p>{{ loadError }}</p>
      <button class="secondary-button" type="button" @click="loadProfile">
        Intentar de nuevo
      </button>
    </div>

    <template v-else-if="profile">
      <div class="athlete-banner">
        <span class="athlete-avatar" aria-hidden="true">{{
          accountInitials
        }}</span>
        <div>
          <h2>{{ auth.user?.email || "Tu perfil de atleta" }}</h2>
          <p>Tu espacio personal de entrenamiento</p>
        </div>
        <span class="athlete-unit"
          ><PulsoIcon name="scale" :size="20" />{{
            profile.preferredUnit === "KG" ? "Kilogramos" : "Libras"
          }}</span
        >
      </div>
      <div class="profile-grid">
        <form class="form-card" @submit.prevent="saveProfile">
          <h2>Datos del atleta</h2>
          <p class="card-intro">
            Solo puedes editar la fecha de nacimiento y tu unidad preferida.
          </p>

          <label class="field-label" for="birth-date"
            >Fecha de nacimiento</label
          >
          <input
            id="birth-date"
            v-model="birthDate"
            class="form-control"
            type="date"
            :disabled="saving"
            aria-describedby="birth-date-hint"
          />
          <p id="birth-date-hint" class="field-hint">Campo opcional.</p>

          <label class="field-label" for="preferred-unit"
            >Unidad preferida</label
          >
          <select
            id="preferred-unit"
            v-model="preferredUnit"
            class="form-control"
            :disabled="saving"
          >
            <option
              v-for="unit in measurementUnitSchema.options"
              :key="unit"
              :value="unit"
            >
              {{ unit === "KG" ? "Kilogramos (kg)" : "Libras (lb)" }}
            </option>
          </select>

          <p v-if="validationError" class="form-error" role="alert">
            {{ validationError }}
          </p>
          <p v-if="requestError" class="form-error" role="alert">
            {{ requestError }}
          </p>
          <p v-if="successMessage" class="success-message" role="status">
            {{ successMessage }}
          </p>
          <button class="primary-button" type="submit" :disabled="saving">
            {{ saving ? "Guardando…" : "Guardar cambios" }}
          </button>
        </form>

        <aside
          class="details-card profile-preferences"
          aria-labelledby="profile-details-title"
        >
          <h2 id="profile-details-title">Preferencias de entrenamiento</h2>
          <RouterLink :to="{ name: 'measurements' }"
            ><PulsoIcon name="scale" /><span>Medidas corporales</span
            ><PulsoIcon name="chevron-right" :size="16"
          /></RouterLink>
          <RouterLink :to="{ name: 'progression-settings' }"
            ><PulsoIcon name="settings" /><span
              >Configuración de progresión</span
            ><PulsoIcon name="chevron-right" :size="16"
          /></RouterLink>
          <details>
            <summary>Información de la cuenta</summary>
            <dl class="details-list">
              <div>
                <dt>Identificador de atleta</dt>
                <dd class="profile-id">{{ profile.id }}</dd>
              </div>
              <div>
                <dt>Creado</dt>
                <dd>{{ formatTimestamp(profile.createdAt) }}</dd>
              </div>
              <div>
                <dt>Última actualización</dt>
                <dd>{{ formatTimestamp(profile.updatedAt) }}</dd>
              </div>
            </dl>
          </details>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped src="../components/account/account.css"></style>
<style scoped>
.profile-preferences a {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--target-size);
  border-top: 1px solid var(--line);
  text-decoration: none;
}
.profile-preferences a span {
  flex: 1;
}
.profile-preferences details {
  margin-top: var(--space-4);
}
.profile-preferences summary {
  min-height: var(--target-size);
  align-content: center;
  cursor: pointer;
}
</style>
