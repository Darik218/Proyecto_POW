<script setup lang="ts">
import NextWorkoutPanel from "../components/workouts/NextWorkoutPanel.vue";
import { useDashboard } from "../composables/useDashboard";
import { workoutStatusLabel } from "../services/workout-sessions.service";
import PageHeader from "../components/ui/PageHeader.vue";
import PulsoIcon from "../components/ui/PulsoIcon.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import SessionDistribution from "../components/ui/SessionDistribution.vue";
const {
  recent,
  total,
  completed,
  pending,
  activePlans,
  loading,
  errors,
  load,
} = useDashboard();
</script>
<template>
  <section class="page-view dashboard-page">
    <PageHeader
      title="Cada sesión cuenta."
      description="Tu entrenamiento y tu rendimiento, en un mismo lugar."
      ><template #actions
        ><RouterLink class="primary-button" :to="{ name: 'workout-sessions' }"
          ><PulsoIcon name="plus" :size="18" />Registrar
          entrenamiento</RouterLink
        ></template
      ></PageHeader
    >
    <NextWorkoutPanel />
    <section class="performance-hero" aria-label="PULSO, tu progreso medido">
      <div class="performance-hero__copy">
        <h2 aria-label="Tu progreso, medido.">
          Tu progreso,<br /><span>medido.</span>
        </h2>
        <p>Planifica <span>/</span> Entrena <span>/</span> Progresa</p>
      </div>
      <svg
        class="performance-track"
        viewBox="0 0 640 290"
        fill="none"
        aria-hidden="true"
      >
        <g transform="translate(320 150) rotate(-10)">
          <ellipse rx="290" ry="100" />
          <ellipse rx="255" ry="83" />
          <ellipse rx="220" ry="66" />
          <ellipse rx="185" ry="49" />
          <path d="M-30 48v100" />
        </g>
      </svg>
    </section>
    <div
      class="dashboard-metrics"
      aria-label="Totales consultados en el servidor"
      :aria-busy="loading"
    >
      <div>
        <PulsoIcon name="activity" /><strong>{{ total ?? "—" }}</strong
        ><span>Sesiones registradas</span>
      </div>
      <div>
        <PulsoIcon name="check" /><strong>{{ completed ?? "—" }}</strong
        ><span>Sesiones finalizadas</span>
      </div>
      <div>
        <PulsoIcon name="chart" /><strong>{{ pending ?? "—" }}</strong
        ><span>Propuestas pendientes</span>
      </div>
    </div>
    <div v-if="errors.length" class="state-card state-card--error" role="alert">
      <p v-for="message in errors" :key="message">{{ message }}</p>
      <button class="secondary-button" :disabled="loading" @click="load">
        Volver a consultar
      </button>
    </div>
    <div class="dashboard-main-grid">
      <section class="ui-panel dashboard-recent">
        <div class="dashboard-panel-heading">
          <div>
            <h2>Últimas sesiones</h2>
            <p>Hasta 5 entrenamientos de tu historial.</p>
          </div>
          <RouterLink :to="{ name: 'workout-history' }"
            >Ver historial <PulsoIcon name="arrow-right" :size="16"
          /></RouterLink>
        </div>
        <LoadingState
          v-if="loading"
          label="Consultando tus entrenamientos…"
          :rows="3"
        />
        <ol v-else-if="recent.length" class="dashboard-session-list">
          <li v-for="session in recent" :key="session.id">
            <RouterLink
              :to="{
                name: 'workout-session-detail',
                params: { sessionId: session.id },
              }"
              ><span class="dashboard-session-icon"
                ><PulsoIcon name="dumbbell" /></span
              ><span class="dashboard-session-copy"
                ><strong>{{
                  session.name || session.trainingPlan?.name || "Entrenamiento"
                }}</strong
                ><small
                  >{{
                    session.performedOn?.slice(0, 10) ??
                    "Fecha deportiva sin registrar"
                  }}
                  · {{ session.exerciseCount }} ejercicios</small
                ></span
              ><StatusBadge
                :status="session.status"
                :label="workoutStatusLabel(session.status)" /><PulsoIcon
                name="chevron-right"
                :size="16"
            /></RouterLink>
          </li>
        </ol>
        <EmptyState
          v-else-if="total === 0"
          title="Comienza tu progreso"
          description="Crea tu rutina o registra tu primer entrenamiento libre. Tus resultados serán tu primera referencia."
          icon="dumbbell"
          ><RouterLink
            class="secondary-button"
            :to="{ name: 'workout-sessions' }"
            >Registrar entrenamiento</RouterLink
          ></EmptyState
        >
        <p v-else class="state-message">
          El historial no está disponible. Puedes volver a consultarlo.
        </p>
      </section>
      <aside class="ui-panel dashboard-next">
        <h2>Tu siguiente paso</h2>
        <RouterLink :to="{ name: 'home' }"
          ><span class="dashboard-action-icon"
            ><PulsoIcon name="calendar" /></span
          ><span
            ><strong>Mi rutina</strong
            ><small>Consulta tu programación actual.</small></span
          ><PulsoIcon name="chevron-right" :size="16" /></RouterLink
        ><RouterLink :to="{ name: 'progression' }"
          ><span class="dashboard-action-icon"><PulsoIcon name="chart" /></span
          ><span
            ><strong>Ver mi progreso</strong
            ><small>Consulta tus referencias y próximos objetivos.</small></span
          ><PulsoIcon name="chevron-right" :size="16" /></RouterLink
        ><RouterLink :to="{ name: 'exercise-catalog' }"
          ><span class="dashboard-action-icon"
            ><PulsoIcon name="settings" /></span
          ><span
            ><strong>Añadir ejercicio</strong
            ><small>Encuentra movimientos para tu rutina.</small></span
          ><PulsoIcon name="chevron-right" :size="16"
        /></RouterLink>
      </aside>
      <section class="ui-panel dashboard-distribution">
        <h2>El ritmo de tu entrenamiento</h2>
        <p class="ui-muted">
          Una lectura de las sesiones visibles; no representa todo el historial.
        </p>
        <SessionDistribution
          v-if="recent.length"
          :sessions="recent"
        /><EmptyState
          v-else
          title="El ritmo lo marcas tú"
          description="Aquí verás la distribución real de tus sesiones recientes."
          icon="activity"
        />
      </section>
      <section class="dashboard-bottom">
        <div>
          <PulsoIcon name="layers" :size="30" />
          <h2>Un plan para avanzar.</h2>
          <p>
            {{
              activePlans === null
                ? "Consulta y organiza tu planificación."
                : `${activePlans} planes activos en la consulta actual.`
            }}
            Cada semana y cada objetivo, en su lugar.
          </p>
          <RouterLink class="secondary-button" :to="{ name: 'training-plans' }"
            >Ver planificación <PulsoIcon name="arrow-right" :size="17"
          /></RouterLink>
        </div>
        <div>
          <PulsoIcon name="scale" :size="30" />
          <h2>Tu evolución, registrada.</h2>
          <p>
            Consulta tu perfil y conserva un historial de tus medidas
            corporales.
          </p>
          <RouterLink class="secondary-button" :to="{ name: 'measurements' }"
            >Medidas corporales <PulsoIcon name="arrow-right" :size="17"
          /></RouterLink>
        </div>
      </section>
    </div>
  </section>
</template>
<style scoped>
.performance-hero {
  position: relative;
  overflow: hidden;
  min-height: 238px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-card);
  background:
    radial-gradient(ellipse at 100% 100%, #31e6c514, transparent 65%),
    var(--color-surface-subtle);
  padding: 30px 36px;
  margin-bottom: 20px;
}
.performance-hero__copy {
  position: relative;
  z-index: 1;
}
.performance-hero h2 {
  font: 800 clamp(2.8rem, 4.7vw, 4.5rem)/1.04 var(--font-heading);
  font-style: italic;
  letter-spacing: -0.035em;
  margin: 0;
}
.performance-hero h2 span {
  color: var(--color-primary);
}
.performance-hero p {
  color: var(--ink);
  font-size: 0.9rem;
  margin: 21px 0 0;
  word-spacing: 0.3em;
}
.performance-hero p span {
  color: var(--color-secondary);
  padding: 0 14px;
}
.performance-track {
  position: absolute;
  width: 65%;
  height: 100%;
  right: -7%;
  top: 10%;
  stroke: var(--color-primary);
  stroke-width: 1.5;
  opacity: 0.8;
  animation: track-reveal 0.8s var(--ease-out);
}
.performance-track ellipse:nth-child(2n) {
  stroke: var(--color-secondary);
}
.performance-track path {
  stroke: var(--ink);
}
.dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  margin-bottom: 24px;
  padding: 25px 0;
}
.dashboard-metrics > div {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px 12px;
  padding: 0 28px;
  border-right: 1px solid var(--line);
  align-items: center;
}
.dashboard-metrics > div:last-child {
  border: 0;
}
.dashboard-metrics .pulso-icon {
  color: var(--color-primary);
  grid-row: 1/3;
}
.dashboard-metrics strong {
  font: 750 1.9rem/1 var(--font-heading);
  font-variant-numeric: tabular-nums;
}
.dashboard-metrics span {
  font-size: 0.75rem;
  color: var(--muted);
}
.dashboard-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(285px, 1fr);
  gap: 22px;
}
.dashboard-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.dashboard-panel-heading h2,
.dashboard-next h2,
.dashboard-distribution h2 {
  margin: 0;
}
.dashboard-panel-heading p {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 8px 0 0;
}
.dashboard-panel-heading > a {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 0.75rem;
  text-decoration: none;
  min-height: 34px;
}
.dashboard-session-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.dashboard-session-list > li + li {
  border-top: 1px solid var(--line);
}
.dashboard-session-list a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 84px;
  color: var(--ink);
  text-decoration: none;
  padding: 12px 0;
}
.dashboard-session-list a:hover .dashboard-session-copy strong {
  color: var(--color-primary);
}
.dashboard-session-icon,
.dashboard-action-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: #31e6c50e;
  color: var(--color-primary);
  flex: none;
}
.dashboard-session-copy {
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.dashboard-session-copy strong {
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.dashboard-session-copy small {
  font-size: 0.7rem;
  color: var(--muted);
}
.dashboard-next > a {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: var(--ink);
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
}
.dashboard-next > a:last-child {
  border: 0;
  padding-bottom: 0;
}
.dashboard-next > a > span:nth-child(2) {
  display: grid;
  gap: 8px;
  flex: 1;
}
.dashboard-next small {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.6;
}
.dashboard-next strong {
  font-size: 0.85rem;
}
.dashboard-distribution {
  grid-column: 1;
}
.dashboard-distribution > p {
  font-size: 0.8rem;
  max-width: 50ch;
  margin-bottom: 25px;
}
.dashboard-bottom {
  grid-column: 2;
  display: grid;
  gap: 22px;
}
.dashboard-bottom > div {
  padding: 24px 0;
  border-top: 1px solid var(--line);
}
.dashboard-bottom .pulso-icon {
  color: var(--color-primary);
}
.dashboard-bottom h2 {
  margin: 14px 0 8px;
}
.dashboard-bottom p {
  font-size: 0.8rem;
  color: var(--muted);
}
.dashboard-bottom .secondary-button .pulso-icon {
  color: inherit;
}
@keyframes track-reveal {
  from {
    opacity: 0.2;
    transform: translateX(16px);
  }
  to {
    opacity: 0.8;
    transform: translateX(0);
  }
}
@media (max-width: 1150px) {
  .dashboard-main-grid {
    grid-template-columns: 1fr;
  }
  .dashboard-distribution,
  .dashboard-bottom {
    grid-column: 1;
  }
  .dashboard-bottom {
    grid-template-columns: 1fr 1fr;
  }
  .performance-track {
    opacity: 0.4;
  }
  .dashboard-session-list .ui-badge {
    font-size: 0.65rem;
  }
  .dashboard-metrics > div {
    padding-inline: 18px;
  }
}
@media (max-width: 600px) {
  .performance-hero {
    padding: 25px 22px;
    min-height: 215px;
  }
  .performance-track {
    right: -35%;
    width: 110%;
    opacity: 0.2;
  }
  .performance-hero h2 {
    font-size: 2.8rem;
  }
  .performance-hero p {
    font-size: 0.75rem;
  }
  .performance-hero p span {
    padding: 0 4px;
  }
  .dashboard-metrics {
    padding: 18px 0;
  }
  .dashboard-metrics > div {
    padding-inline: 12px;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .dashboard-metrics .pulso-icon {
    grid-row: auto;
    width: 18px;
  }
  .dashboard-metrics strong {
    font-size: 1.65rem;
  }
  .dashboard-metrics span {
    font-size: 0.65rem;
    line-height: 1.5;
  }
  .dashboard-bottom {
    grid-template-columns: 1fr;
  }
  .dashboard-session-list a {
    flex-wrap: wrap;
  }
  .dashboard-session-copy {
    flex-basis: calc(100% - 65px);
  }
  .dashboard-session-list .ui-badge {
    margin-left: 54px;
  }
  .dashboard-session-list a > .pulso-icon {
    margin-left: auto;
  }
  .dashboard-panel-heading {
    flex-wrap: wrap;
  }
}
</style>
