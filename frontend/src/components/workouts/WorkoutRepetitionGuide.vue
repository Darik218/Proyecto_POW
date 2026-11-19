<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import {
  workoutComparability,
  repetitionClaims,
} from "../../services/workout-comparability.service";
import { useAuthStore } from "../../stores/auth.store";
import { workoutGuideService } from "../../services/workout-guide.service";
import { workoutErrorMessage } from "../../services/workout-sessions.service";
import type {
  WorkoutGuide,
  WorkoutGuideQuery,
} from "../../schemas/workout-guide.schema";
const props = defineProps<{
  query: WorkoutGuideQuery;
  exerciseId: string;
  occurrenceId?: string;
  context: NonNullable<
    | WorkoutGuide["exercises"][number]["repetitionContext"]
    | WorkoutGuide["exercises"][number]["progressiveContext"]
  >;
  disabled?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{
  calculated: [value: WorkoutGuide, occurrenceId: string, contextKey: string];
  checking: [occurrenceId: string, active: boolean];
}>();
const auth = useAuthStore(),
  loading = ref(false),
  error = ref(""),
  memoryRevision = ref(0);
const scope = computed(() =>
  auth.isAuthenticated
    ? JSON.stringify([auth.user?.id, auth.getSessionGeneration()])
    : null,
);
const missing = computed(() => {
  void memoryRevision.value;
  return workoutComparability.missing(
    scope.value,
    props.context.comparisonKey,
    repetitionClaims,
  );
});
const needsConfirmation = computed(
  () =>
    props.context.ready &&
    (!("comparability" in props.context) ||
      !props.context.comparability ||
      props.context.comparability.state === "CONFIRMATION_REQUIRED"),
);
const question = computed(() => {
  const labels = {
    sameVariant: "la misma variante",
    sameEquipment: "el mismo equipo",
    sameLoadConvention: "la misma forma de anotar el peso (por mano o total)",
    externalTotal: "carga externa total",
  };
  return (
    "¿Usaste " +
    missing.value.map((key) => labels[key]).join(", ") +
    " en estos registros?"
  );
});
let revision = 0,
  controller: AbortController | undefined;
let checkingId: string | undefined;
function stopChecking() {
  loading.value = false;
  if (checkingId) emit("checking", checkingId, false);
  checkingId = undefined;
}
watch(
  () =>
    JSON.stringify([
      props.query,
      props.exerciseId,
      props.occurrenceId,
      needsConfirmation.value,
      props.context.contextKey,
      props.context.comparisonKey,
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ]),
  () => {
    revision++;
    controller?.abort();
    stopChecking();
    error.value = "";
    workoutComparability.setScope(scope.value);
    if (
      auth.isAuthenticated &&
      needsConfirmation.value &&
      !missing.value.length
    )
      void calculate(false);
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled && !error.value && !missing.value.length)
      void calculate(false);
  },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
  stopChecking();
});
async function calculate(explicit = true) {
  const contextKey = props.context.contextKey;
  if (
    loading.value ||
    props.disabled ||
    !auth.isAuthenticated ||
    !needsConfirmation.value ||
    !contextKey
  )
    return;
  if (!explicit && missing.value.length) return;
  const n = revision;
  const requestedScope = scope.value,
    comparisonKey = props.context.comparisonKey;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  checkingId = props.occurrenceId ?? props.exerciseId;
  emit("checking", checkingId, true);
  error.value = "";
  try {
    const result = await workoutGuideService.repetitionPreview(
      {
        source: props.query,
        exerciseId: props.exerciseId,
        contextKey,
        declaration: {
          sameVariant: true,
          sameEquipment: true,
          sameLoadConvention: true,
        },
        policyContract: props.context.policyContract,
      },
      signal,
    );
    if (n === revision && !signal.aborted) {
      const exercise = result.exercises.find(
        (item) =>
          item.exerciseId === props.exerciseId &&
          (!props.occurrenceId || item.id === props.occurrenceId),
      );
      const returned =
        props.context.policyContract === "session-repetition-preview-v2"
          ? exercise?.progressiveContext
          : exercise?.repetitionContext;
      if (!exercise || returned?.contextKey !== contextKey) return;
      if (comparisonKey && returned.comparisonKey === comparisonKey) {
        workoutComparability.record(requestedScope, comparisonKey, {
          sameVariant: true,
          sameEquipment: true,
          sameLoadConvention: true,
        });
        memoryRevision.value++;
      }
      emit("calculated", result, exercise.id, contextKey);
    }
  } catch (cause) {
    if (n === revision && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "La referencia cambió o no se pudo comprobar. Actualiza la guía; puedes seguir entrenando con tus propios valores.",
      );
  } finally {
    if (n === revision) stopChecking();
  }
}
</script>
<template>
  <div
    v-if="needsConfirmation"
    class="repetition-guidance"
    :class="{ 'repetition-guidance--compact': compact }"
  >
    <p v-if="loading && !compact" role="status" class="field-hint">
      Verificando la orientación…
    </p>
    <template v-if="!loading">
      <p v-if="missing.length">{{ question }}</p>
      <button
        v-if="missing.length || error"
        class="text-button repetition-preview-button"
        type="button"
        :disabled="disabled"
        @click="calculate()"
      >
        {{
          missing.length
            ? "Sí, orientar mis repeticiones"
            : "Reintentar orientación"
        }}
      </button>
    </template>
    <p v-if="!compact" class="field-hint">
      Sin registrar esfuerzo ni configurar incrementos. Solo propone
      repeticiones dentro del rango del plan, con el mismo peso; tú puedes
      cambiarlas.
    </p>
    <details v-if="!compact" class="repetition-evidence">
      <summary>Registros y criterio de comparación</summary>
      <p v-if="context.baselineSource === 'RECORDED_HISTORY'">
        El plan no fija un peso: se mantiene la carga y unidad que registraste
        en las series comparables. No se añade una carga al plan.
      </p>
      <p v-if="context.minimumSource === 'PERSISTED_SETTING'">
        Tu configuración guardada exige {{ context.minimumSessions }}
        {{
          context.minimumSessions === 1
            ? "sesión comparable"
            : "sesiones comparables"
        }}
        consecutivas con el mismo resultado.
      </p>
      <p v-else>
        Sin configuración guardada: esta orientación inicial utiliza una sesión
        completa comparable y solo permite avanzar dentro del rango de tu plan.
        No configura aumentos de peso ni guarda preferencias.
      </p>
      <ul>
        <li v-for="task in context.tasks" :key="task.id">
          {{ task.performedOn ?? "Fecha no registrada" }} ·
          {{ task.timeZone ?? "Zona no registrada" }}
        </li>
      </ul>
    </details>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  </div>
</template>
<style scoped>
.repetition-guidance {
  margin-block: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-left: 3px solid var(--color-primary);
  background: var(--color-surface-subtle);
  border-radius: 0.4rem;
}
.repetition-guidance--compact {
  margin-block: 0.1rem 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.repetition-guidance--compact .text-button {
  min-height: 44px;
}
p {
  margin: 0.3rem 0;
  line-height: 1.45;
}
.text-button {
  text-align: left;
  white-space: normal;
}
</style>
