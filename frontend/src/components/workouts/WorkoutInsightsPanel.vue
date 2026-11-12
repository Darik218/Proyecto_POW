<script setup lang="ts">
import ExerciseReferenceComparison from "./ExerciseReferenceComparison.vue";
import { insightReason } from "../../utils/insight-messages";
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import {
  workoutInsightsService,
  type WorkoutInsights,
} from "../../services/workout-insights.service";
import {
  workoutErrorMessage,
  setStatusLabel,
} from "../../services/workout-sessions.service";
const props = defineProps<{ sessionId: string }>(),
  auth = useAuthStore();
const result = ref<WorkoutInsights | null>(null),
  error = ref(""),
  busy = ref(false);
const declarations = ref<Record<string, boolean>>({});
let mounted = false,
  generation = 0,
  controller: AbortController | undefined;
async function load(externalId?: string) {
  if (!auth.isAuthenticated) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    n = ++generation,
    session = props.sessionId;
  error.value = "";
  busy.value = true;
  try {
    const value = await workoutInsightsService.get(session, externalId, signal);
    if (n !== generation || signal.aborted) return;
    if (externalId && result.value) {
      const updated = value.exercises.find(
        (e) => e.workoutExerciseId === externalId,
      );
      result.value = {
        ...value,
        exercises: result.value.exercises.map((e) =>
          e.workoutExerciseId === externalId && updated ? updated : e,
        ),
      };
    } else result.value = value;
  } catch (cause) {
    if (n === generation && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "No pudimos consultar tu referencia. Tus resultados siguen guardados.",
      );
  } finally {
    if (n === generation) busy.value = false;
  }
}
onMounted(() => {
  mounted = true;
  void load();
});
watch(
  () =>
    [
      props.sessionId,
      auth.user?.id,
      auth.status,
      auth.getSessionGeneration(),
    ].join(":"),
  () => {
    generation++;
    controller?.abort();
    result.value = null;
    declarations.value = {};
    error.value = "";
    busy.value = false;
    if (mounted && auth.isAuthenticated) void load();
  },
  { flush: "sync" },
);
onUnmounted(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section
    class="ui-panel workout-insights"
    aria-labelledby="workout-insights-title"
    :aria-busy="busy"
  >
    <h2 id="workout-insights-title">Tu referencia para la próxima sesión</h2>
    <p class="ui-muted">
      Orientación descriptiva basada en lo que registraste. Consultarla no
      cambia tu rutina ni activa automatización.
    </p>
    <p v-if="busy" role="status">Preparando tu referencia…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button class="text-button" @click="load()">Volver a consultar</button>
    </p>
    <article
      v-for="exercise in result?.exercises"
      :key="exercise.workoutExerciseId"
      class="insight-exercise"
    >
      <h3>{{ exercise.name }}</h3>
      <ul v-if="exercise.actualSets.length" class="insight-sets">
        <li v-for="set in exercise.actualSets" :key="set.id">
          Serie {{ set.setNumber }} ·
          {{
            set.kind === "WORK"
              ? "Trabajo"
              : set.kind === "WARMUP"
                ? "Calentamiento"
                : "Tipo no registrado"
          }}
          · {{ setStatusLabel(set) }}:
          <strong
            >{{ set.load ?? "Carga no registrada" }}
            {{ set.loadUnit ?? "(unidad desconocida)" }} ×
            {{ set.repetitions ?? "—" }} repeticiones</strong
          ><span v-if="set.rpe !== null"> · RPE {{ set.rpe }}</span>
        </li>
      </ul>
      <p class="insight-orientation">{{ exercise.orientation.message }}</p>
      <p v-if="exercise.reference" class="ui-muted">
        Referencia anterior: {{ exercise.reference.sessionLabel }} ·
        {{ exercise.reference.performedOn ?? "Fecha no registrada" }}.
      </p>
      <ExerciseReferenceComparison
        :current="exercise.actualSets"
        :reference="exercise.reference"
      />
      <details>
        <summary>Estimación de fuerza y calidad de los datos</summary>
        <div
          v-if="exercise.loadMeaning === 'UNKNOWN'"
          class="insight-declaration"
        >
          <p>
            Para estimar 1RM necesitamos saber qué significa la carga. No
            podemos deducirlo de KG/LB o del nombre del ejercicio.
          </p>
          <label
            ><input
              v-model="declarations[exercise.workoutExerciseId]"
              type="checkbox"
              :disabled="busy"
            />Confirmo que las cargas registradas en este ejercicio corresponden
            a la carga externa total, sin asistencia ni peso corporal.</label
          >
          <button
            class="secondary-button"
            :disabled="busy || !declarations[exercise.workoutExerciseId]"
            @click="load(exercise.workoutExerciseId)"
          >
            Calcular estimaciones descriptivas
          </button>
        </div>
        <div
          v-for="rm in exercise.oneRm"
          :key="rm.setId"
          class="insight-estimate"
        >
          <template v-if="rm.calculation"
            ><p
              v-for="estimate in rm.calculation.estimates"
              :key="estimate.formula"
            >
              <strong
                >{{ estimate.formula }}: {{ estimate.estimatedOneRm }}
                {{ estimate.unit }}</strong
              >
              estimados · {{ rm.calculation.load.originalLoad }}
              {{ rm.calculation.load.originalUnit }} ×
              {{ rm.calculation.repetitions }}
            </p>
            <p class="ui-muted">
              El esfuerzo máximo no está verificado. Una estimación no mide tu
              máximo real ni autoriza un aumento de carga.
            </p></template
          >
          <p v-else class="ui-muted">
            Esta serie no permite estimar 1RM:
            {{
              rm.eligibility.reasons.map(insightReason).join(" · ") ||
              "faltan datos elegibles"
            }}.
          </p>
        </div>
        <p
          v-if="exercise.loadMeaningSource === 'REQUEST_DECLARATION'"
          class="ui-muted"
        >
          Interpretación declarada para esta consulta; no modifica el registro
          histórico ni persiste una estimación oficial.
        </p>
      </details>
    </article>
    <p v-if="result && !result.exercises.length">
      No hay ejercicios registrados. Para obtener una referencia, completa una
      serie de trabajo con carga, unidad y repeticiones.
    </p>
  </section>
</template>
<style scoped>
.workout-insights {
  margin: 1.25rem 0;
}
.insight-exercise {
  border-top: 1px solid var(--color-border);
  padding: 1rem 0;
}
.insight-exercise h3 {
  margin: 0.25rem 0 1rem;
}
.insight-sets {
  padding-left: 1.25rem;
  line-height: 1.8;
}
.insight-orientation {
  padding: 1rem;
  border-left: 3px solid var(--color-primary);
  background: rgba(49, 230, 197, 0.05);
}
details {
  margin-top: 1rem;
}
summary {
  cursor: pointer;
  color: var(--color-primary);
  padding: 0.5rem 0;
}
.insight-declaration {
  display: grid;
  gap: 1rem;
}
.insight-declaration label {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  line-height: 1.5;
}
.insight-declaration input {
  flex-shrink: 0;
}
.insight-estimate {
  margin: 1rem 0;
}
</style>
