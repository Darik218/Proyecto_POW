<script setup lang="ts">
import { computed } from "vue";
import {
  lastCompletedWorkSet,
  type WorkoutSetReference,
} from "../../utils/workout-set-reference";
const props = defineProps<{
  current: WorkoutSetReference[];
  reference: { sessionLabel: string; sets: WorkoutSetReference[] } | null;
}>();
const currentSet = computed(() => lastCompletedWorkSet(props.current)),
  previousSet = computed(() => lastCompletedWorkSet(props.reference?.sets));
const chart = computed(() => {
  const a = previousSet.value,
    b = currentSet.value;
  if (
    !a ||
    !b ||
    !a.loadUnit ||
    a.loadUnit !== b.loadUnit ||
    a.load == null ||
    b.load == null
  )
    return null;
  // Geometry only. Decimal strings remain the displayed evidence; no official progression calculation.
  const first = Number(a.load),
    second = Number(b.load),
    max = Math.max(first, second);
  return Number.isFinite(max) && first >= 0 && second >= 0 && max > 0
    ? { first: (first / max) * 100, second: (second / max) * 100 }
    : null;
});
</script>
<template>
  <div v-if="previousSet && currentSet" class="reference-comparison">
    <h4>Antes y ahora</h4>
    <div class="comparison-row">
      <span>{{ reference?.sessionLabel }}</span>
      <div v-if="chart" class="comparison-track" aria-hidden="true">
        <i :style="{ width: chart.first + '%' }"></i>
      </div>
      <strong
        >{{ previousSet.load ?? "—" }}
        {{ previousSet.loadUnit ?? "(unidad desconocida)" }} ×
        {{ previousSet.repetitions ?? "—"
        }}<small>RPE {{ previousSet.rpe ?? "no registrado" }}</small></strong
      >
    </div>
    <div class="comparison-row">
      <span>Esta sesión</span>
      <div v-if="chart" class="comparison-track current" aria-hidden="true">
        <i :style="{ width: chart.second + '%' }"></i>
      </div>
      <strong
        >{{ currentSet.load ?? "—" }}
        {{ currentSet.loadUnit ?? "(unidad desconocida)" }} ×
        {{ currentSet.repetitions ?? "—"
        }}<small>RPE {{ currentSet.rpe ?? "no registrado" }}</small></strong
      >
    </div>
    <p class="field-hint">
      Última serie de trabajo completada de cada sesión. Compara también las
      repeticiones y el esfuerzo: más carga por sí sola no demuestra una mejora.
    </p>
    <p v-if="!chart" class="field-hint">
      No se dibujan cargas con unidades diferentes o desconocidas.
    </p>
  </div>
</template>
<style scoped>
.reference-comparison {
  margin: 1rem 0;
  padding: 1rem;
  background: var(--color-background);
  border-radius: var(--radius-md);
}
.reference-comparison h4 {
  margin: 0 0 1rem;
}
.comparison-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(50px, 2fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
  margin: 0.75rem 0;
  font-size: 0.9rem;
}
.comparison-row > span {
  overflow-wrap: anywhere;
}
.comparison-row small {
  display: block;
  color: var(--color-text-secondary);
  font-weight: 400;
  margin-top: 0.25rem;
}
.comparison-track {
  height: 8px;
  background: var(--color-surface-elevated);
  border-radius: 4px;
  overflow: hidden;
}
.comparison-track i {
  display: block;
  background: var(--color-text-secondary);
  height: 100%;
}
.comparison-track.current i {
  background: var(--color-primary);
}
@media (max-width: 600px) {
  .comparison-row {
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .comparison-row strong {
    grid-column: 2;
    grid-row: auto;
  }
  .comparison-track {
    grid-column: 1/-1;
    grid-row: auto;
    order: 1;
  }
}
</style>
