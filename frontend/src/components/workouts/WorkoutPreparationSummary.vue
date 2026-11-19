<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { WorkoutGuide } from "../../schemas/workout-guide.schema";
import { recordableLoad } from "../../utils/workout-set-draft";
const props = defineProps<{ exercise: WorkoutGuide["exercises"][number] }>();
const preparation = computed(() => props.exercise.preparation);
const labels: Record<string, string> = {
  NO_REPRESENTABLE_INCREMENT:
    "El salto de peso disponible no permite un aumento dentro de los límites configurados.",
  GRID_HAS_NO_POSITIVE_INCREMENT:
    "El salto de peso disponible no produce un aumento válido para esta carga.",
  PLAN_TARGET_AVAILABLE: "Se usa el objetivo del plan como punto de partida.",
  NO_ELIGIBLE_HISTORY:
    "Todavía no hay sesiones anteriores completas para comparar.",
  FIRST_BASELINE: "Esta sesión servirá como primera referencia.",
  PLAN_WITH_REFERENCE:
    "El historial sirve como referencia junto al objetivo del plan.",
  COMPARABILITY_DECLARATION_REQUIRED:
    "Confirma la variante, el equipo y la forma de anotar el peso para comparar.",
  REPETITION_TARGET_ADVANCE:
    "Completaste las series comparables: puedes probar una repetición más dentro del rango del plan.",
  REPETITION_RANGE_COMPLETED:
    "Ya alcanzaste el máximo de repeticiones del plan. Un aumento de carga requiere su propia evaluación.",
  LOAD_INCREMENT_REQUIRES_EXPLICIT_POLICY:
    "Subir peso requiere una política e incrementos de carga configurados.",
  LOAD_FROM_RECORDED_HISTORY:
    "El plan no fija peso: se toma la carga que registraste, sin modificar el plan.",
  EFFORT_NOT_REQUIRED_BY_POLICY:
    "Este criterio utiliza series y repeticiones; no exige RPE ni RIR.",
  MINIMUM_NOT_REACHED:
    "Aún faltan sesiones completas comparables para avanzar; conserva la referencia.",
  CONTEXTUAL_HISTORY_ONLY:
    "El registro pertenece a otro contexto y solo sirve como referencia.",
  PARTIAL_SESSION_REFERENCE:
    "La referencia es una sesión parcial; revisa sus resultados antes de reutilizarlos.",
  SESSION_NOT_COMPLETED: "La sesión anterior no está completada.",
  INCOMPLETE_HISTORY:
    "Faltan resultados completos o una clasificación verificable de las series.",
  WORK_SET_NOT_COMPLETED: "Una serie de trabajo anterior no se completó.",
  WORK_SLOT_MAPPING_INCOMPLETE:
    "Las series registradas no cubren todas las series previstas.",
  SET_KIND_UNKNOWN: "Falta confirmar qué series eran de trabajo.",
  LOAD_UNIT_UNKNOWN: "La unidad de un peso anterior no está registrada.",
  KNOWN_LOAD_BASELINE_REQUIRED:
    "Falta una carga con unidad conocida que pueda usarse como referencia.",
  RECORDED_LOAD_DIFFERS:
    "Los pesos registrados difieren; revisa qué carga corresponde a esta sesión.",
  HISTORY_REPETITIONS_INCONSISTENT:
    "Las repeticiones anteriores no son uniformes; revisa las series antes de elegir un nuevo objetivo.",
  REPETITIONS_OUTSIDE_PRESCRIBED_RANGE:
    "Las repeticiones registradas están fuera del rango del plan.",
  HISTORICAL_TARGETS_DIFFER:
    "Los objetivos capturados en el historial difieren de los actuales.",
  HISTORICAL_TARGETS_INCOMPATIBLE:
    "Los objetivos del historial no son compatibles con esta sesión.",
  DESTINATION_TARGETS_CHANGED:
    "El objetivo de esta sesión cambió; vuelve a comprobar la comparación.",
  PRESCRIPTION_TARGETS_CHANGED:
    "La prescripción cambió desde que se guardó la referencia.",
  PRESCRIPTION_HISTORY_REQUIRED:
    "Falta un historial con los objetivos del plan capturados.",
  PRESCRIPTION_REQUIRED:
    "Falta un objetivo del plan al que vincular esta comparación.",
  REFERENCE_OUTSIDE_PREVIEW_PERIOD:
    "La referencia queda fuera de la semana de esta sesión y de la anterior; necesita revisión.",
  STALE_REFERENCE:
    "La referencia es antigua; revísala antes de preparar una nueva orientación.",
  REVIEW_REFERENCE_BEFORE_TRAINING:
    "Revisa la referencia y el objetivo antes de entrenar.",
  REVIEW_REQUIRED:
    "La referencia necesita revisión antes de calcular una nueva orientación.",
  INTRADAY_ORDER_UNKNOWN:
    "Hay varias sesiones en la misma fecha y no se conoce su orden.",
  SAME_DAY_NOT_ORDERED:
    "No se supone qué sesión ocurrió primero en la misma fecha.",
  DUPLICATE_SESSION_REFERENCE: "Hay una sesión duplicada en la comparación.",
  DUPLICATE_SET_REFERENCE: "Hay una serie duplicada en la comparación.",
  DATE_UNKNOWN: "Falta una fecha verificable del entrenamiento anterior.",
  TIME_ZONE_MISMATCH: "Las zonas horarias de los registros no coinciden.",
  READ_LIMIT_REACHED:
    "El historial consultado alcanzó su límite y la comparación puede estar incompleta.",
  FUTURE_CUTOFF_UNVERIFIED:
    "La sesión es futura y su historial deberá comprobarse de nuevo antes de entrenar.",
  CONFIGURATION_REQUIRED:
    "La evaluación de carga necesita configuración del ejercicio.",
  INCREMENT_REQUIRED: "Falta configurar el incremento de peso.",
  POLICY_PROVENANCE_REQUIRED:
    "Falta una política explícita para evaluar un aumento de carga.",
  SETTING_LOAD_UNIT_REQUIRED:
    "Falta definir la unidad de la configuración de carga.",
  AMBIGUOUS_INCREMENT_MODE:
    "Hay más de un incremento posible; elige cuál evaluar.",
  INCREMENT_MODE_REQUIRED:
    "Selecciona el tipo de incremento que quieres evaluar.",
  AMBIGUOUS_SETTING_SCOPE:
    "Hay configuraciones que se solapan para este ejercicio.",
  SETTING_MINIMUM_INVALID:
    "El mínimo de sesiones configurado necesita revisión.",
  TARGET_UNIT_REQUIRED: "Falta la unidad del peso objetivo.",
  TARGET_UNIT_MISMATCH:
    "La unidad del objetivo y la de la propuesta no coinciden.",
  DESTINATION_DECIMAL_INCOMPATIBLE:
    "La precisión de la carga no puede registrarse sin cambiar el valor.",
  SUBSTITUTION_NOT_COMPARABLE:
    "El ejercicio fue sustituido; sus resultados no se equiparan automáticamente.",
  EXERCISE_OMITTED: "Este ejercicio está omitido en la sesión.",
  SESSION_NOT_TRAINABLE: "Esta sesión no está disponible para entrenar.",
  DESTINATION_UNAVAILABLE:
    "El destino de la orientación ya no está disponible.",
  SOURCE_OWNERSHIP_MISMATCH: "No se pudo verificar el origen de los registros.",
  RECORDED_EFFORT_ABOVE_TARGET:
    "El esfuerzo registrado supera el objetivo; revisa la referencia.",
  RECORDED_EFFORT_CONTEXT: "El esfuerzo registrado se muestra como contexto.",
  RECORDED_EFFORT_INVALID: "Un valor de esfuerzo registrado necesita revisión.",
  PROPOSAL_EXPIRED: "La propuesta guardada ha caducado.",
  PROPOSAL_OBSOLETE:
    "La propuesta guardada ya no corresponde al contexto actual.",
  PROPOSAL_NOT_ACTIVE: "La propuesta guardada ya no está activa.",
  REVALIDATION_UNAVAILABLE:
    "No se pudo volver a verificar la propuesta guardada.",
  NEWER_REFERENCE_OUTSIDE_PROPOSAL:
    "Hay resultados más recientes que no formaban parte de la propuesta.",
  CYCLE_CONFLICT: "Otra propuesta ocupa el mismo ciclo de progresión.",
  CYCLE_UNRESERVED: "La propuesta no tiene reservado su ciclo de progresión.",
};
function reason(code: string) {
  return (
    labels[code] ??
    (/^[A-Z][A-Z0-9_]+$/.test(code)
      ? `Revisa el dato indicado en los detalles: ${code}.`
      : code)
  );
}
const explanation = computed(() => {
  const p = preparation.value;
  if (!p) return [];
  const codes = p.why.filter(
    (code) => !p.blockers.some((blocker) => blocker.code === code),
  );
  return [...new Set(codes.map(reason))];
});
const draft = computed(() => preparation.value?.draft);
const otherMethods = computed(() => {
  const diagnostics = preparation.value?.diagnostics;
  return [
    {
      key: "repetition",
      label: "Repeticiones",
      diagnostic: diagnostics?.repetition,
    },
    { key: "load", label: "Carga", diagnostic: diagnostics?.load },
  ].filter(
    (method) =>
      method.diagnostic &&
      !method.diagnostic.ready &&
      method.diagnostic.reasons.length,
  );
});
function load(value: string) {
  return recordableLoad(value) ?? value;
}
</script>
<template>
  <div
    v-if="preparation"
    class="workout-preparation"
    :data-stage="preparation.stage"
  >
    <div class="preparation-context">
      <div class="preparation-before">
        <strong class="preparation-label">Antes</strong>
        <template v-if="preparation.before">
          <time :datetime="preparation.before.performedOn">{{
            preparation.before.performedOn
          }}</time>
          <p
            v-if="preparation.before.scope === 'FREE_SESSION'"
            class="field-hint"
          >
            Referencia de entrenamiento libre; conserva su origen libre.
          </p>
          <p
            v-else-if="preparation.before.scope === 'OTHER_CONTEXT'"
            class="field-hint"
          >
            Referencia del ejercicio en otro contexto; no se equipara
            automáticamente al plan.
          </p>
          <p v-if="preparation.before.sessions.length > 1" class="field-hint">
            Varias sesiones en la misma fecha; se conservan sin suponer su
            orden.
          </p>
          <p
            v-for="session in preparation.before.sessions"
            :key="session.taskId"
          >
            <span v-for="(set, index) in session.sets" :key="set.setNumber">
              {{ index ? " · " : "" }}{{ set.load ?? "Peso sin registrar" }}
              {{ set.loadUnit ?? "(unidad sin registrar)" }} ×
              {{ set.repetitions ?? "—"
              }}<span v-if="set.status !== 'COMPLETED'">
                (serie sin completar)</span
              >
            </span>
            <span v-if="session.sessionStatus === 'IN_PROGRESS'">
              · sesión parcial</span
            >
          </p>
        </template>
        <span v-else-if="preparation.stage === 'PLAN_ONLY'">
          Sin resultados anteriores. Esta sesión creará tu primera referencia.
        </span>
        <span v-else>
          No hay una referencia anterior ordenada/verificada para esta fecha;
          revisa los registros y objetivos.
        </span>
      </div>
      <p class="preparation-plan">
        <strong class="preparation-label">Objetivo del plan</strong>
        {{ preparation.plan.targetSets ?? "Series sin definir"
        }}{{ preparation.plan.targetSets ? " series" : "" }} ·
        {{ preparation.plan.targetRepsMin ?? "—"
        }}{{
          preparation.plan.targetRepsMin !== preparation.plan.targetRepsMax
            ? "–" + (preparation.plan.targetRepsMax ?? "—")
            : ""
        }}
        repeticiones<span v-if="preparation.plan.targetLoad !== null">
          · {{ load(preparation.plan.targetLoad) }}
          {{
            preparation.plan.targetLoadUnit ?? "(unidad sin registrar)"
          }}</span
        ><span v-else> · peso a elegir</span>
      </p>
    </div>
    <p class="preparation-draft" :data-origin="draft?.origin">
      <strong class="preparation-label">Para esta sesión</strong>
      <template v-if="preparation.stage === 'REVIEW_REQUIRED'">
        Revisa la referencia antes de reutilizarla. Puedes registrar tus propios
        resultados.</template
      >
      <template v-else-if="draft">
        <span class="preparation-draft-values">
          <span v-if="draft.sets">{{ draft.sets }} series · </span>
          <span v-if="draft.load !== null"
            >{{ load(draft.load) }}
            {{ draft.unit ?? "(unidad sin registrar)" }} × </span
          ><span v-else>Peso a elegir · </span>
          {{ draft.reps ?? "Repeticiones a elegir"
          }}{{ draft.reps !== null ? " repeticiones" : "" }}
        </span>
        <span class="preparation-draft-note">
          Borrador editable<span v-if="draft.origin === 'HISTORICAL_REFERENCE'">
            desde tu referencia anterior</span
          ><span v-else-if="draft.origin === 'PLAN_TARGET'">
            desde el objetivo del plan</span
          ><span v-else> calculado para esta sesión</span>.
        </span>
      </template>
      <template v-else>
        Elige los valores para registrar tus resultados reales.</template
      >
    </p>
    <details v-if="exercise.originalTarget" class="preparation-original">
      <summary>Objetivo original conservado</summary>
      <p>
        {{ exercise.originalTarget.targetSets ?? "—" }} series ·
        {{ exercise.originalTarget.targetRepsMin ?? "—" }}–{{
          exercise.originalTarget.targetRepsMax ?? "—"
        }}
        repeticiones ·
        {{ exercise.originalTarget.targetLoad ?? "Peso sin definir" }}
        {{ exercise.originalTarget.targetLoadUnit ?? "" }}
      </p>
    </details>
    <details class="preparation-why">
      <summary>Por qué</summary>
      <p
        v-for="session in preparation.before?.sessions ?? []"
        :key="session.taskId"
      >
        <RouterLink
          :to="{
            name: 'workout-session-detail',
            params: { sessionId: session.sessionId },
          }"
          >Ver resultados anteriores ·
          {{
            session.performedOn ?? preparation.before?.performedOn
          }}</RouterLink
        >
      </p>
      <p v-for="text in explanation" :key="text">{{ text }}</p>
      <p v-if="!explanation.length && !preparation.blockers.length">
        El objetivo y los resultados anteriores preparan un borrador que puedes
        ajustar.
      </p>
      <p>
        No modifica tu plan. RPE y RIR son opcionales para registrar y orientar
        repeticiones.
      </p>
    </details>
    <details v-if="otherMethods.length" class="preparation-method-diagnostics">
      <summary>Qué falta para otros métodos</summary>
      <div v-for="method in otherMethods" :key="method.key">
        <strong>{{ method.label }}</strong>
        <p
          v-for="item in method.diagnostic!.reasons"
          :key="item.category + item.code"
        >
          {{ reason(item.code) }} <small>({{ item.code }})</small>
        </p>
      </div>
    </details>
    <details v-if="preparation.blockers.length" class="preparation-blockers">
      <summary>Qué falta revisar ({{ preparation.blockers.length }})</summary>
      <p
        v-for="blocker in preparation.blockers"
        :key="blocker.category + blocker.code"
      >
        {{ reason(blocker.code) }}
      </p>
    </details>
  </div>
</template>
<style scoped>
.workout-preparation {
  min-width: 0;
  margin-block: 0.7rem 0.5rem;
  font-size: 0.9rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
p {
  margin: 0.35rem 0;
}
.preparation-context {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1rem;
  padding-block: 0.65rem;
  border-top: 1px solid var(--color-border);
}
.preparation-label {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 650;
}
.preparation-plan {
  margin: 0;
}
.preparation-before time {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.preparation-before p {
  margin: 0.22rem 0 0;
}
.preparation-draft {
  margin: 0;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: 0.65rem;
  background: var(--color-surface-elevated);
}
.preparation-draft-values {
  display: block;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.preparation-draft-note {
  display: block;
  margin-top: 0.15rem;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}
summary {
  min-height: 44px;
  cursor: pointer;
  align-content: center;
}
details {
  font-size: 0.85rem;
}
details + details {
  border-top: 1px solid var(--color-border);
}
@media (max-width: 450px) {
  .preparation-context {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
