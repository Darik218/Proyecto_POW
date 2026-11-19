<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { RouterLink } from "vue-router";
import { useExercisesCatalog } from "../../composables/useExercisesCatalog";
import {
  exercisesService,
  exerciseEnums,
  exerciseEnumLabel,
  exerciseErrorMessage,
  type Exercise,
  type ExerciseScope,
  type ListExercisesQuery,
  type MuscleGroup,
} from "../../services/exercises.service";
import PersonalExerciseForm from "./PersonalExerciseForm.vue";
import { useAuthStore } from "../../stores/auth.store";
const auth = useAuthStore();
const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
  initialSelection?: "FEATURED" | "RECENT" | "ALL";
  contextMuscleGroups?: string[];
  selectedIds?: string[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  selected: [exercise: Exercise];
}>();
const id = useId(),
  search = ref(""),
  selectedScope = ref<ExerciseScope>("visible"),
  selectedName = ref(""),
  selection = ref<"ALL" | "FEATURED" | "RECENT" | "FREQUENT">(
    props.initialSelection ?? "FEATURED",
  ),
  group = ref(props.contextMuscleGroups?.[0] ?? ""),
  equipment = ref<ListExercisesQuery["equipmentType"]>(),
  groups = ref<MuscleGroup[]>([]),
  groupsError = ref(""),
  creating = ref(false);
const {
  exercises,
  loading,
  errorMessage,
  offset,
  total,
  pageSize,
  load,
  retry,
  nextPage,
  previousPage,
  invalidate,
  dispose,
} = useExercisesCatalog();
const tabs = [
  { key: "RECENT", label: "Recientes" },
  { key: "FREQUENT", label: "Habituales" },
  { key: "FEATURED", label: "Destacados" },
  { key: "ALL", label: "Todos" },
] as const;
const contextGroups = computed(() =>
  groups.value.filter((item) => props.contextMuscleGroups?.includes(item.key)),
);
watch(
  () => props.contextMuscleGroups,
  (value) => {
    group.value = value?.[0] ?? "";
  },
);
function preventImplicitSubmit(event: KeyboardEvent) {
  if (
    (event.target as HTMLElement).matches(
      "input:not([type=checkbox]):not([type=radio])",
    )
  )
    event.preventDefault();
}
function select(exercise: Exercise) {
  emit("selected", exercise);
  emit("update:modelValue", exercise.id);
  selectedName.value = exercise.name;
}
let timer: ReturnType<typeof setTimeout> | undefined;
function request() {
  const recent =
    !search.value.trim() && ["RECENT", "FREQUENT"].includes(selection.value);
  return load(
    {
      ...(recent && selectedScope.value !== "visible"
        ? {
            origin:
              selectedScope.value === "global"
                ? ("GLOBAL" as const)
                : ("PERSONAL" as const),
          }
        : {}),
      ...(search.value.trim()
        ? { search: search.value.trim() }
        : { selection: selection.value }),
      ...(group.value ? { primaryMuscleGroupKey: group.value } : {}),
      ...(equipment.value ? { equipmentType: equipment.value } : {}),
    },
    recent ? "visible" : selectedScope.value,
    0,
  );
}
watch([search, selectedScope, selection, group, equipment], () => {
  invalidate();
  loading.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => void request(), search.value ? 250 : 0);
});
async function loadGroups() {
  try {
    groups.value = await exercisesService.listMuscleGroups();
    groupsError.value = "";
  } catch (cause) {
    groupsError.value = exerciseErrorMessage(
      cause,
      "No se pudieron cargar los filtros.",
    );
  }
}
function created(exercise: Exercise) {
  creating.value = false;
  selectedScope.value = "mine";
  selection.value = "ALL";
  search.value = exercise.name;
  emit("update:modelValue", exercise.id);
  selectedName.value = exercise.name;
  emit("selected", exercise);
}
watch(
  () =>
    [auth.user?.id, auth.isAuthenticated, auth.getSessionGeneration()].join(
      ":",
    ),
  () => {
    clearTimeout(timer);
    invalidate();
    exercises.value = [];
    total.value = 0;
    offset.value = 0;
    selectedName.value = "";
    creating.value = false;
    emit("update:modelValue", "");
    if (auth.isAuthenticated) void request();
  },
  { flush: "sync" },
);
onMounted(() => {
  void request();
  void loadGroups();
});
onUnmounted(() => {
  clearTimeout(timer);
  dispose();
});
</script>
<template>
  <fieldset
    class="exercise-picker"
    :disabled="disabled"
    @keydown.enter="preventImplicitSubmit"
  >
    <legend>Añadir ejercicio</legend>
    <label class="field-label" :for="id + '-search'"
      >Busca por nombre, alias o abreviatura</label
    ><input
      :id="id + '-search'"
      v-model="search"
      class="form-control"
      type="search"
      maxlength="100"
      placeholder="Press banca, RDL, remo mancu…"
      @keydown.enter.prevent="request()"
    />
    <div
      v-if="contextMuscleGroups?.length"
      class="routine-tabs"
      aria-label="Para este día"
    >
      <span>Para este día:</span>
      <button
        v-for="item in contextGroups"
        :key="item.key"
        type="button"
        class="text-button"
        :aria-pressed="group === item.key"
        @click="group = item.key"
      >
        {{ item.name }}
      </button>
      <p v-if="!contextGroups.length" class="field-hint">
        Los filtros de este día se basan en los grupos musculares del catálogo.
      </p>
    </div>
    <div v-if="!search.trim()" class="routine-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="text-button"
        type="button"
        :aria-pressed="selection === tab.key"
        @click="selection = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>
    <p v-if="!search && selection === 'FEATURED'" class="field-hint">
      Selección editorial de PULSO; no representa popularidad.
    </p>
    <p v-if="!search && selection === 'RECENT'" class="field-hint">
      Ejercicios con series realmente registradas en tus entrenamientos.
    </p>
    <p v-if="!search.trim() && selection === 'FREQUENT'" class="field-hint">
      Ordenados por tus entrenamientos con resultados registrados, no por el
      número de series.
    </p>
    <details>
      <summary>Filtrar ejercicios</summary>
      <label :for="id + 'scope'">Origen</label
      ><select :id="id + 'scope'" v-model="selectedScope" class="form-control">
        <option value="visible">PULSO y mis ejercicios</option>
        <option value="global">Solo PULSO</option>
        <option value="mine">Mis ejercicios</option></select
      ><label :for="id + 'group'">Grupo muscular</label
      ><select :id="id + 'group'" v-model="group" class="form-control">
        <option value="">Todos</option>
        <option v-for="item in groups" :key="item.key" :value="item.key">
          {{ item.name }}
        </option></select
      ><label :for="id + 'equipment'">Equipamiento</label
      ><select :id="id + 'equipment'" v-model="equipment" class="form-control">
        <option :value="undefined">Todos</option>
        <option
          v-for="value in exerciseEnums.equipmentType"
          :key="value"
          :value="value"
        >
          {{ exerciseEnumLabel(value) }}
        </option>
      </select>
      <p v-if="groupsError" role="alert">
        {{ groupsError }}
        <button class="text-button" type="button" @click="loadGroups">
          Reintentar
        </button>
      </p>
    </details>
    <p v-if="selectedName && !selectedIds" role="status">
      Seleccionado: {{ selectedName }}
    </p>
    <p v-if="loading" class="state-message" role="status">
      Cargando ejercicios…
    </p>
    <div
      v-else-if="errorMessage"
      class="state-card state-card--error"
      role="alert"
    >
      <p>{{ errorMessage }}</p>
      <button type="button" class="secondary-button" @click="retry">
        Reintentar
      </button>
    </div>
    <div v-else-if="!exercises.length" class="state-message">
      <p>
        {{
          !search.trim() && ["RECENT", "FREQUENT"].includes(selection)
            ? "Todavía no tienes ejercicios registrados con estos filtros."
            : "No hay ejercicios con estos criterios."
        }}
      </p>
      <button
        class="secondary-button"
        type="button"
        @click="
          search = '';
          selection = 'ALL';
        "
      >
        Buscar en todos los ejercicios
      </button>
    </div>
    <template v-else
      ><ul class="picker-results">
        <li v-for="exercise in exercises" :key="exercise.id">
          <label
            ><input
              :type="selectedIds ? 'checkbox' : 'radio'"
              :name="id + '-exercise'"
              :value="exercise.id"
              :checked="
                selectedIds
                  ? selectedIds.includes(exercise.id)
                  : modelValue === exercise.id
              "
              @change="select(exercise)"
            /><span
              ><strong>{{ exercise.name }}</strong
              ><small
                >{{ exercise.primaryMuscleGroup.name }} ·
                {{ exercise.equipment }} ·
                {{ exercise.origin === "GLOBAL" ? "PULSO" : "Propio" }}</small
              ></span
            ></label
          >
        </li>
      </ul>
      <nav
        v-if="total > pageSize"
        class="plan-actions"
        aria-label="Páginas del selector de ejercicios"
      >
        <button
          class="secondary-button"
          type="button"
          :disabled="loading || offset === 0"
          @click="previousPage"
        >
          Anterior</button
        ><span
          >{{ offset + 1 }}–{{ Math.min(offset + exercises.length, total) }} de
          {{ total }}</span
        ><button
          class="secondary-button"
          type="button"
          :disabled="loading || offset + exercises.length >= total"
          @click="nextPage"
        >
          Siguiente
        </button>
      </nav></template
    >
    <div class="plan-actions">
      <button class="text-button" type="button" @click="creating = !creating">
        Crear ejercicio privado</button
      ><RouterLink :to="{ name: 'exercise-catalog' }"
        >Explorar catálogo completo</RouterLink
      >
    </div>
    <PersonalExerciseForm
      v-if="creating"
      @created="created"
      @cancel="creating = false"
    />
  </fieldset>
</template>
