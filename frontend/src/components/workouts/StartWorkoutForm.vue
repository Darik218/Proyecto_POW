<script setup lang="ts">
import { ref, useId, onUnmounted, watch } from "vue";
import PreviousWorkoutSelector from "./PreviousWorkoutSelector.vue";
import PlanDaySelector from "./PlanDaySelector.vue";
import {
  createWorkoutSchema,
  workoutWriteRejected,
  workoutErrorMessage,
  workoutSessionsService,
  type CreateWorkout,
  type WorkoutSuggestion,
} from "../../services/workout-sessions.service";
import { localTrainingDate } from "../../utils/dates";
const props = defineProps<{
  initialScheduledActivityId?: string;
  initialPlanId?: string;
  initialWeekId?: string;
  initialDayId?: string;
  initialRepeatFromId?: string;
  save: (input: CreateWorkout) => Promise<unknown>;
}>();
const emit = defineEmits<{ cancel: [] }>();
const id = useId();
const source = ref(
  props.initialRepeatFromId
    ? "REPEAT"
    : props.initialPlanId
      ? "PLAN_DAY"
      : "FREE",
);
const repeatFromId = ref(props.initialRepeatFromId ?? "");
const selection = ref({
  trainingPlanId: props.initialPlanId ?? "",
  planWeekId: props.initialWeekId ?? "",
  planDayId: props.initialDayId ?? "",
});
const scheduledActivityId = ref<string | undefined>();
const timeZone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
const performedOn = ref(localTrainingDate(timeZone.value));
const recordingMode = ref<"LIVE" | "RETROSPECTIVE">("LIVE");
const name = ref("");
const notes = ref("");
const pending = ref(false);
const error = ref("");
const submitted = ref<CreateWorkout | null>(null);
let requestId = crypto.randomUUID();
const suggestions = ref<WorkoutSuggestion[]>([]);
const suggestionMessage = ref("");
const suggesting = ref(false);
let controller: AbortController | undefined;
let generation = 0;
// The accepted activity belongs to this exact origin, selection and local date/zone.
// Invalidate synchronously so a same-tick submit cannot carry a stale association.
watch(
  [
    source,
    performedOn,
    timeZone,
    () => selection.value.trainingPlanId,
    () => selection.value.planWeekId,
    () => selection.value.planDayId,
  ],
  () => {
    scheduledActivityId.value = undefined;
  },
  { flush: "sync" },
);
if (props.initialPlanId && props.initialWeekId && props.initialDayId)
  scheduledActivityId.value = props.initialScheduledActivityId;
watch([performedOn, timeZone], () => {
  generation++;
  controller?.abort();
  suggesting.value = false;
  suggestions.value = [];
  suggestionMessage.value = "";
});
async function suggest() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const current = ++generation;
  suggesting.value = true;
  error.value = "";
  suggestions.value = [];
  suggestionMessage.value = "";
  try {
    const result = await workoutSessionsService.suggestions(
      performedOn.value,
      timeZone.value,
      signal,
    );
    if (current !== generation) return;
    suggestions.value = result.candidates;
    suggestionMessage.value =
      result.resolution === "NONE"
        ? "No hay una coincidencia con fechas explícitas. Selecciona un día manualmente o entrena libremente."
        : result.resolution === "SINGLE"
          ? "Hay una coincidencia. Confirma si quieres utilizarla."
          : "Hay varias coincidencias. Elige una; no se seleccionará automáticamente.";
  } catch (cause) {
    if (current === generation && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "No se pudo consultar la programación.",
      );
  } finally {
    if (current === generation) suggesting.value = false;
  }
}
function accept(candidate: WorkoutSuggestion) {
  selection.value = {
    trainingPlanId: candidate.trainingPlanId,
    planWeekId: candidate.planWeekId,
    planDayId: candidate.planDayId,
  };
  source.value = "PLAN_DAY";
  scheduledActivityId.value = candidate.scheduledActivityId;
}
async function submit() {
  if (pending.value || suggesting.value) return;
  error.value = "";
  if (source.value === "SUGGESTED") {
    error.value = "Acepta una sugerencia o cambia el origen.";
    return;
  }
  if (!submitted.value) {
    const parsed = createWorkoutSchema.safeParse({
      id: requestId,
      performedOn: performedOn.value,
      timeZone: timeZone.value,
      recordingMode: recordingMode.value,
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
      ...(source.value === "PLAN_DAY"
        ? {
            ...selection.value,
            ...(scheduledActivityId.value
              ? { scheduledActivityId: scheduledActivityId.value }
              : {}),
          }
        : {}),
      ...(source.value === "REPEAT"
        ? { repeatFromId: repeatFromId.value }
        : {}),
      notes: notes.value.trim() || null,
    });
    if (!parsed.success) {
      error.value =
        parsed.error.issues[0]?.message ??
        "Revisa los datos del entrenamiento.";
      return;
    }
    if (source.value === "REPEAT" && !repeatFromId.value) {
      error.value = "Selecciona una sesión anterior.";
      return;
    }
    submitted.value = parsed.data;
  }
  pending.value = true;
  try {
    await props.save(submitted.value);
  } catch (cause) {
    if (workoutWriteRejected(cause)) {
      submitted.value = null;
      requestId = crypto.randomUUID();
    }
    error.value = workoutErrorMessage(
      cause,
      "No se pudo preparar el entrenamiento.",
    );
  } finally {
    pending.value = false;
  }
}
onUnmounted(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <form
    class="plan-form training-editor"
    novalidate
    :aria-busy="pending"
    @submit.prevent="submit"
  >
    <h2>Nuevo entrenamiento</h2>
    <fieldset :disabled="pending || Boolean(submitted)">
      <legend class="training-section-legend">Origen y fecha</legend>
      <label class="field-label" :for="id + '-source'">Origen</label
      ><select :id="id + '-source'" v-model="source" class="form-control">
        <option value="FREE">Entrenamiento libre</option>
        <option value="PLAN_DAY">Desde un día del plan</option>
        <option value="REPEAT">Repetir entrenamiento anterior</option>
        <option value="SUGGESTED">Sugerencia por fecha</option>
      </select>
      <div class="plan-form-grid">
        <div>
          <label class="field-label" :for="id + '-date'"
            >Fecha del entrenamiento</label
          ><input
            :id="id + '-date'"
            v-model="performedOn"
            type="date"
            class="form-control"
            required
          />
        </div>
        <div>
          <label class="field-label" :for="id + '-zone'"
            >Zona horaria (IANA)</label
          ><input
            :id="id + '-zone'"
            v-model="timeZone"
            class="form-control"
            required
            placeholder="Ej. America/Bogota"
          />
          <p class="field-hint">
            La fecha local se conserva junto con esta zona horaria.
          </p>
        </div>
      </div>
      <label class="field-label" :for="id + '-mode'">Tipo de registro</label
      ><select :id="id + '-mode'" v-model="recordingMode" class="form-control">
        <option value="LIVE">Entrenar en directo</option>
        <option value="RETROSPECTIVE">
          Registrar un entrenamiento anterior
        </option>
      </select>
      <p v-if="recordingMode === 'RETROSPECTIVE'" class="field-hint">
        El inicio y el fin indican cuándo registras los datos; la fecha anterior
        identifica el entrenamiento realizado.
      </p>
      <PreviousWorkoutSelector
        v-if="source === 'REPEAT'"
        v-model="repeatFromId"
        :disabled="pending || Boolean(submitted)"
      />
      <PlanDaySelector
        v-if="source === 'PLAN_DAY'"
        v-model="selection"
        :disabled="pending || Boolean(submitted)"
      />
      <div v-if="source === 'SUGGESTED'">
        <button
          class="secondary-button"
          type="button"
          :disabled="suggesting"
          @click="suggest"
        >
          {{ suggesting ? "Consultando…" : "Consultar programación" }}
        </button>
        <p role="status">{{ suggestionMessage }}</p>
        <ul>
          <li
            v-for="candidate in suggestions"
            :key="candidate.scheduledActivityId ?? candidate.planDayId"
          >
            <button
              class="text-button"
              type="button"
              @click="accept(candidate)"
            >
              Usar {{ candidate.planName }} · Semana
              {{ candidate.weekNumber }} · {{ candidate.name }}
            </button>
          </li>
        </ul>
        <button class="text-button" type="button" @click="source = 'FREE'">
          Ignorar sugerencias y entrenar libremente
        </button>
      </div>
      <div class="training-section-divider"><h3>Identifica tu sesión</h3></div>
      <label class="field-label" :for="id + '-name'">Nombre (opcional)</label
      ><input
        :id="id + '-name'"
        v-model="name"
        maxlength="160"
        class="form-control"
      />
      <label class="field-label" :for="id + '-notes'">Notas (opcional)</label
      ><textarea
        :id="id + '-notes'"
        v-model="notes"
        maxlength="4000"
        class="form-control"
      />
    </fieldset>
    <p v-if="submitted && error" class="field-hint">
      Reintentar conserva los datos y el identificador para evitar duplicados.
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="plan-actions">
      <button
        class="primary-button"
        type="submit"
        :disabled="pending || suggesting"
      >
        {{
          pending
            ? "Preparando…"
            : submitted
              ? "Reintentar preparación"
              : "Preparar entrenamiento"
        }}</button
      ><button
        class="text-button"
        type="button"
        :disabled="pending"
        @click="emit('cancel')"
      >
        Cerrar
      </button>
    </div>
  </form>
</template>
