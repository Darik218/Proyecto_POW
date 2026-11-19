<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import ExercisePicker from '../training-plans/ExercisePicker.vue'
import {
  trainingPlansService,
  type TrainingPlan,
} from '../../services/training-plans.service'
import {
  automationConsentService,
  consentError,
} from '../../services/automation-consent.service'
import { consentContractSchema } from '../../schemas/automation-consent.schema'
import {
  policyFields,
  signalFields,
  buildProgressionPolicy,
} from '../../utils/progression-inputs'
import { contractFields, policyFormValues } from '../../utils/consent-form'
import type {
  ConsentContract,
  ConsentCandidates,
  ConsentSnapshot,
} from '../../types/automation-consent'
const props = defineProps<{ initial?: ConsentSnapshot; busy: boolean }>(),
  emit = defineEmits<{ preview: [contract: ConsentContract]; change: [] }>()
const initial = props.initial?.contract,
  form = reactive(contractFields(initial)),
  policy = reactive(policyFormValues(initial?.policy)),
  plans = ref<TrainingPlan[]>([]),
  candidates = ref<ConsentCandidates | null>(null),
  items = ref<ConsentCandidates['items']>([]),
  targetIds = ref<string[]>([...(initial?.selector.prescriptionIds ?? [])]),
  taskIds = ref<string[]>(
    initial?.policy.cohort.mode === 'EXPLICIT_TASK_SET'
      ? [...initial.policy.cohort.taskIds]
      : [],
  ),
  anchor = ref(initial?.policy.assessment.count?.anchorTaskId ?? ''),
  minimumSessions = ref(
    initial?.policy.assessment.count
      ? String(initial.policy.assessment.count.minimumSessions)
      : '',
  ),
  slots = reactive<Record<string, { original: string; adjusted: string }>>(
    Object.fromEntries(
      initial?.policy.assessment.compliance?.slots.map((s) => [
        s.taskId,
        { original: s.original.join(','), adjusted: s.adjusted.join(',') },
      ]) ?? [],
    ),
  ),
  problem = ref(''),
  loading = ref(false),
  declaration = ref(false)
const auth = useAuthStore(),
  session = () => `${auth.user?.id ?? ''}:${auth.getSessionGeneration()}`
for (const id of taskIds.value) slots[id] ??= { original: '', adjusted: '' }
let request = 0
let mounted = true
onUnmounted(() => {
  mounted = false
  request++
})
onMounted(async () => {
  const s = session()
  try {
    const values = await trainingPlansService.list()
    if (mounted && s === session()) plans.value = values
  } catch {
    if (mounted && s === session())
      problem.value = 'No se pudieron consultar los planes.'
  }
})
watch(
  [() => form.exerciseId, () => form.planId, () => form.scope, () => form.unit],
  () => {
    request++
    candidates.value = null
    items.value = []
    targetIds.value = []
    taskIds.value = []
    anchor.value = ''
    declaration.value = false
    emit('change')
  },
)
watch(
  [
    form,
    policy,
    targetIds,
    taskIds,
    anchor,
    minimumSessions,
    slots,
    declaration,
  ],
  () => emit('change'),
  { deep: true },
)
const tasks = computed(() => [
  ...(candidates.value?.tasks ?? []),
  ...taskIds.value
    .filter((id) => !candidates.value?.tasks.some((t) => t.id === id))
    .map((id) => ({ id, performedOn: null, sessionId: '' })),
])
async function load(page = 1) {
  if (
    !form.exerciseId ||
    !['KG', 'LB'].includes(form.unit) ||
    (form.scope === 'PLAN' && !form.planId) ||
    !form.scope
  ) {
    problem.value = 'Selecciona ejercicio, unidad y alcance explícitos.'
    return
  }
  const n = ++request,
    s = session()
  loading.value = true
  problem.value = ''
  try {
    const value = await automationConsentService.candidates({
      exerciseId: form.exerciseId,
      unit: form.unit as 'KG' | 'LB',
      ...(form.scope === 'PLAN' ? { trainingPlanId: form.planId } : {}),
      page,
    })
    if (n !== request || s !== session()) return
    candidates.value = value
    items.value =
      page === 1 ? [...value.items] : [...items.value, ...value.items]
  } catch (e) {
    if (n === request) problem.value = consentError(e).message
  } finally {
    if (n === request) loading.value = false
  }
}
function toggleTask(id: string, checked: boolean) {
  taskIds.value = checked
    ? [...taskIds.value, id]
    : taskIds.value.filter((v) => v !== id)
  slots[id] ??= { original: '', adjusted: '' }
}
function submit() {
  problem.value = ''
  try {
    if (
      !declaration.value ||
      !taskIds.value.includes(anchor.value) ||
      !['true', 'false'].includes(policy.closed ?? '') ||
      !candidates.value
    )
      throw Error()
    const p = buildProgressionPolicy(
      { ...policy, unit: form.unit },
      slots,
      taskIds.value,
      anchor.value,
      { minSuccessfulSessions: Number(minimumSessions.value) },
    )
    const contract = consentContractSchema.parse({
      schemaVersion: 'automation-consent-contract-v1',
      exerciseId: form.exerciseId,
      trainingPlanId: form.scope === 'PLAN' ? form.planId : null,
      policy: p,
      historyWindowDays: Number(form.historyWindowDays),
      limits: {
        unit: form.unit,
        loadMeaning: 'EXTERNAL_TOTAL',
        maximumAbsoluteIncrement: form.maximumAbsoluteIncrement,
        maximumPercentIncrement: form.maximumPercentIncrement,
        maximumLoad: form.maximumLoad,
        maximumApplicationsPerWeek: Number(form.maximumApplicationsPerWeek),
        weekStartsOn: Number(form.weekStartsOn),
      },
      selector: {
        kind: 'EXACT_PRESCRIPTION_ALLOWLIST',
        prescriptionIds: targetIds.value,
        futureOnly: true,
        planState: 'DRAFT',
        versionPolicy: 'READ_CURRENT_AND_CAS',
      },
      validity: {
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        timeZone: form.timeZone,
      },
      termsVersion: form.termsVersion,
      provenance: {
        source: 'INTERNAL_CONFIGURATION_REQUEST',
        reference: form.reference,
      },
    })
    emit('preview', contract)
  } catch {
    problem.value =
      'Completa condiciones, destinos, referencias históricas, posiciones de series y política. Revisa las fechas ISO con offset y la configuración registrada.'
  }
}
</script>
<template>
  <form class="progression-form" @submit.prevent="submit">
    <nav class="progression-context-nav" aria-label="Secciones del formulario"><a href="#consent-draft-scope">1. Alcance</a><a href="#consent-draft-targets">2. Destinos</a><a href="#consent-draft-policy">3. Evidencia y política</a><a href="#consent-draft-limits">4. Límites y vigencia</a></nav>
    <fieldset id="consent-draft-scope" class="progression-form-step" :disabled="busy || loading">
      <legend>1. Alcance exacto de la solicitud</legend>
      <ExercisePicker
        v-if="!initial"
        v-model="form.exerciseId"
        :disabled="busy || loading"
      />
      <p v-else>
        Ejercicio conservado: {{ form.exerciseId }}. Cambiar ejercicio o plan
        requiere otra solicitud.
      </p>
      <div class="progression-grid">
        <label
          >Alcance del plan<select
            v-model="form.scope"
            data-consent="scope"
            :disabled="!!initial"
            required
          >
            <option value="" disabled>Selecciona el alcance</option>
            <option value="PLAN">Un plan explícito</option>
            <option value="EXACT_IDS">
              Solo las prescripciones elegidas, sin ampliar a todos los planes
            </option>
          </select></label
        ><label v-if="form.scope === 'PLAN'"
          >Plan<select
            v-model="form.planId"
            data-consent="plan"
            :disabled="!!initial"
            required
          >
            <option value="" disabled>Selecciona el plan</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.status }}
            </option>
          </select></label
        ><label
          >Unidad declarada de límites, configuración y rejilla<select
            v-model="form.unit"
            data-consent="unit"
            required
          >
            <option value="" disabled>Selecciona unidad</option>
            <option>KG</option>
            <option>LB</option>
          </select></label
        >
      </div>
      <button
        type="button"
        class="secondary-button"
        data-testid="consentCandidates"
        @click="load()"
      >
        Consultar destinos y configuración
      </button>
      <p>
        No se elige ningún destino por defecto. Los candidatos son
        configurables; esto no acredita una fecha futura aplicable.
      </p>
    </fieldset>
    <fieldset id="consent-draft-targets" class="progression-form-step" :disabled="busy || loading">
      <legend>2. Prescripciones incluidas explícitamente</legend>
      <p v-if="candidates && !items.length">
        No hay candidatos en esta página con la unidad y las restricciones
        actuales.
      </p>
      <label v-for="p in items" :key="p.prescriptionId"
        ><input
          v-model="targetIds"
          type="checkbox"
          :value="p.prescriptionId"
          :data-target="p.prescriptionId"
        />
        {{ p.planName }} → semana {{ p.weekNumber }} → {{ p.dayName }} ·
        {{ p.load }} {{ p.unit }} · versión {{ p.recordedPlanVersion }}</label
      ><label
        v-for="id in targetIds.filter(
          (id) => !items.some((p) => p.prescriptionId === id),
        )"
        :key="id"
        ><input v-model="targetIds" type="checkbox" :value="id" /> Prescripción
        conservada {{ id }}: no está en los candidatos cargados. La
        previsualización comprobará su disponibilidad.</label
      ><button
        v-if="candidates?.hasMore"
        type="button"
        class="secondary-button"
        @click="load(candidates.page + 1)"
      >
        Cargar más candidatos
      </button>
    </fieldset>
    <section v-if="candidates" class="progression-card">
      <h2>Configuración vigente consultada (página actual)</h2>
      <p v-if="!candidates.settings.some((s) => s.selected)">
        Falta configuración registrada aplicable. No se inventarán incrementos
        ni criterios.
      </p>
      <p v-for="s in candidates.settings" :key="s.planId">
        Plan {{ s.planId }} · {{ s.scope ?? 'Sin configuración' }} · mínimo
        {{ s.selected?.minSuccessfulSessions ?? 'Desconocido' }} sesiones · RPE
        {{ s.selected?.targetRpeMin ?? '?' }}–{{
          s.selected?.targetRpeMax ?? '?'
        }}
        · absoluto {{ s.selected?.incrementAbsolute ?? 'No configurado' }}
        {{ form.unit }} · porcentual
        {{ s.selected?.incrementPercent ?? 'No configurado' }}% · límite
        {{ s.selected?.maxIncrementPercent ?? '?' }}% · carga máxima
        {{ s.selected?.maxLoad ?? 'No configurada' }} {{ form.unit }}.
      </p>
      <p>
        La preferencia guardada no es consentimiento. El servidor comprobará la
        política completa para cada plan; no se combinarán configuraciones.
      </p>
    </section>
    <fieldset id="consent-draft-policy" class="progression-form-step" :disabled="busy">
      <legend>3. Política y evidencia de referencia</legend>
      <p v-if="candidates && !tasks.length">
        No hay referencias completas disponibles. Esta política exige una
        referencia real para el conteo; no se fabricará una.
      </p>
      <p>
        Las referencias son explícitas y no autorizan resolver automáticamente
        futuras cohortes. La aceptación recurrente efectiva sigue bloqueada.
      </p>
      <p v-if="candidates?.tasksTruncated">
        Se muestran las 100 referencias más recientes; no se presume historial
        completo.
      </p>
      <div v-for="t in tasks" :key="t.id" class="progression-card">
        <label
          ><input
            type="checkbox"
            :checked="taskIds.includes(t.id)"
            :data-consent-task="t.id"
            @change="
              toggleTask(t.id, ($event.target as HTMLInputElement).checked)
            "
          />
          {{
            t.performedOn ?? 'Referencia histórica conservada; fecha no cargada'
          }}
          · {{ t.id }}</label
        >
        <div v-if="taskIds.includes(t.id)" class="progression-grid">
          <label
            >Posiciones originales<input
              v-model="slots[t.id]!.original"
              :data-consent-original="t.id"
              placeholder="1,2,3"
              required /></label
          ><label
            >Posiciones ajustadas<input
              v-model="slots[t.id]!.adjusted"
              :data-consent-adjusted="t.id"
              placeholder="1,2,3"
              required
          /></label>
        </div>
      </div>
      <label
        >Referencia para el conteo<select
          v-model="anchor"
          data-consent="anchor"
          required
        >
          <option value="" disabled>Selecciona una referencia</option>
          <option v-for="id in taskIds" :key="id">{{ id }}</option>
        </select></label
      ><label
        >Mínimo de sesiones según configuración aplicable<input
          v-model="minimumSessions"
          data-consent="minimumSessions"
          inputmode="numeric"
          required
      /></label>
      <div class="progression-grid">
        <label
          v-for="[key, label, options] in policyFields.filter(
            ([key]) => key !== 'unit',
          )"
          :key="key"
          >{{ label
          }}<select
            v-if="options"
            v-model="policy[key]"
            :data-consent-policy="key"
            required
          >
            <option value="" disabled>Selecciona</option>
            <option v-for="o in options" :key="o">{{ o }}</option></select
          ><input
            v-else
            v-model="policy[key]"
            :data-consent-policy="key"
            maxlength="120"
            required
        /></label>
      </div>
      <div
        v-if="policy.review && policy.review !== 'NOT_REQUIRED_EXPLICIT'"
        class="progression-grid"
      >
        <label
          v-for="[key, label, options] in signalFields.filter(
            ([key]) =>
              policy.review === 'TEMPORAL_SIGNAL' || !['k', 'm'].includes(key),
          )"
          :key="key"
          >{{ label
          }}<select
            v-if="options"
            v-model="policy[key]"
            :data-consent-policy="key"
            required
          >
            <option value="" disabled>Selecciona</option>
            <option v-for="o in options" :key="o">{{ o }}</option></select
          ><input
            v-else
            v-model="policy[key]"
            :data-consent-policy="key"
            required
        /></label>
      </div>
      <label
        ><input
          v-model="declaration"
          data-consent="declaration"
          type="checkbox"
        />
        Declaro para esta solicitud la interpretación de carga externa total de
        los objetivos y referencias seleccionados.</label
      >
    </fieldset>
    <fieldset id="consent-draft-limits" class="progression-form-step" :disabled="busy">
      <legend>4. Límites, frecuencia y vigencia [inicio, fin)</legend>
      <div class="progression-grid">
        <label
          v-for="[key, label] in [
            ['maximumAbsoluteIncrement', 'Incremento absoluto máximo'],
            ['maximumPercentIncrement', 'Incremento porcentual máximo (%)'],
            ['maximumLoad', 'Carga máxima'],
            ['maximumApplicationsPerWeek', 'Máximo de aplicaciones semanales'],
            ['historyWindowDays', 'Ventana histórica máxima (días)'],
            ['weekStartsOn', 'Primer día semanal ISO (1–7)'],
            ['startsAt', 'Inicio ISO con offset explícito'],
            ['endsAt', 'Fin exclusivo ISO con offset explícito'],
            ['timeZone', 'Zona horaria IANA'],
            ['termsVersion', 'Versión de condiciones'],
            ['reference', 'Procedencia / motivo de la solicitud'],
          ]"
          :key="key"
          >{{ label }}
          <span
            v-if="['maximumAbsoluteIncrement', 'maximumLoad'].includes(key)"
            >{{ form.unit }}</span
          ><input
            v-model="form[key as keyof typeof form]"
            :data-consent="key"
            :placeholder="
              ['startsAt', 'endsAt'].includes(key)
                ? '2026-12-01T09:00:00-05:00'
                : undefined
            "
            required
        /></label>
      </div>
      <p>
        No se usa la zona del navegador para convertir instantes. El servidor
        conserva el instante normalizado y la zona declarada.
      </p>
      <button
        class="primary-button"
        type="submit"
        data-testid="consentPreview"
        :disabled="busy || loading"
      >
        Revisar condiciones con el servidor
      </button>
    </fieldset>
    <p v-if="loading" role="status">Consultando destinos y configuración…</p>
    <p v-if="problem" role="alert">{{ problem }}</p>
  </form>
</template>
