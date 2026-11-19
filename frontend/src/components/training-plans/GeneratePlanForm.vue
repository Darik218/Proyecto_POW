<script setup lang="ts">
import axios from "axios";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { routineService } from "../../services/routine.service";
import {
  trainingPlanErrorMessage,
  weekdayLabel,
} from "../../services/training-plans.service";
import { useAuthStore } from "../../stores/auth.store";
import {
  blockPrescriptions,
  buildRoutineRequest,
  createRoutineDraft,
  routineStyles,
  applyRoutineSchedule,
  type RoutineStyle,
} from "../../utils/routine-builder";
import {
  exercisesService,
  exerciseEnums,
  exerciseEnumLabel,
} from "../../services/exercises.service";
import {
  routineTemplates,
  templateSessions,
  defaultMuscleAllocation,
  exerciseCountPresets,
  templateMuscleLabels,
  recommendedTemplate,
  type RoutineTemplateId,
} from "../../config/routine-templates";
import {
  buildTemplateBlocks,
  summarizeTemplateBlocks,
  type TemplatePreferences,
} from "../../utils/routine-templates";
import type { TemplateCatalogExercise } from "../../types/routine-template";
import type { GenerateRoutine } from "../../schemas/routine.schema";
import RoutineBuilder from "./RoutineBuilder.vue";
const props = withDefaults(
  defineProps<{ entryMode?: "recommended" | "library" | "custom" }>(),
  { entryMode: "custom" },
);
const emit = defineEmits<{ created: [id: string]; cancel: [] }>();
const guided = computed(() => props.entryMode !== "custom");
const auth = useAuthStore();
const form = reactive(createRoutineDraft());
const step = ref(1),
  busy = ref(false),
  error = ref(""),
  createdPlanId = ref(""),
  uncertain = ref(false);
const heading = ref<HTMLElement>();
onMounted(() => heading.value?.focus());
const frequency = ref(3),
  scheduleMode = ref<"fixed" | "flexible">("fixed"),
  selectedWeekdays = ref<number[]>([]);
const templateId = ref<RoutineTemplateId>("fullbody");
const availableTemplates = computed(() =>
  routineTemplates.filter((item) => item.frequencies.includes(frequency.value)),
);
const exerciseCount = ref(5);
const volumePreset = ref("balanced");
const preferences = reactive<{
  goal: "" | TemplatePreferences["goal"];
  experience: "" | TemplatePreferences["experience"];
  equipment: TemplatePreferences["equipment"];
  durationMinutes: number;
  muscleAllocations: NonNullable<TemplatePreferences["muscleAllocations"]>;
  familyStrategies: NonNullable<TemplatePreferences["familyStrategies"]>;
}>({
  goal: "",
  experience: "",
  equipment: [],
  durationMinutes: 45,
  muscleAllocations: {},
  familyStrategies: {},
});
const families = computed(() => {
  if (
    !routineTemplates
      .find((item) => item.id === templateId.value)
      ?.frequencies.includes(frequency.value)
  )
    return [];
  const seen = new Set<string>();
  return templateSessions(templateId.value, frequency.value).filter((item) => {
    if (seen.has(item.family)) return false;
    seen.add(item.family);
    return true;
  });
});
const repeatedFamilies = computed(() =>
  families.value.filter(
    (family) =>
      templateSessions(templateId.value, frequency.value).filter(
        (item) => item.family === family.family,
      ).length > 1,
  ),
);
function allocationTotal(family: string) {
  return Object.values(preferences.muscleAllocations[family] ?? {}).reduce(
    (total, count) => total + Number(count),
    0,
  );
}
function chooseVolumePreset() {
  const preset = exerciseCountPresets.find(
    (item) => item.id === volumePreset.value,
  )!;
  if (preset.id !== "custom") {
    exerciseCount.value = preset.count;
    preferences.durationMinutes = preset.minutes;
  }
}
watch(
  [templateId, frequency, exerciseCount],
  () => {
    preferences.muscleAllocations = Object.fromEntries(
      families.value.map((item) => [
        item.family,
        defaultMuscleAllocation(
          item,
          Number.isInteger(exerciseCount.value) ? exerciseCount.value : 0,
        ),
      ]),
    );
  },
  { immediate: true, flush: "sync" },
);
watch(
  exerciseCount,
  (value) => {
    if (volumePreset.value === "custom") return;
    volumePreset.value =
      exerciseCountPresets.find(
        (item) =>
          item.id !== "custom" && value >= item.min && value <= item.max,
      )?.id ?? "custom";
  },
  { flush: "sync" },
);
const missing = ref<string[]>([]),
  proposalWarnings = ref<string[]>([]);
const proposalCatalog = ref<TemplateCatalogExercise[]>([]);
const advancedExpanded = ref(false);
const selectedBlockId = ref("");
const proposalKey = ref("");
const catalogPreferencesKey = computed(() =>
  JSON.stringify([
    templateId.value,
    frequency.value,
    exerciseCount.value,
    preferences.goal,
    preferences.experience,
    [...preferences.equipment].sort(),
    preferences.muscleAllocations,
    repeatedFamilies.value.map(
      (family) => preferences.familyStrategies[family.family] ?? "partial",
    ),
  ]),
);
const proposalSummary = computed(() =>
  summarizeTemplateBlocks(form.blocks, proposalCatalog.value),
);
const sessionSummaries = computed(() =>
  form.blocks.map((block) => ({
    ...summarizeTemplateBlocks([block], proposalCatalog.value),
    id: block.id,
    name: block.name,
  })),
);
const titles = computed(() =>
  guided.value
    ? ["Tu disponibilidad", "Tus preferencias", "Revisa tu propuesta"]
    : ["Elige cómo entrenas", "Prepara tus bloques", "Organiza tu semana"],
);
const stepLabels = computed(() =>
  guided.value
    ? ["Disponibilidad", "Preferencias", "Propuesta"]
    : ["Estructura", "Ejercicios", "Semana"],
);
const trainingDays = computed(() => form.weekdays.filter(Boolean).length);
const assignedBlock = (id: string) =>
  form.blocks.find((block) => block.id === id);
let intent: GenerateRoutine | undefined;
let proposalController: AbortController | undefined;
let session = auth.getSessionGeneration(),
  epoch = 0,
  disposed = false;
watch(
  frequency,
  () => {
    const preferred = recommendedTemplate(frequency.value);
    if (
      props.entryMode === "recommended" ||
      !availableTemplates.value.some((item) => item.id === templateId.value)
    )
      templateId.value =
        availableTemplates.value.find((item) => item.id === preferred)?.id ??
        availableTemplates.value[0]!.id;
  },
  { flush: "sync" },
);
watch(
  () => [auth.user?.id, auth.status],
  () => {
    const current = auth.getSessionGeneration();
    if (current === session) return;
    session = current;
    epoch++;
    intent = undefined;
    proposalController?.abort();
    Object.assign(form, createRoutineDraft());
    step.value = 1;
    busy.value = false;
    error.value = "";
    createdPlanId.value = "";
    uncertain.value = false;
    selectedWeekdays.value = [];
    frequency.value = 3;
    templateId.value = "fullbody";
    scheduleMode.value = "fixed";
    preferences.goal = "";
    preferences.experience = "";
    preferences.equipment = [];
    preferences.durationMinutes = 45;
    preferences.familyStrategies = {};
    volumePreset.value = "balanced";
    exerciseCount.value = 5;
    preferences.muscleAllocations = Object.fromEntries(
      families.value.map((item) => [
        item.family,
        defaultMuscleAllocation(item, 5),
      ]),
    );
    missing.value = [];
    proposalWarnings.value = [];
    proposalCatalog.value = [];
    proposalKey.value = "";
    selectedBlockId.value = "";
    advancedExpanded.value = false;
  },
  { flush: "sync" },
);
watch(
  () => form.blocks.map((block) => block.id),
  (ids) => {
    form.weekdays = form.weekdays.map((id) => (ids.includes(id) ? id : ""));
  },
);
onUnmounted(() => {
  disposed = true;
  epoch++;
  proposalController?.abort();
});
function chooseStyle(style: RoutineStyle) {
  if (style === form.style) return;
  const fresh = createRoutineDraft(style);
  form.style = style;
  form.blocks = fresh.blocks;
  form.weekdays = fresh.weekdays;
  intent = undefined;
  error.value = "";
}
async function goTo(value: number) {
  error.value = "";
  step.value = value;
  await nextTick();
  heading.value?.focus();
}
async function next() {
  if (busy.value || uncertain.value) return;
  error.value = "";
  const nextEpoch = epoch;
  try {
    if (guided.value) {
      if (step.value === 1) {
        templateSessions(templateId.value, frequency.value);
        if (
          scheduleMode.value === "fixed" &&
          selectedWeekdays.value.length !== frequency.value
        )
          throw new Error(
            `Selecciona ${frequency.value} días para tu semana fija.`,
          );
      } else {
        if (
          !preferences.goal ||
          !preferences.experience ||
          !preferences.equipment.length
        )
          throw new Error(
            "Elige tu objetivo, experiencia y equipamiento disponible.",
          );
        // Validate editorial inputs before starting catalog requests.
        try {
          buildTemplateBlocks(templateId.value, frequency.value, [], {
            ...preferences,
            exerciseCount: exerciseCount.value,
          } as TemplatePreferences);
        } catch (cause) {
          advancedExpanded.value = true;
          throw cause;
        }
        const key = catalogPreferencesKey.value;
        if (proposalKey.value === key) {
          applyRoutineSchedule(
            form,
            scheduleMode.value,
            selectedWeekdays.value,
          );
          await goTo(3);
          return;
        }
        const ownEpoch = epoch;
        busy.value = true;
        proposalController?.abort();
        const controller = new AbortController();
        proposalController = controller;
        try {
          const keys = [
            ...new Set(
              templateSessions(templateId.value, frequency.value).flatMap(
                (item) => item.muscleGroups,
              ),
            ),
          ];
          const pages = await Promise.all(
            keys.map(async (key) => {
              const filters = {
                primaryMuscleGroupKey: key,
                limit: 100,
                ...(preferences.experience === "BEGINNER"
                  ? { difficulty: "BEGINNER" as const }
                  : {}),
              };
              const featured = await exercisesService.list(
                { ...filters, selection: "FEATURED" },
                "visible",
                controller.signal,
              );
              if (disposed || ownEpoch !== epoch) return [];
              const items: TemplateCatalogExercise[] = featured.items.map(
                (exercise, editorialRank) => ({ ...exercise, editorialRank }),
              );
              const frequent = await exercisesService.list(
                { ...filters, selection: "FREQUENT" },
                "visible",
                controller.signal,
              );
              if (disposed || ownEpoch !== epoch) return [];
              items.push(
                ...frequent.items.map((exercise, usageRank) => ({
                  ...exercise,
                  usageRank,
                })),
              );
              let offset = 0;
              while (true) {
                const page = await exercisesService.list(
                  { ...filters, selection: "ALL", offset },
                  "visible",
                  controller.signal,
                );
                if (disposed || ownEpoch !== epoch) return [];
                items.push(...page.items);
                offset += page.limit;
                if (offset >= page.total || page.items.length === 0) break;
              }
              return items;
            }),
          );
          if (disposed || ownEpoch !== epoch) return;
          const byId = new Map<string, TemplateCatalogExercise>();
          for (const exercise of pages.flat())
            byId.set(exercise.id, { ...byId.get(exercise.id), ...exercise });
          const proposal = buildTemplateBlocks(
            templateId.value,
            frequency.value,
            [...byId.values()],
            {
              ...preferences,
              exerciseCount: exerciseCount.value,
            } as TemplatePreferences,
          );
          proposalCatalog.value = [...byId.values()];
          form.blocks = proposal.blocks;
          missing.value = proposal.missing;
          proposalWarnings.value = proposal.warnings;
          form.name = `${routineTemplates.find((item) => item.id === templateId.value)!.label} · ${frequency.value} días`;
          proposalKey.value = key;
          applyRoutineSchedule(
            form,
            scheduleMode.value,
            selectedWeekdays.value,
          );
        } finally {
          if (ownEpoch === epoch) busy.value = false;
        }
      }
    } else if (step.value === 1) {
      if (!form.name.trim()) throw new Error("Escribe el nombre de tu plan.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startsOn))
        throw new Error(
          "Elige la fecha inicial para guardar tu semana y sus descansos.",
        );
      if (
        !Number.isInteger(form.durationWeeks) ||
        form.durationWeeks < 1 ||
        form.durationWeeks > 52
      )
        throw new Error("Elige entre 1 y 52 semanas completas.");
    } else for (const block of form.blocks) blockPrescriptions(block);
    await goTo(step.value + 1);
  } catch (cause) {
    if (!disposed && nextEpoch === epoch)
      error.value =
        cause instanceof Error ? cause.message : "Revisa los campos.";
  }
}
async function save() {
  if (busy.value || createdPlanId.value) return;
  error.value = "";
  try {
    intent ??= structuredClone(
      buildRoutineRequest(
        form,
        crypto.randomUUID(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Revisa los campos.";
    return;
  }
  const ownEpoch = epoch,
    ownSession = auth.getSessionGeneration();
  busy.value = true;
  try {
    const result = await routineService.generate(structuredClone(intent));
    if (
      disposed ||
      ownEpoch !== epoch ||
      ownSession !== auth.getSessionGeneration()
    )
      return;
    createdPlanId.value = result.id;
    emit("created", result.id);
  } catch (cause) {
    if (
      !disposed &&
      ownEpoch === epoch &&
      ownSession === auth.getSessionGeneration()
    ) {
      const status = axios.isAxiosError(cause)
        ? cause.response?.status
        : undefined;
      uncertain.value =
        !status || status >= 500 || [408, 409, 429].includes(status);
      if (!uncertain.value) intent = undefined;
      error.value = trainingPlanErrorMessage(
        cause,
        "No se pudo confirmar la creación. Reintenta sin duplicarla.",
      );
    }
  } finally {
    if (!disposed && ownEpoch === epoch) busy.value = false;
  }
}
</script>
<template>
  <form
    class="state-card routine-form training-editor routine-wizard"
    novalidate
    @submit.prevent="step < 3 ? next() : save()"
  >
    <ol class="wizard-steps" aria-label="Pasos para crear la rutina">
      <li
        v-for="(label, index) in stepLabels"
        :key="label"
        :class="{ current: step === index + 1, done: step > index + 1 }"
        :aria-current="step === index + 1 ? 'step' : undefined"
      >
        <span aria-hidden="true">{{ step > index + 1 ? "✓" : index + 1 }}</span>
        {{ label }}
      </li>
    </ol>
    <header class="wizard-heading">
      <p>Paso {{ step }} de {{ stepLabels.length }}</p>
      <h2 ref="heading" tabindex="-1">{{ titles[step - 1] }}</h2>
    </header>
    <fieldset
      class="wizard-fields"
      :disabled="busy || uncertain || !!createdPlanId"
    >
      <template v-if="guided && step === 1">
        <label class="field-label" for="routine-frequency"
          >Días de entrenamiento por semana</label
        >
        <select
          id="routine-frequency"
          v-model.number="frequency"
          class="form-control"
        >
          <option v-for="value in 7" :key="value" :value="value">
            {{ value }} {{ value === 1 ? "día" : "días" }}
          </option>
        </select>
        <fieldset id="routine-template" class="template-chooser">
          <legend>Elige una plantilla</legend>
          <div class="style-options">
            <label
              v-for="item in availableTemplates"
              :key="item.id"
              class="style-option template-option"
              :class="{ selected: templateId === item.id }"
            >
              <input
                :id="'routine-template-' + item.id"
                v-model="templateId"
                type="radio"
                name="routine-template"
                :value="item.id"
              />
              <strong>{{ item.label }}</strong>
              <span>{{ item.description }}</span>
              <small
                v-if="
                  entryMode === 'recommended' &&
                  item.id === recommendedTemplate(frequency)
                "
              >
                Sugerida para {{ frequency }}
                {{ frequency === 1 ? "día" : "días" }}
              </small>
            </label>
          </div>
        </fieldset>
        <details class="wizard-disclosure">
          <summary>Ver plantillas para otras frecuencias</summary>
          <ul>
            <li v-for="item in routineTemplates" :key="item.id">
              <strong>{{ item.label }}</strong> ·
              {{ item.frequencies.join(", ") }} días. {{ item.description }}
            </li>
          </ul>
        </details>
        <fieldset class="schedule-choice">
          <legend>Cómo organizarás tus sesiones</legend>
          <label
            ><input
              v-model="scheduleMode"
              type="radio"
              value="fixed"
              name="routine-schedule"
            />
            Semana fija</label
          ><label
            ><input
              v-model="scheduleMode"
              type="radio"
              value="flexible"
              name="routine-schedule"
            />
            Orden flexible, sin fechas asignadas</label
          >
        </fieldset>
        <fieldset v-if="scheduleMode === 'fixed'" class="weekday-choices">
          <legend>
            Elige {{ frequency }} días ({{ selectedWeekdays.length }}
            seleccionados)
          </legend>
          <label v-for="value in 7" :key="value"
            ><input
              :id="'routine-weekday-' + value"
              v-model="selectedWeekdays"
              type="checkbox"
              :value="value"
            />{{ weekdayLabel(value) }}</label
          >
        </fieldset>
        <p v-else class="field-hint">
          Tus sesiones conservarán su orden y podrás ubicarlas en el calendario
          después. No se crearán descansos con fecha.
        </p>
      </template>
      <template v-else-if="guided && step === 2">
        <div class="routine-grid wizard-basics">
          <label for="routine-goal"
            >Objetivo<select
              id="routine-goal"
              v-model="preferences.goal"
              class="form-control"
            >
              <option value="" disabled>Elige tu objetivo</option>
              <option value="GENERAL">Entrenamiento general</option>
              <option value="HYPERTROPHY">Ganar masa muscular</option>
              <option value="STRENGTH">Ganar fuerza</option>
            </select></label
          >
          <label for="routine-experience"
            >Experiencia<select
              id="routine-experience"
              v-model="preferences.experience"
              class="form-control"
            >
              <option value="" disabled>Elige tu experiencia</option>
              <option value="BEGINNER">Estoy empezando</option>
              <option value="INTERMEDIATE">Tengo experiencia</option>
              <option value="ADVANCED">Tengo experiencia avanzada</option>
            </select></label
          >
        </div>
        <fieldset class="equipment-choices">
          <legend>Equipamiento que tienes disponible</legend>
          <label v-for="value in exerciseEnums.equipmentType" :key="value"
            ><input
              :id="'routine-equipment-' + value"
              v-model="preferences.equipment"
              type="checkbox"
              :value="value"
            />{{ exerciseEnumLabel(value) }}</label
          >
        </fieldset>
        <label for="routine-volume" class="wizard-volume"
          >Tamaño de la sesión
          <select
            id="routine-volume"
            v-model="volumePreset"
            class="form-control"
            @change="chooseVolumePreset"
          >
            <option
              v-for="preset in exerciseCountPresets"
              :key="preset.id"
              :value="preset.id"
            >
              {{ preset.label }}
            </option>
          </select>
        </label>
        <details
          class="wizard-disclosure wizard-advanced"
          :open="advancedExpanded"
          @toggle="
            advancedExpanded = ($event.currentTarget as HTMLDetailsElement).open
          "
        >
          <summary>Ajustar volumen, distribución y variantes</summary>
          <div class="wizard-advanced-body">
            <div class="routine-grid">
              <label for="routine-exercise-count"
                >Ejercicios por sesión
                <input
                  id="routine-exercise-count"
                  v-model.number="exerciseCount"
                  class="form-control"
                  type="number"
                  min="1"
                  max="20"
                />
              </label>
              <label for="routine-duration-minutes"
                >Duración orientativa (minutos)
                <input
                  id="routine-duration-minutes"
                  v-model.number="preferences.durationMinutes"
                  class="form-control"
                  type="number"
                  min="10"
                  max="240"
                />
              </label>
            </div>
            <p class="field-hint">
              La duración es una referencia editorial editable para organizarte;
              tu ritmo y descansos pueden cambiarla.
            </p>
            <div class="session-preferences">
              <fieldset
                v-for="family in families.filter(
                  (item) => item.muscleGroups.length,
                )"
                :key="family.family"
                class="muscle-allocation"
              >
                <legend>
                  {{ family.name.replace(/ A$/, "") }} · distribución de
                  ejercicios
                </legend>
                <div class="allocation-grid">
                  <label
                    v-for="key in family.muscleGroups"
                    :key="key"
                    :for="'routine-allocation-' + family.family + '-' + key"
                    >{{ templateMuscleLabels[key] ?? key }}
                    <input
                      :id="'routine-allocation-' + family.family + '-' + key"
                      v-model.number="
                        preferences.muscleAllocations[family.family]![key]
                      "
                      type="number"
                      min="0"
                      :max="exerciseCount"
                      class="form-control"
                    />
                  </label>
                </div>
                <p
                  class="field-hint"
                  :class="{
                    'allocation-error':
                      allocationTotal(family.family) !== exerciseCount,
                  }"
                >
                  {{ allocationTotal(family.family) }} de
                  {{ exerciseCount }} ejercicios distribuidos.
                </p>
              </fieldset>
            </div>
            <fieldset
              v-if="repeatedFamilies.length"
              class="variant-preferences"
            >
              <legend>Cómo se repiten tus sesiones A/B/C</legend>
              <p class="field-hint">
                Elige por separado para cada grupo de sesiones. Después podrás
                editar cada día o copiarlo sin cambiar el original.
              </p>
              <label
                v-for="family in repeatedFamilies"
                :key="family.family"
                :for="'routine-variant-' + family.family"
                >{{ family.name.replace(/ A$/, "") }}
                <select
                  :id="'routine-variant-' + family.family"
                  :value="
                    preferences.familyStrategies[family.family] ?? 'partial'
                  "
                  class="form-control"
                  @change="
                    preferences.familyStrategies[family.family] = (
                      $event.target as HTMLSelectElement
                    ).value as NonNullable<
                      TemplatePreferences['familyStrategies']
                    >[string]
                  "
                >
                  <option value="same">Mismos ejercicios</option>
                  <option value="partial">
                    Variantes parciales · conservar una base
                  </option>
                  <option value="different">Ejercicios diferentes</option>
                  <option value="independent">
                    Configurar cada día de forma independiente
                  </option>
                </select>
              </label>
            </fieldset>
          </div>
        </details>
        <p class="field-hint">
          Partirás de
          {{
            preferences.experience === "BEGINNER"
              ? "2"
              : preferences.experience
                ? "3"
                : "2–3"
          }}
          series de 8–12 repeticiones. Podrás ajustar los ejercicios y sus
          objetivos en la propuesta.
        </p>
        <p
          v-if="proposalKey && proposalKey !== catalogPreferencesKey"
          class="field-hint"
        >
          Generar con estas preferencias reemplazará los ejercicios de la
          propuesta anterior.
        </p>
      </template>
      <template v-else-if="guided && step === 3">
        <p class="field-hint">
          Plantilla inicial editable:
          {{ preferences.experience === "BEGINNER" ? "2" : "3" }} series de 8–12
          repeticiones, sin carga asignada. Revisa cada sesión antes de
          guardarla.
        </p>
        <section class="proposal-summary" aria-label="Volumen de la propuesta">
          <dl class="proposal-metrics">
            <div>
              <dt>Sesiones por semana</dt>
              <dd>{{ sessionSummaries.length }}</dd>
            </div>
            <div>
              <dt>Ejercicios en la semana</dt>
              <dd>{{ proposalSummary.exerciseCount }}</dd>
            </div>
            <div>
              <dt>Series directas</dt>
              <dd>{{ proposalSummary.setCount }}</dd>
            </div>
          </dl>
          <label for="routine-duration-review"
            >Tiempo orientativo por sesión (minutos)
            <input
              id="routine-duration-review"
              v-model.number="preferences.durationMinutes"
              class="form-control"
              type="number"
              min="10"
              max="240"
            />
          </label>
          <ul class="proposal-sessions">
            <li v-for="day in sessionSummaries" :key="day.id">
              <strong>{{ day.name }}</strong>
              <span
                >{{ day.exerciseCount }} ejercicios ·
                {{ day.setCount }} series</span
              >
            </li>
          </ul>
          <details class="wizard-disclosure">
            <summary>Series por músculo principal en tu semana</summary>
            <ul>
              <li
                v-for="(sets, group) in proposalSummary.directSets"
                :key="group"
              >
                {{ templateMuscleLabels[group] ?? group }}: {{ sets }} series
              </li>
            </ul>
            <p v-if="proposalSummary.unclassifiedSets" class="field-hint">
              {{ proposalSummary.unclassifiedSets }} series de ejercicios
              añadidos sin grupo principal disponible en esta propuesta.
            </p>
            <p class="field-hint">
              El recuento usa solo el músculo principal del catálogo. No
              equipara el trabajo indirecto con series directas.
            </p>
          </details>
        </section>
        <details v-if="proposalWarnings.length" class="template-missing">
          <summary>
            Revisa {{ proposalWarnings.length }} ajustes de la propuesta
          </summary>
          <ul>
            <li v-for="warning in proposalWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </details>
        <div v-if="missing.length" class="template-missing" role="status">
          <strong>Faltan ejercicios compatibles del catálogo.</strong>
          <p>
            Completa o adapta estas partes con el selector. No añadimos
            ejercicios con equipamiento o metadatos desconocidos.
          </p>
          <ul>
            <li v-for="item in missing" :key="item">{{ item }}</li>
          </ul>
        </div>
        <label class="field-label" for="routine-name">Nombre de tu rutina</label
        ><input
          id="routine-name"
          v-model="form.name"
          class="form-control"
          maxlength="160"
          required
        />
        <div class="routine-grid">
          <label
            >Repetir durante (semanas)<input
              id="routine-weeks"
              v-model.number="form.durationWeeks"
              class="form-control"
              type="number"
              min="1"
              max="52" /></label
          ><label v-if="scheduleMode === 'fixed'"
            >Fecha inicial<input
              id="routine-start"
              v-model="form.startsOn"
              class="form-control"
              type="date"
          /></label>
        </div>
        <p class="field-hint">
          {{
            scheduleMode === "flexible"
              ? "Orden flexible, sin días ni descansos fechados."
              : selectedWeekdays
                  .slice()
                  .sort((a, b) => a - b)
                  .map((value) => weekdayLabel(value))
                  .join(" · ")
          }}. Se guardará como borrador; la activación se elige después.
        </p>
        <RoutineBuilder
          :key="session"
          v-model:blocks="form.blocks"
          v-model:active-block-id="selectedBlockId"
          :disabled="busy || uncertain"
          :allow-block-changes="false"
          review
        />
      </template>
      <template v-else-if="step === 1">
        <p class="field-hint">
          Usa tu rutina actual o una estructura inicial. Tú eliges los
          ejercicios y sus objetivos.
        </p>
        <div
          class="style-options"
          role="group"
          aria-label="Estructura de la rutina"
        >
          <button
            v-for="style in routineStyles"
            :key="style.id"
            type="button"
            class="style-option"
            :class="{ selected: form.style === style.id }"
            :aria-pressed="form.style === style.id"
            @click="chooseStyle(style.id)"
          >
            <strong>{{ style.label }}</strong
            ><span>{{ style.description }}</span>
          </button>
        </div>
        <label class="field-label" for="routine-name">Nombre de tu rutina</label
        ><input
          id="routine-name"
          v-model="form.name"
          class="form-control"
          maxlength="160"
          autocomplete="off"
          placeholder="Mi rutina de entrenamiento"
          required
        />
        <div class="routine-grid">
          <div>
            <label class="field-label" for="routine-weeks"
              >Repetir durante (semanas)</label
            ><input
              id="routine-weeks"
              v-model.number="form.durationWeeks"
              class="form-control"
              type="number"
              min="1"
              max="52"
              required
            />
            <p class="field-hint">
              Editable. Cada semana tendrá sus propios días.
            </p>
          </div>
          <div>
            <label class="field-label" for="routine-start">Fecha inicial</label
            ><input
              id="routine-start"
              v-model="form.startsOn"
              class="form-control"
              type="date"
              required
            />
            <p class="field-hint">
              Hoy, según tu zona horaria. Puedes cambiarla antes de crear la
              rutina.
            </p>
          </div>
        </div>
      </template>
      <RoutineBuilder
        v-else-if="step === 2"
        :key="session"
        v-model:blocks="form.blocks"
        v-model:active-block-id="selectedBlockId"
        :disabled="busy"
      />
      <template v-else>
        <p class="field-hint">
          Asigna los bloques a los días que entrenas. Puedes repetir un bloque y
          adaptar cada copia después.
        </p>
        <fieldset class="schedule-choice">
          <legend>Organización de tus sesiones</legend>
          <label
            ><input
              v-model="form.scheduleMode"
              type="radio"
              value="fixed"
              name="custom-schedule"
            />
            Semana fija</label
          ><label
            ><input
              v-model="form.scheduleMode"
              type="radio"
              value="flexible"
              name="custom-schedule"
            />
            Orden flexible, sin fechas asignadas</label
          >
        </fieldset>
        <p v-if="form.scheduleMode === 'flexible'" class="field-hint">
          Se guardarán {{ form.blocks.length }} sesiones en el orden de los
          bloques. Podrás distribuirlas después; no se crearán descansos
          fechados.
        </p>
        <div v-else class="week-assignments">
          <div
            v-for="(_, index) in form.weekdays"
            :key="index"
            class="weekday-assignment"
          >
            <label :for="'routine-weekday-' + index">{{
              weekdayLabel(index + 1)
            }}</label
            ><select
              :id="'routine-weekday-' + index"
              v-model="form.weekdays[index]"
              class="form-control"
            >
              <option value="">Descanso</option>
              <option
                v-for="block in form.blocks"
                :key="block.id"
                :value="block.id"
              >
                {{ block.name }}
              </option></select
            ><small>{{
              assignedBlock(form.weekdays[index] ?? "")?.exercises.length
                ? `${assignedBlock(form.weekdays[index] ?? "")!.exercises.length} ejercicios`
                : "Sin entrenamiento"
            }}</small>
          </div>
        </div>
        <div class="wizard-review">
          <strong
            >{{ form.name }} · {{ form.durationWeeks }}
            {{ form.durationWeeks === 1 ? "semana" : "semanas" }}</strong
          >
          <p>
            {{
              form.scheduleMode === "flexible"
                ? `${form.blocks.length} sesiones en orden flexible.`
                : `${trainingDays} días de entrenamiento y ${7 - trainingDays} de descanso por semana.`
            }}
          </p>
          <p>
            Los objetivos se copian a cada día y semana. Cambiar una copia no
            modifica las demás.
          </p>
          <p v-if="form.scheduleMode !== 'flexible'">
            Fecha inicial: {{ form.startsOn }}. Los días se ubican en los siete
            días que comienzan en esa fecha.
          </p>
        </div>
        <details class="review-exercises">
          <summary>Revisar ejercicios y objetivos</summary>
          <section
            v-for="block in form.blocks.filter(
              (item) =>
                form.scheduleMode === 'flexible' ||
                form.weekdays.includes(item.id),
            )"
            :key="block.id"
          >
            <h3>{{ block.name }}</h3>
            <ul>
              <li
                v-for="exercise in block.exercises"
                :key="exercise.exerciseId"
              >
                {{ exercise.name }} · {{ exercise.targetSets }} ×
                {{
                  exercise.targetRepsMin === exercise.targetRepsMax
                    ? exercise.targetRepsMin
                    : `${exercise.targetRepsMin}–${exercise.targetRepsMax}`
                }}
                reps ·
                {{
                  exercise.targetLoad
                    ? `${exercise.targetLoad} ${exercise.targetLoadUnit.toLowerCase()}`
                    : "Carga sin definir"
                }}
              </li>
            </ul>
          </section>
        </details>
      </template>
    </fieldset>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="uncertain" role="status" class="field-hint">
      La respuesta anterior no se confirmó. La propuesta queda bloqueada para
      reintentar con el mismo identificador.
    </p>
    <p v-if="busy" role="status" class="field-hint">
      Creando los días, ejercicios y semanas de tu rutina…
    </p>
    <div class="plan-actions wizard-actions">
      <button
        class="text-button"
        type="button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Cancelar
      </button>
      <button
        v-if="step > 1"
        class="text-button"
        type="button"
        :disabled="busy || uncertain || !!createdPlanId"
        @click="goTo(step - 1)"
      >
        Atrás</button
      ><button
        class="primary-button"
        type="submit"
        :disabled="busy || !!createdPlanId"
      >
        {{
          busy
            ? "Creando mi rutina…"
            : createdPlanId
              ? "Rutina creada"
              : step < 3
                ? guided && step === 2
                  ? "Ver propuesta"
                  : "Continuar"
                : uncertain
                  ? "Reintentar creación"
                  : "Crear mi rutina"
        }}
      </button>
    </div>
  </form>
</template>
<style scoped>
.proposal-summary {
  padding: var(--space-4);
  margin: var(--space-4) 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface-subtle);
}
.proposal-summary input {
  max-width: 180px;
}
.proposal-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: var(--space-3);
  margin: 0 0 var(--space-4);
}
.proposal-metrics > div {
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}
.proposal-metrics dt {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
}
.proposal-metrics dd {
  font: 700 1.6rem/1 var(--font-heading);
  font-variant-numeric: tabular-nums;
  margin: 0;
}
.proposal-sessions {
  list-style: none;
  padding: 0;
  margin-block: 0 var(--space-4);
}
.proposal-sessions li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  flex-wrap: wrap;
  border-top: 1px solid var(--color-border);
  padding-block: var(--space-2);
  overflow-wrap: anywhere;
}
.proposal-sessions li > span {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}
.session-preferences {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: var(--space-4);
}
.muscle-allocation,
.variant-preferences {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 1rem;
}
.muscle-allocation legend,
.variant-preferences legend {
  font-size: 0.85rem;
  font-weight: 600;
}
.allocation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.allocation-grid label,
.variant-preferences > label {
  display: block;
  font-size: 0.8rem;
}
.variant-preferences > label {
  margin: 0.75rem 0;
}
.allocation-error {
  color: var(--color-danger);
}
.schedule-choice,
.weekday-choices,
.equipment-choices {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 1rem;
  margin: 1rem 0;
  display: flex;
  gap: 0.75rem 1.25rem;
  flex-wrap: wrap;
}
.schedule-choice label,
.weekday-choices label,
.equipment-choices label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--target-size, 48px);
}
.template-missing {
  border: 1px solid var(--color-border);
  padding: 1rem;
  margin: 1rem 0;
  border-radius: var(--radius-control);
  font-size: 0.875rem;
}
.routine-wizard {
  max-width: 68rem;
  min-width: 0;
  padding: clamp(1rem, 4vw, 2rem);
}
.wizard-heading {
  margin-block: var(--space-6) var(--space-4);
}
.wizard-heading p {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  margin: 0 0 var(--space-2);
}
.wizard-heading h2 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  line-height: 1.1;
  margin: 0;
  text-wrap: balance;
}
.wizard-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
  padding: 0 0 var(--space-3);
  margin: 0;
  gap: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.wizard-steps li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.8125rem;
  line-height: 1.25;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.wizard-steps li.current {
  color: var(--color-primary);
}
.wizard-steps li > span {
  display: grid;
  place-items: center;
  flex: 0 0 1.625rem;
  min-height: 1.625rem;
  border-radius: 50%;
  background: var(--color-surface-elevated);
  font-size: 0.75rem;
  font-weight: 700;
}
.wizard-steps li.current > span {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.wizard-steps li.done > span {
  color: var(--color-primary);
}
.wizard-fields {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.wizard-fields :is(.form-control, summary) {
  min-height: var(--target-size, 48px);
}
.wizard-fields :is(.form-control, select, input[type="date"]) {
  max-width: 100%;
  min-width: 0;
}
.wizard-fields :is(label, legend, summary) {
  overflow-wrap: anywhere;
}
.wizard-basics label,
.wizard-volume {
  display: block;
}
.wizard-basics select,
.wizard-volume select {
  margin-top: var(--space-2);
}
.wizard-volume {
  max-width: 23rem;
  margin-block: var(--space-4);
}
.template-chooser {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: var(--space-5) 0 0;
}
.template-chooser legend {
  font-weight: 650;
  padding: 0;
}
.style-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-3) 0 var(--space-4);
}
.style-option {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 94px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-subtle);
  color: var(--color-text-primary);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  cursor: pointer;
  overflow-wrap: anywhere;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast);
}
.style-option.selected {
  border-color: var(--color-primary);
  background: var(--color-accent-surface);
}
.style-option:hover {
  border-color: var(--color-primary);
}
.style-option strong {
  font-size: 0.95rem;
}
.style-option span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}
.template-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: start;
  align-items: center;
}
.template-option input {
  accent-color: var(--color-primary);
  margin: 0;
  width: 1.125rem;
  height: 1.125rem;
}
.template-option :is(span, small) {
  grid-column: 2;
}
.template-option small {
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.75rem;
}
.wizard-disclosure {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-subtle);
  padding-inline: var(--space-4);
}
.wizard-disclosure summary {
  cursor: pointer;
  align-content: center;
  font-weight: 650;
  padding-block: var(--space-2);
}
.wizard-disclosure ul {
  font-size: 0.875rem;
  padding-inline-start: var(--space-5);
  color: var(--color-text-secondary);
}
.wizard-disclosure li + li {
  margin-top: var(--space-2);
}
.wizard-advanced-body {
  display: grid;
  gap: var(--space-4);
  padding-block: var(--space-2) var(--space-4);
}
.week-assignments {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 1.25rem 0;
}
.weekday-assignment {
  padding: 0.75rem 0.5rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  min-width: 0;
}
.weekday-assignment > label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.weekday-assignment select {
  padding: 0.55rem 0.25rem;
  font-size: 0.75rem;
  width: 100%;
  min-width: 0;
}
.weekday-assignment small {
  display: block;
  font-size: 0.65rem;
  margin-top: 0.5rem;
  color: var(--color-text-secondary);
}
.wizard-review {
  padding: 1rem;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-control);
}
.wizard-review p {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 0.5rem 0;
}
.review-exercises {
  font-size: 0.8rem;
  margin: 1rem 0;
}
.review-exercises summary {
  cursor: pointer;
  padding: 0.75rem 0;
  min-height: 44px;
}
.review-exercises h3 {
  font-size: 0.85rem;
}
.review-exercises li {
  margin: 0.5rem 0;
}
.wizard-actions {
  margin: var(--space-6) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  gap: var(--space-2);
  background: var(--color-surface);
}
.wizard-actions .primary-button {
  margin-inline-start: auto;
}
.wizard-actions button {
  min-height: var(--target-size, 48px);
  white-space: normal;
}
.routine-wizard :is(button, input, select, summary):focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
.routine-wizard h2:focus {
  outline: none;
}
@media (max-width: 850px) {
  .week-assignments {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .style-options {
    grid-template-columns: minmax(0, 1fr);
  }
  .style-option {
    min-height: var(--target-size, 48px);
    padding: var(--space-3);
  }
  .wizard-steps {
    gap: var(--space-2);
  }
  .wizard-steps li {
    font-size: 0.7rem;
    flex-direction: column;
    text-align: center;
  }
  .week-assignments {
    grid-template-columns: 1fr;
  }
  .weekday-assignment {
    display: grid;
    grid-template-columns: minmax(4.5rem, auto) minmax(0, 1fr);
    align-items: center;
    gap: 0.25rem 0.5rem;
    padding: 0.75rem;
  }
  .weekday-assignment > label {
    margin: 0;
  }
  .weekday-assignment select {
    font-size: 0.875rem;
    padding: 0.55rem;
  }
  .weekday-assignment small {
    grid-column: 2;
    margin-top: 0;
  }
  .wizard-actions {
    position: sticky;
    z-index: 1;
    bottom: calc(
      var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px)
    );
    padding-block: var(--space-2);
  }
  .wizard-actions .primary-button {
    flex: 1 0 auto;
    max-width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .style-option {
    transition: none;
  }
}
</style>
