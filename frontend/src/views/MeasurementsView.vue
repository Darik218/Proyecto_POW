<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { z } from "zod";
import {
  athleteErrorMessage,
  athletesService,
} from "../services/athletes.service";
import type { AthleteProfile, BodyMeasurement } from "../types/athletes";

const weightInputSchema = z
  .string()
  .trim()
  .min(1, "Ingresa tu peso.")
  .regex(/^\d{1,4}(?:[.,]\d{1,3})?$/, "Usa un número con hasta tres decimales.")
  .transform((value) => Number(value.replace(",", ".")))
  .pipe(
    z
      .number()
      .min(0.001, "El peso mínimo es 0,001.")
      .max(9999.999, "El peso máximo es 9999,999."),
  );

const measurementFormSchema = z.object({
  bodyWeight: weightInputSchema,
  measuredAt: z.iso.date({ error: "Selecciona una fecha válida." }),
  notes: z.string().max(1000, "La nota admite hasta 1000 caracteres."),
});

const profile = ref<AthleteProfile | null>(null);
const measurements = ref<BodyMeasurement[]>([]);
const weight = ref("");
const measuredAt = ref(localToday());
const notes = ref("");
const loadingProfile = ref(true);
const loadingMeasurements = ref(true);
const submitting = ref(false);
const profileError = ref("");
const historyError = ref("");
const validationError = ref("");
const submitError = ref("");
const successMessage = ref("");

const preferredUnitLabel = computed(() => {
  if (profile.value?.preferredUnit === "KG") return "kg";
  if (profile.value?.preferredUnit === "LB") return "lb";
  return "";
});

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortMeasurements(items: BodyMeasurement[]): BodyMeasurement[] {
  return [...items].sort(
    (left, right) =>
      right.measuredAt.localeCompare(left.measuredAt) ||
      right.id.localeCompare(left.id),
  );
}

function formatMeasurementDate(value: string): string {
  const [yearText, monthText, dayText] = value.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

function formatWeight(value: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(
    value,
  );
}

async function loadProfile(): Promise<void> {
  loadingProfile.value = true;
  profileError.value = "";
  try {
    profile.value = await athletesService.getProfile();
  } catch (error) {
    profileError.value = athleteErrorMessage(
      error,
      "No se pudo cargar la unidad preferida.",
    );
  } finally {
    loadingProfile.value = false;
  }
}

async function loadMeasurements(): Promise<boolean> {
  loadingMeasurements.value = true;
  historyError.value = "";
  try {
    measurements.value = sortMeasurements(
      await athletesService.getMeasurements(),
    );
    return true;
  } catch (error) {
    historyError.value = athleteErrorMessage(
      error,
      "No se pudo cargar el historial de medidas.",
    );
    return false;
  } finally {
    loadingMeasurements.value = false;
  }
}

async function submitMeasurement(): Promise<void> {
  if (submitting.value || !profile.value) return;
  validationError.value = "";
  submitError.value = "";
  successMessage.value = "";
  const parsed = measurementFormSchema.safeParse({
    bodyWeight: weight.value,
    measuredAt: measuredAt.value,
    notes: notes.value,
  });
  if (!parsed.success) {
    validationError.value =
      parsed.error.issues[0]?.message ?? "Revisa los datos de la medición.";
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      bodyWeight: parsed.data.bodyWeight,
      measuredAt: parsed.data.measuredAt,
      ...(parsed.data.notes.trim() ? { notes: parsed.data.notes.trim() } : {}),
    };
    const saved = await athletesService.addMeasurement(payload);
    weight.value = "";
    notes.value = "";
    measuredAt.value = localToday();
    successMessage.value = "La medición se registró correctamente.";

    const refreshed = await loadMeasurements();
    if (!refreshed)
      measurements.value = sortMeasurements([...measurements.value, saved]);
  } catch (error) {
    submitError.value = athleteErrorMessage(
      error,
      "No se pudo registrar la medición.",
    );
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadProfile();
  void loadMeasurements();
});
</script>

<template>
  <section class="page-view">
    <div class="page-heading">
      <h1>Medidas corporales</h1>
      <p class="intro">
        Registra tu peso y conserva cada medición para consultar tu historial.
      </p>
    </div>

    <div
      v-if="!loadingMeasurements && measurements.length"
      class="measurement-overview"
    >
      <div>
        <span>Registros en tu historial</span
        ><strong>{{ measurements.length }}</strong>
      </div>
      <div>
        <span>Última medición</span
        ><strong>{{
          formatMeasurementDate(measurements[0]!.measuredAt)
        }}</strong>
      </div>
      <p>
        Una referencia de tu recorrido. Consulta el valor y las notas de cada
        fecha en el historial.
      </p>
    </div>
    <div class="measurements-grid">
      <form
        class="form-card measurement-form"
        @submit.prevent="submitMeasurement"
      >
        <h2>Nueva medición</h2>
        <p v-if="loadingProfile" class="field-hint" role="status">
          Cargando unidad preferida…
        </p>
        <div v-else-if="profileError" class="profile-unit-error" role="alert">
          <p>{{ profileError }}</p>
          <button class="refresh-button" type="button" @click="loadProfile">
            Reintentar
          </button>
        </div>
        <p v-else class="unit-note">
          Unidad preferida en tu perfil:
          <strong>{{ preferredUnitLabel }}</strong
          >. Cada valor se conserva sin una unidad asociada y no se convierte al
          cambiar tu preferencia. El historial se muestra tal como fue
          registrado.
        </p>

        <label class="field-label" for="body-weight">Peso</label>
        <input
          id="body-weight"
          v-model="weight"
          class="form-control"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          maxlength="8"
          placeholder="Por ejemplo, 72,5"
          :disabled="submitting || loadingProfile || !profile"
          aria-describedby="weight-hint"
        />
        <p id="weight-hint" class="field-hint">
          De 0,001 a 9999,999; máximo tres decimales.
        </p>

        <label class="field-label" for="measured-at">Fecha de medición</label>
        <input
          id="measured-at"
          v-model="measuredAt"
          class="form-control"
          type="date"
          :disabled="submitting || loadingProfile || !profile"
        />

        <label class="field-label" for="measurement-notes"
          >Nota <span class="optional-label">(opcional)</span></label
        >
        <textarea
          id="measurement-notes"
          v-model="notes"
          class="form-control form-control--textarea"
          maxlength="1000"
          rows="4"
          :disabled="submitting || loadingProfile || !profile"
        ></textarea>
        <p class="field-hint field-hint--right">{{ notes.length }}/1000</p>

        <p v-if="validationError" class="form-error" role="alert">
          {{ validationError }}
        </p>
        <p v-if="submitError" class="form-error" role="alert">
          {{ submitError }}
        </p>
        <p v-if="successMessage" class="success-message" role="status">
          {{ successMessage }}
        </p>
        <button
          class="primary-button"
          type="submit"
          :disabled="submitting || loadingProfile || !profile"
        >
          {{ submitting ? "Guardando medición…" : "Registrar medición" }}
        </button>
      </form>

      <section class="history-card" aria-labelledby="measurement-history-title">
        <div class="history-heading">
          <div>
            <h2 id="measurement-history-title">Historial</h2>
            <p class="card-intro">
              Ordenado del registro más reciente al más antiguo.
            </p>
          </div>
          <button
            class="refresh-button"
            type="button"
            :disabled="loadingMeasurements"
            @click="loadMeasurements"
          >
            {{ loadingMeasurements ? "Actualizando…" : "Actualizar" }}
          </button>
        </div>

        <p v-if="loadingMeasurements" class="state-message" role="status">
          Cargando mediciones…
        </p>
        <div
          v-else-if="historyError && measurements.length === 0"
          class="state-card state-card--error"
          role="alert"
        >
          <p>{{ historyError }}</p>
          <button
            class="secondary-button"
            type="button"
            @click="loadMeasurements"
          >
            Intentar de nuevo
          </button>
        </div>
        <div v-else-if="measurements.length === 0" class="empty-state">
          <span class="empty-state__mark" aria-hidden="true">—</span>
          <strong>Aún no hay mediciones</strong>
          <p>Tu primer registro aparecerá aquí.</p>
        </div>
        <template v-else>
          <p v-if="historyError" class="inline-warning" role="alert">
            {{ historyError }}
          </p>
          <ul class="measurement-list">
            <li
              v-for="measurement in measurements"
              :key="measurement.id"
              class="measurement-row"
            >
              <div class="measurement-row__value">
                <strong>{{ formatWeight(measurement.bodyWeight) }}</strong>
                <span>peso registrado</span>
              </div>
              <div class="measurement-row__detail">
                <time :datetime="measurement.measuredAt">{{
                  formatMeasurementDate(measurement.measuredAt)
                }}</time>
                <p v-if="measurement.notes">{{ measurement.notes }}</p>
              </div>
            </li>
          </ul>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped src="../components/account/account.css"></style>
