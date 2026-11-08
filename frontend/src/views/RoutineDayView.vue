<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import PlanDayCard from '../components/training-plans/PlanDayCard.vue'
import { requestIntent } from '../composables/requestIntent'
import { useTrainingPlan } from '../composables/useTrainingPlans'
import { useWorkoutSessions } from '../composables/useWorkoutSessions'
import { routineService, type ScheduledActivity } from '../services/routine.service'
import {
  workoutSessionsService,
  localTrainingDate,
  workoutErrorMessage,
  type CreateWorkout,
} from '../services/workout-sessions.service'
import { trainingPlanErrorMessage, weekdayLabel } from '../services/training-plans.service'
import '../assets/training-plans.css'
import '../assets/routine.css'
const route = useRoute(),
  router = useRouter(),
  actions = useTrainingPlan(),
  history = useWorkoutSessions()
const { plan, loading, error, saving } = actions
const planId = computed(() => String(route.params.planId ?? '')),
  weekId = computed(() => String(route.params.weekId ?? '')),
  dayId = computed(() => String(route.params.dayId ?? ''))
const week = computed(() => plan.value?.weeks.find((w) => w.id === weekId.value)),
  day = computed(() => week.value?.days.find((d) => d.id === dayId.value))
const editable = computed(
  () =>
    !!day.value &&
    !day.value.retiredAt &&
    !day.value.hasHistory &&
    (plan.value?.status === 'DRAFT' ||
      (plan.value?.status === 'ACTIVE' && day.value.isEditableOverride === true)),
)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  date = ref(typeof route.query.date === 'string' ? route.query.date : localTrainingDate(timeZone)),
  busy = ref(false),
  failure = ref(''),
  notice = ref(''),
  copying = ref(false),
  copyMode = ref<'NEW_DAY' | 'APPEND'>('NEW_DAY'),
  destinations = ref<string[]>([]),
  target = ref(''),
  confirm = ref(false)
const calendar = ref<ScheduledActivity[]>([]),
  activityId = ref(typeof route.query.activityId === 'string' ? route.query.activityId : '')
const availableActivities = computed(() =>
  calendar.value.filter(
    (a) =>
      a.planDayId === dayId.value &&
      a.scheduledOn.slice(0, 10) === date.value &&
      ['PLANNED', 'RESCHEDULED'].includes(a.status),
  ),
)
let calendarRevision = 0,
  calendarController: AbortController | undefined
const calendarLoading=ref(true),calendarError=ref('')
async function loadCalendar(){
    calendarLoading.value=true;calendarError.value=''
    const current = ++calendarRevision
    calendarController?.abort()
    calendarController = new AbortController()
    try {
      const result = await routineService.activities(
        { weekId: weekId.value, from: date.value, to: date.value, timeZone },
        calendarController.signal,
      )
      if (current === calendarRevision) {
        calendar.value = result
        if (!availableActivities.value.some((a) => a.id === activityId.value))
          activityId.value =
            availableActivities.value.length === 1 ? availableActivities.value[0]!.id : ''
      }
    } catch(cause) {
      if(current===calendarRevision&&!calendarController.signal.aborted){calendar.value=[];calendarError.value=trainingPlanErrorMessage(cause,'No se pudo confirmar la programación de esta fecha.')}
    } finally{if(current===calendarRevision)calendarLoading.value=false}
}
watch([date,dayId],()=>void loadCalendar(),{immediate:true})
const trainable = computed(
  () =>
    !!day.value &&
    (!day.value.retiredAt ||
      (!!day.value.retiredFromOn && date.value < day.value.retiredFromOn.slice(0, 10))),
)
const intents = requestIntent()
const revision = (values: object) => ({
  id: intents.id(values),
  expectedVersion: plan.value?.version ?? 0,
})
let intent: { key: string; input: CreateWorkout; sessionId?: string } | undefined
const resumable = computed(() =>
  history.sessions.value.filter((s) => ['PLANNED', 'IN_PROGRESS'].includes(s.status)),
)
watch(
  () => route.fullPath,
  async () => {
    failure.value = ''
    notice.value = ''
    await Promise.all([actions.load(planId.value), history.load({ planDayId: dayId.value })])
    intent = undefined
  },
  { immediate: true },
)
async function begin() {
  if (busy.value || calendarLoading.value || calendarError.value || !day.value || !trainable.value) return
  busy.value = true
  failure.value = ''
  try {
    const key = JSON.stringify({
      dayId: dayId.value,
      date: date.value,
      activityId: activityId.value,
    })
    if (intent?.key !== key)
      intent = {
        key,
        input: {
          id: crypto.randomUUID(),
          ...(activityId.value ? { scheduledActivityId: activityId.value } : {}),
          trainingPlanId: planId.value,
          planWeekId: weekId.value,
          planDayId: dayId.value,
          performedOn: date.value,
          timeZone,
          recordingMode: date.value === localTrainingDate(timeZone) ? 'LIVE' : 'RETROSPECTIVE',
          name: day.value.name,
        },
      }
    if (!intent!.sessionId) {
      const prepared = await workoutSessionsService.create(intent!.input)
      intent!.sessionId = prepared.id
    }
    const current = await workoutSessionsService.get(intent!.sessionId)
    if (current.status === 'PLANNED')
      await workoutSessionsService.start(current.id, current.version ?? 0)
    await router.push({ name: 'workout-session-detail', params: { sessionId: current.id } })
  } catch (cause) {
    failure.value = workoutErrorMessage(
      cause,
      'No se pudo iniciar el entrenamiento. Reintenta para recuperar la misma sesión.',
    )
  } finally {
    busy.value = false
  }
}
async function change(action: 'copy' | 'future-copy' | 'withdraw') {
  if (busy.value) return
  if (action === 'withdraw' && !confirm.value) {
    confirm.value = true
    return
  }
  busy.value = true
  failure.value = ''
  try {
    const values = {
      action,
      planId: planId.value,
      dayId: dayId.value,
      mode: copyMode.value,
      weekIds: destinations.value,
      targetDayId: target.value,
      fromDate: date.value,
      timeZone,
    }
    const result =
      action === 'copy'
        ? await routineService.copy(planId.value, {
            ...revision(values),
            sourceDayId: dayId.value,
            timeZone,
            mode: copyMode.value,
            ...(copyMode.value === 'NEW_DAY'
              ? { weekIds: destinations.value }
              : { targetDayId: target.value }),
          })
        : await routineService.future(planId.value, dayId.value, action, {
            ...revision(values),
            fromDate: date.value,
            timeZone,
          })
    intents.confirmed(values)
    copying.value = false
    confirm.value = false
    await actions.load(planId.value)
    notice.value = 'Programación guardada. El historial y las demás semanas se mantienen.'
    if (action === 'future-copy' && result.dayIds?.[0])
      await router.replace({
        name: 'routine-day',
        params: { planId: planId.value, weekId: weekId.value, dayId: result.dayIds[0] },
      })
  } catch (cause) {
    failure.value = trainingPlanErrorMessage(cause, 'No se pudo adaptar la programación.')
  } finally {
    busy.value = false
  }
}
onUnmounted(() => {
  calendarRevision++
  calendarController?.abort()
  actions.dispose()
  history.dispose()
})
</script>
<template>
  <section class="page-view" aria-labelledby="routine-day-title">
    <div class="routine-back-links">
      <RouterLink :to="{ name: 'home', query: { planId, weekId } }">← Mi rutina</RouterLink
      ><RouterLink :to="{ name: 'workout-history', query: { planId, dayId } }"
        >Historial de este día</RouterLink
      >
    </div>
    <p v-if="loading" role="status">Cargando día…</p>
    <div v-else-if="error" class="state-card" role="alert">
      {{ error }} <button class="text-button" @click="actions.load(planId)">Reintentar</button>
    </div>
    <template v-else-if="day && week && plan"
      ><header class="page-heading">
        <p class="eyebrow">{{ plan.name }} · SEMANA {{ week.weekNumber }}</p>
        <h1 id="routine-day-title">{{ day.name }}</h1>
        <p>{{ weekdayLabel(day.weekday) }} · {{ day.exercises.length }} ejercicios</p>
        <p v-if="day.retiredAt" class="field-hint">
          Programación anterior conservada para consulta histórica.
        </p>
      </header>
      <section v-if="trainable && ['DRAFT', 'ACTIVE'].includes(plan.status)" class="state-card">
        <h2>Entrenar este día</h2>
        <p v-if="calendarLoading" role="status">Comprobando la programación…</p><p v-if="calendarError" class="form-error" role="alert">{{calendarError}} <button class="text-button" :disabled="busy" @click="loadCalendar">Reintentar</button></p>
        <RouterLink
          v-for="session in resumable"
          :key="session.id"
          class="routine-resume"
          :to="{ name: 'workout-session-detail', params: { sessionId: session.id } }"
          >Continuar {{ session.performedOn?.slice(0, 10) }} →</RouterLink
        ><label for="routine-execution-date" class="field-label"
          >Fecha del entrenamiento ({{ timeZone }})</label
        ><input
          id="routine-execution-date"
          v-model="date"
          class="form-control"
          type="date"
          :disabled="busy"
        />
        <p class="field-hint">
          {{
            date === localTrainingDate(timeZone)
              ? 'Inicia una sesión real con los ejercicios de este día.'
              : 'Registrarás un entrenamiento de otra fecha, sin iniciar un cronómetro actual.'
          }}
          Los ajustes y resultados no cambian el plan.
        </p>
        <label v-if="availableActivities.length > 1" for="day-occurrence"
          >Hay varias programaciones para esta fecha. Elige la que corresponde o entrena sin
          vincularla.</label
        ><select
          v-if="availableActivities.length > 1"
          id="day-occurrence"
          v-model="activityId"
          class="form-control"
        >
          <option value="">Sin vincular a una programación</option>
          <option v-for="activity in availableActivities" :key="activity.id" :value="activity.id">
            {{ activity.title }} · {{ activity.scheduledOn.slice(0, 10) }}
          </option></select
        ><button class="primary-button" :disabled="busy || !date || calendarLoading || !!calendarError" @click="begin">
          {{
            busy
              ? 'Procesando…'
              : date === localTrainingDate(timeZone)
                ? 'Empezar entrenamiento'
                : 'Registrar entrenamiento de esta fecha'
          }}
        </button>
      </section>
      <details class="routine-options" open>
        <summary>Programación y objetivos</summary>
        <p v-if="!editable && !day.retiredAt" class="field-hint">
          La programación está protegida. Crea una copia editable para adaptar entrenamientos
          futuros.
        </p>
        <PlanDayCard
          :key="day.id"
          :day="day"
          :week-id="week.id"
          :editable="editable"
          :busy="busy || saving"
          :copy-position="
            Math.max(0, ...week.days.filter((d) => !d.retiredAt).map((d) => d.position)) + 1
          "
          :actions="actions"
        />
      </details>
      <details
        v-if="!day.retiredAt && ['DRAFT', 'ACTIVE'].includes(plan.status)"
        class="routine-options"
      >
        <summary>Copiar o adaptar esta rutina</summary>
        <div class="plan-actions">
          <button class="secondary-button" :disabled="busy" @click="copying = !copying">
            Copiar a otros días o semanas</button
          ><button class="secondary-button" :disabled="busy" @click="change('future-copy')">
            Crear copia editable desde {{ date }}</button
          ><button class="text-button" :disabled="busy" @click="change('withdraw')">
            Retirar programación futura
          </button>
        </div>
        <div v-if="confirm" class="routine-copy-confirm">
          <p>
            Se retirará este día y sus fechas sin ejecución desde {{ date }}. Los entrenamientos y
            resultados anteriores se conservarán.
          </p>
          <button class="secondary-button" :disabled="busy" @click="change('withdraw')">
            Confirmar retirada</button
          ><button class="text-button" @click="confirm = false">Cancelar</button>
        </div>
        <form v-if="copying" class="routine-copy-confirm" @submit.prevent="change('copy')">
          <label for="routine-copy-mode">Modo de copia</label
          ><select id="routine-copy-mode" v-model="copyMode" class="form-control">
            <option value="NEW_DAY">Crear días nuevos e independientes</option>
            <option value="APPEND">Añadir ejercicios a un día existente</option></select
          ><template v-if="copyMode === 'NEW_DAY'"
            ><fieldset>
              <legend>Semanas de destino</legend>
              <label v-for="item in plan.weeks" :key="item.id" class="routine-resume"
                ><input v-model="destinations" type="checkbox" :value="item.id" /> Semana
                {{ item.weekNumber }}</label
              >
            </fieldset></template
          ><template v-else
            ><label for="routine-copy-target">Día de destino</label
            ><select id="routine-copy-target" v-model="target" class="form-control" required>
              <option value="">Selecciona un día editable</option>
              <optgroup
                v-for="item in plan.weeks"
                :key="item.id"
                :label="'Semana ' + item.weekNumber"
              >
                <option
                  v-for="d in item.days.filter(
                    (d) => !d.retiredAt && !d.hasHistory && (d.isEditableOverride || editable),
                  )"
                  :key="d.id"
                  :value="d.id"
                >
                  {{ d.name }}
                </option>
              </optgroup>
            </select></template
          >
          <p>
            No se sobrescribe ningún ejercicio existente. Cada copia tiene identificadores propios.
          </p>
          <button
            class="primary-button"
            :disabled="busy || (copyMode === 'NEW_DAY' ? !destinations.length : !target)"
          >
            Confirmar copia
          </button>
        </form>
      </details>
      <h2>Entrenamientos de este día</h2>
      <p v-if="history.loading.value" role="status">Cargando entrenamientos…</p>
      <p v-else-if="history.error.value" role="alert">{{ history.error.value }}</p>
      <p v-else-if="!history.sessions.value.length" class="state-card">
        Sin entrenamientos registrados. Esto no significa que el día se haya omitido.
      </p>
      <RouterLink
        v-for="session in history.sessions.value"
        :key="session.id"
        class="routine-resume"
        :to="{ name: 'workout-session-detail', params: { sessionId: session.id } }"
        >{{ session.performedOn?.slice(0, 10) ?? 'Fecha histórica sin registrar' }} ·
        {{ session.completedSetCount ?? 0 }} series completadas →</RouterLink
      ></template
    >
    <p v-else class="state-card">Día no encontrado en esta semana.</p>
    <p v-if="failure" role="alert" class="form-error">{{ failure }}</p>
    <p v-if="notice" role="status" class="success-message">{{ notice }}</p>
  </section>
</template>
