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
  context: NonNullable<WorkoutGuide["exercises"][number]["repetitionContext"]>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ calculated: [value: WorkoutGuide] }>();
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
watch(
  () =>
    JSON.stringify([
      props.query,
      props.exerciseId,
      props.context.contextKey,
      props.context.comparisonKey,
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ]),
  () => {
    revision++;
    controller?.abort();
    loading.value = false;
    error.value = "";
    workoutComparability.setScope(scope.value);
    if (auth.isAuthenticated && props.context.ready && !missing.value.length)
      void calculate(false);
  },
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
});
async function calculate(explicit = true) {
  if (
    loading.value ||
    props.disabled ||
    !auth.isAuthenticated ||
    !props.context.ready ||
    !props.context.contextKey
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
  error.value = "";
  try {
    const result = await workoutGuideService.repetitionPreview(
      {
        source: props.query,
        exerciseId: props.exerciseId,
        contextKey: props.context.contextKey,
        declaration: {
          sameVariant: true,
          sameEquipment: true,
          sameLoadConvention: true,
        },
        policyContract: "session-repetition-preview-v1",
      },
      signal,
    );
    if (n === revision && !signal.aborted) {
      const returned = result.exercises.find(
        (item) => item.exerciseId === props.exerciseId,
      )?.repetitionContext?.comparisonKey;
      if (comparisonKey && returned === comparisonKey) {
        workoutComparability.record(requestedScope, comparisonKey, {
          sameVariant: true,
          sameEquipment: true,
          sameLoadConvention: true,
        });
        memoryRevision.value++;
      }
      emit("calculated", result);
    }
  } catch (cause) {
    if (n === revision && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "La referencia cambió o no se pudo comprobar. Actualiza la guía; puedes seguir entrenando con tus propios valores.",
      );
  } finally {
    if (n === revision) loading.value = false;
  }
}
</script>
<template>
  <div v-if="context.ready" class="repetition-guidance">
    <p v-if="missing.length">{{ question }}</p>
    <p v-else class="field-hint">
      Comparabilidad confirmada para estos registros.
      {{
        loading
          ? "Actualizando la orientación…"
          : "Puedes consultar de nuevo el resultado."
      }}
    </p>
    <button
      class="text-button repetition-preview-button"
      type="button"
      :disabled="disabled || loading"
      @click="calculate()"
    >
      {{
        loading
          ? "Comprobando tus resultados…"
          : missing.length
            ? "Sí, orientar mis repeticiones"
            : "Actualizar orientación"
      }}
    </button>
    <p class="field-hint">
      Sin registrar esfuerzo ni configurar incrementos. Solo propone
      repeticiones dentro del rango del plan, con el mismo peso; tú puedes
      cambiarlas.
    </p>
    <details class="repetition-evidence">
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
p {
  margin: 0.3rem 0;
  line-height: 1.45;
}
.text-button {
  text-align: left;
  white-space: normal;
}
</style>
