<script setup lang="ts">
import { ref, useId } from "vue";
import ExercisePicker from "../training-plans/ExercisePicker.vue";
import {
  addWorkoutExerciseSchema,
  workoutWriteRejected,
  workoutErrorMessage,
  type AddWorkoutExercise,
} from "../../services/workout-sessions.service";
const props = defineProps<{
  busy?: boolean;
  expectedVersion?: number;
  omittedExercises?: Array<{ id: string; exercise: { name: string } }>;
  replacementSource?: {
    id: string;
    exerciseId: string;
    name: string;
    hasResults: boolean;
  };
  save: (input: AddWorkoutExercise) => Promise<unknown>;
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const id = useId();
let requestId = crypto.randomUUID();
const exerciseId = ref("");
const notes = ref("");
const replaces = ref("");
const pending = ref(false);
const submitted = ref<AddWorkoutExercise | null>(null);
const error = ref("");
async function submit() {
  if (pending.value || props.busy) return;
  error.value = "";
  if (!submitted.value) {
    if (props.replacementSource?.exerciseId === exerciseId.value) {
      error.value = "Selecciona una alternativa diferente al ejercicio actual.";
      return;
    }
    const parsed = addWorkoutExerciseSchema.safeParse({
      id: requestId,
      expectedVersion: props.expectedVersion ?? 0,
      ...(replaces.value ? { replacesWorkoutExerciseId: replaces.value } : {}),
      exerciseId: exerciseId.value,
      notes: notes.value.trim() || null,
    });
    if (!parsed.success) {
      error.value = "Selecciona un ejercicio y revisa las notas.";
      return;
    }
    submitted.value = parsed.data;
  }
  pending.value = true;
  try {
    await props.save(submitted.value);
    emit("saved");
  } catch (cause) {
    if (workoutWriteRejected(cause)) {
      submitted.value = null;
      requestId = crypto.randomUUID();
    }
    error.value = workoutErrorMessage(cause, "No se pudo añadir el ejercicio.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form
    class="plan-form training-editor quick-add-exercise"
    novalidate
    :aria-busy="pending"
    @submit.prevent="submit"
  >
    <h2>
      {{
        replacementSource
          ? "Cambiar " + replacementSource.name
          : "Añadir ejercicio al entrenamiento"
      }}
    </h2>
    <p v-if="replacementSource" class="field-hint">
      Solo cambia esta sesión. Las series registradas y los objetivos originales
      se conservan, y la alternativa empieza por separado, sin copiar pesos ni
      resultados.
    </p>
    <p class="field-hint">
      Elige entre tus ejercicios recientes, habituales o busca por nombre.
    </p>
    <fieldset :disabled="pending || busy || Boolean(submitted)">
      <legend class="training-section-legend">Selecciona un ejercicio</legend>
      <ExercisePicker
        v-model="exerciseId"
        initial-selection="RECENT"
        :disabled="pending || busy || Boolean(submitted)"
      />
      <div
        v-if="!replacementSource && omittedExercises?.length"
        class="quick-substitution"
      >
        <label class="field-label" :for="id + '-replaces'"
          >¿Qué quieres hacer?</label
        >
        <select :id="id + '-replaces'" v-model="replaces" class="form-control">
          <option value="">Añadir un ejercicio más</option>
          <option
            v-for="item in omittedExercises"
            :key="item.id"
            :value="item.id"
          >
            Sustituir {{ item.exercise.name }}
          </option>
        </select>
        <p v-if="replaces" class="field-hint">
          El ejercicio original permanece en el historial. El nuevo se registra
          por separado.
        </p>
      </div>
      <details class="quick-add-options">
        <summary>Añadir observaciones (opcional)</summary>
        <label class="field-label" :for="id + '-notes'"
          >Observaciones (opcional)</label
        ><textarea
          :id="id + '-notes'"
          v-model="notes"
          class="form-control form-control--textarea"
          maxlength="4000"
          rows="2"
        />
      </details>
    </fieldset>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="submitted && error" class="field-hint">
      Reintentar conserva el identificador de esta solicitud para evitar
      duplicados.
    </p>
    <div class="plan-actions">
      <button
        class="primary-button"
        type="submit"
        :disabled="pending || busy || !exerciseId"
      >
        {{
          pending
            ? "Añadiendo…"
            : submitted
              ? "Reintentar"
              : replacementSource
                ? "Usar ejercicio seleccionado"
                : "Añadir ejercicio seleccionado"
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

<style scoped>
.quick-add-exercise > h2 {
  margin-bottom: 0;
}
.quick-add-exercise > fieldset {
  min-width: 0;
}
.quick-add-options {
  margin-top: 1rem;
}
.quick-add-options > summary {
  cursor: pointer;
  min-height: 44px;
  align-content: center;
}
.quick-add-exercise button {
  min-height: 44px;
}
</style>
