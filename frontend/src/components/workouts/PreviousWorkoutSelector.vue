<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'
import { useWorkoutSessions } from '../../composables/useWorkoutSessions'
const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const { sessions, total, offset, loading, error, load, dispose } = useWorkoutSessions()
const page = ref(0)
function go(direction: number) { page.value = Math.max(0, page.value + direction * 20); void load({ status: 'COMPLETED', offset: page.value }) }
onMounted(() => void load({ status: 'COMPLETED' }))
onUnmounted(dispose)
</script>
<template>
  <div><label class="field-label" :for="id">Entrenamiento anterior</label><p v-if="loading" role="status">Cargando historial…</p><select :id="id" :value="modelValue" class="form-control" :disabled="disabled || loading" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option value="">Selecciona un entrenamiento</option><option v-if="modelValue && !sessions.some(item => item.id === modelValue)" :value="modelValue">Entrenamiento seleccionado desde el historial</option><option v-for="item in sessions" :key="item.id" :value="item.id">{{ item.name ?? item.sourceSnapshot?.day?.name ?? 'Entrenamiento' }} · {{ item.performedOn?.slice(0,10) ?? 'Fecha local no registrada' }}</option></select><p>Se copiarán la estructura y los objetivos ajustados. Las series realizadas y el feedback no se copiarán.</p><p v-if="!loading && !sessions.length && !error">No hay entrenamientos finalizados.</p><p v-if="error" role="alert" class="form-error">{{ error }} <button class="text-button" type="button" @click="load({ status: 'COMPLETED', offset: page })">Reintentar</button></p><div v-if="total > 20" class="plan-actions"><button class="text-button" type="button" :disabled="disabled || loading || offset === 0" @click="go(-1)">Anteriores</button><button class="text-button" type="button" :disabled="disabled || loading || offset + sessions.length >= total" @click="go(1)">Siguientes</button></div></div>
</template>
