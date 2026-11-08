<script setup lang="ts">
import { computed, reactive, ref, useId } from 'vue'
import { setInputSchema, workoutWriteRejected, workoutErrorMessage, type SetInput, type SetRecord } from '../../services/workout-sessions.service'
const props = defineProps<{ initial?: SetRecord; nextNumber?: number; busy?: boolean; save: (input: SetInput, creationId: string) => Promise<unknown> }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const id = useId()
const creationId = crypto.randomUUID()
const form = reactive({ setNumber: String(props.initial?.setNumber ?? props.nextNumber ?? 1), status: props.initial ? props.initial.status ?? '' : 'COMPLETED', kind: props.initial ? props.initial.kind ?? '' : 'WORK', load: props.initial?.load ?? '', loadUnit: props.initial ? props.initial.loadUnit ?? '' : 'KG', repetitions: props.initial?.repetitions?.toString() ?? '', rpe: props.initial?.rpe?.toString() ?? '', notes: props.initial?.notes ?? '' })
const hasResults = computed(() => !['PENDING','SKIPPED'].includes(form.status))
const clearsResults = computed(() => Boolean(props.initial?.load != null && !hasResults.value))
const confirmClear = ref(false)
const pending = ref(false)
const submitted = ref<SetInput | null>(null)
const error = ref('')
async function submit() {
  if (pending.value || props.busy) return
  error.value = ''
  if (clearsResults.value && !confirmClear.value) { error.value = 'Confirma la retirada de los valores de esta serie.'; return }
  if (!submitted.value) {
    const input = { setNumber: Number(form.setNumber), status: form.status, kind: form.kind, load: hasResults.value ? form.load.trim().replace(',', '.') || null : null, loadUnit: hasResults.value ? form.loadUnit || null : null, repetitions: hasResults.value && String(form.repetitions).trim() ? Number(form.repetitions) : null, rpe: hasResults.value && String(form.rpe).trim() ? Number(form.rpe) : null, notes: form.notes.trim() || null }
    const parsed = setInputSchema.safeParse(input)
    if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'Revisa los resultados reales de la serie.'; return }
    submitted.value = parsed.data
  }
  pending.value = true
  try { await props.save(submitted.value, creationId); emit('saved') } catch (cause) { if (workoutWriteRejected(cause)) { submitted.value = null } error.value = workoutErrorMessage(cause, 'No se pudo guardar la serie.') } finally { pending.value = false }
}
</script>
<template>
  <form class="plan-form" novalidate :aria-busy="pending" @submit.prevent="submit"><h4>{{ initial ? 'Editar serie registrada' : 'Registrar serie' }}</h4><p>Introduce resultados reales. Los objetivos no se guardan como resultados automáticamente.</p><fieldset :disabled="pending || busy || Boolean(submitted)"><div class="plan-form-grid">
    <div><label class="field-label" :for="id+'-number'">Número de serie</label><input :id="id+'-number'" v-model="form.setNumber" class="form-control" type="number" min="1" max="1000" step="1" required></div>
    <div><label class="field-label" :for="id+'-kind'">Tipo</label><select :id="id+'-kind'" v-model="form.kind" class="form-control"><option value="">Selecciona un tipo</option><option value="WORK">Trabajo</option><option value="WARMUP">Calentamiento</option></select></div>
    <div><label class="field-label" :for="id+'-status'">Estado</label><select :id="id+'-status'" v-model="form.status" class="form-control"><option value="">Clasifica explícitamente la serie histórica</option><option value="COMPLETED">Completada</option><option value="INCOMPLETE">Incompleta</option><option value="FAILED">Intento fallido · 0 repeticiones</option><option value="PENDING">Pendiente · sin resultados</option><option value="SKIPPED">Omitida · sin resultados</option></select></div>
    <template v-if="hasResults"><div><label class="field-label" :for="id+'-reps'">Repeticiones realizadas</label><input :id="id+'-reps'" v-model="form.repetitions" class="form-control" type="number" min="0" max="10000" step="1" required></div><div><label class="field-label" :for="id+'-load'">Carga utilizada</label><input :id="id+'-load'" v-model="form.load" class="form-control" inputmode="decimal" placeholder="Ej. 77.5" required></div><div><label class="field-label" :for="id+'-unit'">Unidad de la carga real</label><select :id="id+'-unit'" v-model="form.loadUnit" class="form-control"><option value="">Selecciona la unidad conocida</option><option value="KG">kg</option><option value="LB">lb</option></select></div><div><label class="field-label" :for="id+'-rpe'">RPE real (opcional)</label><input :id="id+'-rpe'" v-model="form.rpe" class="form-control" type="number" min="0" max="10" step="0.1"></div></template>
  </div><label class="field-label" :for="id+'-notes'">Notas de la serie</label><textarea :id="id+'-notes'" v-model="form.notes" class="form-control" maxlength="4000" /><label v-if="clearsResults" class="field-label"><input v-model="confirmClear" type="checkbox"> Confirmo retirar los valores registrados de esta serie.</label></fieldset><p v-if="error" role="alert" class="form-error">{{ error }}</p><p v-if="submitted && error" class="field-hint">Reintentar conserva el mismo identificador y los mismos datos.</p><div class="plan-actions"><button class="primary-button" type="submit" :disabled="pending || busy">{{ pending ? 'Guardando…' : submitted ? 'Reintentar' : 'Guardar serie' }}</button><button class="text-button" type="button" :disabled="pending" @click="emit('cancel')">Cerrar</button></div></form>
</template>
