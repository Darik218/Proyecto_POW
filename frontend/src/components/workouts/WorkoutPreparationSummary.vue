<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { WorkoutGuide } from "../../schemas/workout-guide.schema";
import {
  formatGuideLoad,
  guideRepetitions,
  workoutGuideReason,
} from "../../utils/workout-guide-presentation";

type Exercise = WorkoutGuide["exercises"][number];
type Reference = NonNullable<Exercise["lastReference"]>;
type Target = Exercise["target"];
const props = defineProps<{ exercise: Exercise }>();
const preparation = computed(() => props.exercise.preparation);
const before = computed(() =>
  preparation.value ? preparation.value.before : props.exercise.lastReference,
);
const plan = computed(() => preparation.value?.plan ?? props.exercise.target);
const draft = computed(() => {
  if (preparation.value) return preparation.value.draft;
  const suggestion = props.exercise.guidanceSuggested;
  return suggestion && suggestion.origin !== "INSUFFICIENT_DATA"
    ? suggestion
    : null;
});
const stage = computed(
  () =>
    preparation.value?.stage ??
    (before.value ? "PLAN_WITH_REFERENCE" : "PLAN_ONLY"),
);
const initial = computed(() => stage.value === "PLAN_ONLY" && !before.value);
const calculated = computed(
  () =>
    draft.value?.origin === "CALCULATED" ||
    draft.value?.origin === "PERSISTED_PROPOSAL",
);
const proposal = computed(() => props.exercise.proposal);
const setupReasons = new Set([
  "SETTING_REQUIRED",
  "CONFIGURATION_REQUIRED",
  "INCREMENT_REQUIRED",
  "SETTING_LOAD_UNIT_REQUIRED",
  "AMBIGUOUS_INCREMENT_MODE",
  "INCREMENT_MODE_REQUIRED",
  "SETTING_MINIMUM_INVALID",
  "AMBIGUOUS_SETTING_SCOPE",
]);
const blockerCodes = computed(
  () => preparation.value?.blockers.map((item) => item.code) ?? [],
);
const loadCodes = computed(
  () =>
    preparation.value?.diagnostics?.load?.reasons.map((item) => item.code) ??
    [],
);
const needsLoadSetup = computed(
  () =>
    !initial.value &&
    !calculated.value &&
    loadCodes.value
      .concat(blockerCodes.value)
      .some((code) => setupReasons.has(code)),
);

const primaryReason = computed(() => {
  if (calculated.value) {
    if (stage.value === "REPETITION_DRAFT") {
      const reason = preparation.value?.why.find((code) =>
        ["REPETITION_TARGET_ADVANCE", "REPETITION_RANGE_COMPLETED"].includes(
          code,
        ),
      );
      if (reason) return workoutGuideReason(reason);
    }
    if (props.exercise.guidanceSuggested?.action === "INCREASE")
      return "Tus registros cumplen el objetivo y el incremento cabe en tus ajustes de carga.";
    return "El historial y el objetivo actual respaldan este borrador.";
  }
  if (before.value?.scope === "FREE_SESSION")
    return "Referencia de entrenamiento libre. Úsala para elegir tus valores si el equipo y la forma de anotar el peso coinciden.";
  if (before.value?.scope === "OTHER_CONTEXT")
    return workoutGuideReason("CONTEXTUAL_HISTORY_ONLY");
  if (stage.value === "REPETITION_READY")
    return workoutGuideReason("COMPARABILITY_DECLARATION_REQUIRED");

  const main = blockerCodes.value.find(
    (code) =>
      !setupReasons.has(code) &&
      !!workoutGuideReason(code) &&
      code !== "NO_ELIGIBLE_HISTORY",
  );
  if (main) return workoutGuideReason(main);
  if (stage.value === "REVIEW_REQUIRED")
    return before.value
      ? "Revisa el registro antes de reutilizarlo."
      : "No se pudo verificar el orden o el contexto de un registro anterior.";
  if (before.value)
    return "Puedes usar el último registro como referencia al elegir tus valores.";
  return undefined;
});

const draftLabel = computed(() => {
  if (!draft.value) return "";
  const { load, unit, reps, repsBySet } = draft.value;
  const repetitions = guideRepetitions(reps, repsBySet);
  if (repetitions === "—")
    return load === null
      ? "Elige el peso y las repeticiones"
      : `${formatGuideLoad(load, unit)} · repeticiones a elegir`;
  return `${load === null ? "" : `${formatGuideLoad(load, unit)} × `}${repetitions} repeticiones`;
});

const detailReason = computed(() => {
  if (initial.value) return undefined;
  if (calculated.value) {
    // The repetition policy's prose identifies the specific work set advanced.
    return draft.value?.repsBySet?.length
      ? props.exercise.guidanceSuggested?.reason
      : undefined;
  }
  const codes = [
    ...blockerCodes.value,
    ...(preparation.value?.why ?? props.exercise.guidance.reasons),
    ...loadCodes.value,
  ];
  return codes
    .filter(
      (code) =>
        !setupReasons.has(code) &&
        ![
          "NO_ELIGIBLE_HISTORY",
          "FIRST_BASELINE",
          "PLAN_TARGET_AVAILABLE",
          "PLAN_WITH_REFERENCE",
        ].includes(code),
    )
    .map(workoutGuideReason)
    .find((label) => label && label !== primaryReason.value);
});

function targetLabel(value: Target) {
  const min = value.targetRepsMin;
  const max = value.targetRepsMax;
  const reps =
    min !== null && max !== null && min !== max
      ? `${min}–${max}`
      : (min ?? max);
  const volume =
    reps === null
      ? `${value.targetSets ?? "Series a elegir"}${value.targetSets !== null ? " series" : ""} · repeticiones a elegir`
      : `${value.targetSets !== null ? `${value.targetSets} × ` : ""}${reps} repeticiones`;
  const weight =
    value.targetLoad === null
      ? "peso a elegir"
      : formatGuideLoad(value.targetLoad, value.targetLoadUnit);
  return `${volume} · ${weight}`;
}

function sessionSets(recorded: Reference["sessions"][number]["sets"]): string {
  const work = recorded.filter((set) => set.kind === "WORK");
  const sets = work.length ? work : recorded;
  const [first] = sets;
  if (!first) return "Sin series registradas.";
  const sameLoad =
    first.load !== null &&
    first.loadUnit !== null &&
    sets.every(
      (set) =>
        set.isCompleted &&
        set.status === "COMPLETED" &&
        set.repetitions !== null &&
        formatGuideLoad(set.load, set.loadUnit) ===
          formatGuideLoad(first.load, first.loadUnit),
    );
  if (sameLoad)
    return `${formatGuideLoad(first.load, first.loadUnit)} · ${sets.map((set) => set.repetitions).join(" / ")} repeticiones`;
  return sets
    .map((set) => {
      const result =
        set.repetitions === null
          ? formatGuideLoad(set.load, set.loadUnit)
          : `${formatGuideLoad(set.load, set.loadUnit)} × ${set.repetitions}`;
      return set.isCompleted && set.status === "COMPLETED"
        ? result
        : `${result} (serie sin completar)`;
    })
    .join(" · ");
}
</script>

<template>
  <div class="workout-preparation" :data-stage="stage">
    <template v-if="before">
      <p
        v-for="(session, index) in before.sessions"
        :key="session.taskId"
        class="preparation-before"
      >
        <strong v-if="index === 0">{{
          before.sessions.length === 1 ? "Anterior" : "Anteriores"
        }}</strong>
        <span>{{ sessionSets(session.sets) }}</span>
        <span v-if="session.sessionStatus === 'IN_PROGRESS'">
          · sesión parcial</span
        >
      </p>
    </template>
    <p class="preparation-plan">
      <strong>Objetivo del plan</strong>
      <span>{{ targetLabel(plan) }}</span>
    </p>
    <p v-if="exercise.isOmitted">Este ejercicio está omitido.</p>
    <p v-else-if="initial" class="preparation-hint">
      Registra lo que hagas para tener una referencia en tu próxima sesión.
    </p>
    <template v-else>
      <p class="preparation-draft" :data-origin="draft?.origin">
        <strong>Para esta sesión</strong>
        <template v-if="draft && stage !== 'REVIEW_REQUIRED'">
          <span class="preparation-draft-values">{{ draftLabel }}</span>
          <span class="preparation-hint">
            {{
              draft.origin === "CALCULATED"
                ? "Propuesta calculada"
                : draft.origin === "PERSISTED_PROPOSAL"
                  ? "Propuesta guardada"
                  : draft.origin === "HISTORICAL_REFERENCE"
                    ? "Referencia anterior"
                    : "Objetivo del plan"
            }}
            · borrador editable
          </span>
        </template>
        <span v-else
          >Guíate por el objetivo del plan y registra los valores que
          realices.</span
        >
      </p>
      <p v-if="primaryReason" class="preparation-hint">{{ primaryReason }}</p>
      <slot name="comparison" />
    </template>
    <details
      v-if="!initial || exercise.originalTarget || proposal"
      class="preparation-why"
    >
      <summary>Ver explicación</summary>
      <p v-if="detailReason">{{ detailReason }}</p>
      <p v-if="needsLoadSetup">
        Para evaluar un aumento de peso, revisa los incrementos y la unidad en
        <RouterLink
          :to="{
            name: 'progression-settings',
            query: { exerciseId: exercise.exerciseId },
          }"
        >
          Ajustes de progresión </RouterLink
        >.
      </p>
      <p v-if="before && before.sessions.length > 1">
        Hay varias sesiones en esa fecha y su orden no está verificado.
      </p>
      <ul v-if="before?.sessions.length" class="preparation-sources">
        <li v-for="session in before.sessions" :key="session.taskId">
          <RouterLink
            :to="{
              name: 'workout-session-detail',
              params: { sessionId: session.sessionId },
            }"
          >
            Ver registro del {{ session.performedOn ?? before.performedOn }}
          </RouterLink>
        </li>
      </ul>
      <p v-if="exercise.originalTarget">
        Objetivo original conservado ·
        {{ targetLabel(exercise.originalTarget) }}
      </p>
      <p v-if="proposal">
        {{
          proposal.status === "CURRENT"
            ? "Propuesta guardada vigente."
            : "La propuesta guardada necesita revisión."
        }}
        <RouterLink :to="proposal.href">Consultar propuesta</RouterLink>
      </p>
      <p v-if="calculated">
        Puedes ajustar los valores al entrenar. Tu plan conserva sus objetivos.
      </p>
    </details>
  </div>
</template>

<style scoped>
.workout-preparation {
  display: grid;
  min-width: 0;
  gap: 0.4rem;
  font-size: 0.875rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.workout-preparation p {
  margin: 0;
}
.workout-preparation strong {
  margin-inline-end: 0.35rem;
  color: var(--color-text-secondary);
  font-weight: 650;
}
.preparation-draft-values {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.preparation-draft .preparation-hint {
  display: block;
  margin-top: 0.15rem;
}
.preparation-hint {
  color: var(--color-text-secondary);
}
.preparation-why summary {
  display: list-item;
  min-height: 44px;
  cursor: pointer;
  align-content: center;
}
.preparation-why p + p {
  margin-top: 0.4rem;
}
.preparation-sources {
  margin: 0.4rem 0;
  padding-inline-start: 1.2rem;
}
</style>
