<script setup lang="ts">
import { ref } from "vue";
import { workoutErrorMessage } from "../../services/workout-sessions.service";
const props = defineProps<{
  busy?: boolean;
  hasResults?: boolean;
  save: (confirmWithoutResults: boolean) => Promise<unknown>;
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const pending = ref(false),
  error = ref("");
async function submit() {
  if (pending.value || props.busy) return;
  error.value = "";
  pending.value = true;
  try {
    await props.save(!props.hasResults);
    emit("saved");
  } catch (cause) {
    error.value = workoutErrorMessage(
      cause,
      "No se pudo finalizar. Tus series guardadas siguen disponibles.",
    );
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <form
    class="plan-form training-editor workout-close-form"
    :aria-busy="pending"
    @submit.prevent="submit"
  >
    <h2>
      {{ hasResults ? "Guardar y finalizar" : "¿Finalizar sin resultados?" }}
    </h2>
    <p>Las series guardadas se conservarán y la sesión quedará cerrada.</p>
    <p v-if="!hasResults" class="field-hint">
      Esta sesión no contiene resultados reales. Sus objetivos no se registrarán
      como si los hubieras realizado.
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="plan-actions">
      <button class="primary-button" type="submit" :disabled="pending || busy">
        {{
          pending
            ? "Finalizando…"
            : hasResults
              ? "Finalizar entrenamiento"
              : "Finalizar sin resultados"
        }}</button
      ><button
        class="text-button"
        type="button"
        :disabled="pending || busy"
        @click="emit('cancel')"
      >
        Seguir entrenando
      </button>
    </div>
  </form>
</template>
