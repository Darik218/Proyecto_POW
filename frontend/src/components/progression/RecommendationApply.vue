<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  routineService,
  type ScheduledActivity,
} from '../../services/routine.service'
import type {
  ProgressionProposal,
  ApplicationReadiness,
} from '../../types/progression'
const props = defineProps<{
    proposal: ProgressionProposal
    readiness: ApplicationReadiness | null
    busy: boolean
  }>(),
  emit = defineEmits<{
    prepare: [activity: string, intent: string]
    apply: []
    invalidate: []
  }>()
const from = ref(''),
  to = ref(''),
  zone = ref(''),
  activity = ref(''),
  activities = ref<ScheduledActivity[]>([]),
  confirmed = ref(false),
  problem = ref(''),
  loading = ref(false)
let request = 0
watch(
  () => [props.proposal.id, props.proposal.reviewVersion],
  () => {
    activities.value = []
    activity.value = ''
    confirmed.value = false
    request++
  },
)
watch([from, to, zone], () => {
  activities.value = []
  activity.value = ''
  request++
  emit('invalidate')
})
watch(activity, () => {
  confirmed.value = false
  emit('invalidate')
})
watch(
  () => props.readiness,
  () => {
    confirmed.value = false
  },
)
function applyConfirmed() {
  if (props.busy || !confirmed.value || !props.readiness?.eligible) return
  confirmed.value = false
  emit('apply')
}
function prepare() {
  if (!props.busy && activity.value)
    emit('prepare', activity.value, crypto.randomUUID())
}
async function query() {
  const weekId = props.proposal.generation?.destination.weekId
  if (!weekId) return
  const n = ++request
  loading.value = true
  problem.value = ''
  try {
    const values = await routineService.activities({
      weekId,
      from: from.value,
      to: to.value,
      timeZone: zone.value,
    })
    if (request === n)
      activities.value = values.filter(
        (a) => a.planDayId === props.proposal.generation?.destination.dayId,
      )
  } catch {
    if (request === n)
      problem.value =
        'No se pudieron consultar las actividades. Revisa fechas y zona horaria.'
  } finally {
    if (request === n) loading.value = false
  }
}
</script>
<template>
  <section class="progression-card progression-application">
    <h2>Aplicación manual separada</h2>
    <p>
      Estado: {{ proposal.status }}. Carga autorizada:
      {{ proposal.previousLoad }} → {{ proposal.recommendedLoad }}
      {{ proposal.loadUnit ?? 'Unidad desconocida' }}.
    </p>
    <p>
      Solo el servidor puede verificar si el plan y todas las actividades
      afectadas siguen siendo editables y futuras. No se crearán copias ni se
      redondeará la carga para evitar un bloqueo.
    </p>
    <template v-if="proposal.status === 'APPROVED'"
      ><div class="progression-grid">
        <label
          >Actividades desde<input
            v-model="from"
            data-testid="activityFrom"
            type="date"
            :disabled="busy" /></label
        ><label
          >Hasta<input
            v-model="to"
            data-testid="activityTo"
            type="date"
            :disabled="busy" /></label
        ><label
          >Zona horaria de consulta<input
            v-model="zone"
            data-testid="activityZone"
            :disabled="busy"
            placeholder="Ej.: America/Bogota"
        /></label>
      </div>
      <button
        class="secondary-button"
        type="button"
        data-testid="activities"
        :disabled="busy || loading || !from || !to || !zone"
        @click="query"
      >
        Consultar actividades de destino</button
      ><label
        >Actividad futura<select
          v-model="activity"
          data-testid="activity"
          :disabled="busy"
        >
          <option value="" disabled>Selecciona la actividad</option>
          <option v-for="a in activities" :key="a.id" :value="a.id">
            {{ a.title }} · {{ a.scheduledOn.slice(0, 10) }} ·
            {{ a.timeZone }} · {{ a.status }}
          </option>
        </select></label
      ><button
        type="button"
        class="secondary-button"
        data-testid="readiness"
        :disabled="busy || !activity"
        @click="prepare"
      >
        Comprobar condiciones de aplicación
      </button>
      <div v-if="readiness" class="progression-readiness" :class="{ 'is-eligible': readiness.eligible }" role="status">
        <p>
          {{
            readiness.eligible
              ? 'Aplicación disponible según la última inspección'
              : 'Aplicación bloqueada'
          }}
        </p>
        <p v-for="reason in readiness.reasons" :key="reason">{{ reason }}</p>
        <template v-if="readiness.eligible && readiness.command"
          ><p>
            Destino {{ readiness.command.destination.prescriptionId }} · plan
            versión {{ readiness.command.expectedPlanVersion }} · fecha
            {{ readiness.command.expectedScheduledOn }} ·
            {{ readiness.command.timeZone }}. Carga
            {{ readiness.command.previousLoad }} →
            {{ readiness.command.appliedLoad }}
            {{ readiness.command.loadUnit }}.
          </p>
          <label
            ><input
              v-model="confirmed"
              data-testid="confirmApply"
              type="checkbox"
              :disabled="busy"
            />
            Confirmo que quiero modificar exclusivamente esta prescripción
            futura con la carga y unidad mostradas.</label
          ><button
            type="button"
            class="primary-button"
            data-testid="apply"
            :disabled="busy || !confirmed"
            @click="applyConfirmed"
          >
            Aplicar a la prescripción futura
          </button></template
        >
      </div></template
    >
    <p v-else>
      La aplicación requiere una aprobación específica y vigente. APPROVED y
      APPLIED son estados diferentes.
    </p>
    <p v-if="loading" role="status">Consultando actividades de destino…</p>
    <p v-if="problem" role="alert">{{ problem }}</p>
  </section>
</template>
