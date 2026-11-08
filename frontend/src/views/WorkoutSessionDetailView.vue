<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AddWorkoutExerciseForm from '../components/workouts/AddWorkoutExerciseForm.vue'
import CompleteWorkoutForm from '../components/workouts/CompleteWorkoutForm.vue'
import WorkoutExerciseCard from '../components/workouts/WorkoutExerciseCard.vue'
import WorkoutSessionForm from '../components/workouts/WorkoutSessionForm.vue'
import SaveWorkoutDayForm from '../components/workouts/SaveWorkoutDayForm.vue'
import PlanDaySelector from '../components/workouts/PlanDaySelector.vue'
import { trainingPlansService, type DailyPrescription } from '../services/training-plans.service'
import { useWorkoutSession } from '../composables/useWorkoutSessions'
import { workoutDate, workoutErrorMessage, workoutStatusLabel } from '../services/workout-sessions.service'
import '../assets/training-plans.css'
import '../assets/workouts.css'
const route = useRoute()
const id = computed(() => String(route.params.sessionId ?? ''))
const actions = useWorkoutSession()
const { session, loading, saving, editable, error, notice, load, start, complete, addExercise, dispose } = actions
const backTo=computed(()=>session.value?.trainingPlan&&session.value.planWeek&&session.value.planDay?{name:'routine-day',params:{planId:session.value.trainingPlan.id,weekId:session.value.planWeek.id,dayId:session.value.planDay.id}}:{name:'home'})
const adding = ref(false)
const confirming = ref(false)
const editing = ref(false)
const associating = ref(false)
const exporting = ref(false)
const importing = ref(false)
const cancelling = ref(false)
const selection = ref({ trainingPlanId: '', planWeekId: '', planDayId: '' })
const importId = ref(crypto.randomUUID())
const importPreview = ref<DailyPrescription[]>([])
const importLoading = ref(false)
let importController: AbortController | undefined
let previewVersion = 0
const actionError = ref('')
watch(id, value => { adding.value = false; confirming.value = false; editing.value = false; associating.value = false; exporting.value = false; importing.value = false; cancelling.value = false; actionError.value = ''; void load(value) }, { immediate: true })
async function run(operation: () => Promise<unknown>) { if (saving.value) return; actionError.value = ''; try { await operation() } catch (cause) { actionError.value = workoutErrorMessage(cause, 'No se pudo actualizar el entrenamiento.') } }
async function associate() { await actions.associate(selection.value); associating.value = false; importId.value = crypto.randomUUID(); importing.value = false; importPreview.value = [] }
async function previewImport() {
  if (importing.value) { importing.value = false; return }
  if (!session.value?.trainingPlan || !session.value.planWeek || !session.value.planDay) return
  importing.value = true; importLoading.value = true; importPreview.value = []; actionError.value = ''
  importController?.abort(); importController = new AbortController(); const signal = importController.signal
  const current = ++previewVersion; const sessionId = session.value.id
  try {
    const plan = await trainingPlansService.getPlanning(session.value.trainingPlan.id, signal)
    if (current !== previewVersion || session.value?.id !== sessionId) return
    const ids = new Set(session.value.exercises.map(item => item.original?.source.kind === 'PLAN_DAY' ? item.original.source.id : item.prescription?.id))
    importPreview.value = plan.weeks.find(week => week.id === session.value?.planWeek?.id)?.days.find(day => day.id === session.value?.planDay?.id)?.exercises.filter(item => !ids.has(item.id)) ?? []
  } catch (cause) { if (!signal.aborted && current === previewVersion) actionError.value = workoutErrorMessage(cause, 'No se pudo revisar el día antes de incorporarlo.') }
  finally { if (current === previewVersion) importLoading.value = false }
}
async function importDay() { await actions.importDay(importId.value); importing.value = false; importId.value = crypto.randomUUID() }
function openAssociation() { selection.value = { trainingPlanId: session.value?.trainingPlan?.id ?? '', planWeekId: session.value?.planWeek?.id ?? '', planDayId: session.value?.planDay?.id ?? '' }; associating.value = !associating.value }
onUnmounted(() => { previewVersion++; importController?.abort(); dispose() })
</script>
<template>
  <section class="page-view training-plans workouts" aria-labelledby="workout-title">
    <RouterLink class="back-link" :to="backTo">← Volver a mi rutina</RouterLink><h1 id="workout-title">{{ session?.name ?? session?.sourceSnapshot?.day?.name ?? 'Sesión de entrenamiento' }}</h1>
    <p v-if="loading" class="state-message" role="status">Cargando entrenamiento…</p><div v-else-if="error" class="state-card state-card--error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="load(id)">Reintentar</button></div>
    <template v-else-if="session">
      <div class="workout-summary"><span class="plan-status">{{ workoutStatusLabel(session.status) }}</span><p><strong>Fecha del entrenamiento:</strong> {{ session.performedOn?.slice(0,10) ?? 'Fecha local no registrada' }} · {{ session.timeZone ?? 'Zona horaria no registrada' }}</p><p><strong>Asociación actual:</strong> {{ session.trainingPlan?.name ?? 'Entrenamiento independiente' }}{{ session.planWeek ? ' · Semana '+session.planWeek.weekNumber : '' }}{{ session.planDay ? ' · '+session.planDay.name : session.planWeek ? ' · Referencia semanal histórica' : '' }}</p><p v-if="session.sourceSnapshot?.kind === 'FREE'" class="field-hint">Origen: entrenamiento libre. Una asociación posterior no modifica sus ejercicios.</p><p v-if="session.sourceSnapshot?.kind === 'SESSION'">Preparado a partir de la estructura de otro entrenamiento. Sin copiar sus resultados.</p><p v-if="session.sourceSnapshot?.kind === 'PLAN_DAY'" class="field-hint">Origen conservado: {{ session.sourceSnapshot.plan?.name }} · Semana {{ session.sourceSnapshot.week?.weekNumber }} · {{ session.sourceSnapshot.day?.name }}</p><p v-if="session.recordingMode === 'RETROSPECTIVE'" class="field-hint">Registro de un entrenamiento anterior. Los tiempos siguientes corresponden al registro de datos.</p><p>{{ session.recordingMode === 'RETROSPECTIVE' ? 'Inicio del registro' : 'Inicio' }}: {{ workoutDate(session.startedAt, session.timeZone) }}</p><p v-if="session.finishedAt">Finalización{{ session.recordingMode === 'RETROSPECTIVE' ? ' del registro' : '' }}: {{ workoutDate(session.completedAt ?? session.finishedAt, session.timeZone) }}</p><p v-if="!session.timeZone" class="field-hint">Los tiempos históricos se muestran en la zona de este dispositivo; la zona original no está registrada.</p><p v-if="session.notes" class="plan-copy">{{ session.notes }}</p><p>{{ session.actualSetCount ?? 0 }} series con resultados · {{ session.completedSetCount ?? 0 }} completadas</p><p v-if="session.status === 'COMPLETED' && !session.actualSetCount" class="field-hint">Entrenamiento finalizado sin resultados registrados.</p></div>
      <p v-if="notice" class="success-message" role="status">{{ notice }}</p><p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      <p v-if="session.status === 'PLANNED'" class="plan-policy">Revisa los ejercicios y ajusta sus objetivos. No se registrarán resultados hasta empezar.</p><p v-if="session.status === 'IN_PROGRESS'" class="plan-policy">Entrenamiento en curso. Tus series se guardan al confirmar cada registro y puedes retomarlo después.</p><p v-if="!editable" class="plan-policy">Este entrenamiento está cerrado y conserva sus resultados para consulta.</p>
      <div class="plan-actions"><button v-if="session.status === 'PLANNED'" class="primary-button" type="button" :disabled="saving" @click="run(start)">{{ session.recordingMode === 'RETROSPECTIVE' ? 'Comenzar registro anterior' : 'Empezar entrenamiento' }}</button><button v-if="editable" class="secondary-button" type="button" :disabled="saving" @click="adding = !adding">Añadir ejercicio</button><button v-if="editable" class="text-button" type="button" :disabled="saving" @click="editing = !editing">Datos y fecha</button><button v-if="editable" class="text-button" type="button" :disabled="saving" @click="openAssociation">Asociar a plan y día</button><button v-if="editable && session.planDay" class="text-button" type="button" :disabled="saving" @click="previewImport">Incorporar prescripciones del día</button><button v-if="session.status === 'IN_PROGRESS'" class="primary-button" type="button" :disabled="saving" @click="confirming = !confirming">Finalizar entrenamiento</button><button v-if="editable" class="text-button" type="button" :disabled="saving" @click="cancelling = !cancelling">Cancelar entrenamiento</button><button v-if="['COMPLETED','CANCELLED'].includes(session.status)" class="secondary-button" type="button" @click="exporting = !exporting">Guardar como día de un plan</button><RouterLink class="back-link" :to="{ name: 'workout-sessions', query: { repeatFromId: session.id } }">Repetir estructura →</RouterLink><button class="refresh-button" type="button" :disabled="saving" @click="load(id)">Actualizar detalle</button></div>
      <WorkoutSessionForm v-if="editable && editing" :session="session" :busy="saving" :save="actions.update" @saved="editing = false" @cancel="editing = false" />
      <form v-if="editable && associating" class="plan-form" @submit.prevent="run(associate)"><h2>Asociación manual</h2><p>Asociar no sustituye tus ejercicios ni resultados. Puedes entrenar el bloque en una fecha diferente a su programación.</p><PlanDaySelector v-model="selection" :disabled="saving" /><div class="plan-actions"><button class="primary-button" type="submit" :disabled="saving || !selection.trainingPlanId || !selection.planWeekId || !selection.planDayId">Guardar asociación sin cambiar ejercicios</button><button class="text-button" type="button" @click="associating = false">Cerrar</button></div></form>
      <div v-if="editable && importing" class="state-card"><h2>Confirmar incorporación de prescripciones</h2><p>Se añadirán las prescripciones de {{ session.planDay?.name }} que todavía no estén incluidas. Se conservan los ejercicios, objetivos ajustados y resultados existentes. Los ejercicios omitidos no se restauran automáticamente.</p><p v-if="importLoading" role="status">Revisando prescripciones…</p><ul v-else><li v-for="item in importPreview" :key="item.id">{{ item.exercise.name }} · {{ item.targetSets }} series · {{ item.targetRepsMin }}–{{ item.targetRepsMax }} repeticiones</li></ul><p v-if="!importLoading && !importPreview.length">No hay prescripciones nuevas para incorporar.</p><div class="plan-actions"><button class="primary-button" type="button" :disabled="saving || importLoading || !importPreview.length" @click="run(importDay)">Confirmar incorporación</button><button class="text-button" type="button" @click="importing = false">Cerrar</button></div></div>
      <div v-if="editable && cancelling" class="state-card"><p>¿Cancelar el entrenamiento? Sus registros se conservarán y quedará cerrado.</p><div class="plan-actions"><button class="secondary-button" type="button" :disabled="saving" @click="run(actions.cancel)">Confirmar cancelación</button><button class="text-button" type="button" @click="cancelling = false">Seguir</button></div></div>
      <AddWorkoutExerciseForm v-if="editable && adding" :save="addExercise" :expected-version="session.version" :omitted-exercises="session.exercises.filter(item => item.isOmitted)" :busy="saving" @saved="adding = false" @cancel="adding = false" />
      <CompleteWorkoutForm v-if="session.status === 'IN_PROGRESS' && confirming" :save="complete" :has-results="Boolean(session.actualSetCount)" :busy="saving" @saved="confirming = false" @cancel="confirming = false" />
      <SaveWorkoutDayForm v-if="['COMPLETED','CANCELLED'].includes(session.status) && exporting" :session-id="session.id" :busy="saving" @cancel="exporting = false" />
      <h2 class="weeks-heading">Ejercicios y resultados</h2><p v-if="!session.exercises.length" class="state-card">Todavía no hay ejercicios en este entrenamiento.</p>
      <WorkoutExerciseCard v-for="(item,index) in session.exercises" :key="session.id+item.id" :item="item" :status="session.status" :busy="saving" :index="index" :count="session.exercises.length" :actions="actions" />
    </template>
  </section>
</template>
