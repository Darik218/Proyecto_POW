<script setup lang="ts">
import { computed } from "vue";
import {
  calendarShortLabels,
  weekDates,
  shiftCivilDate,
  calendarDayState,
} from "../../utils/weekly-calendar";
const props = defineProps<{
  startsOn?: string | null;
  referenceDate: string;
  selectedDate: string;
  days: readonly { id: string; name: string; weekday: number | null }[];
  activities: readonly {
    id: string;
    planDayId?: string | null;
    scheduledOn: string;
    status: string;
    title: string;
    workouts: readonly { status: string }[];
  }[];
}>();
const emit = defineEmits<{ select: [date: string] }>();
const cells = computed(() => {
  const dates = props.startsOn
    ? Array.from({ length: 7 }, (_, i) => shiftCivilDate(props.startsOn!, i))
    : weekDates(props.referenceDate);
  return dates.map((date) => {
    const weekday = new Date(date + "T00:00:00Z").getUTCDay() || 7;
    const activities = props.activities.filter(
      (a) => a.scheduledOn.slice(0, 10) === date,
    );
    const pattern = props.days.filter(
      (day) =>
        day.weekday === weekday &&
        !props.activities.some((a) => a.planDayId === day.id),
    );
    const state = calendarDayState(activities, []);
    return {
      date,
      letter: ["L", "M", "X", "J", "V", "S", "D"][weekday - 1],
      title:
        activities.map((a) => a.title).join(" · ") ||
        pattern.map((day) => day.name).join(" · ") ||
        "—",
      state:
        !activities.length && pattern.length ? "Distribución" : state.label,
      code: state.code,
    };
  });
});
</script>
<template>
  <nav
    class="routine-week-strip"
    aria-label="Distribución semanal de la rutina"
  >
    <button
      v-for="cell in cells"
      :key="cell.date"
      type="button"
      :aria-pressed="selectedDate === cell.date"
      :aria-label="cell.date + ' · ' + cell.title + ' · ' + cell.state"
      :data-state="cell.code"
      @click="emit('select', cell.date)"
    >
      <span class="routine-week-date"
        >{{ cell.letter }} <small>{{ cell.date.slice(8) }}</small></span
      >
      <strong>{{ cell.code === "REST" ? "Desc." : cell.title }}</strong
      ><small v-if="cell.code !== 'REST'">{{
        cell.state === "Distribución"
          ? "Distrib."
          : (calendarShortLabels[cell.code] ?? cell.state)
      }}</small>
    </button>
  </nav>
</template>
<style scoped>
.routine-week-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.55rem;
  margin: 1rem 0;
}
button {
  min-width: 0;
  min-height: 106px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--color-surface);
  color: var(--ink);
  padding: 0.75rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
button[aria-pressed="true"] {
  border-color: var(--color-primary);
  background: var(--color-surface-subtle);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
button[data-state="COMPLETED"] .routine-week-date {
  color: var(--color-primary);
}
.routine-week-date {
  font-weight: 750;
  display: flex;
  justify-content: space-between;
  gap: 0.3rem;
}
strong {
  font-size: 0.82rem;
}
small {
  font-size: 0.72rem;
  color: var(--muted);
}
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .routine-week-strip {
    gap: 0.3rem;
  }
  button {
    padding: 0.6rem 0.25rem;
    min-height: 100px;
    text-align: center;
    align-items: center;
  }
  strong {
    font-size: 0.65rem;
  }
  small {
    font-size: 0.6rem;
  }
  .routine-week-date {
    flex-direction: column;
    gap: 0.15rem;
  }
}
</style>
