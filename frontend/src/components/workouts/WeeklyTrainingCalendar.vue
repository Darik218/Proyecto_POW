<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth.store";
import {
  routineService,
  type ScheduledActivity,
} from "../../services/routine.service";
import {
  workoutSessionsService,
  workoutErrorMessage,
  workoutStatusLabel,
  type WorkoutSummary,
  type CreateWorkout,
} from "../../services/workout-sessions.service";
import { localTrainingDate } from "../../utils/dates";
import {
  weekDates,
  shiftCivilDate,
  calendarDayState,
} from "../../utils/weekly-calendar";
import type { WorkoutGuide } from "../../schemas/workout-guide.schema";
import DailyWorkoutGuide from "./DailyWorkoutGuide.vue";
const auth = useAuthStore(),
  router = useRouter(),
  timeZone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
const zones = Array.from(
  new Set([timeZone.value, "UTC", ...Intl.supportedValuesOf("timeZone")]),
);
const today = ref(localTrainingDate(timeZone.value)),
  anchor = ref(today.value),
  selected = ref(today.value);
const days = computed(() => weekDates(anchor.value)),
  letters = ["L", "M", "X", "J", "V", "S", "D"],
  names = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];
// Compact labels keep seven civil days readable on small screens; the button's
// accessible name and selected-day details retain the complete state.
const shortLabels: Record<string, string> = {
  UNSCHEDULED: "—",
  PLANNED: "Plan",
  RESCHEDULED: "Movido",
  REST: "Desc.",
  IN_PROGRESS: "En curso",
  COMPLETED: "Hecho",
  OMITTED: "Omit.",
  WITHDRAWN: "Retir.",
  RECORDED: "Datos",
  MULTIPLE: "Varias",
};
const activities = ref<ScheduledActivity[]>([]),
  records = ref<WorkoutSummary[]>([]),
  ongoing = ref<WorkoutSummary[]>([]),
  partial = ref(false),
  loading = ref(false),
  error = ref(""),
  busy = ref(false),
  startError = ref(""),
  chosenId = ref(""),
  guideEpoch = ref(0),
  guide = ref<WorkoutGuide | null>(null);
const selectedActivities = computed(() =>
    activities.value.filter(
      (a) => a.scheduledOn.slice(0, 10) === selected.value,
    ),
  ),
  chosen = computed(() =>
    selectedActivities.value.find((a) => a.id === chosenId.value),
  ),
  selectedRecords = computed(() =>
    records.value.filter((s) => s.performedOn?.slice(0, 10) === selected.value),
  ),
  linked = computed(() => chosen.value?.workouts ?? []);
const canBegin = computed(
  () =>
    !!chosen.value &&
    !!guide.value &&
    guide.value.status === "TRAINABLE" &&
    guide.value.source.activityId === chosen.value.id &&
    ["PLANNED", "RESCHEDULED"].includes(chosen.value.status) &&
    guide.value.source.performedOn !== null &&
    guide.value.source.timeZone !== null &&
    guide.value.source.performedOn <=
      localTrainingDate(guide.value.source.timeZone) &&
    !linked.value.some((s) =>
      ["PLANNED", "IN_PROGRESS", "COMPLETED"].includes(s.status),
    ),
);
let revision = 0,
  controller: AbortController | undefined,
  intent: { key: string; input: CreateWorkout; sessionId?: string } | undefined;
async function load() {
  if (busy.value) return;
  guideEpoch.value++;
  today.value = localTrainingDate(timeZone.value);
  const n = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  activities.value = [];
  records.value = [];
  ongoing.value = [];
  guide.value = null;
  error.value = "";
  partial.value = false;
  loading.value = true;
  if (!auth.isAuthenticated) {
    loading.value = false;
    return;
  }
  const results = await Promise.allSettled([
    routineService.activities(
      { from: days.value[0]!, to: days.value[6]!, timeZone: timeZone.value },
      signal,
    ),
    workoutSessionsService.list(
      { from: days.value[0]!, to: days.value[6]!, limit: 100 },
      signal,
    ),
    workoutSessionsService.list({ status: "IN_PROGRESS", limit: 10 }, signal),
  ]);
  if (n !== revision || signal.aborted) return;
  const [scheduled, history, running] = results;
  if (scheduled.status === "fulfilled") activities.value = scheduled.value;
  if (history.status === "fulfilled") {
    records.value = history.value.items;
    partial.value = history.value.total > history.value.items.length;
  }
  if (running.status === "fulfilled") ongoing.value = running.value.items;
  if (results.some((x) => x.status === "rejected"))
    error.value =
      "No se pudo confirmar toda la programación o el historial. Consulta de nuevo antes de iniciar desde aquí.";
  loading.value = false;
  select(selected.value);
}
function select(date: string) {
  if (busy.value) return;
  const old = chosenId.value,
    previousDate = selected.value;
  selected.value = date;
  chosenId.value =
    previousDate === date && selectedActivities.value.some((a) => a.id === old)
      ? old
      : selectedActivities.value.length === 1
        ? selectedActivities.value[0]!.id
        : "";
  if (old !== chosenId.value) guide.value = null;
  startError.value = "";
}
function choose(id: string) {
  if (busy.value) return;
  if (chosenId.value !== id) guide.value = null;
  chosenId.value = id;
  startError.value = "";
}
function move(offset: number) {
  anchor.value = shiftCivilDate(anchor.value, offset);
  selected.value = weekDates(anchor.value)[0]!;
}
function currentWeek() {
  today.value = localTrainingDate(timeZone.value);
  anchor.value = today.value;
  select(today.value);
}
function dayActivities(date: string) {
  return activities.value.filter((a) => a.scheduledOn.slice(0, 10) === date);
}
function dayState(date: string) {
  return calendarDayState(
    dayActivities(date),
    records.value.filter((s) => s.performedOn?.slice(0, 10) === date),
  );
}
function loaded(value: WorkoutGuide) {
  if (value.source.activityId === chosen.value?.id) guide.value = value;
}
async function begin() {
  if (
    busy.value ||
    loading.value ||
    error.value ||
    !canBegin.value ||
    !guide.value ||
    !chosen.value
  )
    return;
  const source = guide.value.source,
    date = source.performedOn!,
    zone = source.timeZone!,
    activity = chosen.value;
  if (
    date !== activity.scheduledOn.slice(0, 10) ||
    zone !== activity.timeZone
  ) {
    startError.value =
      "La programación cambió. Actualiza la semana antes de comenzar.";
    return;
  }
  const context = auth.getSessionGeneration(),
    account = auth.user?.id,
    key = JSON.stringify([
      context,
      account,
      activity.id,
      activity.version,
      date,
      zone,
      source.planDayId,
    ]);
  if (intent?.key !== key)
    intent = {
      key,
      input: {
        id: crypto.randomUUID(),
        scheduledActivityId: activity.id,
        performedOn: date,
        timeZone: zone,
        recordingMode:
          date === localTrainingDate(zone) ? "LIVE" : "RETROSPECTIVE",
        name: source.title ?? activity.title,
        ...(source.trainingPlanId && source.planWeekId && source.planDayId
          ? {
              trainingPlanId: source.trainingPlanId,
              planWeekId: source.planWeekId,
              planDayId: source.planDayId,
            }
          : {}),
      },
    };
  const operation = intent,
    operationRevision = revision,
    same = () =>
      revision === operationRevision &&
      auth.isAuthenticated &&
      auth.getSessionGeneration() === context &&
      auth.user?.id === account;
  busy.value = true;
  startError.value = "";
  try {
    if (!operation.sessionId) {
      const prepared = await workoutSessionsService.create(operation.input);
      if (!same()) return;
      operation.sessionId = prepared.id;
    }
    const current = await workoutSessionsService.get(operation.sessionId);
    if (!same()) return;
    if (current.status === "PLANNED") {
      await workoutSessionsService.start(current.id, current.version ?? 0);
      if (!same()) return;
    }
    if (!["PLANNED", "IN_PROGRESS"].includes(current.status)) {
      busy.value = false;
      await load();
      return;
    }
    await router.push({
      name: "workout-session-detail",
      params: { sessionId: current.id },
    });
  } catch (cause) {
    if (same())
      startError.value = workoutErrorMessage(
        cause,
        "No se confirmó el inicio. Reintenta para recuperar la misma sesión, sin crear otra.",
      );
  } finally {
    if (same()) busy.value = false;
  }
}
watch(
  () =>
    [
      days.value[0],
      timeZone.value,
      auth.user?.id,
      auth.isAuthenticated,
      auth.getSessionGeneration(),
    ].join(":"),
  () => {
    intent = undefined;
    busy.value = false;
    chosenId.value = "";
    startError.value = "";
    void load();
  },
  { immediate: true, flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
});
</script>
<template>
  <section
    class="ui-panel weekly-training"
    aria-labelledby="week-title"
    :aria-busy="loading"
  >
    <header class="week-heading">
      <div>
        <span class="ui-eyebrow">Tu entrenamiento, a mano</span>
        <h2 id="week-title">¿Qué toca entrenar?</h2>
        <p>{{ days[0] }} — {{ days[6] }} · {{ timeZone }}</p>
      </div>
      <div class="week-controls">
        <button
          class="secondary-button"
          aria-label="Semana anterior"
          :disabled="busy"
          @click="move(-7)"
        >
          ←</button
        ><button class="text-button" @click="currentWeek" :disabled="busy">
          Hoy</button
        ><button
          class="secondary-button"
          aria-label="Semana siguiente"
          :disabled="busy"
          @click="move(7)"
        >
          →
        </button>
      </div>
    </header>
    <nav class="week-days" aria-label="Calendario semanal">
      <button
        v-for="(date, index) in days"
        :key="date"
        type="button"
        class="week-day"
        :class="{
          'is-selected': selected === date,
          'is-today': today === date,
        }"
        :aria-pressed="selected === date"
        :aria-current="today === date ? 'date' : undefined"
        :aria-label="`${names[index]} ${date}: ${dayState(date).label}`"
        @click="select(date)"
        :disabled="busy"
      >
        <span aria-hidden="true">{{ letters[index] }}</span
        ><strong>{{ date.slice(8) }}</strong
        ><small class="week-state-full" aria-hidden="true">{{
          loading ? "…" : dayState(date).label
        }}</small
        ><small class="week-state-short" aria-hidden="true">{{
          loading ? "…" : shortLabels[dayState(date).code]
        }}</small
        ><span class="day-training">{{
          dayActivities(date)
            .map((a) => a.title)
            .join(" · ")
        }}</span>
      </button>
    </nav>
    <p v-if="loading" role="status">Consultando tu semana…</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button class="text-button" @click="load">Actualizar semana</button>
    </p>
    <template v-if="!loading">
      <h3>
        {{ selected === today ? "Hoy" : selected }}
        <span v-if="selected > localTrainingDate(chosen?.timeZone || timeZone)"
          >· Vista previa</span
        >
      </h3>
      <div v-if="ongoing.length" class="ongoing-workouts">
        <p>Entrenamientos que puedes retomar:</p>
        <RouterLink
          v-for="s in ongoing"
          :key="s.id"
          class="primary-button"
          :to="{ name: 'workout-session-detail', params: { sessionId: s.id } }"
          >Continuar {{ s.name || "entrenamiento" }} ·
          {{ s.performedOn?.slice(0, 10) ?? "sin fecha" }}</RouterLink
        >
      </div>
      <p v-if="selectedActivities.length > 1">
        Hay varias actividades. Selecciona la que quieras consultar.
      </p>
      <div v-if="selectedActivities.length > 1" class="activity-choices">
        <button
          v-for="a in selectedActivities"
          :key="a.id"
          type="button"
          class="secondary-button"
          :aria-pressed="chosenId === a.id"
          @click="choose(a.id)"
          :disabled="busy"
        >
          {{ a.title }} · {{ calendarDayState([a], []).label }}
        </button>
      </div>
      <template v-if="chosen">
        <h3>{{ chosen.title }} · {{ calendarDayState([chosen], []).label }}</h3>
        <p class="field-hint">
          Fecha de esta programación: {{ chosen.scheduledOn.slice(0, 10) }} ·
          {{ chosen.timeZone }}. El inicio utiliza esta fecha y zona.
        </p>
        <p v-if="chosen.status === 'REST'">
          Descanso programado. No cuenta como incumplimiento.
        </p>
        <p v-else-if="chosen.status === 'OMITTED'">
          Esta actividad está marcada como omitida. Es diferente de un descanso
          o un día sin registros.
        </p>
        <p v-else-if="chosen.status === 'WITHDRAWN'">
          Esta actividad fue retirada de la programación.
        </p>
        <p v-else-if="selected < today && !chosen.workouts.length">
          Previsto sin registro asociado. Esto no confirma que no hayas hecho
          actividad física. Puedes registrar lo que realizaste o revisar la
          programación en Mi plan.
        </p>
        <RouterLink
          v-for="s in linked"
          :key="s.id"
          class="secondary-button"
          :to="{ name: 'workout-session-detail', params: { sessionId: s.id } }"
          >{{
            s.status === "COMPLETED"
              ? "Ver resultados"
              : s.status === "CANCELLED"
                ? "Ver sesión cancelada"
                : "Abrir entrenamiento"
          }}
          · {{ workoutStatusLabel(s.status) }}</RouterLink
        >
        <DailyWorkoutGuide
          v-if="
            ['PLANNED', 'RESCHEDULED'].includes(chosen.status) &&
            !linked.some((s) => s.status === 'COMPLETED')
          "
          :key="chosen.id + ':' + chosen.version + ':' + guideEpoch"
          :query="{ activityId: chosen.id }"
          compact
          @loaded="loaded"
        />
        <button
          v-if="canBegin"
          class="primary-button"
          type="button"
          :disabled="busy || !!error"
          @click="begin"
        >
          {{
            busy
              ? "Recuperando tu sesión…"
              : guide?.source.performedOn ===
                  localTrainingDate(guide?.source.timeZone || timeZone)
                ? "Comenzar entrenamiento"
                : "Registrar entrenamiento anterior"
          }}
        </button>
        <p
          v-if="selected > localTrainingDate(chosen.timeZone)"
          class="field-hint"
        >
          Los objetivos son una vista previa. La guía volverá a comprobarse
          cuando llegue el día; las propuestas pueden cambiar.
        </p>
      </template>
      <p v-if="!selectedActivities.length && !error">
        No hay entrenamiento programado para esta fecha. No se interpreta como
        descanso ni sesión omitida. Si tu plan es flexible, elige el siguiente
        bloque en Mi plan.
      </p>
      <p v-if="partial" role="status">
        Esta semana tiene más registros de los que se muestran. Consulta el
        historial completo.
      </p>
      <div v-if="selectedRecords.length" class="actual-records">
        <h4>Registros realizados en esta fecha</h4>
        <RouterLink
          v-for="s in selectedRecords"
          :key="s.id"
          :to="{ name: 'workout-session-detail', params: { sessionId: s.id } }"
          >{{ s.name || s.trainingPlan?.name || "Entrenamiento" }} ·
          {{ workoutStatusLabel(s.status) }} · {{ s.exerciseCount }} ejercicios
          · {{ s.completedSetCount ?? 0 }} series completadas</RouterLink
        >
      </div>
      <p v-if="startError" role="alert">{{ startError }}</p>
      <details class="calendar-zone">
        <summary>Zona horaria del calendario</summary>
        <p>
          Consulta la zona en la que programaste el plan. Las fechas deportivas
          guardadas no se convierten a la zona del dispositivo.
        </p>
        <label
          >Zona del calendario
          <select
            v-model="timeZone"
            aria-label="Zona horaria del calendario"
            :disabled="busy"
            @change="currentWeek"
          >
            <option v-for="zone in zones" :key="zone" :value="zone">
              {{ zone }}
            </option>
          </select></label
        >
      </details>
      <footer class="week-footer">
        <RouterLink class="secondary-button" :to="{ name: 'home' }"
          >Mi plan y programación</RouterLink
        ><RouterLink :to="{ name: 'workout-sessions', query: { new: 'free' } }"
          >Entrenar sin plan</RouterLink
        ><RouterLink :to="{ name: 'workout-history' }"
          >Ver historial</RouterLink
        >
      </footer>
    </template>
  </section>
</template>
<style scoped>
.week-state-short {
  display: none;
}
.calendar-zone {
  margin: 1rem 0;
}
.calendar-zone summary {
  cursor: pointer;
  padding: 0.7rem 0;
}
.calendar-zone label {
  display: grid;
  gap: 0.5rem;
}
.calendar-zone select {
  max-width: 100%;
  min-width: 0;
}
.weekly-training {
  margin-bottom: 1.5rem;
  min-width: 0;
}
.week-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.week-heading h2 {
  margin: 0.4rem 0;
}
.week-heading p {
  font-size: 0.8rem;
  color: var(--muted);
}
.week-controls {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.week-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.4rem;
  margin: 1rem 0 1.5rem;
}
.week-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 0.3rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--color-surface-subtle);
  color: var(--ink);
  min-height: 135px;
  cursor: pointer;
  min-width: 0;
}
.week-day strong {
  font-size: 1.25rem;
}
.week-day small {
  font-size: 0.65rem;
  overflow-wrap: anywhere;
}
.day-training {
  font-size: 0.65rem;
  overflow-wrap: anywhere;
}
.week-day.is-today {
  border-color: var(--color-primary);
}
.week-day.is-selected {
  background: var(--color-primary);
  color: var(--color-bg, #111);
  box-shadow: 0 0 0 2px var(--color-primary);
}
.week-footer,
.activity-choices,
.ongoing-workouts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin: 1rem 0;
}
.week-footer {
  border-top: 1px solid var(--line);
  padding-top: 1rem;
}
.actual-records {
  display: grid;
  gap: 0.7rem;
}
.ongoing-workouts p {
  flex-basis: 100%;
  margin: 0;
}
.actual-records h4 {
  margin: 1rem 0 0.2rem;
}
@media (max-width: 600px) {
  .weekly-training {
    padding: 0.9rem;
  }
  .week-days {
    gap: 0.25rem;
  }
  .week-day {
    padding: 0.7rem 0.15rem;
    min-height: 108px;
  }
  .week-day small {
    font-size: 0.75rem;
    line-height: 1.4;
  }
  .week-state-full {
    display: none;
  }
  .week-state-short {
    display: block;
  }
  .day-training {
    display: none;
  }
  .week-heading h2 {
    font-size: 1.4rem;
  }
  .week-controls button {
    min-height: 44px;
  }
  .week-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .ongoing-workouts a,
  .activity-choices button {
    width: 100%;
    white-space: normal;
  }
}
</style>
