<script setup lang="ts">
import { computed, ref } from 'vue'
import WorkoutTargetsForm from './WorkoutTargetsForm.vue'
import WorkoutSetForm from './WorkoutSetForm.vue'
import { setStatusLabel, workoutErrorMessage, type Workout, type SetInput, type SetRecord } from '../../services/workout-sessions.service'
import type { useWorkoutSession } from '../../composables/useWorkoutSessions'
const props = defineProps<{ item: Workout['exercises'][number]; status: Workout['status']; busy: boolean; index: number; count: number; actions: ReturnType<typeof useWorkoutSession> }>()
const editing = ref(false)
const addingSet = ref(false)
const editingSet = ref('')
const error = ref('')
const editable = computed(() => ['PLANNED','IN_PROGRESS'].includes(props.status))
const workCompleted = computed(() => props.item.sets?.filter(set => set.kind === 'WORK' && set.status === 'COMPLETED').length ?? 0)
const remaining = computed(() => props.item.targets?.targetSets == null ? null : Math.max(0, props.item.targets.targetSets - workCompleted.value))
function reps(value: { targetRepsMin: number | null; targetRepsMax: number | null }) { return value.targetRepsMin === null ? 'Sin especificar' : value.targetRepsMin === value.targetRepsMax ? String(value.targetRepsMin) : `${value.targetRepsMin}–${value.targetRepsMax}` }
async function run(operation: () => Promise<unknown>) { if (props.busy) return; error.value = ''; try { await operation() } catch (cause) { error.value = workoutErrorMessage(cause, 'No se pudo actualizar el ejercicio.') } }
function move(direction: number) {
  const ids = props.actions.session.value?.exercises.map(item => item.id) ?? []
  const from = ids.indexOf(props.item.id); const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return
  ;[ids[from],ids[to]] = [ids[to]!,ids[from]!]
  return run(() => props.actions.reorder(ids))
}
function saveSet(input: SetInput, creationId: string, existing?: SetRecord) { return props.actions.recordSet(props.item.id, input, existing?.id, existing?.version, creationId) }
</script>
<template>
  <article class="workout-exercise-card" :class="{ 'workout-exercise-card--omitted': item.isOmitted }">
    <header class="plan-section-heading"><h3>{{ item.orderInSession }}. {{ item.exercise.name }}</h3><span v-if="item.isOmitted" class="plan-status">Ejercicio omitido</span></header><p class="field-hint">{{ item.exercise.muscleGroup }} · {{ item.exercise.equipment }}</p><p v-if="item.replacesWorkoutExerciseId" class="field-hint">Sustitución vinculada al ejercicio omitido de esta sesión.</p>
    <details v-if="item.original"><summary>Objetivos originales al preparar la sesión</summary><p>{{ item.original.targets.targetSets ?? 'Sin objetivo de' }} series · {{ reps(item.original.targets) }} repeticiones · {{ item.original.targets.targetLoad ?? 'Sin carga' }} {{ item.original.targets.targetLoad !== null ? item.original.targets.targetLoadUnit ?? '(unidad desconocida)' : '' }} · RPE {{ item.original.targets.targetRpe ?? 'sin especificar' }}</p><p v-if="item.original.notes">{{ item.original.notes }}</p></details><p v-else class="field-hint">Sesión histórica sin captura original verificable. No se han reconstruido objetivos.</p>
    <dl v-if="item.targets" class="prescription-values"><div><dt>Series objetivo ajustadas</dt><dd>{{ item.targets.targetSets ?? 'Sin especificar' }}</dd></div><div><dt>Repeticiones objetivo</dt><dd>{{ reps(item.targets) }}</dd></div><div><dt>Carga objetivo</dt><dd>{{ item.targets.targetLoad ?? 'Sin especificar' }} {{ item.targets.targetLoad !== null ? item.targets.targetLoadUnit ?? '(unidad desconocida)' : '' }}</dd></div><div><dt>RPE objetivo</dt><dd>{{ item.targets.targetRpe ?? 'Sin especificar' }}</dd></div></dl><p v-if="item.notes">{{ item.notes }}</p>
    <div v-if="editable" class="plan-actions"><button class="text-button" type="button" :disabled="busy" @click="editing = !editing">Ajustar objetivos</button><button class="text-button" type="button" :disabled="busy" @click="run(() => actions.updateExercise(item.id, { isOmitted: !item.isOmitted }))">{{ item.isOmitted ? 'Restaurar ejercicio' : 'Omitir ejercicio' }}</button><button class="text-button" type="button" :disabled="busy || index === 0" :aria-label="'Subir '+item.exercise.name" @click="move(-1)">↑ Subir</button><button class="text-button" type="button" :disabled="busy || index === count-1" :aria-label="'Bajar '+item.exercise.name" @click="move(1)">↓ Bajar</button></div>
    <WorkoutTargetsForm v-if="editable && editing" :initial="item.targets" :notes="item.notes" :busy="busy" :save="input => actions.updateExercise(item.id, input)" @saved="editing = false" @cancel="editing = false" />
    <h4>Series realizadas</h4><p v-if="!item.isOmitted && remaining !== null" class="field-hint">{{ workCompleted }} series de trabajo completadas · {{ remaining }} del objetivo por completar.</p><p v-if="!item.sets?.length" class="state-message">Sin series registradas. Los objetivos no son resultados.</p>
    <ol v-else class="workout-set-list"><li v-for="set in item.sets" :key="set.id"><div class="plan-section-heading"><h5>Serie {{ set.setNumber }} · {{ set.kind === 'WARMUP' ? 'Calentamiento' : set.kind === 'WORK' ? 'Trabajo' : 'Tipo no registrado' }}</h5><span class="plan-status">{{ setStatusLabel(set) }}</span></div><p v-if="set.load !== null || set.repetitions !== null">{{ set.repetitions ?? 'Sin' }} repeticiones · {{ set.load ?? 'Sin carga' }} {{ set.load !== null ? set.loadUnit ?? '(unidad desconocida)' : '' }}<span v-if="set.rpe !== null"> · RPE {{ set.rpe }}</span></p><p v-else>Sin resultados ejecutados.</p><p v-if="set.notes">{{ set.notes }}</p><button v-if="status === 'IN_PROGRESS' && !item.isOmitted" class="text-button" type="button" :disabled="busy" @click="editingSet = set.id">Editar serie</button><WorkoutSetForm v-if="status === 'IN_PROGRESS' && editingSet === set.id && !item.isOmitted" :key="set.id" :initial="set" :busy="busy" :save="(input, creationId) => saveSet(input, creationId, set)" @saved="editingSet = ''" @cancel="editingSet = ''" /></li></ol>
    <button v-if="status === 'IN_PROGRESS' && !item.isOmitted && !addingSet" class="primary-button" type="button" :disabled="busy" @click="addingSet = true">Registrar serie</button><WorkoutSetForm v-if="status === 'IN_PROGRESS' && !item.isOmitted && addingSet" :busy="busy" :next-number="Math.max(0,...(item.sets ?? []).map(set => set.setNumber))+1" :save="(input, creationId) => saveSet(input, creationId)" @saved="addingSet = false" @cancel="addingSet = false" />
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  </article>
</template>
