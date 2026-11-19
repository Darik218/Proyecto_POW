<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { workoutGuideService } from "../../services/workout-guide.service";
import type {
  WorkoutGuide,
  WorkoutGuideQuery,
} from "../../schemas/workout-guide.schema";
import { workoutErrorMessage } from "../../services/workout-sessions.service";
import WorkoutRepetitionGuide from "./WorkoutRepetitionGuide.vue";
import WorkoutPreparationSummary from "./WorkoutPreparationSummary.vue";
import { recordableLoad } from "../../utils/workout-set-draft";
const props = defineProps<{
  query: WorkoutGuideQuery;
  compact?: boolean;
  exerciseId?: string;
}>();
const emit = defineEmits<{ loaded: [value: WorkoutGuide] }>();
const auth = useAuthStore(),
  guide = ref<WorkoutGuide | null>(null),
  error = ref(""),
  loading = ref(false);
const visibleExercises = computed(
  () =>
    guide.value?.exercises.filter(
      (exercise) =>
        !props.exerciseId || exercise.exerciseId === props.exerciseId,
    ) ?? [],
);
let revision = 0,
  controller: AbortController | undefined;
async function load() {
  const n = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  guide.value = null;
  error.value = "";
  loading.value = true;
  if (!auth.isAuthenticated) {
    loading.value = false;
    return;
  }
  try {
    const value = await workoutGuideService.get(props.query, signal);
    if (n !== revision || signal.aborted) return;
    guide.value = value;
    emit("loaded", value);
  } catch (cause) {
    if (n === revision && !signal.aborted)
      error.value = workoutErrorMessage(
        cause,
        "No se pudo consultar la guía. Puedes registrar tus resultados manualmente.",
      );
  } finally {
    if (n === revision) loading.value = false;
  }
}
function calculated(value: WorkoutGuide) {
  guide.value = value;
  emit("loaded", value);
}
watch(
  () =>
    JSON.stringify([
      props.query,
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ]),
  () => void load(),
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
});
</script>
<template>
  <section
    class="daily-guide"
    aria-label="Guía para este entrenamiento"
    :aria-busy="loading"
  >
    <h3>{{ compact ? "Antes de empezar" : "Tu guía para esta sesión" }}</h3>
    <p class="field-hint">
      Objetivos y referencias orientativas. Tú eliges lo que realizas; consultar
      esta guía no cambia tu plan.
    </p>
    <p v-if="loading" role="status">Consultando objetivos e historial…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button class="text-button" type="button" @click="load">
        Reintentar guía
      </button>
    </p>
    <template v-if="guide">
      <p
        v-if="
          guide.historyCutoffOn &&
          guide.source.performedOn &&
          guide.source.performedOn > guide.historyCutoffOn
        "
        class="field-hint"
      >
        Historial consultado hasta {{ guide.historyCutoffOn }}. Esta orientación
        futura se volverá a comprobar antes de entrenar.
      </p>
      <p v-if="guide.status === 'REST'">
        Descanso programado. No es una sesión omitida.
      </p>
      <p v-else-if="guide.status !== 'TRAINABLE'">
        Esta programación no está disponible para iniciar un entrenamiento.
      </p>
      <p v-if="!guide.exercises.length && guide.status === 'TRAINABLE'">
        Todavía no hay ejercicios previstos para este entrenamiento.
      </p>
      <article
        v-for="exercise in visibleExercises"
        :key="exercise.id"
        class="guide-exercise"
      >
        <h4>
          {{ exercise.name }} <span v-if="exercise.isOmitted">· Omitido</span>
        </h4>
        <WorkoutPreparationSummary
          v-if="exercise.preparation"
          :exercise="exercise"
        />
        <template v-if="!exercise.preparation">
          <p>
            <strong>{{
              guide.source.kind === "SESSION"
                ? "Objetivo de esta sesión:"
                : "Objetivo previsto actualmente:"
            }}</strong>
            {{ exercise.target.targetSets ?? "Sin definir" }} series ·
            {{ exercise.target.targetRepsMin ?? "—" }}–{{
              exercise.target.targetRepsMax ?? "—"
            }}
            repeticiones<span v-if="exercise.target.targetLoad !== null">
              · {{ exercise.target.targetLoad }}
              {{
                exercise.target.targetLoadUnit ?? "(unidad sin registrar)"
              }}</span
            >
          </p>
          <details v-if="exercise.originalTarget">
            <summary>Objetivo original conservado</summary>
            <p>
              {{ exercise.originalTarget.targetSets ?? "—" }} series ·
              {{ exercise.originalTarget.targetRepsMin ?? "—" }}–{{
                exercise.originalTarget.targetRepsMax ?? "—"
              }}
              repeticiones ·
              {{ exercise.originalTarget.targetLoad ?? "Sin carga definida" }}
              {{ exercise.originalTarget.targetLoadUnit ?? "" }}
            </p>
          </details>
          <div v-if="exercise.lastReference">
            <p class="field-hint">
              {{
                exercise.lastReference.scope === "SAME_PLAN_DAY"
                  ? "Referencia del mismo día y plan."
                  : exercise.lastReference.scope === "FREE_SESSION"
                    ? "Referencia de entrenamiento libre; conserva su origen libre."
                    : "Referencia del mismo ejercicio en otro contexto."
              }}
              La variante, el equipo y la forma de anotar el peso deben ser
              comparables antes de calcular una mejora.
            </p>
            <p>
              <strong
                >Último registro anterior:
                {{ exercise.lastReference.performedOn }}</strong
              >
            </p>
            <p
              v-if="exercise.lastReference.sessions.length > 1"
              class="field-hint"
            >
              Hay varias sesiones en esa fecha; se muestran sin suponer cuál fue
              primero.
            </p>
            <div
              v-for="previous in exercise.lastReference.sessions"
              :key="previous.taskId"
            >
              <p class="field-hint">
                {{
                  previous.sessionStatus === "IN_PROGRESS"
                    ? "Sesión parcial: estas series son contexto y no acreditan un entrenamiento completo para progresar."
                    : previous.sessionStatus === "COMPLETED"
                      ? "Sesión completada."
                      : "Estado de la sesión anterior no verificado."
                }}
              </p>
              <ul>
                <li v-for="set in previous.sets" :key="set.setNumber">
                  Serie {{ set.setNumber }}:
                  {{ set.load ?? "Carga no registrada" }}
                  {{ set.loadUnit ?? "(unidad desconocida)" }} ×
                  {{ set.repetitions ?? "—" }} repeticiones<span
                    v-if="set.rpe !== null"
                  >
                    · Esfuerzo {{ set.rpe }}/10</span
                  ><span v-if="set.status !== 'COMPLETED'">
                    · Registro {{ set.status ?? "sin clasificación" }}</span
                  >
                </li>
              </ul>
              <RouterLink
                :to="{
                  name: 'workout-session-detail',
                  params: { sessionId: previous.sessionId },
                }"
                >Ver resultados anteriores</RouterLink
              >
            </div>
          </div>
          <p>{{ exercise.guidance.message }}</p>
          <p
            v-if="exercise.guidanceSuggested?.origin === 'HISTORICAL_REFERENCE'"
          >
            {{ exercise.guidanceSuggested.reason }}
          </p>
          <p v-if="exercise.guidanceSuggested?.origin === 'CALCULATED'">
            <strong>Nueva orientación calculada:</strong>
            {{ exercise.guidanceSuggested.reason
            }}<span v-if="exercise.guidanceSuggested.load !== null">
              {{
                recordableLoad(exercise.guidanceSuggested.load) ??
                exercise.guidanceSuggested.load
              }}
              {{ exercise.guidanceSuggested.unit }} ×
              {{ exercise.guidanceSuggested.reps }} repeticiones.</span
            >
            No cambia el plan.
          </p>
        </template>
        <WorkoutRepetitionGuide
          v-if="
            (exercise.progressiveContext ?? exercise.repetitionContext) &&
            exercise.preparation?.stage !== 'REVIEW_REQUIRED' &&
            (exercise.preparation
              ? exercise.preparation.stage === 'REPETITION_READY'
              : exercise.guidanceSuggested?.load == null)
          "
          :query="query"
          :exercise-id="exercise.exerciseId"
          :context="
            (exercise.progressiveContext ?? exercise.repetitionContext)!
          "
          @calculated="calculated"
        />
        <details v-if="exercise.proposal" class="guide-proposal">
          <summary>Propuesta guardada</summary>
          <p v-if="exercise.proposal.status === 'CURRENT'">
            <strong>Propuesta matemática vigente:</strong>
            {{ exercise.proposal.recommendedLoad }}
            {{ exercise.proposal.loadUnit }}. Es opcional; puedes ajustar el
            objetivo desde el ejercicio, solo para esta sesión.
          </p>
          <p v-else>
            Existe una propuesta que necesita revisión. No se ofrece una nueva
            carga hasta verificar su vigencia y contexto.
          </p>
          <details>
            <summary>¿Por qué?</summary>
            <p>
              Se contrasta la propuesta guardada con la política, configuración,
              destino e historial actuales. Una referencia anterior no
              constituye una obligación de aumentar carga.
            </p>
            <p v-if="exercise.proposal.status !== 'CURRENT'">
              Consulta la propuesta para conocer los requisitos que faltan.
            </p>
          </details>
          <RouterLink :to="exercise.proposal.href"
            >Consultar propuesta y explicación</RouterLink
          >
        </details>
      </article>
      <details>
        <summary>¿Qué significa esfuerzo y fuerza estimada?</summary>
        <p>
          RPE es el esfuerzo que declaras de 0 a 10; puedes omitirlo. Una
          estimación de 1RM calcula una referencia de fuerza a partir de una
          serie compatible: no mide tu máximo real. No se convierte RPE en
          repeticiones en reserva.
        </p>
      </details>
    </template>
  </section>
</template>
<style scoped>
.daily-guide {
  margin-block: 1rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  min-width: 0;
}
.daily-guide h3 {
  margin: 0 0 0.7rem;
}
.guide-exercise {
  padding: 1rem 0;
  border-top: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.guide-exercise h4 {
  margin: 0 0 0.7rem;
}
.guide-exercise p,
.guide-exercise li {
  line-height: 1.6;
}
.guide-exercise ul {
  padding-left: 1.2rem;
}
.guide-proposal {
  padding: 0.8rem;
  border-left: 3px solid var(--color-primary);
  background: var(--color-surface-subtle);
}
summary {
  cursor: pointer;
  padding: 0.5rem 0;
}
</style>
