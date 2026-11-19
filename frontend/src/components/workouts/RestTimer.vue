<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
const props = defineProps<{ autoStart?: number }>();
const seconds = ref(""),
  left = ref(0),
  running = ref(false),
  finished = ref(false);
let timer: ReturnType<typeof setInterval> | undefined,
  endsAt = 0;
const clock = computed(
  () =>
    `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, "0")}`,
);
function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
  running.value = false;
}
function start() {
  const value = Number(seconds.value);
  if (!Number.isInteger(value) || value < 1 || value > 3600 || running.value)
    return;
  stop();
  finished.value = false;
  left.value = value;
  endsAt = Date.now() + value * 1000;
  running.value = true;
  timer = setInterval(() => {
    left.value = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (left.value === 0) {
      stop();
      finished.value = true;
    }
  }, 250);
}
watch(
  () => props.autoStart,
  (value, old) => {
    if (value && value !== old && String(seconds.value).trim()) {
      stop();
      start();
    }
  },
);
onUnmounted(stop);
</script>
<template>
  <details class="rest-timer">
    <summary>Descanso opcional</summary>
    <p>
      Elige tu duración. Este temporizador no prescribe descansos ni modifica el
      entrenamiento.
    </p>
    <form @submit.prevent="start">
      <label
        >Segundos de descanso
        <input
          v-model="seconds"
          type="number"
          inputmode="numeric"
          min="1"
          max="3600"
          step="1"
          required
          :disabled="running" /></label
      ><button class="secondary-button" type="submit" :disabled="running">
        Iniciar descanso</button
      ><button v-if="running" class="text-button" type="button" @click="stop">
        Detener
      </button>
    </form>
    <p v-if="running" role="timer" aria-live="off">{{ clock }}</p>
    <p v-if="finished" role="status">
      Terminó el tiempo que elegiste. Continúa cuando te encuentres en
      condiciones.
    </p>
  </details>
</template>
<style scoped>
.rest-timer {
  margin: 1rem 0;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}
summary {
  cursor: pointer;
  padding: 0.3rem 0;
}
.rest-timer form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
.rest-timer input {
  max-width: 6rem;
  margin: 0.5rem;
}
.rest-timer p {
  color: var(--muted);
  line-height: 1.6;
}
</style>
