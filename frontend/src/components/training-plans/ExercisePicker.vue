<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useExercisesCatalog } from '../../composables/useExercisesCatalog'
import type { ExerciseScope } from '../../services/exercises.service'
defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const search = ref('')
const selectedScope = ref<ExerciseScope>('global')
const selectedName = ref('')
const { exercises, loading, errorMessage, offset, total, pageSize, load, retry, nextPage, previousPage, dispose } = useExercisesCatalog()
let timer: ReturnType<typeof setTimeout> | undefined
function request() { return load(search.value.trim() ? { search: search.value.trim() } : {}, selectedScope.value, 0) }
watch([search, selectedScope], () => {
  emit('update:modelValue', '')
  selectedName.value = ''
  clearTimeout(timer)
  timer = setTimeout(() => void request(), 250)
})
onMounted(() => void request())
onUnmounted(() => { clearTimeout(timer); dispose() })
</script>

<template>
  <fieldset class="exercise-picker" :disabled="disabled">
    <legend>Selecciona un ejercicio del catálogo</legend>
    <div class="plan-form-grid">
      <div><label class="field-label" :for="id + '-scope'">Origen</label><select :id="id + '-scope'" v-model="selectedScope" class="form-control"><option value="global">Catálogo PULSO</option><option value="mine">Mis ejercicios</option></select></div>
      <div><label class="field-label" :for="id + '-search'">Buscar</label><input :id="id + '-search'" v-model="search" class="form-control" type="search" maxlength="100" placeholder="Nombre o descripción"></div>
    </div>
    <p v-if="selectedName" role="status">Seleccionado: {{ selectedName }}</p>
    <p v-if="loading" class="state-message" role="status">Cargando ejercicios…</p>
    <div v-else-if="errorMessage" class="state-card state-card--error" role="alert"><p>{{ errorMessage }}</p><button type="button" class="secondary-button" @click="retry">Reintentar</button></div>
    <p v-else-if="!exercises.length" class="state-message">No hay ejercicios disponibles con estos criterios.</p>
    <template v-else>
      <ul class="picker-results">
        <li v-for="exercise in exercises" :key="exercise.id"><label><input type="radio" :name="id + '-exercise'" :value="exercise.id" :checked="modelValue === exercise.id" @change="emit('update:modelValue', exercise.id); selectedName = exercise.name"><span><strong>{{ exercise.name }}</strong><small>{{ exercise.primaryMuscleGroup.name }} · {{ exercise.equipment }}</small></span></label></li>
      </ul>
      <nav v-if="total > pageSize" class="plan-actions" aria-label="Páginas del selector de ejercicios"><button class="secondary-button" type="button" :disabled="offset === 0" @click="previousPage">Anterior</button><span>{{ offset + 1 }}–{{ Math.min(offset + exercises.length, total) }} de {{ total }}</span><button class="secondary-button" type="button" :disabled="offset + exercises.length >= total" @click="nextPage">Siguiente</button></nav>
    </template>
  </fieldset>
</template>
