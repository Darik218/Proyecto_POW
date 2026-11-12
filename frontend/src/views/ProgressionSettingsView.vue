<script setup lang="ts">
import PageHeader from "../components/ui/PageHeader.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { z } from "zod";
import { useAuthStore } from "../stores/auth.store";
import { useProgressionSettingsStore } from "../stores/progression-settings.store";
import { useProgressionStore } from "../stores/progression.store";
import SettingStatus from "../components/progression/SettingStatus.vue";
import ExercisePicker from "../components/training-plans/ExercisePicker.vue";
import {
  trainingPlansService,
  type TrainingPlan,
} from "../services/training-plans.service";
import { settingReasonLabel } from "../utils/setting-form";
import "../assets/progression.css";
const route = useRoute(),
  auth = useAuthStore(),
  store = useProgressionSettingsStore(),
  progression = useProgressionStore(),
  safeId = (v: unknown) => (z.uuid().safeParse(v).success ? String(v) : ""),
  exerciseId = ref(safeId(route.query.exerciseId)),
  planId = ref(safeId(route.query.planId)),
  plans = ref<TrainingPlan[]>([]),
  usePolicy = ref(false);
const policy = computed(() =>
  progression.context?.exerciseId === exerciseId.value
    ? progression.context.configuration.policy
    : undefined,
);
let alive = true,
  stamp = auth.getSessionGeneration();
onUnmounted(() => {
  alive = false;
});
onMounted(async () => {
  void store.loadList();
  try {
    const result = await trainingPlansService.list();
    if (alive && stamp === auth.getSessionGeneration()) plans.value = result;
  } catch {}
});
watch([exerciseId, planId], () => {
  store.resolution = null;
  usePolicy.value = false;
});
watch(
  () => auth.user?.id,
  () => {
    plans.value = [];
    store.resolution = null;
  },
);
function resolve() {
  if (!exerciseId.value) return;
  void store.effective({
    exerciseId: exerciseId.value,
    trainingPlanId: planId.value || null,
    ...(usePolicy.value && policy.value ? { policy: policy.value } : {}),
  });
}
const newQuery = computed(() => ({
  ...(exerciseId.value ? { exerciseId: exerciseId.value } : {}),
  ...(planId.value ? { planId: planId.value } : {}),
  ...(route.query.returnTo === "progression-new"
    ? { returnTo: "progression-new" }
    : {}),
}));
</script>
<template>
  <section class="page-view progression-page">
    <RouterLink :to="{ name: 'progression' }">Volver a progresión</RouterLink>
    <PageHeader
      title="Configuraciones de progresión"
      description="Define los parámetros por atleta, ejercicio o plan y consulta su precedencia."
      icon="settings"
    />
    <p>
      Una fila persistida no es una política matemática, recomendación o
      consentimiento. Guardar una configuración no activa la automatización.
    </p>
    <SettingStatus />
    <RouterLink
      class="primary-button"
      data-testid="newSetting"
      :to="{ name: 'progression-settings-new', query: newQuery }"
      >Nueva configuración</RouterLink
    >
    <RouterLink
      v-if="route.query.returnTo === 'progression-new'"
      class="secondary-button"
      data-testid="returnToProgression"
      :to="{ name: 'progression-new' }"
      >Volver al contexto anterior y revalidar explícitamente</RouterLink
    >
    <section class="progression-card progression-setting-context">
      <h2>Configuración efectiva para un contexto</h2>
      <ExercisePicker v-model="exerciseId" :disabled="store.busy" /><label
        >Plan opcional<select
          v-model="planId"
          data-testid="effectiveSettingPlan"
          :disabled="store.busy"
        >
          <option value="">Sin plan</option>
          <option v-for="p in plans" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      >
      <label v-if="policy"
        ><input v-model="usePolicy" type="checkbox" />Comprobar también con la
        política explícita del contexto en memoria. No se guardará como
        configuración.</label
      >
      <button
        type="button"
        class="secondary-button"
        data-testid="resolveSetting"
        :disabled="!exerciseId || store.busy"
        @click="resolve"
      >
        Consultar configuración efectiva
      </button>
      <div
        v-if="store.resolution"
        class="progression-resolution"
        data-testid="settingResolution"
      >
        <h3>
          {{ store.resolution.status }} ·
          {{ store.resolution.scope ?? "Sin fila aplicable" }}
        </h3>
        <p>
          Precedencia por fila completa: ejercicio/plan, ejercicio, general. No
          se mezclan parámetros.
        </p>
        <template v-if="store.resolution.selected"
          ><p>
            Registro {{ store.resolution.selected.id }} · revisión
            {{ store.resolution.selected.revision }} · modificación
            {{ store.resolution.selected.updatedAt }}.
          </p>
          <dl>
            <template
              v-for="(v, k) in store.resolution.selected.parameters"
              :key="k"
              ><dt>
                {{ k }} · procedencia fila
                {{ store.resolution.selected.parameterSources[k]?.settingId }}
              </dt>
              <dd>{{ v === null ? "null explícito" : v }}</dd></template
            >
          </dl></template
        >
        <p v-for="r in store.resolution.settingReasons" :key="r">
          Parámetros: {{ settingReasonLabel(r) }}
        </p>
        <p v-for="r in store.resolution.externalRequirements" :key="r">
          Requisito externo: {{ settingReasonLabel(r) }}
        </p>
        <p>
          Sin política, unidad, cohorte y evidencia suficientes no se garantiza
          una recomendación. Las cargas de esta fila no tienen unidad propia.
        </p>
      </div>
    </section>
    <section>
      <h2>Filas propias</h2>
      <p v-if="store.list && !store.list.items.length" data-testid="noSettings">
        No hay configuraciones guardadas.
      </p>
      <article
        v-for="r in store.list?.items"
        :key="r.id"
        class="progression-card progression-setting-row"
        :data-scope="r.scope"
        data-testid="settingRow"
      >
        <h3>
          <RouterLink
            :to="{
              name: 'progression-setting-edit',
              params: { id: r.id },
              query: newQuery,
            }"
            >{{ r.scope }} · {{ r.exerciseName ?? "General del atleta" }} ·
            {{ r.planName ?? "Sin plan" }}</RouterLink
          >
        </h3>
        <p>
          Mínimo {{ r.parameters.minSuccessfulSessions }} · RPE
          {{ r.parameters.targetRpeMin }}–{{ r.parameters.targetRpeMax }} ·
          absoluto {{ r.parameters.incrementAbsolute ?? "null" }} · porcentaje
          {{ r.parameters.incrementPercent ?? "null" }}.
        </p>
        <p>Modificada {{ r.updatedAt }} · revisión {{ r.revision }}.</p>
        <p>
          {{
            r.parameterIssues.length
              ? "Parámetros incompletos o incompatibles"
              : "Parámetros persistidos; compatibilidad de política pendiente del contexto"
          }}.
        </p>
        <p v-for="v in r.parameterIssues" :key="v">
          {{ settingReasonLabel(v) }}
        </p>
      </article>
      <div v-if="store.list" class="progression-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="store.busy || store.list.page === 1"
          @click="store.loadList(store.list.page - 1)"
        >
          Anterior</button
        ><span>Página {{ store.list.page }} · {{ store.list.total }} filas</span
        ><button
          type="button"
          class="secondary-button"
          :disabled="
            store.busy || store.list.page * store.list.limit >= store.list.total
          "
          @click="store.loadList(store.list.page + 1)"
        >
          Siguiente
        </button>
      </div>
    </section>
  </section>
</template>
