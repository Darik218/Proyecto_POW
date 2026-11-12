<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  nextTick,
  reactive,
  ref,
  watch,
} from 'vue'
import {
  trainingPlansService,
  type TrainingPlan,
  type Planning,
} from '../../services/training-plans.service'
import { progressionCommandSchema } from '../../schemas/progression.schema'
import {
  policyFields,
  signalFields,
  buildProgressionPolicy,
} from '../../utils/progression-inputs'
import type {
  ProgressionCommand,
  ProgressionFormDraft,
  ProgressionContext,
} from '../../types/progression'
const props = defineProps<{
  context: ProgressionContext | null
  busy: boolean
  initialDraft?: ProgressionFormDraft | null
  session?: string
}>()
const emit = defineEmits<{
  context: [command: ProgressionCommand]
  preview: [command: ProgressionCommand]
  change: []
  resetContext: []
  configure: []
  restored: []
}>()
const plans = ref<TrainingPlan[]>([]),
  planning = ref<Planning | null>(null),
  planId = ref(''),
  weekId = ref(''),
  dayId = ref(''),
  prescriptionId = ref(''),
  problem = ref(''),
  fields = reactive<Record<string, string>>({}),
  dates = reactive({
    start: '',
    endExclusive: '',
    cutoffOn: '',
    from: '',
    timeZone: '',
    weekStartsOn: '',
  }),
  selection = ref<string[]>([]),
  anchor = ref(''),
  protocol = ref(''),
  equipment = ref(''),
  declared = ref(false),
  slots = reactive<Record<string, { original: string; adjusted: string }>>({})
let load = 0,
  alive = true,
  restoring = !!props.initialDraft
const stamp = props.session
onUnmounted(() => {
  alive = false
  load++
})
onMounted(async () => {
  try {
    const loaded = await trainingPlansService.list()
    if (!alive || stamp !== props.session) return
    plans.value = loaded
    const d = props.initialDraft
    if (d) {
      planId.value = d.planId
      await nextTick()
      const current = await trainingPlansService.getPlanning(d.planId)
      if (!alive || stamp !== props.session) return
      planning.value = current
      weekId.value = d.weekId
      dayId.value = d.dayId
      prescriptionId.value = d.prescriptionId
      Object.assign(dates, d.dates)
      Object.assign(fields, d.fields)
      Object.assign(slots, d.slots)
      selection.value = [...d.selection]
      anchor.value = d.anchor
      protocol.value = d.protocol
      equipment.value = d.equipment
      declared.value = false
      await nextTick()
      emit('restored')
    }
    restoring = false
  } catch {
    if (alive)
      problem.value =
        'No se pudieron recuperar los planes o el contexto anterior. Vuelve a seleccionar y consultar.'
    restoring = false
  }
})
watch(planId, async (id) => {
  if (restoring) return
  const request = ++load
  planning.value = null
  weekId.value = ''
  if (!id) return
  try {
    const value = await trainingPlansService.getPlanning(id)
    if (alive && stamp === props.session && load === request)
      planning.value = value
  } catch {
    if (load === request) problem.value = 'No se pudo cargar la programación.'
  }
})
watch(weekId, () => {
  if (restoring) return
  dayId.value = ''
})
watch(dayId, () => {
  if (restoring) return
  prescriptionId.value = ''
})
const week = computed(() =>
    planning.value?.weeks.find((w) => w.id === weekId.value),
  ),
  day = computed(() => week.value?.days.find((d) => d.id === dayId.value)),
  prescription = computed(() =>
    day.value?.exercises.find((e) => e.id === prescriptionId.value),
  )
watch(
  [planId, weekId, dayId, prescriptionId, dates],
  () => {
    if (restoring) return
    selection.value = []
    anchor.value = ''
    declared.value = false
    emit('resetContext')
    emit('change')
  },
  { deep: true },
)
watch(
  [fields, selection, anchor, protocol, equipment, declared, slots],
  () => {
    if (!restoring) emit('change')
  },
  { deep: true },
)
function command(policy = false): ProgressionCommand {
  const p = prescription.value
  if (!p) throw Error('Selecciona plan, semana, día y ejercicio.')
  const base = progressionCommandSchema.parse({
    history: {
      exerciseId: p.exercise.id,
      from: dates.from,
      to: dates.cutoffOn,
      timeZone: dates.timeZone,
      limit: 100,
    },
    period: {
      start: dates.start,
      endExclusive: dates.endExclusive,
      cutoffOn: dates.cutoffOn,
      timeZone: dates.timeZone,
      weekStartsOn: Number(dates.weekStartsOn),
    },
    destination: {
      kind: 'PRESCRIPTION',
      planId: planId.value,
      weekId: weekId.value,
      dayId: dayId.value,
      prescriptionId: p.id,
    },
    expectedPlanVersion: planning.value?.version,
  })
  if (policy) {
    if (
      !declared.value ||
      !protocol.value.trim() ||
      !equipment.value.trim() ||
      !selection.value.length ||
      !selection.value.includes(anchor.value) ||
      !['true', 'false'].includes(fields.closed ?? '')
    )
      throw Error(
        'Declara el contexto, selecciona evidencia y completa la política.',
      )
    base.history.contexts = selection.value.map((workoutExerciseId) => ({
      workoutExerciseId,
      loadMeaning: 'EXTERNAL_TOTAL',
      protocolKey: protocol.value.trim(),
      equipmentKey: equipment.value.trim(),
      source: 'OWNER_DECLARATION_FOR_ANALYSIS',
    }))
    base.history.comparisons = selection.value
      .filter((id) => id !== anchor.value)
      .map((previousTaskId) => ({
        previousTaskId,
        currentTaskId: anchor.value,
      }))
    base.policy = buildProgressionPolicy(
      fields,
      slots,
      selection.value,
      anchor.value,
      props.context?.configuration.selected ?? null,
    )
  }
  return base
}
function submit(policy = false) {
  problem.value = ''
  try {
    const value = command(policy)
    if (policy) emit('preview', value)
    else emit('context', value)
  } catch {
    problem.value =
      'Completa la selección, las fechas, las declaraciones y todos los criterios de la política. Las cargas y el RPE deben escribirse como decimales.'
  }
}
function toggle(id: string, checked: boolean) {
  selection.value = checked
    ? [...selection.value, id]
    : selection.value.filter((v) => v !== id)
  slots[id] ??= { original: '', adjusted: '' }
}
function getDraft(): ProgressionFormDraft {
  return structuredClone({
    planId: planId.value,
    weekId: weekId.value,
    dayId: dayId.value,
    prescriptionId: prescriptionId.value,
    dates: { ...dates },
    fields: { ...fields },
    selection: [...selection.value],
    anchor: anchor.value,
    protocol: protocol.value,
    equipment: equipment.value,
    slots: Object.fromEntries(
      Object.entries(slots).map(([id, v]) => [id, { ...v }]),
    ),
  })
}
defineExpose({ getDraft })
</script>
<template>
  <form class="progression-form" @submit.prevent="submit(true)">
    <nav class="progression-context-nav" aria-label="Secciones del formulario"><a href="#progression-analysis-destination">1. Destino</a><a href="#progression-analysis-period">2. Período</a><a v-if="context" href="#progression-analysis-evidence">3. Evidencia</a><a v-if="context" href="#progression-analysis-policy">4. Política</a></nav>
    <fieldset id="progression-analysis-destination" class="progression-form-step" :disabled="busy">
      <legend>1. Ejercicio y prescripción de destino</legend>
      <div class="progression-grid">
        <label
          >Plan<select v-model="planId" data-testid="plan" required>
            <option value="" disabled>Selecciona un plan</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.status }}
            </option>
          </select></label
        >
        <label
          >Semana<select v-model="weekId" data-testid="week" required>
            <option value="" disabled>Selecciona una semana</option>
            <option v-for="w in planning?.weeks" :key="w.id" :value="w.id">
              Semana {{ w.weekNumber }}
            </option>
          </select></label
        >
        <label
          >Día<select v-model="dayId" data-testid="day" required>
            <option value="" disabled>Selecciona un día</option>
            <option v-for="d in week?.days" :key="d.id" :value="d.id">
              {{ d.name }}
            </option>
          </select></label
        >
        <label
          >Ejercicio / prescripción<select
            v-model="prescriptionId"
            data-testid="prescription"
            required
          >
            <option value="" disabled>Selecciona un ejercicio</option>
            <option v-for="p in day?.exercises" :key="p.id" :value="p.id">
              {{ p.exercise.name }} · posición {{ p.position }}
            </option>
          </select></label
        >
      </div>
      <p>
        La carga oficial de destino se consulta al servidor, con su precisión
        original. Aplicar requiere un destino futuro editable.
      </p>
    </fieldset>
    <fieldset id="progression-analysis-period" class="progression-form-step" :disabled="busy">
      <legend>2. Período deportivo e historial</legend>
      <div class="progression-grid">
        <label
          v-for="[key, label] in [
            ['start', 'Inicio de semana'],
            ['endExclusive', 'Fin exclusivo de semana'],
            ['cutoffOn', 'Fecha de corte'],
            ['from', 'Historial desde'],
          ]"
          :key="key"
          >{{ label
          }}<input
            v-model="dates[key as 'start']"
            :data-testid="key"
            type="date"
            required
        /></label>
        <label
          >Zona horaria IANA<input
            v-model="dates.timeZone"
            data-testid="timeZone"
            placeholder="Ej.: America/Bogota"
            required
        /></label>
        <label
          >Primer día de la semana<select
            v-model="dates.weekStartsOn"
            data-testid="weekStartsOn"
            required
          >
            <option value="" disabled>Elige un día</option>
            <option
              v-for="(label, index) in [
                'Lunes',
                'Martes',
                'Miércoles',
                'Jueves',
                'Viernes',
                'Sábado',
                'Domingo',
              ]"
              :key="label"
              :value="String(index + 1)"
            >
              {{ label }}
            </option>
          </select></label
        >
      </div>
      <button
        type="button"
        class="secondary-button"
        data-testid="context"
        @click="submit(false)"
      >
        Consultar configuración e historial
      </button>
    </fieldset>
    <template v-if="context"
      ><section class="progression-card">
        <h2>Configuración registrada</h2>
        <p>
          {{ context.configuration.status }} ·
          {{ context.configuration.scope ?? 'Sin alcance' }}
        </p>
        <p v-if="context.configuration.selected">
          Mínimo:
          {{ context.configuration.selected.minSuccessfulSessions }} sesiones.
          RPE: {{ context.configuration.selected.targetRpeMin }}–{{
            context.configuration.selected.targetRpeMax
          }}. Incremento absoluto:
          {{
            context.configuration.selected.incrementAbsolute ??
            'Sin configurar'
          }}; porcentual:
          {{
            context.configuration.selected.incrementPercent ?? 'Sin configurar'
          }}; límite porcentual:
          {{ context.configuration.selected.maxIncrementPercent }}.
        </p>
        <button
          v-if="
            context.configuration.reasons.some((r) =>
              [
                'SETTING_REQUIRED',
                'SETTING_VALUES_INVALID',
                'INCREMENT_REQUIRED',
                'AMBIGUOUS_SETTING_SCOPE',
              ].includes(r),
            )
          "
          type="button"
          class="secondary-button"
          data-testid="configureMissingSetting"
          :disabled="busy"
          @click="emit('configure')"
        >
          Gestionar parámetros para este contexto
        </button>
        <p v-if="!context.configuration.selected" role="status">
          Falta una configuración registrada. Este módulo no inventa incrementos
          ni habilita automatización.
        </p>
        <p>
          Carga del destino:
          {{ context.destination.targets.targetLoad ?? 'Desconocida' }}
          {{
            context.destination.targets.targetLoadUnit ?? 'Unidad desconocida'
          }}
        </p>
        <p v-if="Object.values(context.history.truncated).some(Boolean)">
          El historial está limitado. No se presume evidencia completa.
        </p>
      </section>
      <fieldset id="progression-analysis-evidence" class="progression-form-step" :disabled="busy">
        <legend>
          3. Evidencia histórica y declaraciones para este análisis
        </legend>
        <p>
          Estas declaraciones son posteriores a la ejecución; no reescriben el
          historial.
        </p>
        <div
          v-for="t in context.history.tasks"
          :key="t.id"
          class="progression-card"
        >
          <label
            ><input
              type="checkbox"
              :checked="selection.includes(t.id)"
              :data-task="t.id"
              @change="
                toggle(t.id, ($event.target as HTMLInputElement).checked)
              "
            />
            Sesión {{ t.performedOn ?? 'Fecha desconocida' }} ·
            {{ t.id }}</label
          >
          <div v-if="selection.includes(t.id)" class="progression-grid">
            <label
              >Posiciones de series originales<input
                v-model="slots[t.id]!.original"
                :data-original="t.id"
                placeholder="Ej.: 1,2,3"
                required /></label
            ><label
              >Posiciones de series ajustadas<input
                v-model="slots[t.id]!.adjusted"
                :data-adjusted="t.id"
                placeholder="Ej.: 1,2,3"
                required
            /></label>
          </div>
        </div>
        <p v-if="!context.history.tasks.length">
          No hay ejercicios ejecutados en este intervalo.
        </p>
        <label
          >Ejercicio ejecutado de referencia<select
            v-model="anchor"
            data-testid="anchor"
            required
          >
            <option value="" disabled>Selecciona la referencia</option>
            <option v-for="id in selection" :key="id" :value="id">
              {{ context.history.tasks.find((t) => t.id === id)?.performedOn }}
              · {{ id }}
            </option>
          </select></label
        >
        <div class="progression-grid">
          <label
            >Identificación explícita del protocolo<input
              v-model="protocol"
              data-testid="protocol"
              maxlength="120"
              required /></label
          ><label
            >Identificación explícita del equipo comparable<input
              v-model="equipment"
              data-testid="equipment"
              maxlength="120"
              required
          /></label>
        </div>
        <label
          ><input
            v-model="declared"
            data-testid="loadDeclaration"
            type="checkbox"
          />
          Declaro que las cargas seleccionadas y los objetivos indicados
          representan carga externa total y que el protocolo y equipo declarados
          son comparables.</label
        >
      </fieldset>
      <fieldset id="progression-analysis-policy" class="progression-form-step" :disabled="busy">
        <legend>4. Política explícita</legend>
        <p>
          Sin valores de entrenamiento predeterminados. Base de carga:
          prescripción de destino. Cohorte: ejercicios seleccionados. Cobertura:
          todas las series requeridas. 1RM: contexto descriptivo. Rejilla:
          redondeo inferior. Información: registros actuales al corte deportivo.
        </p>
        <div class="progression-grid">
          <label v-for="[key, label, options] in policyFields" :key="key"
            >{{ label
            }}<select
              v-if="options"
              v-model="fields[key]"
              :data-policy="key"
              required
            >
              <option value="" disabled>Selecciona un criterio</option>
              <option v-for="option in options" :key="option" :value="option">
                {{ option }}
              </option></select
            ><input
              v-else
              v-model="fields[key]"
              :data-policy="key"
              maxlength="120"
              required
          /></label>
        </div>
        <div
          v-if="fields.review && fields.review !== 'NOT_REQUIRED_EXPLICIT'"
          class="progression-grid"
        >
          <label
            v-for="[key, label, options] in signalFields.filter(
              ([key]) =>
                fields.review === 'TEMPORAL_SIGNAL' ||
                !['k', 'm'].includes(key),
            )"
            :key="key"
            >{{ label
            }}<select
              v-if="options"
              v-model="fields[key]"
              :data-policy="key"
              required
            >
              <option value="" disabled>Selecciona</option>
              <option v-for="o in options" :key="o">{{ o }}</option></select
            ><input v-else v-model="fields[key]" :data-policy="key" required
          /></label>
        </div>
        <button
          class="primary-button"
          data-testid="generate"
          :disabled="!context.configuration.selected || busy"
          type="submit"
        >
          Generar vista previa
        </button>
      </fieldset></template
    >
    <p v-if="problem" role="alert">{{ problem }}</p>
  </form>
</template>
