<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onUnmounted, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { workoutProgressService } from "../../services/workout-progress.service";
import type {
  WorkoutProgress,
  ProgressPeriod,
} from "../../schemas/workout-progress.schema";
import ProgressChart from "./ProgressChart.vue";
import DailyWorkoutGuide from "../workouts/DailyWorkoutGuide.vue";
const auth = useAuthStore(),
  result = ref<WorkoutProgress | null>(null),
  filterOptions = shallowRef<Pick<
    WorkoutProgress,
    "plans" | "planDays" | "exercises" | "selectedPlanId" | "selectedPlanDayId"
  > | null>(null),
  period = ref<ProgressPeriod>("30"),
  selected = ref(""),
  selectedDay = ref(""),
  selectedPlan = ref(""),
  loadIndex = ref("0"),
  busy = ref(false),
  error = ref("");
const periods: Array<{ value: ProgressPeriod; label: string }> = [
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
  { value: "all", label: "Todo" },
];
const frequency = computed(
  () =>
    result.value?.frequency.map((p) => ({
      id: p.week,
      date: p.week,
      value: p.sessions,
    })) ?? [],
);
const series = computed(() => result.value?.series[Number(loadIndex.value)]);
const repetitions = computed(
  () =>
    series.value?.points.map((p) => ({
      id: p.setId,
      date: p.performedOn,
      value: p.repetitions,
    })) ?? [],
);
const recordedLoads = computed(() =>
  ["KG", "LB"]
    .map((unit) => ({
      unit,
      points:
        result.value?.series
          .filter(
            (item) =>
              item.kind === "RECORDED_LOAD_REPETITIONS" &&
              item.unit === unit &&
              item.load !== null,
          )
          .flatMap((item) =>
            item.points.map((point) => ({
              id: point.setId,
              date: point.performedOn,
              value: Number(item.load),
            })),
          )
          .sort(
            (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
          ) ?? [],
    }))
    .filter((group) => group.points.length),
);
const estimateGroups = computed(() => {
  type Estimate = WorkoutProgress["estimates"][number];
  const groups = new Map<
    string,
    {
      key: string;
      formula: Estimate["formula"];
      algorithmVersion: string;
      eligibilityVersion: string;
      numericPolicyKey: string;
      points: Array<{ id: string; date: string; value: number }>;
    }
  >();
  for (const estimate of result.value?.estimates ?? []) {
    if (!estimate.performedOn) continue;
    const key = JSON.stringify([
      estimate.formula,
      estimate.algorithmVersion,
      estimate.eligibilityVersion,
      estimate.numericPolicyKey,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        key,
        formula: estimate.formula,
        algorithmVersion: estimate.algorithmVersion,
        eligibilityVersion: estimate.eligibilityVersion,
        numericPolicyKey: estimate.numericPolicyKey,
        points: [],
      });
    groups.get(key)!.points.push({
      id: estimate.id,
      date: estimate.performedOn,
      value: Number(estimate.value),
    });
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => ({
      ...group,
      points: group.points.sort((a, b) => a.date.localeCompare(b.date)),
    }));
});
const truncated = computed(
  () =>
    result.value &&
    Object.values(result.value.metadata.truncated).some(Boolean),
);
let controller: AbortController | undefined,
  generation = 0,
  mounted = false;
async function load() {
  if (!auth.isAuthenticated) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    n = ++generation;
  result.value = null;
  busy.value = true;
  error.value = "";
  loadIndex.value = "0";
  try {
    const value = await workoutProgressService.get(
      period.value,
      selected.value || undefined,
      signal,
      undefined,
      selectedDay.value || undefined,
      selectedPlan.value || undefined,
    );
    if (n !== generation || signal.aborted) return;
    result.value = value;
    filterOptions.value = {
      plans: value.plans,
      planDays: value.planDays,
      exercises: value.exercises,
      selectedPlanId: value.selectedPlanId,
      selectedPlanDayId: value.selectedPlanDayId,
    };
    selected.value = value.selectedExerciseId ?? "";
    selectedDay.value = value.selectedPlanDayId ?? "";
    selectedPlan.value = value.selectedPlanId ?? "";
  } catch {
    if (n === generation && !signal.aborted)
      error.value =
        "No se pudo consultar tu progreso. Tus entrenamientos siguen guardados.";
  } finally {
    if (n === generation) busy.value = false;
  }
}
function changePeriod(value: ProgressPeriod) {
  period.value = value;
  void load();
}
function changeDay() {
  selected.value = "";
  void load();
}
function changePlan() {
  selectedDay.value = "";
  selected.value = "";
  void load();
}
onMounted(() => {
  mounted = true;
  void load();
});
watch(
  () =>
    [auth.user?.id, auth.isAuthenticated, auth.getSessionGeneration()].join(
      ":",
    ),
  () => {
    generation++;
    controller?.abort();
    result.value = null;
    filterOptions.value = null;
    selected.value = "";
    selectedDay.value = "";
    selectedPlan.value = "";
    error.value = "";
    busy.value = false;
    if (mounted && auth.isAuthenticated) void load();
  },
  { flush: "sync" },
);
onUnmounted(() => {
  mounted = false;
  generation++;
  controller?.abort();
});
</script>
<template>
  <section
    class="progress-overview"
    aria-labelledby="my-performance"
    :aria-busy="busy"
    data-testid="progress-overview"
  >
    <header class="progress-heading">
      <h2 id="my-performance">Resultados registrados</h2>
      <RouterLink class="back-link" :to="{ name: 'workout-history' }"
        >Ver historial →</RouterLink
      >
    </header>
    <div class="period-controls" role="group" aria-label="Período del progreso">
      <button
        v-for="option in periods"
        :key="option.value"
        type="button"
        :aria-pressed="period === option.value"
        :data-testid="`progress-period-${option.value}`"
        @click="changePeriod(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <div v-if="filterOptions" class="progress-filters">
      <label v-if="filterOptions.plans?.length" class="performance-selector">
        Plan a consultar
        <select
          v-model="selectedPlan"
          data-testid="progress-plan"
          @change="changePlan"
        >
          <option value="">Todos mis planes y entrenamientos libres</option>
          <option
            v-for="plan in filterOptions.plans"
            :key="plan.id"
            :value="plan.id"
          >
            {{ plan.name
            }}{{
              plan.status === "DRAFT"
                ? " · Borrador"
                : plan.status === "ARCHIVED"
                  ? " · Archivado"
                  : ""
            }}
          </option>
        </select>
      </label>
      <label
        v-if="filterOptions.planDays?.length"
        class="performance-selector progress-day-selector"
      >
        Día del plan
        <select
          v-model="selectedDay"
          data-testid="progress-plan-day"
          :disabled="selectedPlan !== (filterOptions.selectedPlanId ?? '')"
          @change="changeDay"
        >
          <option value="">Todos mis entrenamientos</option>
          <option
            v-for="day in filterOptions.planDays"
            :key="day.id"
            :value="day.id"
          >
            {{ day.name }} · {{ day.planName
            }}{{ day.weekNumber ? ` · Semana ${day.weekNumber}` : "" }}
          </option>
        </select>
      </label>
      <label v-if="filterOptions.exercises.length" class="performance-selector">
        Ejercicio a consultar
        <select
          v-model="selected"
          data-testid="progress-exercise"
          :disabled="
            selectedPlan !== (filterOptions.selectedPlanId ?? '') ||
            selectedDay !== (filterOptions.selectedPlanDayId ?? '')
          "
          @change="load"
        >
          <option
            v-for="exercise in filterOptions.exercises"
            :key="exercise.id"
            :value="exercise.id"
          >
            {{ exercise.name }}
          </option>
        </select>
      </label>
    </div>
    <p v-if="busy" role="status" class="progress-state">
      Buscando tus resultados…
    </p>
    <p v-if="error" role="alert" class="progress-state">
      {{ error }}
      <button class="text-button" type="button" @click="load">
        Reintentar
      </button>
    </p>
    <template v-if="result">
      <p class="period-description">
        {{
          result.from
            ? `${result.from} a ${result.to}`
            : `Historial hasta ${result.to}`
        }}
        · {{ result.timeZone }}
      </p>
      <p v-if="selectedDay" class="scope-note">
        Mostramos las sesiones de este día del plan. Los entrenamientos libres
        están en la vista general.
      </p>
      <p v-if="truncated" class="scope-note" role="status">
        Vista parcial: se muestran hasta
        {{ result.metadata.limits.sessions }} sesiones recientes,
        {{ result.metadata.limits.exercises }} ejercicios,
        {{ result.metadata.limits.tasks }} registros del ejercicio y
        {{ result.metadata.limits.sets }} series. Reduce el período para
        consultar más detalle.
      </p>
      <p v-if="result.metadata.undatedSessions" class="ui-muted">
        {{ result.metadata.undatedSessions }} sesiones completadas sin fecha de
        entrenamiento quedan fuera de las gráficas.
      </p>
      <div v-if="!result.completedSessions" class="ui-panel progress-empty">
        <h3>
          {{
            selectedDay || selectedPlan
              ? "Sin resultados completados en este contexto"
              : period === "all"
                ? "Comienza tu progreso"
                : "Sin sesiones completadas en este período"
          }}
        </h3>
        <p v-if="selectedDay || selectedPlan">
          Los resultados de otros días pueden servir de referencia en la guía de
          la próxima sesión, conservando su procedencia. Aquí solo mostramos los
          registros del contexto seleccionado.
        </p>
        <p v-else>
          Registra tus series y completa un entrenamiento para ver tu primera
          referencia. Puedes dejar el esfuerzo sin registrar.
        </p>
        <RouterLink
          class="primary-button"
          :to="{ name: 'workout-sessions', query: { new: 'free' } }"
          >Registrar entrenamiento</RouterLink
        ><button
          v-if="period !== 'all'"
          type="button"
          class="text-button"
          @click="changePeriod('all')"
        >
          Consultar todo el historial
        </button>
      </div>
      <template v-else>
        <div class="progress-stat ui-panel">
          <span>Sesiones completadas</span
          ><strong data-testid="progress-session-count">{{
            result.completedSessions
          }}</strong
          ><small
            >en el período mostrado{{
              result.metadata.truncated.sessions ? " (vista parcial)" : ""
            }}</small
          >
        </div>
        <div class="ui-panel chart-panel">
          <ProgressChart
            title="Sesiones completadas por semana"
            unit="sesiones"
            test-id="progress-frequency-chart"
            :points="frequency"
          />
          <p class="ui-muted chart-note">
            Cada semana comienza el lunes. Solo aparecen semanas con sesiones
            registradas; no añadimos puntos simulados.
          </p>
        </div>
        <div class="ui-panel exercise-progress">
          <p v-if="!result.exercises.length">
            Completa una serie de trabajo para ver resultados por ejercicio.
          </p>
          <template v-else-if="series">
            <label v-if="result.series.length > 1" class="performance-selector"
              >Carga registrada<select
                v-model="loadIndex"
                data-testid="progress-load"
              >
                <option
                  v-for="(item, index) in result.series"
                  :key="index"
                  :value="String(index)"
                >
                  {{
                    item.kind === "BODYWEIGHT_REPETITIONS"
                      ? "Peso corporal"
                      : `${item.load} ${item.unit} registrados`
                  }}
                </option>
              </select></label
            >
            <p class="load-label">
              {{
                series.kind === "BODYWEIGHT_REPETITIONS"
                  ? "Repeticiones con peso corporal"
                  : `${series.load} ${series.unit} · carga registrada (convención nominal)`
              }}
            </p>
            <p
              v-if="series.comparison.state === 'BASELINE'"
              class="baseline"
              data-testid="progress-baseline"
            >
              <strong>Primera referencia</strong> · Completa otra sesión en una
              fecha posterior con la misma carga para comparar tus repeticiones.
            </p>
            <p
              v-else-if="series.comparison.state === 'AMBIGUOUS'"
              class="baseline"
            >
              Hay varios registros en una misma fecha. Puedes consultarlos, pero
              no comparamos cuál fue el último sin un orden verificable.
            </p>
            <p v-else class="comparison" data-testid="progress-comparison">
              <strong
                >{{ series.comparison.repetitionsDelta! > 0 ? "+" : ""
                }}{{ series.comparison.repetitionsDelta }} repeticiones</strong
              >
              respecto a la sesión anterior con esta misma carga registrada. Es
              una diferencia observada, no un porcentaje de fuerza.
            </p>
            <p class="record-best">
              {{
                series.kind === "BODYWEIGHT_REPETITIONS"
                  ? "Mejores repeticiones registradas con peso corporal"
                  : "Mejores repeticiones a esta carga registrada"
              }}: <strong>{{ series.bestRepetitions }}</strong> · en el período
              mostrado.
            </p>
            <ProgressChart
              title="Repeticiones registradas"
              unit="repeticiones"
              test-id="progress-repetitions-chart"
              :points="repetitions"
            />
            <p class="ui-muted chart-note">
              Se muestra la última serie de trabajo completada de cada registro
              del ejercicio con esta carga y unidad. Compara usando la misma
              máquina, técnica y convención de registro. El esfuerzo puede
              aportar contexto, pero no es obligatorio.
            </p>
          </template>
          <p v-else>
            No hay series de trabajo completadas con repeticiones y una carga de
            unidad conocida para comparar. Los ejercicios de peso corporal
            pueden usar solo repeticiones.
          </p>
        </div>
        <div v-if="recordedLoads.length" class="ui-panel chart-panel">
          <ProgressChart
            v-for="group in recordedLoads"
            :key="group.unit"
            :title="`Peso registrado · ${group.unit}`"
            :unit="`${group.unit} registrados`"
            :test-id="`progress-load-chart-${group.unit}`"
            :points="group.points"
          />
          <p class="ui-muted chart-note">
            Cargas anotadas en tus series de trabajo completadas. KG y LB se
            muestran por separado. La carga usa tu convención de registro; más
            peso por sí solo no demuestra más fuerza.
          </p>
        </div>
        <div v-if="estimateGroups.length" class="ui-panel chart-panel">
          <h3>Estimaciones de fuerza guardadas</h3>
          <p class="ui-muted">
            Estimaciones descriptivas con procedencia verificada. No miden tu
            máximo real ni indican por sí solas un aumento de carga.
          </p>
          <p class="ui-muted chart-note">
            Cada método conserva su propia trayectoria. Separamos las
            estimaciones cuando cambian la versión de cálculo, los criterios de
            elegibilidad o la política numérica.
          </p>
          <div
            v-for="(group, index) in estimateGroups"
            :key="group.key"
            class="estimate-method"
          >
            <ProgressChart
              :title="`1RM estimado · ${group.formula} · método ${index + 1}`"
              unit="KG estimados"
              :test-id="`progress-estimate-${group.formula}-${index}`"
              :points="group.points"
            />
            <details class="metric-context">
              <summary>Detalle del método {{ index + 1 }}</summary>
              <p>
                Cálculo: {{ group.algorithmVersion }} · Criterios:
                {{ group.eligibilityVersion }}
              </p>
              <p class="policy-key">
                Política numérica: {{ group.numericPolicyKey }}
              </p>
            </details>
          </div>
        </div>
        <details class="metric-context">
          <summary>Sobre las métricas disponibles</summary>
          <p v-if="!result.estimates.length">
            No hay estimaciones de 1RM guardadas y verificadas para este
            ejercicio. Tus repeticiones y sesiones siguen siendo referencias
            útiles.
          </p>
          <p>{{ result.volume.message }}</p>
          <p>{{ result.duration.message }}</p>
        </details>
      </template>
      <section
        v-if="result.nextSession"
        class="ui-panel next-session-link"
        data-testid="progress-next-guide"
      >
        <h3>Prepara {{ result.nextSession.title }}</h3>
        <p class="ui-muted">
          <time :datetime="result.nextSession.performedOn">{{
            result.nextSession.performedOn
          }}</time>
          · {{ result.nextSession.timeZone }}
        </p>
        <p
          v-if="selectedDay && result.nextSession.planDayId !== selectedDay"
          class="field-hint"
        >
          Esta es otra sesión programada con el ejercicio seleccionado. Sus
          objetivos se evalúan por separado; sus resultados no se mezclan con
          los del día seleccionado.
        </p>
        <DailyWorkoutGuide
          :query="{ activityId: result.nextSession.activityId }"
          :exercise-id="selected || undefined"
          compact
        />
        <RouterLink
          class="secondary-button"
          :to="{
            name: 'routine-day',
            params: {
              planId: result.nextSession.planId,
              weekId: result.nextSession.planWeekId,
              dayId: result.nextSession.planDayId,
            },
            query: {
              date: result.nextSession.performedOn,
              activityId: result.nextSession.activityId,
              timeZone: result.nextSession.timeZone,
            },
          }"
          >Abrir próximo entrenamiento →</RouterLink
        >
      </section>
      <p v-else-if="selectedPlan" class="field-hint">
        No hay una próxima sesión programada y pendiente para este contexto.
        Puedes revisar la distribución en
        <RouterLink :to="{ name: 'home', query: { planId: selectedPlan } }"
          >Mi plan</RouterLink
        >. No asignamos fechas automáticamente.
      </p>
      <div
        v-else-if="result.completedSessions"
        class="ui-panel next-session-link"
      >
        <h3>Prepara tu próxima sesión</h3>
        <p>
          Abre el próximo entrenamiento de tu calendario para ver sus objetivos,
          tus series anteriores y la orientación disponible. Una referencia
          anterior no equivale a una recomendación calculada.
        </p>
        <RouterLink class="secondary-button" :to="{ name: 'home' }"
          >Consultar mi rutina →</RouterLink
        >
      </div>
    </template>
  </section>
</template>
<style scoped>
.progress-overview {
  margin: 1.25rem 0 1.5rem;
  min-width: 0;
}
.progress-heading {
  display: flex;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  flex-wrap: wrap;
  align-items: center;
}
.progress-heading h2 {
  margin: 0;
  font-size: clamp(1.15rem, 3.7vw, 1.45rem);
}
.progress-heading .back-link {
  min-height: 44px;
  align-content: center;
  margin: 0;
}
.period-controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.25rem;
  max-width: 28rem;
  margin: 0.65rem 0 0.9rem;
  padding: 0.2rem;
  border: 1px solid var(--color-border);
  border-radius: 0.7rem;
  background: var(--color-surface);
}
.period-controls button {
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0.35rem 0.25rem;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.period-controls button[aria-pressed="true"] {
  background: color-mix(
    in srgb,
    var(--color-primary) 11%,
    var(--color-surface)
  );
  color: var(--color-primary);
  border-color: color-mix(
    in srgb,
    var(--color-primary) 35%,
    var(--color-border)
  );
  font-weight: 650;
}
.progress-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem 0.75rem;
}
.progress-state {
  margin-block: 1rem;
}
.period-description,
.chart-note {
  font-size: 0.8rem;
  line-height: 1.55;
}
.period-description {
  color: var(--color-text-secondary);
  margin: 0.5rem 0 0.85rem;
  overflow-wrap: anywhere;
}
.progress-stat {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 0.85rem;
  row-gap: 0.15rem;
  padding: 0.85rem 1rem;
  margin-bottom: 0.85rem;
}
.progress-stat strong {
  grid-column: 1;
  grid-row: 1 / span 2;
  font-size: clamp(1.85rem, 5vw, 2.45rem);
  color: var(--color-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.progress-stat > span {
  font-weight: 650;
}
.progress-stat small {
  color: var(--color-text-secondary);
}
.chart-panel,
.exercise-progress {
  min-width: 0;
  margin-bottom: 0.85rem;
  padding: clamp(0.85rem, 3vw, 1.35rem);
}
.chart-panel > .progress-chart + .progress-chart,
.estimate-method + .estimate-method {
  border-top: 1px solid var(--color-border);
  margin-top: 0.7rem;
  padding-top: 0.9rem;
}
.progress-overview .performance-selector {
  min-width: 0;
  gap: 0.35rem;
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
}
.performance-selector select {
  width: 100%;
  max-width: 100%;
  min-height: 46px;
  padding-block: 0.55rem;
  font-size: 1rem;
}
.baseline,
.comparison,
.scope-note {
  padding: 0.65rem 0.75rem;
  border-inline-start: 2px solid var(--color-border);
  background: var(--color-surface-elevated);
  line-height: 1.5;
  font-size: 0.86rem;
}
.comparison {
  border-inline-start-color: var(--color-primary);
}
.load-label {
  font-weight: 600;
}
.policy-key {
  overflow-wrap: anywhere;
}
.metric-context {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.7;
  padding: 0.75rem 0;
}
.metric-context summary {
  cursor: pointer;
  min-height: 44px;
  align-content: center;
}
.progress-empty .text-button {
  display: block;
  margin-top: 0.5rem;
  min-height: 44px;
}
.next-session-link {
  min-width: 0;
  margin-top: 1rem;
  background: var(--color-surface);
}
.next-session-link .secondary-button {
  max-width: 100%;
  white-space: normal;
  text-align: center;
}
@media (max-width: 720px) {
  .progress-filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
