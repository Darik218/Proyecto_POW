<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { useExercisesCatalog } from "../../composables/useExercisesCatalog";
import {
  exercisesService,
  exerciseEnums,
  exerciseEnumLabel,
  type MuscleGroup,
  type ListExercisesQuery,
} from "../../services/exercises.service";
import {
  selectRoutineExercise,
  type RoutineBlock,
} from "../../utils/routine-builder";
import PersonalExerciseForm from "./PersonalExerciseForm.vue";

const blocks = defineModel<RoutineBlock[]>("blocks", { required: true });
defineProps<{ disabled?: boolean }>();
const uid = useId();
const activeId = ref(blocks.value[0]?.id ?? "");
const activeBlock = computed(() =>
  blocks.value.find((block) => block.id === activeId.value),
);
const search = ref(""),
  group = ref(""),
  equipment = ref<ListExercisesQuery["equipmentType"]>();
const groups = ref<MuscleGroup[]>([]);
const creating = ref(false);
const catalog = useExercisesCatalog();
const { exercises, loading, errorMessage, offset, total, pageSize } = catalog;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
function request() {
  return catalog.load(
    {
      selection: "ALL",
      ...(search.value.trim() ? { search: search.value.trim() } : {}),
      ...(group.value ? { primaryMuscleGroupKey: group.value } : {}),
      ...(equipment.value ? { equipmentType: equipment.value } : {}),
    },
    "visible",
  );
}
watch([search, group, equipment], () => {
  catalog.invalidate();
  clearTimeout(timer);
  timer = setTimeout(request, 250);
});
onMounted(() => {
  void request();
  void exercisesService
    .listMuscleGroups()
    .then((value) => {
      if (!disposed) groups.value = value;
    })
    .catch(() => {
      /* The unfiltered catalog and search remain available. */
    });
});
onUnmounted(() => {
  disposed = true;
  clearTimeout(timer);
  catalog.dispose();
});
function cancelPrivateExercise() {
  creating.value = false;
}
async function created(exercise: { id: string; name: string }) {
  const block = activeBlock.value;
  if (disposed || !block) return;
  if (!block.exercises.some((value) => value.exerciseId === exercise.id))
    selectRoutineExercise(block, exercise);
  creating.value = false;
  await catalog.refresh();
}
function preventPrivateSubmit(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches("input:not([type=checkbox])"))
    event.preventDefault();
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
  <section class="builder" aria-label="Configurar bloques de entrenamiento">
    <p class="field-hint">
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
          v-if="blocks.length > 1"
          type="button"
          class="text-button"
          :disabled="disabled"
          @click="removeBlock(activeBlock.id)"
        >
          Quitar bloque
        </button>
      </div>
      <div class="builder-columns">
        <section
          class="builder-catalog"
          aria-label="Seleccionar ejercicios del catálogo"
        >
          <div class="catalog-heading">
            <h3>Elige tus ejercicios</h3>
            <button
              type="button"
              class="text-button"
              :disabled="disabled"
              :aria-expanded="creating"
              :aria-controls="uid + '-private'"
              @click="creating = !creating"
            >
              {{ creating ? "Volver al catálogo" : "Crear ejercicio privado" }}
            </button>
          </div>
          <div
            v-if="creating"
            :id="uid + '-private'"
            @keydown.enter="preventPrivateSubmit"
          >
            <PersonalExerciseForm
              @created="created"
              @cancel="cancelPrivateExercise"
            />
          </div>
          <template v-else>
            <label class="field-label" :for="uid + '-search'"
              >Buscar en el catálogo y mis ejercicios</label
            >
            <input
              :id="uid + '-search'"
              v-model="search"
              class="form-control"
              type="search"
              maxlength="100"
              placeholder="Nombre o alias…"
              :disabled="disabled"
              @keydown.enter.prevent="request()"
            />
            <div class="catalog-filters">
              <div>
                <label :for="uid + '-muscle'">Músculo</label
                ><select
                  :id="uid + '-muscle'"
                  v-model="group"
                  class="form-control"
                  :disabled="disabled"
                >
                  <option value="">Todos</option>
                  <option
                    v-for="muscle in groups"
                    :key="muscle.key"
                    :value="muscle.key"
                  >
                    {{ muscle.name }}
                  </option>
                </select>
              </div>
              <div>
                <label :for="uid + '-equipment'">Equipo</label
                ><select
                  :id="uid + '-equipment'"
                  v-model="equipment"
                  class="form-control"
                  :disabled="disabled"
                >
                  <option :value="undefined">Todos</option>
                  <option
                    v-for="value in exerciseEnums.equipmentType"
                    :key="value"
                    :value="value"
                  >
                    {{ exerciseEnumLabel(value) }}
                  </option>
                </select>
              </div>
            </div>
            <p v-if="loading" role="status">Cargando ejercicios…</p>
            <div v-else-if="errorMessage" role="alert">
              <p class="form-error">{{ errorMessage }}</p>
              <button
                type="button"
                class="text-button"
                @click="catalog.retry()"
              >
                Reintentar catálogo
              </button>
            </div>
            <template v-else>
              <p v-if="!exercises.length" class="field-hint">
                No hay ejercicios con estos filtros. Prueba otro nombre o
                equipo.
              </p>
              <div class="catalog-options">
                <label
                  v-for="exercise in exercises"
                  :key="exercise.id"
                  class="catalog-option"
                >
                  <input
                    type="checkbox"
                    :checked="
                      activeBlock.exercises.some(
                        (item) => item.exerciseId === exercise.id,
                      )
                    "
                    :disabled="disabled"
                    @change="selectRoutineExercise(activeBlock, exercise)"
                  />
                  <span
                    ><strong>{{ exercise.name }}</strong
                    ><small
                      >{{ exercise.primaryMuscleGroup.name }} ·
                      {{ exercise.equipment
                      }}{{
                        exercise.origin === "PERSONAL" ? " · Propio" : ""
                      }}</small
                    ></span
                  >
                </label>
              </div>
              <div v-if="total > pageSize" class="catalog-pagination">
                <button
                  type="button"
                  class="text-button"
                  :disabled="disabled || offset === 0"
                  @click="catalog.previousPage()"
                >
                  Anterior</button
                ><span
                  >{{ offset + 1 }}–{{ Math.min(offset + pageSize, total) }} de
                  {{ total }}</span
                ><button
                  type="button"
                  class="text-button"
                  :disabled="disabled || offset + pageSize >= total"
                  @click="catalog.nextPage()"
                >
                  Siguiente
                </button>
              </div>
            </template>
          </template>
        </section>
        <section
          class="builder-targets"
          aria-label="Objetivos de los ejercicios seleccionados"
        >
          <h3>{{ activeBlock.exercises.length }} ejercicios seleccionados</h3>
          <p class="field-hint">
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
      </div>
    </template>
  </section>
</template>
<style scoped>
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
  min-height: 44px;
}
.block-tab.selected {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-surface-elevated);
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
}
.builder-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}
.builder-columns h3 {
  font-size: 1rem;
  margin: 0 0 0.75rem;
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
  border-radius: var(--radius-control);
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
  min-height: 44px;
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
  .builder-columns {
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
}
</style>
