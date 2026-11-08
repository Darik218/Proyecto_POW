<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useExercisesCatalog } from '../../composables/useExercisesCatalog'
import {
  exercisesService,
  exerciseEnums,
  exerciseEnumLabel,
  exerciseErrorMessage,
  type Exercise,
  type ExerciseScope,
  type ListExercisesQuery,
  type MuscleGroup,
} from '../../services/exercises.service'
import PersonalExerciseForm from './PersonalExerciseForm.vue'
defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId(),
  search = ref(''),
  selectedScope = ref<ExerciseScope>('visible'),
  selectedName = ref(''),
  selection = ref<'ALL' | 'FEATURED' | 'RECENT'>('FEATURED'),
  group = ref(''),
  equipment = ref<ListExercisesQuery['equipmentType']>(),
  groups = ref<MuscleGroup[]>([]),
  groupsError = ref(''),
  creating = ref(false)
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
} = useExercisesCatalog()
const tabs=[{key:'FEATURED',label:'Destacados'},{key:'RECENT',label:'Usados recientemente'},{key:'ALL',label:'Todos'}] as const
function select(exercise:Exercise){emit('update:modelValue',exercise.id);selectedName.value=exercise.name}
let timer: ReturnType<typeof setTimeout> | undefined
function request() {
  const recent = !search.value.trim() && selection.value === 'RECENT'
  return load(
    {
      ...(recent && selectedScope.value !== 'visible'
        ? { origin: selectedScope.value === 'global' ? ('GLOBAL' as const) : ('PERSONAL' as const) }
        : {}),
      ...(search.value.trim() ? { search: search.value.trim() } : { selection: selection.value }),
      ...(group.value ? { primaryMuscleGroupKey: group.value } : {}),
      ...(equipment.value ? { equipmentType: equipment.value } : {}),
    },
    recent ? 'visible' : selectedScope.value,
    0,
  )
}
watch([search, selectedScope, selection, group, equipment], () => {
  invalidate()
  loading.value=true
  clearTimeout(timer)
  timer = setTimeout(() => void request(), search.value ? 250 : 0)
})
async function loadGroups() {
  try {
    groups.value = await exercisesService.listMuscleGroups()
    groupsError.value = ''
  } catch (cause) {
    groupsError.value = exerciseErrorMessage(cause, 'No se pudieron cargar los filtros.')
  }
}
function created(exercise: Exercise) {
  creating.value = false
  selectedScope.value = 'mine'
  selection.value = 'ALL'
  search.value = exercise.name
  emit('update:modelValue', exercise.id)
  selectedName.value = exercise.name
}
onMounted(() => {
  void request()
  void loadGroups()
})
onUnmounted(() => {
  clearTimeout(timer)
  dispose()
})
</script>
<template>
  <fieldset class="exercise-picker" :disabled="disabled">
    <legend>Añadir ejercicio</legend>
    <label class="field-label" :for="id + '-search'">Busca por nombre, alias o abreviatura</label
    ><input
      :id="id + '-search'"
      v-model="search"
      class="form-control"
      type="search"
      maxlength="100"
      placeholder="Press banca, RDL, remo mancu…"
    />
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
        <option v-for="value in exerciseEnums.equipmentType" :key="value" :value="value">
          {{ exerciseEnumLabel(value) }}
        </option>
      </select>
      <p v-if="groupsError" role="alert">
        {{ groupsError }}
        <button class="text-button" type="button" @click="loadGroups">Reintentar</button>
      </p>
    </details>
    <p v-if="selectedName" role="status">Seleccionado: {{ selectedName }}</p>
    <p v-if="loading" class="state-message" role="status">Cargando ejercicios…</p>
    <div v-else-if="errorMessage" class="state-card state-card--error" role="alert">
      <p>{{ errorMessage }}</p>
      <button type="button" class="secondary-button" @click="retry">Reintentar</button>
    </div>
    <p v-else-if="!exercises.length" class="state-message">
      No hay ejercicios con estos criterios. Prueba «Todos» o crea uno propio.
    </p>
    <template v-else
      ><ul class="picker-results">
        <li v-for="exercise in exercises" :key="exercise.id">
          <label
            ><input
              type="radio"
              :name="id + '-exercise'"
              :value="exercise.id"
              :checked="modelValue === exercise.id"
              @change="select(exercise)"
            /><span
              ><strong>{{ exercise.name }}</strong
              ><small
                >{{ exercise.primaryMuscleGroup.name }} · {{ exercise.equipment }} ·
                {{ exercise.origin === 'GLOBAL' ? 'PULSO' : 'Propio' }}</small
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
          >{{ offset + 1 }}–{{ Math.min(offset + exercises.length, total) }} de {{ total }}</span
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
      ><RouterLink :to="{ name: 'exercise-catalog' }">Explorar catálogo completo</RouterLink>
    </div>
    <PersonalExerciseForm v-if="creating" @created="created" @cancel="creating = false" />
  </fieldset>
</template>
