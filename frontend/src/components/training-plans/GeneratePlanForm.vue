<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { generateRoutineSchema, routineService } from '../../services/routine.service'
import { trainingPlanErrorMessage, weekdayLabel } from '../../services/training-plans.service'
const emit = defineEmits<{ created: [id: string]; cancel: [] }>()
const form = reactive({
  name: '',
  durationWeeks: 8,
  frequency: 3,
  startsOn: '',
  days: Array.from({ length: 3 }, (_, i) => ({
    name: `Día ${i + 1}`,
    weekday: null as number | null,
  })),
})
const busy = ref(false),
  error = ref(''),
  details = ref(false)
const summary = computed(
  () =>
    `${form.durationWeeks} semanas · ${form.frequency} días iniciales por semana. Podrás adaptarlos después.`,
)
watch(
  () => form.frequency,
  (n) => {
    if (n >= 1 && n <= 7)
      form.days = Array.from(
        { length: n },
        (_, i) => form.days[i] ?? { name: `Día ${i + 1}`, weekday: null },
      )
  },
)
let intent: { key: string; id: string } | undefined
async function save() {
  if (busy.value) return
  error.value = ''
  const values = {
    ...form,
    startsOn: form.startsOn || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  const key = JSON.stringify(values)
  if (intent?.key !== key) intent = { key, id: crypto.randomUUID() }
  const parsed = generateRoutineSchema.safeParse({ ...values, id: intent!.id })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Revisa los campos.'
    return
  }
  busy.value = true
  try {
    const result = await routineService.generate(parsed.data)
    emit('created', result.id)
  } catch (cause) {
    error.value = trainingPlanErrorMessage(cause, 'No se pudo crear el plan.')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form class="state-card routine-form" @submit.prevent="save">
    <h2>Tu plan, en un paso</h2>
    <label class="field-label" for="routine-name">Nombre del plan</label
    ><input
      id="routine-name"
      v-model="form.name"
      class="form-control"
      maxlength="160"
      required
      :disabled="busy"
    />
    <div class="routine-grid">
      <div>
        <label class="field-label" for="routine-weeks">Duración en semanas</label
        ><input
          id="routine-weeks"
          v-model.number="form.durationWeeks"
          class="form-control"
          type="number"
          min="1"
          max="52"
          required
          :disabled="busy"
        />
      </div>
      <div>
        <label class="field-label" for="routine-frequency">Días iniciales por semana</label
        ><input
          id="routine-frequency"
          v-model.number="form.frequency"
          class="form-control"
          type="number"
          min="1"
          max="7"
          required
          :disabled="busy"
        />
      </div>
    </div>
    <p>{{ summary }}</p>
    <button class="text-button" type="button" :aria-expanded="details" @click="details = !details">
      {{ details ? 'Ocultar opciones' : 'Personalizar nombres, calendario y fecha inicial' }}
    </button>
    <div v-if="details">
      <label class="field-label" for="routine-start">Fecha inicial (opcional)</label
      ><input
        id="routine-start"
        v-model="form.startsOn"
        class="form-control"
        type="date"
        :disabled="busy"
      />
      <p class="field-hint">
        Sin fecha, la rutina permanece flexible. Los días fijos se ubican dentro de los siete días
        de cada semana fechada.
      </p>
      <fieldset v-for="(day, index) in form.days" :key="index" class="routine-day-fields">
        <legend>Día {{ index + 1 }}</legend>
        <label :for="'routine-day-' + index">Nombre</label
        ><input
          :id="'routine-day-' + index"
          v-model="day.name"
          class="form-control"
          required
          maxlength="160"
          :disabled="busy"
        /><label :for="'routine-weekday-' + index">Programación</label
        ><select
          :id="'routine-weekday-' + index"
          v-model="day.weekday"
          class="form-control"
          :disabled="busy"
        >
          <option :value="null">Flexible</option>
          <option v-for="n in 7" :key="n" :value="n">{{ weekdayLabel(n) }}</option>
        </select>
      </fieldset>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="plan-actions">
      <button class="primary-button" :disabled="busy">
        {{ busy ? 'Creando semanas y días…' : 'Crear mi plan' }}</button
      ><button class="text-button" type="button" :disabled="busy" @click="emit('cancel')">
        Cancelar
      </button>
    </div>
  </form>
</template>
