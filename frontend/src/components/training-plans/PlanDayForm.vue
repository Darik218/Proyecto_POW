<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import { createPlanDaySchema, updatePlanDaySchema, trainingPlanErrorMessage, type PlanDay, type CreatePlanDay, type UpdatePlanDay } from '../../services/training-plans.service'
const props = defineProps<{ initial?: PlanDay; nextPosition?: number; busy: boolean; save: (input: CreatePlanDay | UpdatePlanDay) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const form = reactive({ name: props.initial?.name ?? '', position: String(props.nextPosition ?? 1), weekday: props.initial?.weekday?.toString() ?? '' })
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  const input = { name: form.name, weekday: form.weekday === '' ? null : Number(form.weekday), ...(!props.initial ? { position: Number(form.position) } : {}) }
  const parsed = (props.initial ? updatePlanDaySchema : createPlanDaySchema).safeParse(input)
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los campos.'; return }
  pending.value = true
  try { await props.save(parsed.data); emit('saved') }
  catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo guardar el día.') }
  finally { pending.value = false }
}
</script>
<template>
  <form class="plan-form training-editor" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h3>{{ initial ? 'Editar día' : 'Crear día o bloque' }}</h3>
    <fieldset :disabled="busy || pending"><legend class="training-section-legend">Bloque de entrenamiento</legend>
      <label class="field-label" :for="id + '-name'">Nombre del entrenamiento</label><input :id="id + '-name'" v-model="form.name" class="form-control" maxlength="160" required placeholder="Ej. Tren superior A">
      <div class="plan-form-grid">
        <div v-if="!initial"><label class="field-label" :for="id + '-position'">Posición en la semana</label><input :id="id + '-position'" v-model="form.position" class="form-control" type="number" min="1" max="1000" step="1" required></div>
        <div><label class="field-label" :for="id + '-weekday'">Programación</label><select :id="id + '-weekday'" v-model="form.weekday" class="form-control"><option value="">Flexible · sin día fijo</option><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="7">Domingo</option></select></div>
      </div>
      <p class="field-hint">Puedes programar varios bloques en el mismo día semanal.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar día' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cancelar</button></div>
    </fieldset>
  </form>
</template>
