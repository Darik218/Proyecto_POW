<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue'
import type {
  ConsentChallenge,
  ConsentAcknowledgments,
} from '../../types/automation-consent'
import ConsentConditions from './ConsentConditions.vue'
const props = defineProps<{
  challenge: ConsentChallenge | null
  busy: boolean
  session: string
}>()
const emit = defineEmits<{
  request: []
  accept: [acknowledgments: ConsentAcknowledgments, conditionsPresented: true]
}>()
const acknowledgments = reactive({
    policy: false,
    limits: false,
    destinations: false,
    validity: false,
    revocation: false,
  }),
  now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  ;(timer as unknown as { unref?: () => void }).unref?.()
})
onUnmounted(() => clearInterval(timer))
function reset() {
  for (const k of Object.keys(
    acknowledgments,
  ) as (keyof typeof acknowledgments)[])
    acknowledgments[k] = false
}
watch(() => [props.challenge?.id, props.session], reset, { immediate: true })
const expired = computed(
    () =>
      !!props.challenge && now.value >= Date.parse(props.challenge.expiresAt),
  ),
  ready = computed(
    () =>
      !!props.challenge &&
      !expired.value &&
      !props.busy &&
      Object.values(acknowledgments).every(Boolean),
  )
watch(expired, (v) => {
  if (v) reset()
})
function confirm() {
  if (!ready.value) return
  const a = { ...acknowledgments } as ConsentAcknowledgments
  reset()
  emit('accept', a, true)
}
</script>
<template>
  <section class="progression-card progression-acceptance" data-testid="humanAcceptance">
    <h2>Aceptación humana, sin ejecución habilitada</h2>
    <p>
      Confirmar registra esta versión de las condiciones. No aplica incrementos
      ni habilita progresión automática. Puedes revocar después; cambiar
      condiciones requerirá otra solicitud y aceptación.
    </p>
    <button
      type="button"
      class="secondary-button"
      data-testid="requestAcceptanceChallenge"
      :disabled="busy"
      @click="emit('request')"
    >
      Obtener condiciones para confirmar
    </button>
    <template v-if="challenge">
      <p>
        Consentimiento {{ challenge.consentId }} · versión
        {{ challenge.version }} · condiciones {{ challenge.termsVersion }} ·
        presentación {{ challenge.presentationVersion }}.
      </p>
      <p>
        Desafío válido hasta {{ challenge.expiresAt }}. Huella de contrato
        {{ challenge.contractKey }}. Huella de condiciones
        {{ challenge.conditionsKey }}.
      </p>
      <ConsentConditions
        :value="challenge.snapshot"
        title="Condiciones exactas presentadas para esta aceptación"
      />
      <p v-if="expired" role="alert">
        El desafío ha caducado. Obtén las condiciones otra vez; las
        confirmaciones anteriores no se reutilizan.
      </p>
      <fieldset :disabled="busy || expired">
        <legend>Confirmaciones explícitas de esta versión</legend>
        <label
          ><input
            v-model="acknowledgments.policy"
            type="checkbox"
            data-testid="acceptPolicy"
          />Confirmo la política matemática, sus versiones y configuración
          efectiva mostradas.</label
        >
        <label
          ><input
            v-model="acknowledgments.limits"
            type="checkbox"
            data-testid="acceptLimits"
          />Confirmo los límites, unidades, incrementos, rejilla y frecuencia
          exactos mostrados.</label
        >
        <label
          ><input
            v-model="acknowledgments.destinations"
            type="checkbox"
            data-testid="acceptDestinations"
          />Confirmo únicamente el ejercicio, plan y prescripciones
          enumerados.</label
        >
        <label
          ><input
            v-model="acknowledgments.validity"
            type="checkbox"
            data-testid="acceptValidity"
          />Confirmo el período [inicio, fin) y la zona horaria
          mostrados.</label
        >
        <label
          ><input
            v-model="acknowledgments.revocation"
            type="checkbox"
            data-testid="acceptRevocation"
          />Reconozco cómo revocar y que esta aceptación no autoriza ejecución
          automática.</label
        >
      </fieldset>
      <button
        type="button"
        class="primary-button"
        data-testid="confirmHumanAcceptance"
        :disabled="!ready"
        @click="confirm"
      >
        Registrar aceptación sin ejecución
      </button>
    </template>
  </section>
</template>
