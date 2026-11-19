<script setup lang="ts">
import { computed, ref, watch } from "vue";
const props = defineProps<{
  title: string;
  unit: string;
  testId: string;
  points: Array<{ id: string; date: string; value: number }>;
}>();
const active = ref("");
const repeatedDates = computed(
  () =>
    new Set(props.points.map((point) => point.date)).size < props.points.length,
);
watch(
  () => props.points,
  () => {
    active.value = props.points.at(-1)?.id ?? "";
  },
  { immediate: true },
);
const selected = computed(() =>
  props.points.find((p) => p.id === active.value),
);
const maxValue = computed(() =>
  Math.max(1, ...props.points.map((p) => p.value)),
);
const geometry = computed(() => {
  const dates = props.points.map((p) => Date.parse(p.date)),
    first = Math.min(...dates),
    last = Math.max(...dates);
  return props.points.map((p, i) => ({
    ...p,
    x: first === last ? 230 : 16 + ((dates[i]! - first) / (last - first)) * 428,
    y: 164 - (p.value / maxValue.value) * 148,
  }));
});
const selectedPoint = computed(() =>
  geometry.value.find((p) => p.id === active.value),
);
</script>
<template>
  <figure class="progress-chart">
    <figcaption>{{ title }}</figcaption>
    <div
      v-if="points.length"
      class="chart-plot"
      :class="{ 'chart-plot--single': points.length === 1 }"
    >
      <div class="chart-scale" aria-hidden="true">
        <span>{{ maxValue }}</span
        ><span>0</span>
      </div>
      <div class="chart-data">
        <svg
          viewBox="0 0 460 180"
          role="img"
          :aria-label="`${title}: ${points.length} registros. Consulta la tabla para los valores.`"
          :data-testid="testId"
        >
          <line
            v-for="y in [16, 65, 114, 164]"
            :key="y"
            x1="16"
            :y1="y"
            x2="444"
            :y2="y"
            class="axis"
          />
          <polyline
            v-if="geometry.length > 1 && !repeatedDates"
            :points="geometry.map((p) => `${p.x},${p.y}`).join(' ')"
            fill="none"
            class="trend"
          />
          <circle
            v-for="point in geometry"
            :key="point.id"
            :cx="point.x"
            :cy="point.y"
            :r="point.id === active ? 6 : 4.5"
            class="observation"
            :class="{ 'observation--selected': point.id === active }"
          >
            <title>{{ point.date }}: {{ point.value }} {{ unit }}</title>
          </circle>
          <rect
            v-if="selectedPoint"
            :x="selectedPoint.x - 10"
            :y="selectedPoint.y - 10"
            width="20"
            height="20"
            rx="10"
            class="observation-ring"
            aria-hidden="true"
          />
        </svg>
        <div
          class="chart-dates"
          :class="{
            'chart-dates--single': points[0]?.date === points.at(-1)?.date,
          }"
        >
          <time :datetime="points[0]?.date">{{ points[0]?.date }}</time>
          <time
            v-if="points[0]?.date !== points.at(-1)?.date"
            :datetime="points.at(-1)?.date"
          >
            {{ points.at(-1)?.date }}
          </time>
        </div>
      </div>
    </div>
    <p v-if="repeatedDates" class="selected-record">
      Los registros de una misma fecha se muestran sin ordenar dentro del día.
    </p>
    <p v-if="!points.length">No hay registros para esta gráfica.</p>
    <p v-if="selected" class="selected-record" role="status">
      <time :datetime="selected.date">{{ selected.date }}</time> ·
      <strong>{{ selected.value }} {{ unit }}</strong>
    </p>
    <div
      v-if="points.length"
      class="observations"
      role="group"
      aria-label="Consultar un registro"
    >
      <button
        v-for="point in points"
        :key="point.id"
        type="button"
        :aria-pressed="active === point.id"
        @click="active = point.id"
      >
        {{ point.date }} · {{ point.value }}
      </button>
    </div>
    <details v-if="points.length">
      <summary>Ver datos de la gráfica</summary>
      <div class="table-scroll">
        <table>
          <caption>
            {{
              title
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">{{ unit }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="point in points" :key="point.id">
              <th scope="row">{{ point.date }}</th>
              <td>{{ point.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </figure>
</template>
<style scoped>
.progress-chart {
  margin: 0;
  min-width: 0;
}
.progress-chart figcaption {
  font-weight: 650;
  font-size: 1.05rem;
  margin-bottom: 0.75rem;
}
.chart-plot {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.3rem;
  margin-inline: auto;
  max-width: 45rem;
}
.chart-plot--single {
  max-width: 26rem;
}
.chart-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  margin: clamp(0.35rem, 1.5vw, 1rem) 0
    calc(1.25rem + clamp(0.35rem, 1.5vw, 1rem));
  text-align: right;
}
.chart-dates,
.chart-scale {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.chart-dates {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 0.5rem;
  padding-inline: 3.48%;
}
.chart-dates--single {
  justify-content: center;
}
.progress-chart svg {
  display: block;
  width: 100%;
}
.axis {
  stroke: var(--color-border);
  stroke-width: 1;
}
.trend {
  stroke: var(--color-primary);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.observation {
  fill: var(--color-primary);
  stroke: var(--color-surface);
  stroke-width: 1;
}
.observation--selected {
  fill: var(--color-text-primary);
}
.observation-ring {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 1.5;
  pointer-events: none;
}
.trend,
.axis,
.observation,
.observation-ring {
  vector-effect: non-scaling-stroke;
}
.observations {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.25rem 0.25rem 0.55rem;
  max-width: 100%;
}
.observations button {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.6rem;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.observations button[aria-pressed="true"] {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface));
}
.selected-record {
  font-size: 0.9rem;
  margin: 0.85rem 0 0.35rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.selected-record strong {
  color: var(--color-text-primary);
}
summary {
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  min-height: 44px;
  align-content: center;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  text-align: left;
  border-collapse: collapse;
  font-size: 0.9rem;
}
caption {
  text-align: left;
  padding: 0.75rem 0;
}
th,
td {
  padding: 0.65rem;
  border-bottom: 1px solid var(--color-border);
}
</style>
