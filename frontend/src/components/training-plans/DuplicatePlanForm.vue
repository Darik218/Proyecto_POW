<script setup lang="ts">
import axios from "axios";
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import {
  trainingPlansService,
  trainingPlanErrorMessage,
} from "../../services/training-plans.service";
import { routineService } from "../../services/routine.service";
const props = defineProps<{ planId: string }>(),
  emit = defineEmits<{
    created: [id: string];
    cancel: [];
    pending: [value: boolean];
  }>(),
  auth = useAuthStore();
const name = ref(""),
  sourceName = ref(""),
  version = ref<number | null>(null),
  busy = ref(false),
  error = ref(""),
  uncertain = ref(false);
let submitted: { id: string; expectedVersion: number; name: string } | null =
    null,
  generation = 0,
  controller: AbortController | undefined,
  mounted = false;
const identity = () =>
  [auth.user?.id, auth.getSessionGeneration(), auth.isAuthenticated].join(":");
async function load() {
  if (!auth.isAuthenticated) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    n = ++generation,
    context = identity();
  version.value = null;
  error.value = "";
  busy.value = true;
  try {
    const plan = await trainingPlansService.getPlanning(props.planId, signal);
    if (n !== generation || context !== identity() || signal.aborted) return;
    if (typeof plan.version !== "number") throw Error("Revision required");
    sourceName.value = plan.name;
    version.value = plan.version;
    name.value = plan.name.slice(0, 148) + " (copia)";
  } catch {
    if (n === generation && !signal.aborted)
      error.value =
        "No pudimos verificar la versión de origen. Actualiza antes de duplicar.";
  } finally {
    if (n === generation) busy.value = false;
  }
}
async function submit() {
  if (busy.value || version.value === null || !auth.isAuthenticated) return;
  error.value = "";
  if (!name.value.trim() || name.value.trim().length > 160) {
    error.value = "Escribe un nombre de hasta 160 caracteres.";
    return;
  }
  submitted ??= {
    id: crypto.randomUUID(),
    expectedVersion: version.value,
    name: name.value.trim(),
  };
  const context = identity(),
    n = ++generation;
  busy.value = true;
  try {
    const result = await routineService.duplicate(props.planId, submitted);
    if (n === generation && context === identity()) emit("created", result.id);
  } catch (cause) {
    if (n !== generation || context !== identity()) return;
    const rejected =
      axios.isAxiosError(cause) &&
      [400, 401, 403, 404, 409, 422].includes(cause.response?.status ?? 0);
    uncertain.value = !rejected;
    if (rejected) {
      submitted = null;
      version.value = null;
    }
    error.value = trainingPlanErrorMessage(
      cause,
      "No se pudo confirmar la copia. Comprueba el resultado antes de crear otra.",
    );
  } finally {
    if (n === generation) busy.value = false;
  }
}
async function recover() {
  if (!submitted || busy.value || !auth.isAuthenticated) return;
  const context = identity(),
    n = ++generation;
  busy.value = true;
  try {
    const result = await trainingPlansService.getPlanning(submitted.id);
    if (n === generation && context === identity()) emit("created", result.id);
  } catch {
    if (n === generation && context === identity())
      error.value =
        "Todavía no pudimos confirmar una copia. Puedes reintentar la misma intención, sin crear otra.";
  } finally {
    if (n === generation) busy.value = false;
  }
}
onMounted(() => {
  mounted = true;
  void load();
});
watch(
  () => props.planId + ":" + identity(),
  () => {
    generation++;
    controller?.abort();
    submitted = null;
    version.value = null;
    sourceName.value = "";
    name.value = "";
    error.value = "";
    uncertain.value = false;
    busy.value = false;
    if (mounted && auth.isAuthenticated) void load();
  },
  { flush: "sync" },
);
watch(
  () => busy.value || uncertain.value,
  (value) => emit("pending", value),
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <form class="plan-form" :aria-busy="busy" @submit.prevent="submit">
    <h2>Duplicar rutina completa</h2>
    <p>{{ sourceName || "Consultando rutina…" }}</p>
    <p>
      Se copian semanas, días y objetivos como estructuras independientes en
      borrador. La copia queda sin fechas programadas; no incluye
      entrenamientos, recomendaciones, consentimientos ni permisos.
    </p>
    <label
      >Nombre de la nueva rutina<input
        v-model="name"
        class="form-control"
        required
        maxlength="160"
        :disabled="busy || uncertain || version === null"
    /></label>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="plan-actions">
      <button class="primary-button" :disabled="busy || version === null">
        {{
          busy
            ? "Comprobando…"
            : uncertain
              ? "Reintentar la misma copia"
              : "Crear copia independiente"
        }}</button
      ><button
        v-if="uncertain"
        class="secondary-button"
        type="button"
        :disabled="busy"
        @click="recover"
      >
        Comprobar copia guardada</button
      ><button
        v-if="version === null"
        class="secondary-button"
        type="button"
        :disabled="busy"
        @click="load"
      >
        Actualizar origen</button
      ><button
        type="button"
        class="text-button"
        :disabled="busy || uncertain"
        @click="emit('cancel')"
      >
        Cerrar
      </button>
    </div>
  </form>
</template>
