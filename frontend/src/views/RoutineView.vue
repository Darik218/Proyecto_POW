<script setup lang="ts">
import { useAuthStore } from "../stores/auth.store";
import { onBeforeRouteLeave } from "vue-router";
import PageHeader from "../components/ui/PageHeader.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import DuplicatePlanForm from "../components/training-plans/DuplicatePlanForm.vue";
import GeneratePlanForm from "../components/training-plans/GeneratePlanForm.vue";
import PlanDayForm from "../components/training-plans/PlanDayForm.vue";
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
const chosenPlan = ref(
  typeof route.query.planId === "string" ? route.query.planId : "",
);
const chosenWeek = ref(
  typeof route.query.weekId === "string" ? route.query.weekId : "",
);
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
      { weekId: week.value.id, from: today, to: today, timeZone },
      controller.signal,
    );
    if (current === revision) activities.value = result;
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
  chosenWeek.value = "";
  activities.value = [];
  if (!id) return;
  await actions.load(id);
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
      limit: 100,
    });
});
async function run(work: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  try {
    await work();
    await plansState.load();
    if (chosenPlan.value) await actions.load(chosenPlan.value);
    await loadActivities();
    notice.value = "Cambio guardado.";
  } catch (cause) {
    failure.value = trainingPlanErrorMessage(
      cause,
      "No se pudo guardar el cambio.",
    );
  } finally {
    busy.value = false;
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
  await actions.load(chosenPlan.value);
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
onMounted(async () => {
  await Promise.all([
    plansState.load(),
    ongoing.load({ status: "IN_PROGRESS" }),
    prepared.load({ status: "PLANNED" }),
  ]);
  const requested = chosenPlan.value;
  chosenPlan.value = "";
  const active = plans.value.filter((p) => p.status === "ACTIVE");
  chosenPlan.value =
    requested ||
    (active.length === 1
      ? active[0]!.id
      : plans.value.length === 1
        ? plans.value[0]!.id
        : "");
});
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
    <PageHeader
      id="routine-title"
      title="Mi rutina"
      description="Planifica a tu ritmo. Entrena según tu día."
      icon="dumbbell"
      ><template #actions>
        <div class="plan-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="duplicateLocked || duplicating"
            @click="showWizard = true"
          >
            Crear plan</button
          ><RouterLink
            class="secondary-button"
            :to="{ name: 'workout-sessions', query: { new: 'free' } }"
            >Entrenar sin plan</RouterLink
          >
          <button
            v-if="plan"
            class="text-button"
            type="button"
            :disabled="duplicateLocked || showWizard"
            @click="toggleDuplicate"
          >
            Duplicar rutina
          </button>
        </div>
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
      @created="created"
      @cancel="showWizard = false"
    />
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
      <button class="text-button" @click="plansState.load()">Reintentar</button>
    </div>
    <EmptyState
      v-else-if="!plans.length"
      title="Tu próxima rutina empieza aquí"
      description="Todavía no tienes un plan. Crea uno o comienza un entrenamiento libre."
      icon="dumbbell"
    />
    <template v-else
      ><label class="field-label" for="routine-plan">Plan</label
      ><select
        id="routine-plan"
        v-model="chosenPlan"
        :disabled="duplicateLocked"
        class="form-control"
      >
        <option value="">Selecciona un plan</option>
        <option v-for="item in plans" :key="item.id" :value="item.id">
          {{ item.name }} ·
          {{
            item.status === "ACTIVE"
              ? "Activo"
              : item.status === "DRAFT"
                ? "Borrador"
                : "Consulta"
          }}
        </option>
      </select>
      <p v-if="actions.loading.value && chosenPlan" role="status">
        Cargando semanas…
      </p>
      <p v-if="actions.error.value" class="form-error" role="alert">
        {{ actions.error.value }}
      </p>
      <template v-if="plan && plan.id === chosenPlan"
        ><div class="routine-week-bar">
          <label for="routine-week">Semana</label
          ><select id="routine-week" v-model="chosenWeek" class="form-control">
            <option v-for="item in plan.weeks" :key="item.id" :value="item.id">
              Semana {{ item.weekNumber }}
            </option>
          </select>
        </div>
        <div v-if="week" class="routine-grid">
          <article
            v-for="day in days"
            :key="day.id"
            class="state-card routine-day"
          >
            <div class="routine-day-topline">
              <span class="plan-status">{{ weekdayLabel(day.weekday) }}</span
              ><span class="routine-day-number">{{
                String(day.position).padStart(2, "0")
              }}</span>
            </div>
            <h2>{{ day.name }}</h2>
            <p>{{ day.exercises.length }} ejercicios · objetivos propios</p>
            <p v-if="dayResults(day.id).completed" class="routine-badge">
              {{ dayResults(day.id).completed }} entrenamiento(s) finalizado(s)
            </p>
            <p v-if="dayResults(day.id).ongoing" class="routine-badge">
              Entrenamiento en curso
            </p>
            <RouterLink
              class="primary-button"
              :to="{
                name: 'routine-day',
                params: { planId: plan.id, weekId: week.id, dayId: day.id },
              }"
              >Abrir día →</RouterLink
            >
          </article>
          <p v-if="!days.length" class="state-card">
            Esta semana no tiene días vigentes. Puedes añadir uno.
          </p>
        </div>
        <p v-if="weekSessions.error.value" class="form-error" role="alert">
          {{ weekSessions.error.value }}
        </p>
        <p v-if="weekSessions.total.value > 100" class="field-hint">
          Resumen de las 100 sesiones más recientes de esta semana. El historial
          conserva todas.
        </p>
        <p v-if="week?.pendingExercises.length" class="field-hint">
          Hay prescripciones antiguas pendientes de distribuir. Puedes
          organizarlas desde la edición avanzada.
        </p>
        <details
          v-if="['DRAFT', 'ACTIVE'].includes(plan.status)"
          class="routine-options"
          open
        >
          <summary>Adaptar mi programación</summary>
          <div class="plan-actions">
            <button
              class="secondary-button"
              type="button"
              @click="adding = !adding"
            >
              Añadir día extra</button
            ><button
              v-if="plan.status === 'DRAFT'"
              class="secondary-button"
              :disabled="busy"
              @click="activate"
            >
              Usar como plan activo</button
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
    <p v-if="failure" class="form-error" role="alert">{{ failure }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <RouterLink class="back-link" :to="{ name: 'training-plans' }"
      >Gestionar todos mis planes →</RouterLink
    >
  </section>
</template>
