<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ExercisePicker from '../training-plans/ExercisePicker.vue'
import {
  trainingPlansService,
  type TrainingPlan,
} from '../../services/training-plans.service'
import type {
  SettingRecord,
  SettingParameters,
  SettingScope,
  SettingImpact,
} from '../../types/progression-settings'
import { settingScopeSchema } from '../../schemas/progression-settings.schema'
import {
  settingParameterFields,
  settingFormValues,
  settingFormParameters,
} from '../../utils/setting-form'
const props = defineProps<{
  initial?: SettingRecord
  busy: boolean
  impact: SettingImpact | null
  session: string
  initialExerciseId?: string
  initialPlanId?: string
}>()
const emit = defineEmits<{
  create: [scope: SettingScope, parameters: SettingParameters]
  preview: [parameters: SettingParameters]
  replace: [parameters: SettingParameters, confirmed: true]
  change: []
}>()
const fields = reactive(settingFormValues(props.initial?.parameters)),
  scopeKind = ref(props.initial?.scope ?? ''),
  exerciseId = ref(props.initial?.exerciseId ?? props.initialExerciseId ?? ''),
  planId = ref(props.initial?.trainingPlanId ?? props.initialPlanId ?? ''),
  plans = ref<TrainingPlan[]>([]),
  confirmed = ref(false),
  problem = ref('')
let alive = true
const stamp = props.session
onMounted(async () => {
  try {
    const value = await trainingPlansService.list()
    if (alive && stamp === props.session) plans.value = value
  } catch {
    if (alive) problem.value = 'No se pudieron consultar los planes propios.'
  }
})
onUnmounted(() => {
  alive = false
})
watch(
  [fields, scopeKind, exerciseId, planId],
  () => {
    confirmed.value = false
    emit('change')
  },
  { deep: true },
)
watch(
  () => [props.impact, props.session],
  () => {
    confirmed.value = false
  },
)
function send(preview = false) {
  problem.value = ''
  try {
    const parameters = settingFormParameters(fields)
    if (props.initial) {
      if (preview) emit('preview', parameters)
      else if (confirmed.value && props.impact) {
        confirmed.value = false
        emit('replace', parameters, true)
      }
    } else {
      if (!scopeKind.value) throw Error()
      const scope = settingScopeSchema.parse({
        exerciseId: scopeKind.value === 'ATHLETE' ? null : exerciseId.value,
        trainingPlanId:
          scopeKind.value === 'EXERCISE_PLAN' ? planId.value : null,
      })
      emit('create', scope, parameters)
    }
  } catch {
    problem.value =
      'Completa el ámbito y todos los parámetros obligatorios. Usa cadenas decimales; los campos opcionales vacíos representan null, sin heredar otros valores.'
  }
}
</script>
<template>
  <form class="progression-form" @submit.prevent="send(false)">
    <nav class="progression-context-nav" aria-label="Secciones del formulario"><a href="#setting-draft-scope">1. Ámbito</a><a href="#setting-draft-parameters">2. Parámetros</a></nav>
    <p v-if="problem" role="alert">{{ problem }}</p>
    <fieldset id="setting-draft-scope" class="progression-form-step" :disabled="busy">
      <legend>1. Ámbito de la fila completa</legend>
      <template v-if="!initial">
        <label
          >Ámbito<select
            v-model="scopeKind"
            data-testid="settingScope"
            required
          >
            <option value="" disabled>Selecciona ámbito</option>
            <option value="ATHLETE">General del atleta</option>
            <option value="EXERCISE">Ejercicio</option>
            <option value="EXERCISE_PLAN">Ejercicio dentro de un plan</option>
          </select></label
        >
        <ExercisePicker
          v-if="scopeKind === 'EXERCISE' || scopeKind === 'EXERCISE_PLAN'"
          v-model="exerciseId"
          :disabled="busy"
        />
        <label v-if="scopeKind === 'EXERCISE_PLAN'"
          >Plan que contiene el ejercicio<select
            v-model="planId"
            data-testid="settingPlan"
            required
          >
            <option value="" disabled>Selecciona plan propio</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.status }}
            </option>
          </select></label
        >
      </template>
      <p v-else>
        {{ initial.scope }} · {{ initial.exerciseName ?? 'General' }} ·
        {{ initial.planName ?? 'Sin plan' }}. El ámbito no se cambia al editar;
        crea otra configuración si corresponde.
      </p>
    </fieldset>
    <fieldset id="setting-draft-parameters" class="progression-form-step" :disabled="busy">
      <legend>2. Parámetros persistidos</legend>
      <div class="progression-grid">
        <label v-for="[key, label] in settingParameterFields" :key="key"
          >{{ label
          }}<input
            v-model="fields[key]"
            :data-setting-param="key"
            :inputmode="key === 'minSuccessfulSessions' ? 'numeric' : 'decimal'"
            :required="
              !['incrementPercent', 'incrementAbsolute', 'maxLoad'].includes(
                key,
              )
            "
            type="text"
        /></label>
      </div>
    </fieldset>
    <p>
      Incremento porcentual, absoluto y carga máxima pueden ser null explícito.
      Debe existir al menos un incremento positivo. Si guardas ambos, la
      política tendrá que elegir el modo. No se mezclan valores con otra fila.
    </p>
    <p>
      La unidad no se almacena en ProgressionSetting: la política explícita debe
      declarar KG o LB y una rejilla compatible antes de interpretar cargas. No
      se infiere tu unidad preferida.
    </p>
    <p>
      El default técnico del esquema para sesiones es 3; este formulario no lo
      aplica. Debes introducir tu configuración; no representa una recomendación
      científica.
    </p>
    <p v-if="initial">
      Preferencia histórica autoApplyAuthorized:
      {{ initial.historicalAutoApplyAuthorized }}. Información de solo lectura,
      sin efecto de consentimiento o ejecución automática. Revisión
      {{ initial.revision }}.
    </p>
    <template v-if="initial">
      <button
        type="button"
        class="secondary-button"
        data-testid="settingImpact"
        :disabled="busy"
        @click="send(true)"
      >
        Revisar compatibilidad e impacto
      </button>
      <section
        v-if="impact"
        class="progression-card"
        data-testid="settingImpactResult"
      >
        <h2>Consecuencias de esta sustitución</h2>
        <p>
          Las recomendaciones que usan esta fila pueden requerir revalidación,
          incluso si solo avanza su revisión. No se reescribirá evidencia ni se
          aplicarán cargas.
        </p>
        <p>
          {{ impact.recommendationIds.length }} recomendaciones identificadas ·
          cobertura {{ impact.coverage }}.
        </p>
        <p v-for="c in impact.consents" :key="c.id">
          Consentimiento {{ c.id }} · después del cambio {{ c.compatibility }} ·
          desafío pendiente puede quedar obsoleto {{ c.challengeMayBeStale }}.
          Su aceptación histórica permanece intacta.
        </p>
        <label
          ><input
            v-model="confirmed"
            type="checkbox"
            data-testid="confirmSettingImpact"
            :disabled="busy"
          />Confirmo sustituir los parámetros completos después de revisar sus
          consecuencias. Esto no acepta ni autoriza progresión
          automática.</label
        >
      </section>
    </template>
    <button
      type="submit"
      class="primary-button"
      data-testid="saveSetting"
      :disabled="busy || (!!initial && (!impact || !confirmed))"
    >
      {{ initial ? 'Guardar sustitución completa' : 'Crear configuración' }}
    </button>
  </form>
</template>
