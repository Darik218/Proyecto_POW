<script setup lang="ts">
import StatusBadge from "../components/ui/StatusBadge.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import StartWorkoutForm from "../components/workouts/StartWorkoutForm.vue";
import { useWorkoutSessions } from "../composables/useWorkoutSessions";
import {
  workoutSessionsService,
  workoutStatusLabel,
  workoutStatuses,
  type CreateWorkout,
  type WorkoutSummary,
} from "../services/workout-sessions.service";
import "../assets/training-plans.css";
import "../assets/workouts.css";
import { useTrainingPlans } from "../composables/useTrainingPlans";
import {
  trainingPlansService,
  trainingPlanErrorMessage,
  type Planning,
} from "../services/training-plans.service";
const props = defineProps<{ historyOnly?: boolean }>();
const planState = useTrainingPlans();
const selectedPlan = ref(
  typeof useRoute().query.planId === "string"
    ? String(useRoute().query.planId)
    : "",
);
const selectedDay = ref(
  typeof useRoute().query.dayId === "string"
    ? String(useRoute().query.dayId)
    : "",
);
const rangeFrom = ref(""),
  rangeTo = ref(""),
  filterPlan = ref<Planning | null>(null);
const filterError = ref("");
let filterVersion = 0,
  filterController: AbortController | undefined;
watch(
  selectedPlan,
  async (id, previous) => {
    if (previous !== undefined) selectedDay.value = "";
    const current = ++filterVersion;
    filterController?.abort();
    filterController = new AbortController();
    filterPlan.value = null;
    filterError.value = "";
    if (!id) return;
    try {
      const result = await trainingPlansService.getPlanning(
        id,
        filterController.signal,
      );
      if (current === filterVersion) filterPlan.value = result;
    } catch (cause) {
      if (current === filterVersion && !filterController.signal.aborted)
        filterError.value = trainingPlanErrorMessage(
          cause,
          "No se pudieron cargar las rutinas del filtro.",
        );
    }
  },
  { immediate: true },
);
const route = useRoute();
const router = useRouter();
const queryString = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const initialPlanId = computed(() => queryString(route.query.planId));
const initialWeekId = computed(() => queryString(route.query.weekId));
const initialDayId = computed(() => queryString(route.query.dayId));
const initialRepeatFromId = computed(() =>
  queryString(route.query.repeatFromId),
);
const showingForm = ref(
  Boolean(
    initialPlanId.value ||
    initialRepeatFromId.value ||
    route.query.new === "free",
  ),
);
const status = ref<WorkoutSummary["status"] | "">("COMPLETED");
const {
  sessions,
  total,
  offset,
  loading,
  error,
  load,
  next,
  previous,
  dispose,
} = useWorkoutSessions();
const ongoing = useWorkoutSessions();
const {
  sessions: inProgress,
  loading: loadingOngoing,
  error: ongoingError,
} = ongoing;
watch(
  () => route.fullPath,
  () => {
    if (
      initialPlanId.value ||
      initialRepeatFromId.value ||
      route.query.new === "free"
    )
      showingForm.value = true;
  },
);
function filtered() {
  return load({
    ...(status.value ? { status: status.value } : {}),
    ...(selectedPlan.value ? { trainingPlanId: selectedPlan.value } : {}),
    ...(selectedDay.value ? { planDayId: selectedDay.value } : {}),
    ...(rangeFrom.value ? { from: rangeFrom.value } : {}),
    ...(rangeTo.value ? { to: rangeTo.value } : {}),
  });
}
watch(
  [status, selectedPlan, selectedDay, rangeFrom, rangeTo],
  () => void filtered(),
);
async function prepare(input: CreateWorkout) {
  const result = await workoutSessionsService.create(input);
  await router.push({
    name: "workout-session-detail",
    params: { sessionId: result.id },
  });
}
onMounted(() => {
  void filtered();
  void planState.load();
  if (!props.historyOnly) void ongoing.load({ status: "IN_PROGRESS" });
});
onUnmounted(() => {
  filterVersion++;
  filterController?.abort();
  dispose();
  ongoing.dispose();
  planState.dispose();
});
</script>
<template>
  <section
    class="page-view training-plans workouts"
    aria-labelledby="workouts-title"
  >
    <PageHeader
      id="workouts-title"
      :title="historyOnly ? 'Historial' : 'Entrenar'"
      description="Prepara una sesión, registra lo que realizas y consulta tu historial."
      :icon="historyOnly ? 'history' : 'activity'"
      ><template #actions
        ><button
          v-if="!historyOnly"
          class="primary-button"
          type="button"
          @click="showingForm = !showingForm"
        >
          {{
            showingForm ? "Cerrar formulario" : "Registrar nuevo entrenamiento"
          }}
        </button></template
      ></PageHeader
    >
    <StartWorkoutForm
      v-if="showingForm && !historyOnly"
      :key="route.fullPath"
      :initial-plan-id="initialPlanId"
      :initial-scheduled-activity-id="queryString(route.query.activityId)"
      :initial-week-id="initialWeekId"
      :initial-day-id="initialDayId"
      :initial-repeat-from-id="initialRepeatFromId"
      :save="prepare"
      @cancel="showingForm = false"
    />
    <section
      v-if="!historyOnly"
      class="workout-ongoing"
      aria-labelledby="ongoing-title"
    >
      <h2 id="ongoing-title">Continuar entrenamiento en curso</h2>
      <p v-if="loadingOngoing" role="status">
        Consultando entrenamientos en curso…
      </p>
      <p v-else-if="ongoingError" role="alert" class="form-error">
        {{ ongoingError }}
        <button
          class="text-button"
          type="button"
          @click="ongoing.load({ status: 'IN_PROGRESS' })"
        >
          Reintentar
        </button>
      </p>
      <p v-else-if="!inProgress.length" class="state-message">
        No hay entrenamientos en curso.
      </p>
      <ul v-else class="plan-list">
        <li v-for="item in inProgress" :key="item.id">
          <RouterLink
            class="plan-summary-card"
            :to="{
              name: 'workout-session-detail',
              params: { sessionId: item.id },
            }"
            ><h3>
              {{
                item.name ??
                item.sourceSnapshot?.day?.name ??
                "Entrenamiento libre"
              }}
            </h3>
            <p>
              {{
                item.performedOn?.slice(0, 10) ?? "Fecha local no registrada"
              }}
              · {{ item.completedSetCount ?? 0 }} series completadas
            </p>
            <span class="plan-link">Continuar →</span></RouterLink
          >
        </li>
      </ul>
      <button
        v-if="ongoing.total.value > 20"
        class="text-button"
        type="button"
        @click="status = 'IN_PROGRESS'"
      >
        Ver todos los entrenamientos en curso
      </button>
    </section>
    <h2 class="weeks-heading">Historial y sesiones preparadas</h2>
    <p v-if="filterError" class="form-error" role="alert">{{ filterError }}</p>
    <div class="routine-grid workout-history-filters">
      <div>
        <label class="field-label" for="history-plan">Plan</label
        ><select id="history-plan" v-model="selectedPlan" class="form-control">
          <option value="">Todos</option>
          <option
            v-for="item in planState.plans.value"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }}
          </option>
        </select>
      </div>
      <div>
        <label class="field-label" for="history-day">Rutina</label
        ><select id="history-day" v-model="selectedDay" class="form-control">
          <option value="">Todas</option>
          <optgroup
            v-for="week in filterPlan?.weeks ?? []"
            :key="week.id"
            :label="'Semana ' + week.weekNumber"
          >
            <option v-for="day in week.days" :key="day.id" :value="day.id">
              {{ day.name }}
            </option>
          </optgroup>
        </select>
      </div>
      <div>
        <label class="field-label" for="history-from">Desde</label
        ><input
          id="history-from"
          v-model="rangeFrom"
          class="form-control"
          type="date"
        />
      </div>
      <div>
        <label class="field-label" for="history-to">Hasta</label
        ><input
          id="history-to"
          v-model="rangeTo"
          class="form-control"
          type="date"
          :min="rangeFrom || undefined"
        />
      </div>
    </div>
    <label class="field-label" for="workout-status">Estado</label
    ><select
      id="workout-status"
      v-model="status"
      class="form-control workout-filter"
    >
      <option value="">Todos</option>
      <option v-for="value in workoutStatuses" :key="value" :value="value">
        {{ workoutStatusLabel(value) }}
      </option>
    </select>
    <LoadingState v-if="loading" label="Cargando entrenamientos…" :rows="3" />
    <div v-else-if="error" class="state-card state-card--error" role="alert">
      <p>{{ error }}</p>
      <button class="secondary-button" type="button" @click="load()">
        Reintentar
      </button>
    </div>
    <EmptyState
      v-else-if="!sessions.length"
      title="Sin sesiones en esta selección"
      description="No hay entrenamientos con estos criterios."
      icon="history"
    />
    <ul v-else class="plan-list">
      <li v-for="session in sessions" :key="session.id">
        <article class="plan-summary-card">
          <RouterLink
            class="back-link"
            :to="{
              name: 'workout-session-detail',
              params: { sessionId: session.id },
            }"
            ><div class="plan-section-heading">
              <h3>
                {{
                  session.name ??
                  session.sourceSnapshot?.day?.name ??
                  "Entrenamiento"
                }}
              </h3>
              <StatusBadge
                :status="session.status"
                :label="workoutStatusLabel(session.status)"
              /></div
          ></RouterLink>
          <p>
            Fecha:
            {{ session.performedOn?.slice(0, 10) ?? "Fecha local no registrada"
            }}{{ session.timeZone ? " · " + session.timeZone : "" }}
          </p>
          <p>
            {{ session.trainingPlan?.name ?? "Entrenamiento independiente"
            }}{{
              session.planWeek
                ? " · Semana " + session.planWeek.weekNumber
                : ""
            }}{{ session.planDay ? " · " + session.planDay.name : "" }}
          </p>
          <p>
            {{ session.exerciseCount }} ejercicios ·
            {{ session.completedSetCount ?? 0 }} series completadas
          </p>
          <p
            v-if="session.status === 'COMPLETED' && !session.actualSetCount"
            class="field-hint"
          >
            Finalizado sin resultados registrados.
          </p>
          <div class="plan-actions">
            <RouterLink
              :to="{
                name: 'workout-session-detail',
                params: { sessionId: session.id },
              }"
              >{{
                session.status === "IN_PROGRESS"
                  ? "Continuar entrenamiento"
                  : session.status === "PLANNED"
                    ? "Revisar y preparar"
                    : "Ver resultados"
              }}</RouterLink
            ><RouterLink
              v-if="['COMPLETED', 'CANCELLED'].includes(session.status)"
              :to="{
                name: 'workout-sessions',
                query: { repeatFromId: session.id },
              }"
              >Repetir estructura</RouterLink
            >
          </div>
        </article>
      </li>
    </ul>
    <nav
      v-if="total > 20"
      class="plan-actions"
      aria-label="Páginas de entrenamientos"
    >
      <button
        class="secondary-button"
        type="button"
        :disabled="loading || offset === 0"
        @click="previous"
      >
        Anterior</button
      ><span
        >{{ offset + 1 }}–{{ Math.min(offset + sessions.length, total) }} de
        {{ total }}</span
      ><button
        class="secondary-button"
        type="button"
        :disabled="loading || offset + sessions.length >= total"
        @click="next"
      >
        Siguiente
      </button>
    </nav>
  </section>
</template>
