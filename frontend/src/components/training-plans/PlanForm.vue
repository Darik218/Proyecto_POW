<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import { createTrainingPlanSchema, updateTrainingPlanSchema, trainingPlanErrorMessage, type CreateTrainingPlan, type UpdateTrainingPlan, type TrainingPlan } from '../../services/training-plans.service'
const props = defineProps<{ initial?: TrainingPlan; busy?: boolean; save: (input: CreateTrainingPlan | UpdateTrainingPlan) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const form = reactive({ name: props.initial?.name ?? '', startsOn: props.initial?.startsOn?.slice(0, 10) ?? '', endsOn: props.initial?.endsOn?.slice(0, 10) ?? '' })
const pending = ref(false)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  const values={name:form.name,...(form.startsOn||!props.initial||props.initial.startsOn?{startsOn:form.startsOn}:{}),endsOn:form.endsOn||null}
  const parsed = (props.initial?updateTrainingPlanSchema:createTrainingPlanSchema).safeParse(values)
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los campos.'; return }
  pending.value = true
  try { await props.save(parsed.data); emit('saved') }
  catch (cause) { error.value = trainingPlanErrorMessage(cause, 'No se pudo guardar el plan.') }
  finally { pending.value = false }
}
</script>

<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit">
    <h2>{{ initial ? 'Editar plan' : 'Nuevo plan' }}</h2>
    <fieldset :disabled="pending || busy">
      <label class="field-label" :for="id + '-name'">Nombre</label>
      <input :id="id + '-name'" v-model="form.name" class="form-control" required maxlength="160" autocomplete="off">
      <div class="plan-form-grid">
        <div><label class="field-label" :for="id + '-start'">Fecha inicial</label><input :id="id + '-start'" v-model="form.startsOn" class="form-control" type="date" :required="!initial || !!initial.startsOn"></div>
        <div><label class="field-label" :for="id + '-end'">Fecha final (opcional)</label><input :id="id + '-end'" v-model="form.endsOn" class="form-control" type="date" :min="form.startsOn || undefined"></div>
      </div>
      <p v-if="initial" class="field-hint">La fecha general no reprograma automáticamente semanas ni entrenamientos existentes.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="plan-actions"><button class="primary-button" type="submit">{{ pending ? 'Guardando…' : 'Guardar plan' }}</button><button class="text-button" type="button" @click="emit('cancel')">Cancelar</button></div>
    </fieldset>
  </form>
</template>
