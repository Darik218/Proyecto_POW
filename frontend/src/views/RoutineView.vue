<script setup lang="ts">
import { useAuthStore } from "../stores/auth.store";
import { onBeforeRouteLeave } from "vue-router";
import PageHeader from "../components/ui/PageHeader.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import DuplicatePlanForm from "../components/training-plans/DuplicatePlanForm.vue";
import GeneratePlanForm from "../components/training-plans/GeneratePlanForm.vue";
import PlanDayForm from "../components/training-plans/PlanDayForm.vue";
import RoutineWeekStrip from "../components/training-plans/RoutineWeekStrip.vue";
import { weekDates, shiftCivilDate } from "../utils/weekly-calendar";
import { requestIntent } from "../composables/requestIntent";
import {
  useTrainingPlans,
  useTrainingPlan,
} from "../composables/useTrainingPlans";
import { useWorkoutSessions } from "../composables/useWorkoutSessions";
import {
  routineService,
  activityLabel,
  type ScheduledActivity,
} from "../services/routine.service";
import { localTrainingDate } from "../utils/dates";
import {
  weekdayLabel,
  trainingPlanErrorMessage,
  type CreatePlanDay,
  type UpdatePlanDay,
} from "../services/training-plans.service";
import "../assets/training-plans.css";
import "../assets/routine.css";
const route = useRoute(),
  router = useRouter(),
  plansState = useTrainingPlans(),
  actions = useTrainingPlan(),
  ongoing = useWorkoutSessions(),
  prepared = useWorkoutSessions(),
  weekSessions = useWorkoutSessions();
const { plans, loading, error } = plansState;
const { plan } = actions;
const duplicating = ref(false),
  duplicateSourceId = ref(""),
  duplicateLocked = ref(false),
  auth = useAuthStore();
let present = true;
function toggleDuplicate() {
  if (duplicateLocked.value || showWizard.value) return;
  if (duplicating.value) {
    duplicating.value = false;
    return;
  }
  duplicateSourceId.value = plan.value?.id ?? "";
  duplicating.value = !!duplicateSourceId.value;
}
const authContext = () =>
  [auth.user?.id, auth.getSessionGeneration(), auth.isAuthenticated].join(":");
watch(
  authContext,
  () => {
    duplicateLocked.value = false;
    duplicating.value = false;
    duplicateSourceId.value = "";
  },
  { flush: "sync" },
);
onBeforeRouteLeave(() => {
  if (duplicateLocked.value && auth.isAuthenticated) {
    failure.value =
      "Comprueba primero la copia pendiente o reintenta la misma intención antes de salir.";
    return false;
  }
});
const protectCopy = (event: BeforeUnloadEvent) => {
  if (duplicateLocked.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};
onMounted(() => {
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", protectCopy);
});
onUnmounted(() => {
  present = false;
  if (typeof window !== "undefined")
    window.removeEventListener("beforeunload", protectCopy);
});
const showWizard = ref(route.query.create === "true"),
  adding = ref(false),
  busy = ref(false),
  failure = ref(""),
  notice = ref("");
const entryMode = ref<"recommended" | "library" | "custom">("recommended");
const creationOptions = ref(false);
function startWizard(mode: "recommended" | "library" | "custom") {
  if (duplicateLocked.value) return;
  entryMode.value = mode;
  creationOptions.value = false;
  duplicating.value = false;
  showWizard.value = true;
}
const chosenPlan = ref("");
const chosenWeek = ref("");
const week = computed(() =>
  plan.value?.weeks.find((w) => w.id === chosenWeek.value),
);
const activities = ref<ScheduledActivity[]>([]);
const activitiesLoading = ref(false);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = localTrainingDate(timeZone),
  calendarDate = ref(today);
let revision = 0,
  controller: AbortController | undefined;
function dayResults(id: string) {
  const rows = weekSessions.sessions.value.filter(
    (row) => row.planDay?.id === id,
  );
  return {
    completed: rows.filter((row) => row.status === "COMPLETED").length,
    ongoing: rows.filter((row) => row.status === "IN_PROGRESS").length,
  };
}
const days = computed(() => week.value?.days.filter((d) => !d.retiredAt) ?? []);
const focusedDay = ref(""),
  focusedDate = ref(""),
  moveDate = ref("");
const selectedDay = computed(() =>
  days.value.find((day) => day.id === focusedDay.value),
);
const flexible = computed(
  () =>
    days.value.length > 0 && days.value.every((day) => day.weekday === null),
);
const weekStart = computed(
  () => week.value?.startsOn?.slice(0, 10) || weekDates(today)[0]!,
);
const dates = computed(() =>
  Array.from({ length: 7 }, (_, i) => shiftCivilDate(weekStart.value, i)),
);
const selectedActivities = computed(() =>
  activities.value.filter(
    (a) =>
      a.planDayId === focusedDay.value &&
      a.scheduledOn.slice(0, 10) === focusedDate.value &&
      !["WITHDRAWN", "REST"].includes(a.status),
  ),
);
const selectedActivity = computed(() =>
  selectedActivities.value.length === 1
    ? selectedActivities.value[0]
    : undefined,
);
const selectedLink = computed(() => {
  if (!plan.value || !week.value || !selectedDay.value) return { name: "home" };
  const activity = selectedActivity.value;
  return {
    name: "routine-day",
    params: {
      planId: plan.value.id,
      weekId: week.value.id,
      dayId: selectedDay.value.id,
    },
    query: {
      date: focusedDate.value || today,
      ...(activity
        ? { activityId: activity.id, timeZone: activity.timeZone }
        : {}),
    },
  };
});
function dateForDay(day: (typeof days.value)[number]) {
  const scheduled = activities.value.find(
    (a) => a.planDayId === day.id && !["WITHDRAWN", "REST"].includes(a.status),
  );
  if (scheduled) return scheduled.scheduledOn.slice(0, 10);
  return (
    dates.value.find(
      (date) =>
        (new Date(date + "T00:00:00Z").getUTCDay() || 7) === day.weekday,
    ) || today
  );
}
function chooseDay(id: string) {
  focusedDay.value = id;
  const day = days.value.find((d) => d.id === id);
  focusedDate.value = day ? dateForDay(day) : "";
}
function chooseDate(date: string) {
  focusedDate.value = date;
  const ids = [
    ...new Set(
      activities.value
        .filter(
          (a) =>
            a.scheduledOn.slice(0, 10) === date &&
            a.planDayId &&
            !["WITHDRAWN", "REST"].includes(a.status),
        )
        .map((a) => a.planDayId),
    ),
  ];
  const pattern = days.value.filter(
    (day) =>
      day.weekday === (new Date(date + "T00:00:00Z").getUTCDay() || 7) &&
      !activities.value.some((a) => a.planDayId === day.id),
  );
  focusedDay.value =
    ids.length === 1
      ? ids[0]!
      : ids.length === 0 && pattern.length === 1
        ? pattern[0]!.id
        : "";
}
watch(
  () => [chosenWeek.value, days.value.map((day) => day.id).join(",")],
  () => {
    if (!days.value.some((day) => day.id === focusedDay.value))
      chooseDay(days.value[0]?.id ?? "");
  },
);
watch(
  () => [focusedDay.value, focusedDate.value, selectedActivity.value?.version],
  () => {
    moveDate.value = focusedDate.value || today;
  },
);
async function saveDistributionDate() {
  const day = selectedDay.value;
  if (!day || !moveDate.value) return;
  const actor = authContext(),
    sourceWeek = chosenWeek.value,
    sourcePlan = chosenPlan.value;
  const target = moveDate.value,
    activity = selectedActivity.value;
  if (target < dates.value[0]! || target > dates.value[6]!) {
    failure.value =
      "Elige una fecha de esta semana. Para otra semana utiliza las opciones avanzadas.";
    return;
  }
  if (selectedActivities.value.length > 1) {
    failure.value = "Elige la programación concreta en las opciones avanzadas.";
    return;
  }
  if (activity)
    await run(() =>
      routineService.updateActivity(activity.id, {
        expectedVersion: activity.version,
        scheduledOn: target,
      }),
    );
  else {
    calendarDate.value = target;
    await schedule(day.id, day.name);
  }
  if (
    !present ||
    actor !== authContext() ||
    sourceWeek !== chosenWeek.value ||
    sourcePlan !== chosenPlan.value
  )
    return;
  if (!failure.value) {
    focusedDay.value = day.id;
    focusedDate.value = target;
  }
}
async function loadActivities() {
  const current = ++revision;
  activitiesLoading.value = true;
  activities.value = [];
  controller?.abort();
  controller = new AbortController();
  if (!week.value) {
    activities.value = [];
    activitiesLoading.value = false;
    return;
  }
  try {
    const result = await routineService.activities(
      {
        weekId: week.value.id,
        from: dates.value[0]!,
        to: dates.value[6]!,
        timeZone,
      },
      controller.signal,
    );
    if (current === revision) {
      activities.value = result;
      if (selectedDay.value) focusedDate.value = dateForDay(selectedDay.value);
    }
  } catch (cause) {
    if (current === revision && !controller.signal.aborted)
      failure.value = trainingPlanErrorMessage(
        cause,
        "No se pudo cargar la programación.",
      );
  } finally {
    if (current === revision) activitiesLoading.value = false;
  }
}
watch(chosenPlan, async (id) => {
  const actor = authContext();
  chosenWeek.value = "";
  activities.value = [];
  if (!id) return;
  await actions.load(id);
  if (
    actor !== authContext() ||
    chosenPlan.value !== id ||
    plan.value?.id !== id
  )
    return;
  const requested =
    typeof route.query.weekId === "string" ? route.query.weekId : "";
  chosenWeek.value =
    plan.value?.weeks.find((w) => w.id === requested)?.id ??
    plan.value?.weeks[0]?.id ??
    "";
});
watch(chosenWeek, () => {
  if (chosenPlan.value && chosenWeek.value)
    void router.replace({
      name: "home",
      query: { planId: chosenPlan.value, weekId: chosenWeek.value },
    });
  void loadActivities();
  if (chosenPlan.value && chosenWeek.value)
    void weekSessions.load({
      trainingPlanId: chosenPlan.value,
      planWeekId: chosenWeek.value,
      from: dates.value[0],
      to: dates.value[6],
      limit: 100,
    });
});
async function run(work: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  const actor = authContext();
  try {
    await work();
    if (!present || actor !== authContext()) return;
    await plansState.load();
    if (!present || actor !== authContext()) return;
    if (chosenPlan.value) await actions.load(chosenPlan.value);
    if (!present || actor !== authContext()) return;
    await loadActivities();
    if (!present || actor !== authContext()) return;
    notice.value = "Cambio guardado.";
  } catch (cause) {
    if (present && actor === authContext())
      failure.value = trainingPlanErrorMessage(
        cause,
        "No se pudo guardar el cambio.",
      );
  } finally {
    if (present && actor === authContext()) busy.value = false;
  }
}
const intents = requestIntent();
async function writeIntent<T>(
  values: object,
  work: (id: string) => Promise<T>,
) {
  const result = await work(intents.id(values));
  intents.confirmed(values);
  return result;
}
const operation = (id: string) => ({
  id,
  expectedVersion: plan.value?.version ?? 0,
});
async function activate() {
  await run(() =>
    writeIntent({ action: "activate", planId: chosenPlan.value }, (id) =>
      routineService.transition(chosenPlan.value, "activate", operation(id)),
    ),
  );
}
async function created(id: string) {
  const context = authContext();
  duplicateLocked.value = false;
  duplicating.value = false;
  showWizard.value = false;
  await plansState.load();
  if (present && context === authContext()) chosenPlan.value = id;
}
async function addDay(input: CreatePlanDay | UpdatePlanDay) {
  if (!week.value || !("position" in input) || !input.name) return;
  const actor = authContext(),
    sourcePlan = chosenPlan.value;
  const values = {
    weekId: week.value.id,
    timeZone,
    name: input.name,
    position: input.position,
    weekday: input.weekday ?? null,
  };
  await writeIntent(values, (id) =>
    routineService.newDay(chosenPlan.value, { ...values, ...operation(id) }),
  );
  if (!present || actor !== authContext() || chosenPlan.value !== sourcePlan)
    return;
  await actions.load(sourcePlan);
  if (!present || actor !== authContext() || chosenPlan.value !== sourcePlan)
    return;
  adding.value = false;
}
async function calendarAction(
  activity: ScheduledActivity,
  action: "move" | "omit" | "restore",
) {
  await run(() =>
    routineService.updateActivity(activity.id, {
      expectedVersion: activity.version,
      ...(action === "move"
        ? { scheduledOn: calendarDate.value }
        : { status: action === "omit" ? "OMITTED" : "PLANNED" }),
    }),
  );
}
async function rest() {
  const values = {
    planWeekId: week.value?.id,
    scheduledOn: calendarDate.value,
    timeZone,
    title: "Descanso voluntario",
    status: "REST" as const,
  };
  await run(() =>
    writeIntent(values, (id) =>
      routineService.createActivity({ ...values, id }),
    ),
  );
}
async function schedule(dayId: string, name: string) {
  const values = {
    planWeekId: week.value?.id,
    planDayId: dayId,
    scheduledOn: calendarDate.value,
    timeZone,
    title: name,
    status: "PLANNED" as const,
  };
  await run(() =>
    writeIntent(values, (id) =>
      routineService.createActivity({ ...values, id }),
    ),
  );
}
async function loadHub(keepRequested = false) {
  const actor = authContext();
  await Promise.all([
    plansState.load(),
    ongoing.load({ status: "IN_PROGRESS" }),
    prepared.load({ status: "PLANNED" }),
  ]);
  if (!present || actor !== authContext()) return;
  const requested =
    keepRequested && typeof route.query.planId === "string"
      ? route.query.planId
      : "";
  chosenPlan.value = "";
  const active = plans.value.filter((p) => p.status === "ACTIVE");
  chosenPlan.value =
    requested ||
    (active.length === 1
      ? active[0]!.id
      : plans.value.length === 1
        ? plans.value[0]!.id
        : "");
}
onMounted(() => void loadHub(true));
watch(
  authContext,
  () => {
    revision++;
    controller?.abort();
    plansState.invalidate();
    actions.dispose();
    ongoing.dispose();
    prepared.dispose();
    weekSessions.dispose();
    plans.value = [];
    plan.value = null;
    activities.value = [];
    ongoing.sessions.value = [];
    prepared.sessions.value = [];
    weekSessions.sessions.value = [];
    chosenPlan.value = "";
    chosenWeek.value = "";
    focusedDay.value = "";
    focusedDate.value = "";
    showWizard.value = false;
    creationOptions.value = false;
    failure.value = "";
    notice.value = "";
    busy.value = false;
    if (auth.isAuthenticated) void loadHub();
  },
  { flush: "sync" },
);
onUnmounted(() => {
  revision++;
  controller?.abort();
  plansState.dispose();
  actions.dispose();
  ongoing.dispose();
  prepared.dispose();
  weekSessions.dispose();
});
</script>
<template>
  <section class="page-view routine-view" aria-labelledby="routine-title">
    <PageHeader id="routine-title" title="Mi plan" icon="dumbbell"
      ><template #actions>
        <button
          v-if="plans.length && !showWizard"
          class="secondary-button"
          type="button"
          :disabled="duplicateLocked"
          :aria-expanded="creationOptions"
          @click="creationOptions = !creationOptions"
        >
          {{ creationOptions ? "Volver a mi rutina" : "Crear otra rutina" }}
        </button>
        <RouterLink
          v-if="!showWizard"
          class="text-button"
          :to="{ name: 'workout-sessions', query: { new: 'free' } }"
          >Entrenar sin plan</RouterLink
        >
      </template></PageHeader
    >
    <DuplicatePlanForm
      v-if="duplicating && duplicateSourceId"
      :key="duplicateSourceId"
      :plan-id="duplicateSourceId"
      @created="created"
      @pending="duplicateLocked = $event"
      @cancel="!duplicateLocked && (duplicating = false)"
    />
    <GeneratePlanForm
      v-if="showWizard"
      :entry-mode="entryMode"
      @created="created"
      @cancel="showWizard = false"
    />
    <template v-if="!showWizard">
      <section v-if="ongoing.sessions.value.length" class="state-card">
        <h2>Continúa tu entrenamiento</h2>
        <RouterLink
          v-for="session in ongoing.sessions.value"
          :key="session.id"
          class="routine-resume"
          :to="{
            name: 'workout-session-detail',
            params: { sessionId: session.id },
          }"
          >{{
            session.name ??
            session.sourceSnapshot?.day?.name ??
            "Entrenamiento libre"
          }}
          →</RouterLink
        >
      </section>
      <section v-if="prepared.sessions.value.length" class="state-card">
        <h2>Entrenamientos preparados</h2>
        <RouterLink
          v-for="session in prepared.sessions.value"
          :key="session.id"
          class="routine-resume"
          :to="{
            name: 'workout-session-detail',
            params: { sessionId: session.id },
          }"
          >{{
            session.name ??
            session.sourceSnapshot?.day?.name ??
            "Entrenamiento libre"
          }}
          · Revisar y empezar →</RouterLink
        >
      </section>
      <p v-if="prepared.error.value" class="form-error" role="alert">
        {{ prepared.error.value }}
      </p>
      <p v-if="ongoing.error.value" class="form-error" role="alert">
        {{ ongoing.error.value }}
      </p>
      <LoadingState v-if="loading" label="Cargando tu rutina…" :rows="3" />
      <div v-else-if="error" class="state-card" role="alert">
        {{ error }}
        <button class="text-button" @click="plansState.load()">
          Reintentar
        </button>
      </div>
      <section
        v-else-if="!plans.length || creationOptions"
        class="routine-welcome ui-panel"
      >
        <h2>Elige cómo quieres empezar</h2>
        <div class="routine-entry-options">
          <button
            type="button"
            data-create-mode="recommended"
            @click="startWizard('recommended')"
          >
            <strong>Crear un plan recomendado</strong
            ><small
              >Una propuesta editable para tus días y tu equipamiento.</small
            >
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            data-create-mode="library"
            @click="startWizard('library')"
          >
            <strong>Elegir una rutina</strong
            ><small
              >Full Body, Upper/Lower, PPL y más plantillas editables.</small
            >
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            data-create-mode="custom"
            @click="startWizard('custom')"
          >
            <strong>Crear a mi manera</strong
            ><small>Organiza tus propios días, ejercicios y objetivos.</small>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
      <template v-else>
        <details
          v-if="plans.length > 1"
          class="routine-switcher"
          :open="!chosenPlan"
        >
          <summary>Cambiar rutina · {{ plans.length }} guardadas</summary>
          <label for="routine-plan">Tus rutinas</label>
          <select
            id="routine-plan"
            v-model="chosenPlan"
            :disabled="duplicateLocked"
            class="form-control"
          >
            <option value="">Elige una rutina</option>
            <option v-for="item in plans" :key="item.id" :value="item.id">
              {{ item.name }} ·
              {{
                item.status === "ACTIVE"
                  ? "Activa"
                  : item.status === "DRAFT"
                    ? "Borrador"
                    : "Consulta"
              }}
            </option>
          </select>
        </details>
        <p v-if="!chosenPlan" class="field-hint">
          Elige la rutina que quieres consultar. No cambiaremos tus planes
          activos.
        </p>
        <p v-if="actions.loading.value && chosenPlan" role="status">
          Preparando tu semana…
        </p>
        <p v-if="actions.error.value" class="form-error" role="alert">
          {{ actions.error.value }}
        </p>
        <template v-if="plan && plan.id === chosenPlan">
          <header class="routine-current ui-panel">
            <div>
              <h2>{{ plan.name }}</h2>
              <p>
                {{ days.length }} sesiones ·
                {{
                  flexible
                    ? "Secuencia flexible"
                    : days.some((day) => day.weekday === null)
                      ? "Programación mixta"
                      : "Días fijos"
                }}
              </p>
            </div>
            <div class="routine-current-actions">
              <span class="routine-status" :data-status="plan.status">{{
                plan.status === "ACTIVE"
                  ? "Plan activo"
                  : plan.status === "DRAFT"
                    ? "Borrador guardado"
                    : "Solo consulta"
              }}</span>
              <div v-if="plan.status === 'DRAFT'" class="plan-actions">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="busy"
                  @click="activate"
                >
                  Usar como plan activo
                </button>
              </div>
            </div>
          </header>
          <div class="routine-distribution-title">
            <h2>Tu distribución semanal</h2>
            <label for="routine-week"
              >Semana
              <select
                id="routine-week"
                v-model="chosenWeek"
                class="form-control"
              >
                <option
                  v-for="item in plan.weeks"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.weekNumber }}
                </option>
              </select></label
            >
          </div>
          <RoutineWeekStrip
            v-if="week && (!flexible || activities.length)"
            :starts-on="week.startsOn?.slice(0, 10)"
            :reference-date="today"
            :selected-date="focusedDate"
            :days="days"
            :activities="activities"
            @select="chooseDate"
          />
          <nav class="routine-session-tabs" aria-label="Días de entrenamiento">
            <button
              v-for="(day, index) in days"
              :key="day.id"
              type="button"
              :aria-pressed="focusedDay === day.id"
              @click="chooseDay(day.id)"
            >
              <small>{{
                flexible ? "Sesión " + (index + 1) : weekdayLabel(day.weekday)
              }}</small
              ><strong>{{ day.name }}</strong
              ><span>{{ day.exercises.length }} ejercicios</span>
            </button>
          </nav>
          <article
            v-if="selectedDay && week"
            class="routine-day-preview ui-panel"
          >
            <header>
              <div>
                <h2>{{ selectedDay.name }}</h2>
                <p>
                  {{ selectedDay.exercises.length }} ejercicios ·
                  {{ focusedDate || "Sin fecha fija" }}
                </p>
              </div>
              <RouterLink class="primary-button" :to="selectedLink"
                >Ver entrenamiento →</RouterLink
              >
            </header>
            <p v-if="dayResults(selectedDay.id).ongoing" class="routine-badge">
              Entrenamiento en curso: puedes retomarlo sin reconstruirlo.
            </p>
            <p
              v-else-if="dayResults(selectedDay.id).completed"
              class="field-hint"
            >
              {{ dayResults(selectedDay.id).completed }} entrenamiento(s)
              finalizado(s). Sus resultados permanecen en el historial.
            </p>
            <ol
              v-if="selectedDay.exercises.length"
              class="routine-exercise-preview"
            >
              <li v-for="(item, index) in selectedDay.exercises" :key="item.id">
                <span class="routine-exercise-number">{{ index + 1 }}</span>
                <div>
                  <strong>{{ item.exercise.name }}</strong
                  ><small
                    >{{ item.exercise.muscleGroup }} ·
                    {{ item.exercise.equipment }}</small
                  >
                </div>
                <span
                  >{{ item.targetSets }} ×
                  {{
                    item.targetRepsMin === item.targetRepsMax
                      ? item.targetRepsMin
                      : item.targetRepsMin + "–" + item.targetRepsMax
                  }}</span
                >
              </li>
            </ol>
            <p v-else class="field-hint">
              Este día todavía no tiene ejercicios. Complétalo antes de
              entrenar.
            </p>
            <div class="routine-day-secondary">
              <RouterLink
                class="secondary-button"
                :to="{
                  ...selectedLink,
                  query: { ...selectedLink.query, edit: 'true' },
                }"
                >Editar ejercicios y objetivos</RouterLink
              >
              <details
                v-if="['DRAFT', 'ACTIVE'].includes(plan.status)"
                class="routine-quick-schedule"
              >
                <summary>Personalizar fecha</summary>
                <p class="field-hint">
                  Mueve esta programación o añade una fecha a tu secuencia.
                  Otras semanas y resultados anteriores se conservan.
                </p>
                <label for="selected-schedule-date"
                  >Fecha ({{ timeZone }})<input
                    id="selected-schedule-date"
                    v-model="moveDate"
                    type="date"
                    :min="dates[0]"
                    :max="dates[6]"
                    class="form-control"
                /></label>
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="
                    busy ||
                    !moveDate ||
                    selectedActivities.length > 1 ||
                    selectedActivity?.workouts.some((w) =>
                      ['IN_PROGRESS', 'COMPLETED'].includes(w.status),
                    )
                  "
                  @click="saveDistributionDate"
                >
                  {{
                    selectedActivity
                      ? "Cambiar esta fecha"
                      : "Programar este entrenamiento"
                  }}
                </button>
                <p
                  v-if="
                    selectedActivity?.workouts.some((w) =>
                      ['IN_PROGRESS', 'COMPLETED'].includes(w.status),
                    )
                  "
                  class="field-hint"
                >
                  Esta fecha conserva un entrenamiento iniciado. Puedes
                  organizar otra fecha desde las opciones avanzadas.
                </p>
              </details>
            </div>
          </article>
          <p v-else-if="days.length" class="routine-selection-hint">
            {{
              activities.some(
                (a) =>
                  a.scheduledOn.slice(0, 10) === focusedDate &&
                  a.status === "REST",
              )
                ? "Descanso programado. No es una sesión omitida."
                : "Elige una sesión para ver sus ejercicios. Las fechas sin programación no se consideran incumplimientos."
            }}
          </p>
          <p v-if="!days.length" class="state-card">
            Esta semana está incompleta: añade un día en Personalizar
            programación.
          </p>
          <p v-if="weekSessions.error.value" class="form-error" role="alert">
            {{ weekSessions.error.value }}
          </p>
          <p v-if="weekSessions.total.value > 100" class="field-hint">
            Resumen de las 100 sesiones más recientes de esta semana. El
            historial conserva todas.
          </p>
          <p v-if="week?.pendingExercises.length" class="field-hint">
            Hay prescripciones antiguas pendientes de distribuir. Puedes
            organizarlas desde la edición avanzada.
          </p>
          <details
            v-if="['DRAFT', 'ACTIVE'].includes(plan.status)"
            class="routine-options"
          >
            <summary>Personalizar programación y opciones avanzadas</summary>
            <div class="plan-actions">
              <button
                class="text-button"
                type="button"
                :disabled="duplicateLocked || showWizard"
                @click="toggleDuplicate"
              >
                Duplicar rutina
              </button>
              <RouterLink :to="{ name: 'exercise-catalog' }"
                >Catálogo de ejercicios</RouterLink
              >
              <button
                class="secondary-button"
                type="button"
                @click="adding = !adding"
              >
                Añadir día extra</button
              ><RouterLink
                :to="{
                  name: 'training-plan-detail',
                  params: { planId: plan.id },
                  query: { weekId: chosenWeek },
                }"
                >Edición avanzada, duplicar semana y distribuir
                pendientes</RouterLink
              >
            </div>
            <PlanDayForm
              v-if="adding && week"
              :next-position="Math.max(0, ...days.map((d) => d.position)) + 1"
              :busy="busy"
              :save="addDay"
              @cancel="adding = false"
            />
            <label class="field-label" for="calendar-date"
              >Fecha local ({{ timeZone }})</label
            ><input
              id="calendar-date"
              v-model="calendarDate"
              class="form-control"
              type="date"
            /><button
              class="text-button"
              :disabled="busy || !calendarDate"
              @click="rest"
            >
              Registrar descanso voluntario
            </button>
            <div class="plan-actions">
              <button
                v-for="day in days"
                :key="day.id"
                class="text-button"
                :disabled="busy || !calendarDate"
                @click="schedule(day.id, day.name)"
              >
                Programar {{ day.name }} en esta fecha
              </button>
            </div>
          </details>
          <p v-if="activitiesLoading" role="status">Cargando programación…</p>
          <section v-if="activities.length" class="state-card">
            <div class="plan-panel-heading">
              <h2>Programación y descansos</h2>
              <span class="field-hint">{{ today }} · {{ timeZone }}</span>
            </div>
            <ul class="routine-calendar">
              <li v-for="activity in activities" :key="activity.id">
                <strong
                  >{{ activity.scheduledOn.slice(0, 10) }} ·
                  {{ activity.title }}</strong
                ><RouterLink
                  v-if="activity.planDayId && activity.planWeekId && plan"
                  class="routine-resume"
                  :to="{
                    name: 'routine-day',
                    params: {
                      planId: plan.id,
                      weekId: activity.planWeekId,
                      dayId: activity.planDayId,
                    },
                    query: {
                      date: activity.scheduledOn.slice(0, 10),
                      activityId: activity.id,
                      timeZone: activity.timeZone,
                    },
                  }"
                  >Abrir este entrenamiento →</RouterLink
                >
                <p>{{ activityLabel(activity) }}</p>
                <p
                  v-if="activity.scheduledOn !== activity.originalOn"
                  class="field-hint"
                >
                  Fecha original: {{ activity.originalOn.slice(0, 10) }}
                </p>
                <div
                  v-if="
                    !activity.workouts.some((w) =>
                      ['IN_PROGRESS', 'COMPLETED'].includes(w.status),
                    ) && !['REST', 'WITHDRAWN'].includes(activity.status)
                  "
                  class="plan-actions"
                >
                  <button
                    class="text-button"
                    :disabled="busy"
                    @click="calendarAction(activity, 'move')"
                  >
                    Mover a {{ calendarDate }}</button
                  ><button
                    class="text-button"
                    :disabled="busy"
                    @click="
                      calendarAction(
                        activity,
                        activity.status === 'OMITTED' ? 'restore' : 'omit',
                      )
                    "
                  >
                    {{
                      activity.status === "OMITTED"
                        ? "Restaurar programación"
                        : "Omitir voluntariamente"
                    }}
                  </button>
                </div>
              </li>
            </ul>
          </section></template
        ></template
      >
    </template>
    <p v-if="failure" class="form-error" role="alert">{{ failure }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <RouterLink class="back-link" :to="{ name: 'training-plans' }"
      >Gestionar todos mis planes →</RouterLink
    >
  </section>
</template>

<style scoped>
.routine-welcome {
  padding: clamp(1.2rem, 4vw, 2.5rem);
}
.routine-welcome h2 {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  margin: 0.3rem 0;
}
.routine-entry-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
}
.routine-entry-options button {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
  text-align: left;
  background: var(--color-surface-subtle);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius-card);
  padding: var(--space-5);
  min-height: var(--target-size, 48px);
  overflow-wrap: anywhere;
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast);
}
.routine-entry-options button:first-child {
  border-color: var(--color-primary);
  background: var(--color-accent-surface);
}
.routine-entry-options button:hover {
  border-color: var(--color-primary);
}
.routine-entry-options button > span {
  color: var(--color-primary);
  margin-block-start: auto;
  padding-block-start: var(--space-2);
  font-size: 1.25rem;
}
.routine-entry-options strong {
  font-size: 1.15rem;
  line-height: 1.35;
}
.routine-entry-options small {
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.55;
}
.routine-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1rem 0;
  padding: 1.5rem;
}
.routine-current h2 {
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  margin: 0.3rem 0;
  overflow-wrap: anywhere;
}
.routine-current p:last-child {
  color: var(--muted);
  margin-bottom: 0;
}
.routine-current-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.routine-current-actions .plan-actions {
  margin: 0;
}
.routine-status {
  border: 1px solid var(--line);
  padding: 0.5rem 0.7rem;
  border-radius: 99px;
  white-space: nowrap;
  font-size: 0.8rem;
}
.routine-status[data-status="ACTIVE"] {
  color: var(--color-primary);
  border-color: var(--color-primary);
}
.routine-switcher {
  margin-bottom: 1rem;
}
.routine-switcher summary {
  cursor: pointer;
  min-height: var(--target-size, 48px);
  align-content: center;
}
.routine-distribution-title {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  margin-top: 1.5rem;
}
.routine-distribution-title h2 {
  font-size: 1.2rem;
  margin: 0;
}
.routine-distribution-title label {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.85rem;
}
.routine-distribution-title select {
  width: auto;
  min-width: 4rem;
}
.routine-session-tabs {
  display: flex;
  gap: 0.65rem;
  overflow: auto;
  padding: 0.5rem 0 1rem;
}
.routine-session-tabs button {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 135px;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--ink);
  padding: 0.9rem;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast);
}
.routine-session-tabs button[aria-pressed="true"] {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}
.routine-session-tabs small,
.routine-session-tabs span {
  color: var(--muted);
  font-size: 0.75rem;
}
.routine-day-preview {
  padding: clamp(1rem, 3vw, 1.75rem);
}
.routine-day-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.routine-day-preview h2 {
  margin: 0.3rem 0;
  font-size: 1.5rem;
}
.routine-day-preview header p:last-child {
  color: var(--muted);
  font-size: 0.85rem;
}
.routine-exercise-preview {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
}
.routine-exercise-preview li {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;
  border-top: 1px solid var(--line);
  padding: 1rem 0;
}
.routine-exercise-number {
  color: var(--muted);
  font-size: 0.8rem;
}
.routine-exercise-preview li > div {
  display: grid;
  gap: 0.4rem;
}
.routine-exercise-preview small {
  color: var(--muted);
  line-height: 1.4;
}
.routine-exercise-preview li > span:last-child {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-weight: 650;
}
.routine-day-secondary {
  border-top: 1px solid var(--line);
  padding-top: 1rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: flex-start;
}
.routine-day-secondary > a {
  min-height: var(--target-size, 48px);
  align-content: center;
}
.routine-quick-schedule {
  flex: 1;
  min-width: min(12.5rem, 100%);
}
.routine-quick-schedule summary {
  min-height: var(--target-size, 48px);
  align-content: center;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .routine-entry-options button,
  .routine-session-tabs button {
    transition: none;
  }
}
.routine-quick-schedule label {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}
.routine-options {
  margin-top: 1.25rem;
}
.routine-selection-hint {
  padding: 1rem;
  border: 1px dashed var(--line);
  border-radius: 12px;
  color: var(--muted);
  line-height: 1.5;
}
@media (max-width: 640px) {
  .routine-entry-options {
    grid-template-columns: 1fr;
  }
  .routine-entry-options button {
    gap: 0.55rem;
    padding: 1.2rem;
  }
  .routine-current {
    align-items: flex-start;
    flex-direction: column;
  }
  .routine-day-preview > header {
    align-items: stretch;
    flex-direction: column;
  }
  .routine-day-preview > header .primary-button {
    justify-content: center;
    width: 100%;
  }
  .routine-distribution-title {
    gap: 0.5rem;
  }
  .routine-exercise-preview li {
    grid-template-columns: 1.3rem minmax(0, 1fr);
    gap: 0.5rem;
  }
  .routine-exercise-preview li > span:last-child {
    grid-column: 2;
    font-size: 0.85rem;
    color: var(--color-primary);
  }
  .routine-day-secondary {
    flex-direction: column;
  }
  .routine-quick-schedule {
    width: 100%;
  }
}
</style>
