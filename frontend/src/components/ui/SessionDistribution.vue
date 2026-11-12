<script setup lang="ts">
import { computed } from "vue";
import type { WorkoutSummary } from "../../services/workout-sessions.service";
const props = defineProps<{
  sessions: readonly Pick<WorkoutSummary, "status">[];
}>();
const items = computed(() =>
  [
    {
      status: "COMPLETED",
      label: "Finalizadas",
      color: "var(--color-primary)",
    },
    {
      status: "IN_PROGRESS",
      label: "En progreso",
      color: "var(--color-secondary)",
    },
    {
      status: "PLANNED",
      label: "Planificadas",
      color: "var(--color-text-secondary)",
    },
    { status: "CANCELLED", label: "Canceladas", color: "var(--color-danger)" },
  ].map((item) => ({
    ...item,
    count: props.sessions.filter((s) => s.status === item.status).length,
  })),
);
</script>
<template>
  <figure class="session-distribution">
    <figcaption>
      Estado de las {{ sessions.length }} sesiones mostradas
    </figcaption>
    <div
      v-for="item in items"
      :key="item.status"
      class="session-distribution__row"
    >
      <span>{{ item.label }}</span
      ><svg
        viewBox="0 0 100 6"
        role="img"
        :aria-label="`${item.label}: ${item.count} de ${sessions.length}`"
        preserveAspectRatio="none"
      >
        <rect
          width="100"
          height="6"
          rx="3"
          fill="var(--color-surface-elevated)"
        />
        <rect
          :width="sessions.length ? (item.count / sessions.length) * 100 : 0"
          height="6"
          rx="3"
          :fill="item.color"
        /></svg
      ><strong>{{ item.count }}</strong>
    </div>
  </figure>
</template>
<style scoped>
.session-distribution {
  margin: 0;
}
.session-distribution figcaption {
  font-size: 0.8rem;
  color: var(--muted);
  margin-bottom: 20px;
}
.session-distribution__row {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  font-size: 0.75rem;
}
.session-distribution svg {
  width: 100%;
  height: 6px;
}
.session-distribution strong {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
