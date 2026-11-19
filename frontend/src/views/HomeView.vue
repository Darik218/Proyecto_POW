<script setup lang="ts">
import WeeklyTrainingCalendar from "../components/workouts/WeeklyTrainingCalendar.vue";
import { useDashboard } from "../composables/useDashboard";
import PageHeader from "../components/ui/PageHeader.vue";
import PulsoIcon from "../components/ui/PulsoIcon.vue";
import LoadingState from "../components/ui/LoadingState.vue";

const {
  latestCompleted: lastCompleted,
  activePlans,
  draftPlans,
  loading,
  errors,
  load,
} = useDashboard();
</script>

<template>
  <section class="page-view dashboard-page">
    <PageHeader title="Inicio" description="Tu semana y tu próxima sesión.">
      <template #actions>
        <RouterLink
          class="secondary-button"
          :to="{ name: 'workout-sessions', query: { new: 'free' } }"
        >
          <PulsoIcon name="plus" :size="18" /> Entrenamiento libre
        </RouterLink>
      </template>
    </PageHeader>
    <WeeklyTrainingCalendar />

    <div class="home-details">
      <section
        class="ui-panel home-last-session"
        aria-labelledby="home-recent-title"
      >
        <h2 id="home-recent-title">Última sesión completada</h2>
        <LoadingState
          v-if="loading"
          label="Consultando tu historial…"
          :rows="1"
        />
        <div v-else-if="lastCompleted" class="home-session-row">
          <span class="home-session-icon"
            ><PulsoIcon name="check" :size="23"
          /></span>
          <div>
            <strong>{{
              lastCompleted.name ||
              lastCompleted.trainingPlan?.name ||
              "Entrenamiento"
            }}</strong>
            <small
              >{{
                lastCompleted.performedOn?.slice(0, 10) ?? "Fecha sin registrar"
              }}
              · {{ lastCompleted.exerciseCount }} ejercicios</small
            >
          </div>
          <RouterLink
            class="secondary-button"
            :to="{
              name: 'workout-session-detail',
              params: { sessionId: lastCompleted.id },
            }"
          >
            Ver resultados <PulsoIcon name="arrow-right" :size="16" />
          </RouterLink>
        </div>
        <p v-else class="ui-muted">
          {{
            errors.length
              ? "Si tienes sesiones completadas, puedes buscarlas en tu historial."
              : "Aquí aparecerán los resultados de la próxima sesión que completes."
          }}
        </p>
        <RouterLink class="home-history-link" :to="{ name: 'workout-history' }"
          >Consultar historial <PulsoIcon name="arrow-right" :size="16"
        /></RouterLink>
      </section>
      <aside
        class="ui-panel home-quick-links"
        aria-labelledby="home-links-title"
      >
        <h2 id="home-links-title">Accesos rápidos</h2>
        <p v-if="activePlans === 0 && draftPlans !== null" class="ui-muted">
          {{
            draftPlans > 0
              ? "Tienes un borrador. Revísalo y actívalo desde Mi plan."
              : "Empieza con una plantilla o crea una rutina a tu medida."
          }}
        </p>
        <RouterLink :to="{ name: 'home' }"
          ><PulsoIcon name="calendar" /> <span>Mi plan y programación</span
          ><PulsoIcon name="chevron-right" :size="16"
        /></RouterLink>
        <RouterLink :to="{ name: 'progression' }"
          ><PulsoIcon name="chart" /> <span>Consultar mi progreso</span
          ><PulsoIcon name="chevron-right" :size="16"
        /></RouterLink>
        <RouterLink :to="{ name: 'exercise-catalog' }"
          ><PulsoIcon name="layers" /> <span>Catálogo de ejercicios</span
          ><PulsoIcon name="chevron-right" :size="16"
        /></RouterLink>
      </aside>
    </div>
    <div
      v-if="errors.length"
      class="state-card state-card--error home-error"
      role="alert"
    >
      <p v-for="message in errors" :key="message">{{ message }}</p>
      <button
        class="secondary-button"
        type="button"
        :disabled="loading"
        @click="load"
      >
        Volver a consultar
      </button>
    </div>
  </section>
</template>

<style scoped>
.home-details {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(0, 1fr);
  gap: var(--space-4);
}
.home-details h2 {
  margin: 0 0 var(--space-3);
}
.home-session-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3) 0;
}
.home-session-row div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  overflow-wrap: anywhere;
}
.home-session-row small {
  color: var(--muted);
}
.home-session-row a {
  margin-inline-start: auto;
}
.home-session-icon {
  display: grid;
  place-items: center;
  width: var(--target-size);
  height: var(--target-size);
  flex: none;
  border-radius: var(--radius-control);
  color: var(--color-primary);
  background: var(--color-accent-surface);
}
.home-history-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-size);
}
.home-quick-links a {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--target-size);
  border-top: 1px solid var(--line);
  color: var(--ink);
  text-decoration: none;
}
.home-quick-links a:hover {
  color: var(--color-primary);
}
.home-quick-links a span {
  flex: 1;
}
.home-quick-links a .pulso-icon:first-child {
  color: var(--color-primary);
}
.home-error {
  margin-top: var(--space-4);
}
@media (max-width: 760px) {
  .home-details {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .home-details > section,
  .home-details > aside {
    padding: var(--space-4);
  }
  .home-session-row a {
    margin-inline-start: 0;
  }
}
</style>
