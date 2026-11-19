<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import {
  selectRoutineExercise,
  type RoutineBlock,
} from "../../utils/routine-builder";
import ExercisePicker from "./ExercisePicker.vue";
import {
  copyTemplateDay,
  summarizeTemplateBlocks,
} from "../../utils/routine-templates";

const blocks = defineModel<RoutineBlock[]>("blocks", { required: true });
const activeId = defineModel<string>("activeBlockId", { default: "" });
const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    allowBlockChanges?: boolean;
    review?: boolean;
  }>(),
  { allowBlockChanges: true },
);
const uid = useId();
const copySourceId = ref("");
const copyFeedback = ref("");
watch(activeId, () => {
  copySourceId.value = "";
  copyFeedback.value = "";
});
function copyDay() {
  if (props.disabled || !activeBlock.value) return;
  const source = blocks.value.find((block) => block.id === copySourceId.value);
  if (!source || source.id === activeBlock.value.id) return;
  copyTemplateDay(source, activeBlock.value);
  copyFeedback.value = `Sesión copiada desde ${source.name}. Puedes editarla de forma independiente.`;
}
watch(
  () => blocks.value.map((block) => block.id),
  (ids) => {
    if (!ids.includes(activeId.value)) activeId.value = ids[0] ?? "";
  },
  { immediate: true },
);
const activeBlock = computed(() =>
  blocks.value.find((block) => block.id === activeId.value),
);
const activeSetCount = computed(() =>
  activeBlock.value
    ? summarizeTemplateBlocks([activeBlock.value], []).setCount
    : 0,
);
function selectExercise(exercise: { id: string; name: string }) {
  if (activeBlock.value) selectRoutineExercise(activeBlock.value, exercise);
}
function addBlock() {
  if (blocks.value.length >= 7) return;
  const block = {
    id: crypto.randomUUID(),
    name: `Bloque ${blocks.value.length + 1}`,
    exercises: [],
  };
  blocks.value = [...blocks.value, block];
  activeId.value = block.id;
}
function removeBlock(id: string) {
  if (blocks.value.length <= 1) return;
  blocks.value = blocks.value.filter((block) => block.id !== id);
  activeId.value = blocks.value[0]!.id;
}
function move(index: number, delta: number) {
  const list = activeBlock.value?.exercises;
  if (!list || index + delta < 0 || index + delta >= list.length) return;
  const [exercise] = list.splice(index, 1);
  if (exercise) list.splice(index + delta, 0, exercise);
}
</script>
<template>
  <section
    class="builder"
    :class="{ 'builder-review': review }"
    :aria-labelledby="uid + '-builder'"
  >
    <h3 :id="uid + '-builder'">
      {{ review ? "Edita tus sesiones" : "Ejercicios y objetivos" }}
    </h3>
    <p v-if="!review" class="field-hint">
      Configura cada bloque una vez. Después podrás usarlo en varios días; cada
      copia será independiente.
    </p>
    <div class="builder-tabs" role="group" aria-label="Bloques">
      <button
        v-for="block in blocks"
        :key="block.id"
        type="button"
        class="block-tab"
        :class="{ selected: block.id === activeId }"
        :aria-pressed="block.id === activeId"
        :disabled="disabled"
        @click="activeId = block.id"
      >
        {{ block.name || "Sin nombre" }}
        <span>{{ block.exercises.length }}</span>
      </button>
      <button
        type="button"
        class="text-button"
        v-if="allowBlockChanges"
        :disabled="disabled || blocks.length >= 7"
        @click="addBlock"
      >
        + Añadir bloque
      </button>
    </div>
    <template v-if="activeBlock">
      <div class="block-heading">
        <div>
          <label class="field-label" :for="uid + '-block'"
            >Nombre del bloque</label
          ><input
            :id="uid + '-block'"
            v-model="activeBlock.name"
            class="form-control"
            maxlength="160"
            required
            :disabled="disabled"
          />
        </div>
        <button
          v-if="allowBlockChanges && blocks.length > 1"
          type="button"
          class="text-button"
          :disabled="disabled"
          @click="removeBlock(activeBlock.id)"
        >
          Quitar bloque
        </button>
      </div>
      <div v-if="blocks.length > 1" class="copy-day-controls">
        <label :for="uid + '-copy-day'"
          >Copiar desde otra sesión
          <select
            :id="uid + '-copy-day'"
            v-model="copySourceId"
            class="form-control"
            :disabled="disabled"
          >
            <option value="">Elige una sesión</option>
            <option
              v-for="source in blocks.filter((block) => block.id !== activeId)"
              :key="source.id"
              :value="source.id"
            >
              {{ source.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="text-button"
          :disabled="disabled || !copySourceId"
          @click="copyDay"
        >
          Copiar sesión
        </button>
        <p class="field-hint">
          Reemplaza los ejercicios de esta sesión y conserva el orden, las
          series, las repeticiones y las cargas de la elegida. Cada copia se
          edita por separado.
        </p>
        <p v-if="copyFeedback" role="status" class="field-hint">
          {{ copyFeedback }}
        </p>
      </div>
      <div class="builder-columns">
        <section
          class="builder-targets"
          aria-label="Objetivos de los ejercicios seleccionados"
        >
          <h4>
            {{ activeBlock.exercises.length }} ejercicios ·
            {{ activeSetCount }} series
          </h4>
          <p v-if="!review && activeBlock.exercises.length" class="field-hint">
            Indica tus series y repeticiones. La carga es opcional; podrás
            definirla al entrenar.
          </p>
          <p v-if="!activeBlock.exercises.length" class="builder-empty">
            Selecciona varios ejercicios del catálogo para este bloque.
          </p>
          <fieldset
            v-for="(exercise, index) in activeBlock.exercises"
            :key="exercise.exerciseId"
            class="exercise-targets"
            :disabled="disabled"
          >
            <legend>{{ index + 1 }}. {{ exercise.name }}</legend>
            <div class="target-grid">
              <label
                >Series<input
                  v-model="exercise.targetSets"
                  class="form-control"
                  inputmode="numeric"
                  type="text"
                  required
                  maxlength="4"
              /></label>
              <label
                >Reps mín.<input
                  v-model="exercise.targetRepsMin"
                  class="form-control"
                  inputmode="numeric"
                  type="text"
                  required
                  maxlength="5"
              /></label>
              <label
                >Reps máx.<input
                  v-model="exercise.targetRepsMax"
                  class="form-control"
                  inputmode="numeric"
                  type="text"
                  required
                  maxlength="5"
              /></label>
            </div>
            <div class="load-grid">
              <label
                >Carga opcional<input
                  v-model="exercise.targetLoad"
                  class="form-control"
                  inputmode="decimal"
                  type="text"
                  maxlength="9"
                  placeholder="Sin definir" /></label
              ><label
                >Unidad<select
                  v-model="exercise.targetLoadUnit"
                  class="form-control"
                >
                  <option value="">Sin definir</option>
                  <option value="KG">kg</option>
                  <option value="LB">lb</option>
                </select></label
              >
            </div>
            <div class="exercise-actions">
              <button
                type="button"
                class="text-button"
                :disabled="index === 0"
                :aria-label="'Subir ' + exercise.name"
                @click="move(index, -1)"
              >
                Subir</button
              ><button
                type="button"
                class="text-button"
                :disabled="index === activeBlock.exercises.length - 1"
                :aria-label="'Bajar ' + exercise.name"
                @click="move(index, 1)"
              >
                Bajar</button
              ><button
                type="button"
                class="text-button"
                :aria-label="'Quitar ' + exercise.name"
                @click="
                  selectRoutineExercise(activeBlock, {
                    id: exercise.exerciseId,
                    name: exercise.name,
                  })
                "
              >
                Quitar
              </button>
            </div>
          </fieldset>
        </section>
        <section
          class="builder-catalog"
          aria-label="Añadir ejercicios del catálogo"
        >
          <h4>Añadir ejercicios</h4>
          <ExercisePicker
            :key="activeBlock.id"
            model-value=""
            :disabled="disabled"
            :selected-ids="
              activeBlock.exercises.map((value) => value.exerciseId)
            "
            :context-muscle-groups="activeBlock.muscleGroups"
            @selected="selectExercise"
          />
        </section>
      </div>
    </template>
  </section>
</template>
<style scoped>
.builder {
  min-width: 0;
  margin-block-start: var(--space-6);
}
.builder > h3 {
  font-size: 1.25rem;
  margin-block: 0 var(--space-2);
}
.copy-day-controls {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: end;
  margin: 1rem 0;
}
.copy-day-controls > label {
  flex: 1;
  min-width: min(12rem, 100%);
  font-size: 0.8rem;
}
.copy-day-controls > p {
  flex-basis: 100%;
  margin: 0;
}
.catalog-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.catalog-heading .text-button {
  font-size: 0.75rem;
  min-height: 44px;
  padding-top: 0;
}
.builder-tabs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
.block-tab {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  padding: 0.65rem 0.9rem;
  border-radius: var(--radius-control);
  min-height: var(--target-size, 48px);
  overflow-wrap: anywhere;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast);
}
.block-tab.selected {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-accent-surface);
}
.block-tab span {
  font-size: 0.8rem;
  margin-left: 0.5rem;
}
.block-heading {
  display: flex;
  align-items: end;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.block-heading > div {
  flex: 1;
  min-width: 0;
}
.builder-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}
.builder-columns h4 {
  font-size: 1rem;
  margin: 0 0 0.75rem;
}
.builder-columns > section {
  min-width: 0;
}
.builder-review .builder-columns {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}
.catalog-filters,
.load-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
  margin: 0.75rem 0;
}
.catalog-filters label,
.target-grid label,
.load-grid label {
  font-size: 0.8rem;
  display: block;
  color: var(--color-text-secondary);
}
.catalog-option {
  display: flex;
  gap: 0.65rem;
  padding: 0.85rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  align-items: start;
  cursor: pointer;
  min-height: 52px;
}
.catalog-option input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  accent-color: var(--color-primary);
}
.catalog-option strong {
  font-size: 0.875rem;
  display: block;
  font-weight: 500;
}
.catalog-option small {
  display: block;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  margin-top: 0.25rem;
}
.catalog-options {
  max-height: 30rem;
  overflow: auto;
}
.catalog-pagination,
.exercise-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.catalog-pagination span {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
.exercise-targets {
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface-subtle);
  margin: 1rem 0;
}
.exercise-targets legend {
  max-width: 100%;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0 0.25rem;
  overflow-wrap: anywhere;
}
.target-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}
.builder-empty {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-control);
  padding: 1.5rem;
  color: var(--color-text-secondary);
}
.exercise-actions .text-button {
  font-size: 0.75rem;
  min-height: var(--target-size, 48px);
  padding-inline: 0.5rem;
}
.builder :is(.text-button, .form-control) {
  min-height: var(--target-size, 48px);
}
.form-control {
  width: 100%;
  min-width: 0;
}
.builder :is(button, input, select):focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
@media (max-width: 720px) {
  .builder-columns,
  .builder-review .builder-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .catalog-options {
    max-height: 18rem;
  }
  .block-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 0.5rem;
  }
  .block-heading > .text-button {
    align-self: start;
  }
  .exercise-targets {
    padding: 0.75rem;
  }
  .exercise-actions {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .block-tab {
    transition: none;
  }
}
</style>
