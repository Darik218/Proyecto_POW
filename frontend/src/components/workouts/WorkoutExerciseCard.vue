<script setup lang="ts">
import { computed, ref } from "vue";
import StatusBadge from "../ui/StatusBadge.vue";
import WorkoutTargetsForm from "./WorkoutTargetsForm.vue";
import WorkoutSetForm from "./WorkoutSetForm.vue";
import {
  setStatusLabel,
  workoutErrorMessage,
  type Workout,
  type SetInput,
  type SetRecord,
} from "../../services/workout-sessions.service";
import type { PreviousWorkoutReference } from "../../utils/workout-set-reference";
import type { useWorkoutSession } from "../../composables/useWorkoutSessions";
const props = defineProps<{
  item: Workout["exercises"][number];
  status: Workout["status"];
  busy: boolean;
  index: number;
  count: number;
  actions: ReturnType<typeof useWorkoutSession>;
  previousReference?: PreviousWorkoutReference;
}>();
const editing = ref(false);
const addingSet = ref(false);
const editingSet = ref("");
const savedNotice = ref("");
const error = ref("");
const editable = computed(() =>
  ["PLANNED", "IN_PROGRESS"].includes(props.status),
);
const canRecord = computed(
  () => props.status === "IN_PROGRESS" && !props.item.isOmitted,
);
const workCompleted = computed(
  () =>
    props.item.sets?.filter(
      (set) => set.kind === "WORK" && set.status === "COMPLETED",
    ).length ?? 0,
);
const remaining = computed(() =>
  props.item.targets?.targetSets == null
    ? null
    : Math.max(0, props.item.targets.targetSets - workCompleted.value),
);
const nextSetNumber = computed(
  () => Math.max(0, ...(props.item.sets ?? []).map((set) => set.setNumber)) + 1,
);
function reps(value: {
  targetRepsMin: number | null;
  targetRepsMax: number | null;
}) {
  return value.targetRepsMin === null
    ? "Sin especificar"
    : value.targetRepsMin === value.targetRepsMax
      ? String(value.targetRepsMin)
      : `${value.targetRepsMin}–${value.targetRepsMax}`;
}
async function run(operation: () => Promise<unknown>) {
  if (props.busy) return;
  error.value = "";
  try {
    await operation();
  } catch (cause) {
    error.value = workoutErrorMessage(
      cause,
      "No se pudo actualizar el ejercicio.",
    );
  }
}
function move(direction: number) {
  const ids =
    props.actions.session.value?.exercises.map((item) => item.id) ?? [];
  const from = ids.indexOf(props.item.id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return run(() => props.actions.reorder(ids));
}
function saveSet(input: SetInput, creationId: string, existing?: SetRecord) {
  return props.actions.recordSet(
    props.item.id,
    input,
    existing?.id,
    existing?.version,
    creationId,
  );
}
function editSet(setId: string) {
  editingSet.value = setId;
  addingSet.value = false;
  savedNotice.value = "";
}
function addSet() {
  addingSet.value = true;
  editingSet.value = "";
  savedNotice.value = "";
}
function recorded() {
  savedNotice.value = "Serie guardada. Puedes registrar la siguiente.";
}
</script>

<template>
  <article
    class="workout-exercise-card"
    :class="{ 'workout-exercise-card--omitted': item.isOmitted }"
  >
    <header class="plan-section-heading">
      <h3>{{ item.orderInSession }}. {{ item.exercise.name }}</h3>
      <span v-if="item.isOmitted" class="plan-status">Ejercicio omitido</span>
    </header>
    <p class="field-hint">
      {{ item.exercise.muscleGroup }} · {{ item.exercise.equipment }}
    </p>
    <p v-if="item.replacesWorkoutExerciseId" class="field-hint">
      Sustitución vinculada al ejercicio omitido de esta sesión.
    </p>
    <p v-if="item.targets" class="workout-target-summary">
      <strong>Objetivo:</strong> {{ item.targets.targetSets ?? "—" }} series ×
      {{ reps(item.targets) }} repeticiones<span
        v-if="item.targets.targetLoad !== null"
      >
        · {{ item.targets.targetLoad }}
        {{ item.targets.targetLoadUnit ?? "(unidad desconocida)" }}</span
      ><span v-if="item.targets.targetRpe !== null">
        · RPE {{ item.targets.targetRpe }}</span
      >
    </p>
    <div class="plan-panel-heading workout-results-heading">
      <h4>Series realizadas</h4>
      <span class="plan-status"
        >{{ workCompleted }} de trabajo completadas</span
      >
    </div>
    <progress
      v-if="!item.isOmitted && item.targets?.targetSets"
      class="workout-series-progress"
      :value="workCompleted"
      :max="item.targets.targetSets"
      :aria-label="'Series de trabajo completadas de ' + item.exercise.name"
    />
    <p v-if="!item.isOmitted && remaining !== null" class="field-hint">
      {{ remaining }} del objetivo por completar.
    </p>
    <p v-if="!item.sets?.length" class="state-message">
      Sin series registradas. Los objetivos no son resultados.
    </p>
    <ol v-else class="workout-set-list compact-set-list">
      <li v-for="set in item.sets" :key="set.id">
        <div class="compact-set-row">
          <div>
            <h5>Serie {{ set.setNumber }}</h5>
            <span class="field-hint">{{
              set.kind === "WARMUP"
                ? "Calentamiento"
                : set.kind === "WORK"
                  ? "Trabajo"
                  : "Tipo no registrado"
            }}</span>
          </div>
          <div class="compact-set-values">
            <p v-if="set.load !== null || set.repetitions !== null">
              <strong>{{ set.repetitions ?? "Sin" }}</strong> repeticiones ·
              <strong>{{ set.load ?? "Sin carga" }}</strong>
              {{
                set.load !== null
                  ? (set.loadUnit ?? "(unidad desconocida)")
                  : ""
              }}<span v-if="set.rpe !== null"> · RPE {{ set.rpe }}</span>
            </p>
            <p v-else>Sin resultados ejecutados.</p>
            <StatusBadge
              :status="set.status ?? 'HISTORICAL'"
              :label="setStatusLabel(set)"
            />
          </div>
          <button
            v-if="canRecord"
            class="text-button"
            type="button"
            :disabled="busy"
            :aria-label="
              'Editar serie ' + set.setNumber + ' de ' + item.exercise.name
            "
            @click="editSet(set.id)"
          >
            Editar serie
          </button>
        </div>
        <p v-if="set.notes" class="field-hint">{{ set.notes }}</p>
        <WorkoutSetForm
          v-if="canRecord && editingSet === set.id"
          :key="set.id"
          :initial="set"
          :busy="busy"
          :save="(input, creationId) => saveSet(input, creationId, set)"
          @saved="
            editingSet = '';
            savedNotice = 'Cambios de la serie guardados.';
          "
          @cancel="editingSet = ''"
        />
      </li>
    </ol>
    <p v-if="savedNotice" role="status" class="field-hint">{{ savedNotice }}</p>
    <button
      v-if="canRecord && !addingSet"
      class="primary-button"
      type="button"
      :disabled="busy"
      @click="addSet"
    >
      Registrar serie
    </button>
    <WorkoutSetForm
      v-if="canRecord && addingSet"
      :key="'new-' + nextSetNumber"
      :busy="busy"
      :next-number="nextSetNumber"
      :current-sets="item.sets"
      :previous-reference="previousReference"
      :save="(input, creationId) => saveSet(input, creationId)"
      @saved="recorded"
      @cancel="addingSet = false"
    />
    <details class="workout-prescription-details">
      <summary>Objetivos y organización del ejercicio</summary>
      <details v-if="item.original" class="workout-original">
        <summary>Objetivos originales al preparar la sesión</summary>
        <dl class="prescription-values workout-original-values">
          <div>
            <dt>Series originales</dt>
            <dd>{{ item.original.targets.targetSets ?? "Sin especificar" }}</dd>
          </div>
          <div>
            <dt>Repeticiones originales</dt>
            <dd>{{ reps(item.original.targets) }}</dd>
          </div>
          <div>
            <dt>Carga original</dt>
            <dd>
              {{ item.original.targets.targetLoad ?? "Sin carga" }}
              {{
                item.original.targets.targetLoad !== null
                  ? (item.original.targets.targetLoadUnit ??
                    "(unidad desconocida)")
                  : ""
              }}
            </dd>
          </div>
          <div>
            <dt>RPE original</dt>
            <dd>{{ item.original.targets.targetRpe ?? "Sin especificar" }}</dd>
          </div>
        </dl>
        <p v-if="item.original.notes">{{ item.original.notes }}</p>
      </details>
      <p v-else class="field-hint">
        Sesión histórica sin captura original verificable. No se han
        reconstruido objetivos.
      </p>
      <h4 v-if="item.targets" class="workout-target-heading">
        Objetivos ajustados para esta sesión
      </h4>
      <dl v-if="item.targets" class="prescription-values workout-adjusted">
        <div>
          <dt>Series objetivo ajustadas</dt>
          <dd>{{ item.targets.targetSets ?? "Sin especificar" }}</dd>
        </div>
        <div>
          <dt>Repeticiones objetivo</dt>
          <dd>{{ reps(item.targets) }}</dd>
        </div>
        <div>
          <dt>Carga objetivo</dt>
          <dd>
            {{ item.targets.targetLoad ?? "Sin especificar" }}
            {{
              item.targets.targetLoad !== null
                ? (item.targets.targetLoadUnit ?? "(unidad desconocida)")
                : ""
            }}
          </dd>
        </div>
        <div>
          <dt>RPE objetivo</dt>
          <dd>{{ item.targets.targetRpe ?? "Sin especificar" }}</dd>
        </div>
      </dl>
      <p v-if="item.notes">{{ item.notes }}</p>
      <div v-if="editable" class="plan-actions">
        <button
          class="text-button"
          type="button"
          :disabled="busy"
          @click="editing = !editing"
        >
          Ajustar objetivos</button
        ><button
          class="text-button"
          type="button"
          :disabled="busy"
          @click="
            run(() =>
              actions.updateExercise(item.id, { isOmitted: !item.isOmitted }),
            )
          "
        >
          {{
            item.isOmitted ? "Restaurar ejercicio" : "Omitir ejercicio"
          }}</button
        ><button
          class="text-button"
          type="button"
          :disabled="busy || index === 0"
          :aria-label="'Subir ' + item.exercise.name"
          @click="move(-1)"
        >
          Subir</button
        ><button
          class="text-button"
          type="button"
          :disabled="busy || index === count - 1"
          :aria-label="'Bajar ' + item.exercise.name"
          @click="move(1)"
        >
          Bajar
        </button>
      </div>
      <WorkoutTargetsForm
        v-if="editable && editing"
        :initial="item.targets"
        :notes="item.notes"
        :busy="busy"
        :save="(input) => actions.updateExercise(item.id, input)"
        @saved="editing = false"
        @cancel="editing = false"
      />
    </details>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  </article>
</template>

<style scoped>
.workout-target-summary {
  margin-block: 1rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}
.compact-set-list > li {
  padding: 0.75rem;
}
.compact-set-row {
  display: grid;
  grid-template-columns: minmax(5rem, 0.7fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 0.75rem;
}
.compact-set-values {
  min-width: 0;
  overflow-wrap: anywhere;
}
.compact-set-values p {
  margin: 0 0 0.35rem;
  line-height: 1.5;
}
.workout-exercise-card button,
.workout-prescription-details > summary {
  min-height: 44px;
}
.workout-prescription-details > summary {
  align-content: center;
}
@media (max-width: 640px) {
  .compact-set-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .compact-set-values {
    grid-column: 1;
    grid-row: 2;
  }
  .compact-set-row > button {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}
</style>
