<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
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
  type RoutineStyle,
} from "../../utils/routine-builder";
import RoutineBuilder from "./RoutineBuilder.vue";

const emit = defineEmits<{ created: [id: string]; cancel: [] }>();
const auth = useAuthStore();
const form = reactive(createRoutineDraft());
const step = ref(1),
  busy = ref(false),
  error = ref(""),
  createdPlanId = ref("");
const heading = ref<HTMLElement>();
const titles = [
  "Elige cómo entrenas",
  "Prepara tus bloques",
  "Organiza tu semana",
];
const trainingDays = computed(() => form.weekdays.filter(Boolean).length);
const assignedBlock = (id: string) =>
  form.blocks.find((block) => block.id === id);
let intent: { key: string; id: string } | undefined;
let session = auth.getSessionGeneration();
let epoch = 0;
let disposed = false;
watch(
  () => [auth.user?.id, auth.status],
  () => {
    const current = auth.getSessionGeneration();
    if (current === session) return;
    session = current;
    epoch++;
    intent = undefined;
    Object.assign(form, createRoutineDraft());
    step.value = 1;
    busy.value = false;
    error.value = "";
    createdPlanId.value = "";
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
  error.value = "";
  try {
    if (step.value === 1) {
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
    error.value = cause instanceof Error ? cause.message : "Revisa los campos.";
  }
}
async function save() {
  if (busy.value || createdPlanId.value) return;
  error.value = "";
  let values;
  try {
    values = buildRoutineRequest(
      form,
      crypto.randomUUID(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Revisa los campos.";
    return;
  }
  const { id: _unused, ...body } = values;
  const key = JSON.stringify(body);
  if (intent?.key !== key) intent = { key, id: crypto.randomUUID() };
  const ownEpoch = epoch,
    ownSession = auth.getSessionGeneration();
  busy.value = true;
  try {
    const result = await routineService.generate({ ...values, id: intent.id });
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
    )
      error.value = trainingPlanErrorMessage(
        cause,
        "No se pudo crear el plan. Puedes reintentar sin duplicarlo.",
      );
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
    <div class="wizard-topline">
      <span>CREAR MI RUTINA</span><span>Paso {{ step }} de 3</span>
    </div>
    <ol class="wizard-steps" aria-label="Pasos para crear la rutina">
      <li
        v-for="(title, index) in titles"
        :key="title"
        :class="{ current: step === index + 1, done: step > index + 1 }"
        :aria-current="step === index + 1 ? 'step' : undefined"
      >
        <span>{{ index + 1 }}</span
        >{{ title }}
      </li>
    </ol>
    <h2 ref="heading" tabindex="-1">{{ titles[step - 1] }}</h2>
    <fieldset class="wizard-fields" :disabled="busy || !!createdPlanId">
      <template v-if="step === 1">
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
        :disabled="busy"
      />
      <template v-else>
        <p class="field-hint">
          Asigna los bloques a los días que entrenas. Puedes repetir un bloque y
          adaptar cada copia después.
        </p>
        <div class="week-assignments">
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
            {{ trainingDays }} días de entrenamiento y {{ 7 - trainingDays }} de
            descanso por semana.
          </p>
          <p>
            Los objetivos se copian a cada día y semana. Cambiar una copia no
            modifica las demás.
          </p>
          <p>
            Fecha inicial: {{ form.startsOn }}. Los días se ubican en los siete
            días que comienzan en esa fecha.
          </p>
        </div>
        <details class="review-exercises">
          <summary>Revisar ejercicios y objetivos</summary>
          <section
            v-for="block in form.blocks.filter((item) =>
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
    <p v-if="busy" role="status" class="field-hint">
      Creando los días, ejercicios y semanas de tu rutina…
    </p>
    <div class="plan-actions wizard-actions">
      <button
        v-if="step > 1"
        class="text-button"
        type="button"
        :disabled="busy || !!createdPlanId"
        @click="goTo(step - 1)"
      >
        Atrás</button
      ><button class="primary-button" :disabled="busy || !!createdPlanId">
        {{
          busy
            ? "Creando mi rutina…"
            : createdPlanId
              ? "Rutina creada"
              : step < 3
                ? "Continuar"
                : "Crear mi rutina"
        }}</button
      ><button
        class="text-button"
        type="button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Cancelar
      </button>
    </div>
  </form>
</template>
<style scoped>
.routine-wizard {
  max-width: 1040px;
}
.wizard-topline {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: var(--color-text-secondary);
}
.wizard-steps {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 1.75rem;
  gap: 1rem;
}
.wizard-steps li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  flex: 1;
  border-top: 2px solid var(--color-border);
  padding-top: 0.75rem;
}
.wizard-steps li.current,
.wizard-steps li.done {
  color: var(--color-primary);
  border-color: var(--color-primary);
}
.wizard-steps li > span {
  font-size: 0.75rem;
  font-weight: 700;
}
.wizard-fields {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.style-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 1.2rem 0 1.5rem;
}
.style-option {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 94px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-radius: var(--radius-control);
  padding: 1rem;
}
.style-option.selected {
  border-color: var(--color-primary);
  background: var(--color-surface-elevated);
}
.style-option strong {
  font-size: 0.875rem;
}
.style-option span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
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
  margin-top: 1.5rem;
  flex-wrap: wrap;
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
    grid-template-columns: 1fr 1fr;
  }
  .style-option {
    min-height: 104px;
    padding: 0.8rem;
  }
  .wizard-steps {
    gap: 0.5rem;
  }
  .wizard-steps li {
    font-size: 0.65rem;
    align-items: start;
  }
  .week-assignments {
    grid-template-columns: 1fr;
  }
  .weekday-assignment {
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr);
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
  .wizard-actions .primary-button {
    flex: 1;
  }
}
</style>
