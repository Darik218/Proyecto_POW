<script setup lang="ts">
import {
  computed,
  KeepAlive,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { workoutGuideService } from "../../services/workout-guide.service";
import type { WorkoutGuide } from "../../schemas/workout-guide.schema";
import type {
  Workout,
  AddWorkoutExercise,
} from "../../services/workout-sessions.service";
import {
  workoutComparability,
  loadClaims,
} from "../../services/workout-comparability.service";
import { workoutErrorMessage } from "../../services/workout-sessions.service";
import type { useWorkoutSession } from "../../composables/useWorkoutSessions";
import { lastCompletedWorkSet } from "../../utils/workout-set-reference";
import type { PreviousWorkoutReference } from "../../utils/workout-set-reference";
import type { WorkoutSetDraft } from "../../utils/workout-set-draft";
import {
  formatGuideLoad,
  guideRepetitions,
  workoutGuideReason,
} from "../../utils/workout-guide-presentation";
import WorkoutSetForm from "./WorkoutSetForm.vue";
import WorkoutExerciseCard from "./WorkoutExerciseCard.vue";
import RestTimer from "./RestTimer.vue";
import WorkoutRepetitionGuide from "./WorkoutRepetitionGuide.vue";
import WorkoutPreparationSummary from "./WorkoutPreparationSummary.vue";
import AddWorkoutExerciseForm from "./AddWorkoutExerciseForm.vue";
const props = defineProps<{
  session: Workout;
  busy: boolean;
  actions: ReturnType<typeof useWorkoutSession>;
  previousReferences: Record<string, PreviousWorkoutReference>;
}>();
const emit = defineEmits<{ finish: []; add: [] }>(),
  auth = useAuthStore();
const superseded = computed(
  () =>
    new Set(
      props.session.exercises
        .map((e) => e.replacesWorkoutExerciseId)
        .filter(Boolean),
    ),
);
function logicalPosition(item: Workout["exercises"][number]) {
  const seen = new Set<string>();
  let source = item;
  while (source.replacesWorkoutExerciseId && !seen.has(source.id)) {
    seen.add(source.id);
    const previous = props.session.exercises.find(
      (row) => row.id === source.replacesWorkoutExerciseId,
    );
    if (!previous) break;
    source = previous;
  }
  return source.orderInSession;
}
const usable = computed(() =>
    props.session.exercises
      .filter((e) => !e.isOmitted && !superseded.value.has(e.id))
      .sort(
        (a, b) =>
          logicalPosition(a) - logicalPosition(b) ||
          a.orderInSession - b.orderInSession,
      ),
  ),
  selected = ref(""),
  extra = ref(false),
  saved = ref(""),
  recordCount = ref(0);
const changing = ref<Workout["exercises"][number] | null>(null);
const authScope = computed(() =>
  auth.isAuthenticated
    ? JSON.stringify([auth.user?.id, auth.getSessionGeneration()])
    : null,
);
const completed = (item: Workout["exercises"][number]) =>
  item.sets?.filter((s) => s.status === "COMPLETED" && s.kind === "WORK")
    .length ?? 0;
const reached = (item: Workout["exercises"][number]) =>
  !!item.targets?.targetSets && completed(item) >= item.targets.targetSets;
const planned = computed(() =>
  usable.value.filter((item) => item.targets?.targetSets),
);
const reachedCount = computed(() => planned.value.filter(reached).length);
const currentCard = ref<HTMLElement | null>(null);
const active = computed(
  () =>
    usable.value.find((e) => e.id === selected.value) ??
    usable.value.find((e) => !reached(e)) ??
    usable.value[0],
);
const position = computed(() =>
  active.value
    ? usable.value.findIndex((e) => e.id === active.value?.id) + 1
    : 0,
);
const next = computed(() => {
  const list = usable.value,
    current = active.value;
  if (!current) return;
  return (
    list.slice(position.value).find((e) => !reached(e)) ??
    list.find((e) => e.id !== current.id && !reached(e))
  );
});
const previousSet = computed(() =>
  lastCompletedWorkSet(activeReference.value?.sets),
);
const nextNumber = computed(
  () => Math.max(0, ...(active.value?.sets ?? []).map((s) => s.setNumber)) + 1,
);
function revealCurrent() {
  if (
    typeof window === "undefined" ||
    !window.matchMedia("(max-width:640px)").matches ||
    !active.value
  )
    return;
  if (document.activeElement?.closest(".quick-set-form")) return;
  currentCard.value?.scrollIntoView({ block: "start" });
}
onMounted(() => {
  void nextTick(revealCurrent);
});
async function applyGuide(value: WorkoutGuide) {
  guide.value = value;
  await nextTick();
  if (exerciseGuide.value?.guidanceSuggested?.load != null) {
    const load = currentCard.value?.querySelector<HTMLInputElement>(
      '.quick-set-form input[id$="-load"]',
    );
    if (load) {
      load.focus({ preventScroll: true });
      load.scrollIntoView({ block: "center" });
      return;
    }
  }
  revealCurrent();
}
const guide = ref<WorkoutGuide | null>(null),
  guideBusy = ref(false),
  calculating = ref(false),
  guideError = ref(""),
  gridStep = ref(""),
  calculationPolicy = ref<
    "session-readiness-preview-v1" | "session-load-compliance-preview-v1"
  >("session-load-compliance-preview-v1"),
  mode = ref<"" | "ABSOLUTE" | "PERCENT">("");
const exerciseGuide = computed(() =>
  guide.value?.exercises.find((e) => e.id === active.value?.id),
);
const activeReference = computed<PreviousWorkoutReference | undefined>(() => {
  if (
    !guide.value ||
    exerciseGuide.value?.preparation?.stage === "REVIEW_REQUIRED"
  )
    return undefined;
  const reference = exerciseGuide.value?.lastReference;
  // Several records on one civil date have no verified order. Display them in
  // the guide but do not silently choose one for the editable recording draft.
  if (!reference || reference.sessions.length !== 1) return undefined;
  return {
    sessionLabel: reference.performedOn,
    sets: reference.sessions[0]!.sets,
  };
});
const context = computed(() => exerciseGuide.value?.calculationContext);
const missingLoadClaims = computed(() =>
  workoutComparability.missing(
    authScope.value,
    context.value?.comparisonKey,
    loadClaims,
  ),
);
const claimLabels = {
  sameVariant: "la misma variante",
  sameEquipment: "el mismo equipo",
  externalTotal:
    "peso como carga externa total, sin asistencia ni peso corporal",
  sameLoadConvention: "el mismo criterio de registro del peso",
};
const draft = computed<WorkoutSetDraft | undefined>(() => {
  const item = active.value,
    g = exerciseGuide.value,
    s = g?.guidanceSuggested;
  if (g?.preparation) {
    const prepared = g.preparation.draft;
    if (!prepared) {
      const plan = g.preparation.plan;
      return {
        load: plan.targetLoad,
        unit: plan.targetLoadUnit,
        repetitions: plan.targetRepsMin ?? plan.targetRepsMax,
        origin: "PLAN_TARGET",
        prepared: true,
      };
    }
    return {
      load: prepared.load,
      unit: prepared.unit,
      repetitions: prepared.reps,
      repsBySet: prepared.repsBySet,
      origin: prepared.origin,
      prepared: true,
    };
  }
  if (s?.load != null && s.unit && (s.reps || s.repsBySet))
    return {
      load: s.load,
      unit: s.unit,
      repetitions: s.reps,
      repsBySet: s.repsBySet,
      origin: s.origin,
      reason: s.reason,
    };
  if (!s && g?.proposal?.status === "CURRENT")
    return {
      load: g.proposal.recommendedLoad,
      unit: g.proposal.loadUnit,
      repetitions: item?.targets?.targetRepsMax ?? null,
      origin: "PERSISTED_PROPOSAL",
    };
  if (item?.targets)
    return {
      load: item.targets.targetLoad,
      unit: item.targets.targetLoadUnit,
      repetitions: item.targets.targetRepsMax,
      origin: "PLAN_TARGET",
    };
  return undefined;
});
let revision = 0,
  controller: AbortController | undefined;
function switchTo(id: string) {
  if (props.busy || calculating.value || changing.value) return;
  selected.value = id;
  extra.value = false;
  saved.value = "";
  gridStep.value = "";
  mode.value = "";
  void nextTick(() => {
    if (typeof document === "undefined") return;
    const heading = document.getElementById("live-exercise-" + id);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  });
}
async function openExerciseChange(item: Workout["exercises"][number]) {
  changing.value = item;
  await nextTick();
  const editor = currentCard.value?.querySelector<HTMLElement>(
    "#live-replacement-editor",
  );
  editor?.focus({ preventScroll: true });
  editor?.scrollIntoView({ block: "start" });
}
async function closeExerciseChange() {
  changing.value = null;
  await nextTick();
  currentCard.value
    ?.querySelector<HTMLButtonElement>(".live-change-exercise")
    ?.focus();
}
async function changeExercise(input: AddWorkoutExercise) {
  const source = changing.value;
  if (!source) throw new Error("Selecciona el ejercicio que quieres cambiar.");
  const scope = authScope.value,
    sessionId = props.session.id;
  await props.actions.replaceExercise(source.id, {
    id: input.id,
    exerciseId: input.exerciseId,
    expectedVersion: input.expectedVersion,
    notes: input.notes,
  });
  if (scope !== authScope.value || sessionId !== props.session.id) return;
  changing.value = null;
  selected.value = input.id;
  extra.value = false;
  saved.value = "Ejercicio cambiado. Los resultados anteriores se conservan.";
  await nextTick();
  document
    .getElementById("live-exercise-" + input.id)
    ?.focus({ preventScroll: true });
  document
    .getElementById("live-exercise-" + input.id)
    ?.scrollIntoView({ block: "start" });
}
function advance() {
  if (next.value) switchTo(next.value.id);
  else emit("finish");
}
function recorded() {
  saved.value = "Serie guardada";
  extra.value = false;
  recordCount.value++;
  void nextTick(() => {
    if (typeof document !== "undefined")
      document
        .querySelector<HTMLButtonElement>(
          ".workout-live .quick-set-form .primary-button, .workout-live .live-dominant .primary-button",
        )
        ?.focus({ preventScroll: true });
  });
}
async function loadGuide() {
  const n = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  guide.value = null;
  guideError.value = "";
  guideBusy.value = true;
  if (!auth.isAuthenticated) {
    guideBusy.value = false;
    return;
  }
  try {
    const value = await workoutGuideService.get(
      { sessionId: props.session.id },
      signal,
    );
    if (n === revision && !signal.aborted) guide.value = value;
  } catch (cause) {
    if (n === revision && !signal.aborted)
      guideError.value = workoutErrorMessage(
        cause,
        "No se pudo actualizar la orientación. Puedes seguir registrando tus series.",
      );
  } finally {
    if (n === revision) guideBusy.value = false;
  }
}
function openCalculation() {
  if (typeof document === "undefined" || !active.value) return;
  const details = document.getElementById(
    "live-calc-" + active.value.id,
  ) as HTMLDetailsElement | null;
  if (details) {
    details.open = true;
    details.scrollIntoView({ block: "start" });
  }
}
async function calculate() {
  const c = context.value,
    e = active.value;
  if (!c?.ready || !c.contextKey || !e || calculating.value || props.busy)
    return;
  const selectedMode =
    mode.value || (c.incrementModes.length === 1 ? c.incrementModes[0] : "");
  if (!selectedMode || !gridStep.value.trim()) {
    guideError.value =
      "Indica el salto de peso disponible y el incremento configurado que quieres evaluar.";
    return;
  }
  const n = revision,
    sessionId = props.session.id,
    scope = authScope.value,
    comparisonKey = c.comparisonKey,
    exerciseId = e.exercise.id,
    signal = controller?.signal;
  calculating.value = true;
  guideError.value = "";
  try {
    const value = await workoutGuideService.preview(
      {
        source: { sessionId },
        exerciseId,
        contextKey: c.contextKey,
        gridStep: gridStep.value.trim().replace(",", "."),
        incrementMode: selectedMode,
        policyContract: calculationPolicy.value,
        declaration: {
          sameVariant: true,
          sameEquipment: true,
          externalTotal: true,
        },
      },
      signal,
    );
    if (n === revision && sessionId === props.session.id && !signal?.aborted) {
      const returned = value.exercises.find(
        (item) => item.exerciseId === exerciseId,
      )?.calculationContext?.comparisonKey;
      if (comparisonKey && comparisonKey === returned)
        workoutComparability.record(scope, comparisonKey, {
          sameVariant: true,
          sameEquipment: true,
          externalTotal: true,
        });
      guide.value = value;
      if (exerciseGuide.value?.guidanceSuggested?.load != null)
        void nextTick(() => {
          if (typeof document === "undefined") return;
          const details = document.getElementById(
            "live-calc-" + active.value?.id,
          ) as HTMLDetailsElement | null;
          if (details) details.open = false;
          const input = document.querySelector<HTMLInputElement>(
            '.workout-live .quick-set-form input[id$="-load"]',
          );
          input?.focus({ preventScroll: true });
          input?.scrollIntoView({ block: "center" });
        });
    }
  } catch (cause) {
    if (n === revision && !signal?.aborted)
      guideError.value = workoutErrorMessage(
        cause,
        "No se pudo calcular. Actualiza la orientación para revisar los datos vigentes.",
      );
  } finally {
    if (n === revision) calculating.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.session.id,
      props.session.performedOn,
      props.session.timeZone,
      props.session.exercises.map((e) => [e.id, e.isOmitted, e.targets]),
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ]),
  () => {
    calculating.value = false;
    workoutComparability.setScope(authScope.value);
    gridStep.value = "";
    mode.value = "";
    void loadGuide();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.session.id,
  () => {
    selected.value = "";
    saved.value = "";
    extra.value = false;
    recordCount.value = 0;
    changing.value = null;
  },
);
watch(
  () => [props.session.id, ...usable.value.map((e) => e.id)].join(":"),
  () => {
    if (!usable.value.some((e) => e.id === selected.value))
      selected.value =
        usable.value.find((e) => !reached(e))?.id ?? usable.value[0]?.id ?? "";
  },
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
});
</script>
<template>
  <section class="workout-live" aria-label="Entrenamiento en directo">
    <header class="live-toolbar">
      <div class="live-session-progress">
        <span
          ><strong>{{ session.completedSetCount ?? 0 }}</strong> series
          completadas</span
        >
        <span v-if="planned.length"
          >{{ reachedCount }}/{{ planned.length }} objetivos</span
        >
        <progress
          v-if="planned.length"
          class="workout-series-progress"
          :max="planned.length"
          :value="reachedCount"
          aria-label="Objetivos de series alcanzados"
        />
      </div>
      <div class="live-toolbar-actions">
        <button class="text-button" :disabled="busy" @click="emit('add')">
          Añadir ejercicio</button
        ><button
          class="text-button live-finish"
          :disabled="busy || Boolean(changing)"
          @click="emit('finish')"
        >
          Terminar
        </button>
      </div>
    </header>
    <nav
      v-if="usable.length"
      class="live-exercise-nav"
      aria-label="Ejercicios del entrenamiento"
    >
      <button
        v-for="(item, index) in usable"
        :key="item.id"
        type="button"
        :aria-pressed="active?.id === item.id"
        :disabled="busy || calculating || Boolean(changing)"
        @click="switchTo(item.id)"
      >
        <span class="live-tab-position">{{ index + 1 }}</span
        ><span class="live-tab-title">{{ item.exercise.name }}</span>
        <small
          >{{ completed(item)
          }}{{
            item.targets?.targetSets ? " / " + item.targets.targetSets : ""
          }}</small
        >
      </button>
    </nav>
    <template v-if="active">
      <article
        ref="currentCard"
        class="live-current"
        :aria-labelledby="'live-exercise-' + active.id"
      >
        <header>
          <p class="live-position">
            Ejercicio {{ position }} de {{ usable.length }}
          </p>
          <h2 :id="'live-exercise-' + active.id" tabindex="-1">
            {{ active.exercise.name }}
          </h2>
        </header>
        <div v-if="active.targets?.targetSets" class="live-exercise-progress">
          <span
            >{{ completed(active) }} de {{ active.targets.targetSets }} series
            de trabajo</span
          >
          <progress
            class="workout-series-progress"
            :max="active.targets.targetSets"
            :value="Math.min(completed(active), active.targets.targetSets)"
            aria-label="Series de trabajo del ejercicio"
          />
        </div>
        <p v-else class="live-exercise-progress">
          {{ completed(active) }} series de trabajo completadas
        </p>
        <p v-if="active.replacesWorkoutExerciseId" class="field-hint">
          Sustituye a
          {{
            session.exercises.find(
              (item) => item.id === active.replacesWorkoutExerciseId,
            )?.exercise.name ?? "un ejercicio de esta sesión"
          }}. Sus series anteriores siguen guardadas por separado.
        </p>
        <AddWorkoutExerciseForm
          v-if="changing"
          id="live-replacement-editor"
          tabindex="-1"
          :key="session.id + changing.id"
          :replacement-source="{
            id: changing.id,
            exerciseId: changing.exercise.id,
            name: changing.exercise.name,
            hasResults: Boolean(changing.sets?.length),
          }"
          :expected-version="session.version"
          :busy="busy"
          :save="changeExercise"
          @cancel="closeExerciseChange"
        />
        <div v-show="!changing">
          <div
            class="live-context"
            v-if="
              active.targets || (!exerciseGuide?.preparation && previousSet)
            "
          >
            <p
              class="live-target"
              v-if="
                active.targets &&
                (active.targets.targetRepsMin ||
                  active.targets.targetRepsMax ||
                  active.targets.targetLoad !== null)
              "
            >
              <strong>Objetivo</strong> ·
              <span v-if="active.targets.targetRepsMin !== null"
                >{{ active.targets.targetRepsMin
                }}{{
                  active.targets.targetRepsMax !== active.targets.targetRepsMin
                    ? "–" + (active.targets.targetRepsMax ?? "—")
                    : ""
                }}
                reps</span
              >
              <span v-if="active.targets.targetLoad !== null"
                >{{ active.targets.targetRepsMin !== null ? " · " : ""
                }}{{
                  formatGuideLoad(
                    active.targets.targetLoad,
                    active.targets.targetLoadUnit,
                  )
                }}</span
              >
            </p>
            <p
              v-if="previousSet && !exerciseGuide?.preparation"
              class="live-previous"
            >
              Anterior:
              <strong
                >{{ formatGuideLoad(previousSet.load, previousSet.loadUnit) }} ×
                {{ previousSet.repetitions ?? "—" }}</strong
              >
            </p>
          </div>
          <KeepAlive :max="10"
            ><WorkoutSetForm
              v-if="!reached(active) || extra"
              :key="session.id + active.id + ':' + nextNumber"
              inline
              :busy="busy"
              :next-number="nextNumber"
              :current-sets="active.sets"
              :previous-reference="activeReference"
              :draft="draft"
              :save="
                (input, id) =>
                  actions.recordSet(active!.id, input, undefined, undefined, id)
              "
              @saved="recorded"
          /></KeepAlive>
          <p v-if="saved" role="status" class="live-saved">✓ {{ saved }}</p>
          <div v-if="reached(active) && !extra" class="live-dominant">
            <p>
              Objetivo de series registrado. Puedes continuar o añadir otra
              serie si lo necesitas.
            </p>
            <button class="primary-button" :disabled="busy" @click="advance">
              {{
                next ? "Siguiente ejercicio" : "Finalizar entrenamiento"
              }}</button
            ><button class="text-button" :disabled="busy" @click="extra = true">
              Añadir otra serie
            </button>
          </div>
          <div class="live-secondary-actions">
            <button
              v-if="!reached(active) && next"
              class="text-button live-skip"
              type="button"
              :disabled="busy"
              @click="switchTo(next!.id)"
            >
              Pasar al siguiente ejercicio
            </button>
            <button
              class="text-button live-change-exercise"
              type="button"
              :disabled="busy || calculating"
              @click="openExerciseChange(active)"
            >
              Cambiar ejercicio
            </button>
          </div>
          <WorkoutPreparationSummary
            v-if="exerciseGuide?.preparation"
            class="live-preparation"
            :exercise="exerciseGuide"
          >
            <template
              v-if="
                exerciseGuide.preparation.stage === 'REPETITION_READY' &&
                (
                  exerciseGuide.progressiveContext ??
                  exerciseGuide.repetitionContext
                )?.ready
              "
              #comparison
            >
              <WorkoutRepetitionGuide
                :query="{ sessionId: session.id }"
                :exercise-id="active.exercise.id"
                :context="
                  (exerciseGuide.progressiveContext ??
                    exerciseGuide.repetitionContext)!
                "
                :disabled="busy || calculating"
                compact
                @calculated="applyGuide"
              />
            </template>
          </WorkoutPreparationSummary>
          <div v-else class="live-context">
            <p
              v-if="exerciseGuide?.lastReference?.scope === 'FREE_SESSION'"
              class="field-hint"
            >
              Referencia de entrenamiento libre; no se vincula al plan.
            </p>
            <p
              v-if="
                exerciseGuide?.lastReference?.sessions.some(
                  (previous) => previous.sessionStatus === 'IN_PROGRESS',
                )
              "
              class="field-hint"
            >
              Sesión parcial: referencia contextual, sin acreditar un
              entrenamiento completo para progresar.
            </p>
            <p
              v-if="
                exerciseGuide?.guidanceSuggested?.load !== null &&
                exerciseGuide?.guidanceSuggested?.load !== undefined
              "
              class="live-guidance"
            >
              <strong
                >{{
                  exerciseGuide.guidanceSuggested.origin === "CALCULATED"
                    ? "Propuesta calculada"
                    : "Propuesta verificada"
                }}:</strong
              >
              {{
                formatGuideLoad(
                  exerciseGuide.guidanceSuggested.load,
                  exerciseGuide.guidanceSuggested.unit,
                )
              }}
              ·
              {{
                guideRepetitions(
                  exerciseGuide.guidanceSuggested.reps,
                  exerciseGuide.guidanceSuggested.repsBySet,
                )
              }}. Editable.
            </p>
            <p
              v-if="exerciseGuide?.guidanceSuggested?.origin === 'CALCULATED'"
              class="field-hint live-repetition-reason"
            >
              {{ exerciseGuide.guidanceSuggested.reason }}
            </p>
            <p
              v-if="
                exerciseGuide?.guidance.state === 'FIRST_BASELINE' &&
                !guideBusy &&
                exerciseGuide?.guidanceSuggested?.load == null
              "
              class="field-hint live-baseline"
            >
              <strong>Referencia inicial.</strong> Registra tus propios valores
              o usa el objetivo del plan. Todavía no se calcula una mejora.
            </p>
            <p
              v-else-if="
                exerciseGuide?.guidanceSuggested?.origin ===
                'HISTORICAL_REFERENCE'
              "
              class="field-hint live-reference-state"
            >
              <strong>Referencia anterior, sin recomendación nueva.</strong>
              {{ exerciseGuide.guidanceSuggested.reason }}
            </p>
            <p
              v-else-if="
                !guideBusy && exerciseGuide?.guidanceSuggested?.load == null
              "
              class="field-hint live-insufficient"
            >
              <strong>Información insuficiente para una propuesta.</strong>
              Puedes registrar tus propios valores sin esfuerzo obligatorio.
            </p>
          </div>
          <p v-if="guideBusy" role="status" class="field-hint">
            Consultando tu referencia…
          </p>
          <p v-if="guideError" role="alert" class="form-error">
            {{ guideError }}
            <button
              class="text-button"
              type="button"
              :disabled="calculating"
              @click="loadGuide"
            >
              Actualizar orientación
            </button>
          </p>
          <button
            v-if="
              context?.ready &&
              !(
                exerciseGuide?.progressiveContext ??
                exerciseGuide?.repetitionContext
              )?.ready &&
              exerciseGuide?.preparation?.stage !== 'REVIEW_REQUIRED'
            "
            class="text-button live-compute-short"
            type="button"
            :disabled="busy || calculating"
            @click="openCalculation"
          >
            Obtener una propuesta calculada
          </button>
          <WorkoutRepetitionGuide
            v-if="
              !exerciseGuide?.preparation &&
              (
                exerciseGuide?.progressiveContext ??
                exerciseGuide?.repetitionContext
              )?.ready &&
              exerciseGuide?.guidanceSuggested?.load == null
            "
            :query="{ sessionId: session.id }"
            :exercise-id="active.exercise.id"
            :context="
              (exerciseGuide?.progressiveContext ??
                exerciseGuide?.repetitionContext)!
            "
            :disabled="busy || calculating"
            @calculated="applyGuide"
          />
          <details
            v-if="
              !exerciseGuide?.preparation && exerciseGuide?.guidanceSuggested
            "
            class="live-why"
          >
            <summary>Por qué esta orientación</summary>
            <p>{{ exerciseGuide.guidanceSuggested.reason }}</p>
          </details>
          <details
            v-if="context && (!exerciseGuide?.preparation || context.ready)"
            :id="'live-calc-' + active.id"
            class="live-calculation"
          >
            <summary>Opciones avanzadas de carga</summary>
            <p>
              Este cálculo es opcional y solo prepara valores editables para
              esta sesión. No autoriza cambios en tu plan. Si la última
              referencia está fuera de la semana del entrenamiento o de la
              anterior, solicita recalibración en lugar de aumentar la carga. Es
              un límite de esta vista previa semanal, no una medida de pérdida
              de fuerza.
            </p>
            <template v-if="context.ready && context.setting"
              ><label
                >Cómo evaluar la carga<select
                  v-model="calculationPolicy"
                  :disabled="calculating || busy"
                >
                  <option value="session-load-compliance-preview-v1">
                    Por series y repeticiones (esfuerzo opcional)
                  </option>
                  <option value="session-readiness-preview-v1">
                    Por resultados y esfuerzo registrado
                  </option>
                </select></label
              >
              <p>
                Política: completar todas las series al máximo de repeticiones,
                con la misma carga<span
                  v-if="calculationPolicy === 'session-readiness-preview-v1'"
                >
                  y esfuerzo RPE entre {{ context.setting.targetRpeMin }} y
                  {{ context.setting.targetRpeMax }}</span
                >. Se exigen
                {{ context.setting.minSuccessfulSessions }} sesiones
                satisfactorias seguidas en fechas distintas, dentro de los
                registros comparables.
              </p>
              <p
                v-if="
                  calculationPolicy === 'session-load-compliance-preview-v1'
                "
                class="field-hint"
              >
                Este método utiliza el cumplimiento registrado, sin exigir RPE
                ni convertir RIR. Respeta los incrementos y límites guardados;
                no es una evaluación de fatiga ni autoriza cambios de plan.
              </p>
              <p>Se analizarán estos registros:</p>
              <ul>
                <li v-for="task in context.tasks" :key="task.id">
                  {{ task.performedOn ?? "Fecha desconocida" }} ·
                  {{ task.sets }} series ·
                  {{ task.timeZone ?? "Zona no registrada" }}
                </li>
              </ul>
              <label
                >Salto de peso disponible ({{ context.unit }})<input
                  v-model="gridStep"
                  inputmode="decimal"
                  placeholder="Indica el paso real"
                  :disabled="calculating || busy"
              /></label>
              <p class="field-hint">
                Las cargas disponibles parten de cero y avanzan con este paso;
                el cálculo ajusta hacia abajo, sin superar los límites
                configurados.
              </p>
              <label v-if="context.incrementModes.length > 1"
                >Incremento configurado<select
                  v-model="mode"
                  :disabled="calculating || busy"
                >
                  <option value="">Seleccionar</option>
                  <option
                    v-for="m in context.incrementModes"
                    :key="m"
                    :value="m"
                  >
                    {{ m === "ABSOLUTE" ? "Absoluto" : "Porcentaje" }}
                  </option>
                </select></label
              >
              <p
                v-if="mode || context.incrementModes.length === 1"
                class="field-hint"
              >
                Incremento guardado:
                {{
                  (mode || context.incrementModes[0]) === "ABSOLUTE"
                    ? context.setting.incrementAbsolute
                    : context.setting.incrementPercent
                }}
                {{
                  (mode || context.incrementModes[0]) === "ABSOLUTE"
                    ? context.unit
                    : "%"
                }}. Límite por incremento:
                {{ context.setting.maxIncrementPercent }} %.
                <span v-if="context.setting.maxLoad !== null"
                  >Carga máxima: {{ context.setting.maxLoad }}
                  {{ context.unit }}.</span
                >
                Para este cálculo se interpretan las cargas y los límites
                absolutos en {{ context.unit }}; si no corresponde, revisa la
                configuración.
              </p>
              <p v-if="missingLoadClaims.length">
                Falta confirmar
                {{
                  missingLoadClaims.map((item) => claimLabels[item]).join(", ")
                }}. Al calcular confirmas solo estos datos para los registros
                mostrados. No se deducen de kg/lb ni del nombre del ejercicio.
              </p>
              <p v-else class="field-hint">
                Las declaraciones de comparabilidad de estos registros siguen
                vigentes. No necesitas repetirlas.
              </p>
              <button
                class="secondary-button"
                type="button"
                :disabled="calculating || busy"
                @click="calculate"
              >
                {{
                  calculating
                    ? "Calculando…"
                    : "Calcular con estos registros comparables"
                }}
              </button>
            </template>
            <p v-else>
              Todavía faltan configuración o registros comparables para este
              cálculo. Puedes entrenar usando tus propios valores. Configurar un
              incremento no sustituye el historial ni la información que falta.
            </p>
            <RouterLink
              v-if="!context.ready"
              :to="{
                name: 'progression-settings',
                query: { exerciseId: active.exercise.id },
              }"
              >Revisar configuración del ejercicio</RouterLink
            >
            <details v-if="exerciseGuide?.guidanceSuggested">
              <summary>Detalles del resultado</summary>
              <p
                v-if="
                  exerciseGuide.guidanceSuggested.reasons.some(
                    workoutGuideReason,
                  )
                "
              >
                {{
                  [
                    ...new Set(
                      exerciseGuide.guidanceSuggested.reasons
                        .map(workoutGuideReason)
                        .filter(Boolean),
                    ),
                  ].join(" ")
                }}
              </p>
              <RouterLink
                v-if="exerciseGuide.proposal"
                :to="exerciseGuide.proposal.href"
                >Consultar propuesta guardada</RouterLink
              >
            </details>
          </details>
        </div>
      </article>
      <details class="live-review live-overview">
        <summary>Resumen de todas las series</summary>
        <div class="live-overview-table">
          <table>
            <thead>
              <tr>
                <th>Serie</th>
                <th>Carga</th>
                <th>Repeticiones</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody v-for="item in session.exercises" :key="item.id">
              <tr>
                <th colspan="4">
                  <button
                    class="text-button"
                    :disabled="
                      busy || item.isOmitted || superseded.has(item.id)
                    "
                    @click="switchTo(item.id)"
                  >
                    {{ item.exercise.name }}
                    <span v-if="superseded.has(item.id)">
                      · Sustituido; resultados conservados</span
                    >
                    <span v-else-if="item.isOmitted"> · Omitido</span>
                  </button>
                </th>
              </tr>
              <tr v-for="set in item.sets" :key="set.id">
                <td>{{ set.setNumber }}</td>
                <td>
                  {{ set.load ?? "—" }}
                  {{ set.loadUnit ?? "(unidad no registrada)" }}
                </td>
                <td>{{ set.repetitions ?? "—" }}</td>
                <td>
                  {{
                    set.status === "COMPLETED"
                      ? "Completada"
                      : set.status === "INCOMPLETE"
                        ? "Incompleta"
                        : set.status === "FAILED"
                          ? "Intento fallido"
                          : set.status === "SKIPPED"
                            ? "Omitida"
                            : set.status === "PENDING"
                              ? "Pendiente"
                              : "Sin clasificación"
                  }}
                </td>
              </tr>
              <tr v-if="!item.sets?.length">
                <td colspan="4">Sin series guardadas.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <RestTimer :auto-start="recordCount" />
      <details class="live-review">
        <summary>Ver y corregir series de {{ active.exercise.name }}</summary>
        <WorkoutExerciseCard
          :key="active.id"
          review-only
          :item="active"
          :status="session.status"
          :busy="busy"
          :index="position - 1"
          :count="usable.length"
          :actions="actions"
          :previous-reference="previousReferences[active.id]"
        />
      </details>
    </template>
    <p v-else class="state-card">
      No hay ejercicios disponibles. Puedes añadir uno o finalizar sin
      resultados.
    </p>
  </section>
</template>
<style scoped>
.live-compute-short {
  min-height: 44px;
  padding: 0.3rem 0;
}
.live-why,
.live-preparation,
.live-calculation,
#live-replacement-editor,
.live-current {
  scroll-margin-top: 5.625rem;
}
.live-why {
  font-size: 0.85rem;
}
.live-tab-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-exercise-nav button > .live-tab-title {
  color: var(--ink);
}
.live-previous {
  font-size: 0.9rem;
  margin: 0;
}
.live-current .live-guidance {
  margin: 0;
  font-size: 0.9rem;
}
.live-current h2 {
  scroll-margin-top: 7rem;
}
.live-overview-table {
  overflow-x: auto;
}
.live-overview table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.live-overview td,
.live-overview th {
  text-align: left;
  border-bottom: 1px solid var(--line);
  padding: 0.6rem;
  overflow-wrap: anywhere;
}
.workout-live {
  max-width: 53rem;
  min-width: 0;
  margin-inline: auto;
}
.live-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}
.live-session-progress {
  display: flex;
  flex: 1 1 18rem;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.8rem;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.live-session-progress strong {
  color: var(--color-text-primary);
}
.live-session-progress progress {
  margin: 0;
}
.live-toolbar-actions {
  display: flex;
  gap: 0.25rem 0.9rem;
  flex-wrap: wrap;
}
.live-toolbar-actions button,
.live-change-exercise,
.live-skip {
  min-height: 44px;
}
.live-exercise-nav {
  display: flex;
  overflow-x: auto;
  gap: 0.5rem;
  padding: 0.25rem 0.25rem 0.5rem;
  margin-bottom: 0.5rem;
}
.live-exercise-nav button {
  flex: 0 0 auto;
  max-width: min(15rem, 88%);
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.7rem;
  border-radius: 0.65rem;
  border: 1px solid var(--line);
  background: var(--color-surface);
  color: var(--ink);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.live-exercise-nav button[aria-pressed="true"] {
  border-color: color-mix(
    in srgb,
    var(--color-primary) 58%,
    var(--color-border)
  );
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}
.live-exercise-nav small {
  white-space: nowrap;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.live-tab-position {
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}
.live-current {
  min-width: 0;
  padding: clamp(0.8rem, 3vw, 1.65rem);
  background: var(--color-surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow-wrap: anywhere;
}
.live-position {
  margin: 0 0 0.3rem;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}
.live-current h2 {
  font-size: clamp(1.45rem, 4vw, 2.15rem);
  line-height: 1.15;
  margin: 0;
  overflow-wrap: anywhere;
}
.live-exercise-progress {
  display: grid;
  gap: 0.35rem;
  margin: 0.65rem 0 0.55rem;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.live-context {
  display: grid;
  gap: 0.45rem;
  margin: 0.5rem 0;
}
.live-context > p {
  margin: 0;
}
.live-target {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin: 0;
}
.live-guidance {
  line-height: 1.45;
}
.live-dominant {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}
.live-dominant p {
  margin: 0 0 0.25rem;
  color: var(--color-text-secondary);
}
.live-dominant > .primary-button {
  min-height: 54px;
  font-size: 1.05rem;
}
.live-dominant > .text-button {
  min-height: 44px;
}
.live-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 1rem;
}
.live-saved {
  margin: 0.6rem 0;
  color: var(--color-primary);
  animation: live-saved-in 150ms ease-out;
}
@keyframes live-saved-in {
  from {
    opacity: 0;
    transform: translateY(0.2rem);
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-saved {
    animation: none;
  }
}
.live-review,
.live-preparation,
.live-calculation {
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--line);
}
summary {
  min-height: 48px;
  align-content: center;
  cursor: pointer;
  line-height: 1.5;
}
.live-calculation p,
.live-calculation li {
  line-height: 1.6;
}
.live-calculation label {
  display: grid;
  gap: 0.6rem;
  margin: 1rem 0;
}
.live-calculation input,
.live-calculation select {
  min-height: 48px;
  max-width: 100%;
}
</style>
