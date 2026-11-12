<script setup lang="ts">
import { computed, reactive, ref, useId } from "vue";
import {
  setInputSchema,
  workoutWriteRejected,
  workoutErrorMessage,
  type SetInput,
  type SetRecord,
} from "../../services/workout-sessions.service";
import {
  actualValuesToCopy,
  lastCompletedWorkSet,
  type PreviousWorkoutReference,
  type WorkoutSetReference,
} from "../../utils/workout-set-reference";

const props = defineProps<{
  initial?: SetRecord;
  nextNumber?: number;
  busy?: boolean;
  currentSets?: readonly WorkoutSetReference[];
  previousReference?: PreviousWorkoutReference;
  save: (input: SetInput, creationId: string) => Promise<unknown>;
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const id = useId();
const creationId = crypto.randomUUID();
const form = reactive({
  setNumber: String(props.initial?.setNumber ?? props.nextNumber ?? 1),
  status: props.initial ? (props.initial.status ?? "") : "COMPLETED",
  kind: props.initial ? (props.initial.kind ?? "") : "WORK",
  load: props.initial?.load ?? "",
  loadUnit: props.initial ? (props.initial.loadUnit ?? "") : "KG",
  repetitions: props.initial?.repetitions?.toString() ?? "",
  rpe: props.initial?.rpe?.toString() ?? "",
  notes: props.initial?.notes ?? "",
});
const hasResults = computed(
  () => !["PENDING", "SKIPPED"].includes(form.status),
);
const clearsResults = computed(() =>
  Boolean(
    props.initial &&
    [props.initial.load, props.initial.repetitions, props.initial.rpe].some(
      (value) => value != null,
    ) &&
    !hasResults.value,
  ),
);
const currentReference = computed(() =>
  lastCompletedWorkSet(props.currentSets),
);
const previousSet = computed(() => {
  const sets = props.previousReference?.sets ?? [];
  return (
    sets.find(
      (set) =>
        set.setNumber === Number(form.setNumber) &&
        set.kind === "WORK" &&
        set.status === "COMPLETED",
    ) ?? lastCompletedWorkSet(sets)
  );
});
const copiedSource = ref("");
const confirmCopied = ref(false);
const confirmClear = ref(false);
const pending = ref(false);
const submitted = ref<SetInput | null>(null);
const error = ref("");

function copyReference(source: "CURRENT" | "PREVIOUS") {
  if (props.initial || pending.value || props.busy || submitted.value) return;
  const reference =
    source === "CURRENT" ? currentReference.value : previousSet.value;
  const values = actualValuesToCopy(reference);
  if (!values) {
    error.value =
      "Esta referencia no tiene carga, unidad y repeticiones de trabajo verificables. Introduce los resultados reales.";
    return;
  }
  Object.assign(form, values, { status: "COMPLETED", kind: "WORK" });
  copiedSource.value =
    source === "CURRENT"
      ? `Serie ${reference!.setNumber} de este entrenamiento`
      : `${props.previousReference!.sessionLabel} · serie ${reference!.setNumber}`;
  confirmCopied.value = false;
  error.value = "";
}

async function submit() {
  if (pending.value || props.busy) return;
  error.value = "";
  if (
    !submitted.value &&
    copiedSource.value &&
    hasResults.value &&
    !confirmCopied.value
  ) {
    error.value =
      "Confirma que los valores revisados corresponden a esta serie realizada.";
    return;
  }
  if (clearsResults.value && !confirmClear.value) {
    error.value = "Confirma la retirada de los valores de esta serie.";
    return;
  }
  if (!submitted.value) {
    const input = {
      setNumber: Number(form.setNumber),
      status: form.status,
      kind: form.kind,
      load: hasResults.value
        ? form.load.trim().replace(",", ".") || null
        : null,
      loadUnit: hasResults.value ? form.loadUnit || null : null,
      repetitions:
        hasResults.value && String(form.repetitions).trim()
          ? Number(form.repetitions)
          : null,
      rpe:
        hasResults.value && String(form.rpe).trim() ? Number(form.rpe) : null,
      notes: form.notes.trim() || null,
    };
    const parsed = setInputSchema.safeParse(input);
    if (!parsed.success) {
      error.value =
        parsed.error.issues[0]?.message ??
        "Revisa los resultados reales de la serie.";
      return;
    }
    submitted.value = parsed.data;
  }
  pending.value = true;
  try {
    await props.save(submitted.value, creationId);
    emit("saved");
  } catch (cause) {
    if (workoutWriteRejected(cause)) submitted.value = null;
    error.value = workoutErrorMessage(cause, "No se pudo guardar la serie.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form
    class="plan-form training-editor quick-set-form"
    novalidate
    :aria-busy="pending"
    @submit.prevent="submit"
  >
    <h4>
      {{
        initial
          ? "Editar serie registrada"
          : `Registrar serie ${form.setNumber}`
      }}
    </h4>
    <fieldset :disabled="pending || busy || Boolean(submitted)">
      <legend class="training-section-legend">Resultados reales</legend>
      <div
        v-if="!initial && (currentReference || previousSet)"
        class="quick-set-references"
      >
        <div v-if="currentReference">
          <p>
            <strong>Última serie de trabajo de hoy</strong><br />{{
              currentReference.repetitions ?? "Sin"
            }}
            repeticiones · {{ currentReference.load ?? "Sin carga" }}
            {{ currentReference.loadUnit ?? "(unidad desconocida)"
            }}<span v-if="currentReference.rpe != null">
              · RPE {{ currentReference.rpe }} de referencia</span
            >
          </p>
          <button
            class="secondary-button"
            type="button"
            :disabled="!actualValuesToCopy(currentReference)"
            @click="copyReference('CURRENT')"
          >
            Reutilizar última serie
          </button>
        </div>
        <div v-if="previousSet">
          <p>
            <strong>{{ previousReference?.sessionLabel }}</strong> · serie
            {{ previousSet.setNumber }}<br />{{
              previousSet.repetitions ?? "Sin"
            }}
            repeticiones · {{ previousSet.load ?? "Sin carga" }}
            {{ previousSet.loadUnit ?? "(unidad desconocida)"
            }}<span v-if="previousSet.rpe != null">
              · RPE {{ previousSet.rpe }} de referencia</span
            >
          </p>
          <button
            class="secondary-button"
            type="button"
            :disabled="!actualValuesToCopy(previousSet)"
            @click="copyReference('PREVIOUS')"
          >
            Usar carga y repeticiones anteriores
          </button>
          <p v-if="!actualValuesToCopy(previousSet)" class="field-hint">
            Referencia incompleta: indica los resultados y su unidad.
          </p>
        </div>
      </div>
      <div v-if="hasResults" class="quick-set-fields">
        <div>
          <label class="field-label" :for="id + '-load'">Carga utilizada</label
          ><input
            :id="id + '-load'"
            v-model="form.load"
            class="form-control"
            inputmode="decimal"
            placeholder="Ej. 77.5"
            required
          />
        </div>
        <div>
          <label class="field-label" :for="id + '-unit'">Unidad real</label
          ><select
            :id="id + '-unit'"
            v-model="form.loadUnit"
            class="form-control"
          >
            <option value="">Unidad conocida</option>
            <option value="KG">kg</option>
            <option value="LB">lb</option>
          </select>
        </div>
        <div>
          <label class="field-label" :for="id + '-reps'"
            >Repeticiones realizadas</label
          ><input
            :id="id + '-reps'"
            v-model="form.repetitions"
            class="form-control"
            type="number"
            inputmode="numeric"
            min="0"
            max="10000"
            step="1"
            required
          />
        </div>
        <div>
          <label class="field-label" :for="id + '-rpe'"
            >RPE real <span class="field-hint">opcional</span></label
          ><input
            :id="id + '-rpe'"
            v-model="form.rpe"
            class="form-control"
            type="number"
            inputmode="decimal"
            min="0"
            max="10"
            step="0.1"
            placeholder="Sin registrar"
          />
        </div>
      </div>
      <p v-if="copiedSource" class="field-hint" role="status">
        Valores copiados de {{ copiedSource }}. El RPE anterior solo es una
        referencia.
      </p>
      <label v-if="copiedSource && hasResults" class="quick-set-confirm"
        ><input v-model="confirmCopied" type="checkbox" /> Confirmo que estos
        valores corresponden a la serie que he realizado.</label
      >
      <details
        class="quick-set-options"
        :open="Boolean(initial && (!initial.status || !initial.kind))"
      >
        <summary>
          {{
            initial
              ? "Tipo, estado, número y notas"
              : "Calentamiento, otra clasificación o notas"
          }}
        </summary>
        <div class="plan-form-grid">
          <div>
            <label class="field-label" :for="id + '-number'"
              >Número de serie</label
            ><input
              :id="id + '-number'"
              v-model="form.setNumber"
              class="form-control"
              type="number"
              min="1"
              max="1000"
              step="1"
              required
            />
          </div>
          <div>
            <label class="field-label" :for="id + '-kind'">Tipo</label
            ><select
              :id="id + '-kind'"
              v-model="form.kind"
              class="form-control"
            >
              <option value="">Selecciona un tipo</option>
              <option value="WORK">Trabajo</option>
              <option value="WARMUP">Calentamiento</option>
            </select>
          </div>
          <div>
            <label class="field-label" :for="id + '-status'">Estado</label
            ><select
              :id="id + '-status'"
              v-model="form.status"
              class="form-control"
            >
              <option value="">
                Clasifica explícitamente la serie histórica
              </option>
              <option value="COMPLETED">Completada</option>
              <option value="INCOMPLETE">Incompleta</option>
              <option value="FAILED">Intento fallido · 0 repeticiones</option>
              <option value="PENDING">Pendiente · sin resultados</option>
              <option value="SKIPPED">Omitida · sin resultados</option>
            </select>
          </div>
        </div>
        <label class="field-label" :for="id + '-notes'">Notas de la serie</label
        ><textarea
          :id="id + '-notes'"
          v-model="form.notes"
          class="form-control"
          maxlength="4000"
          rows="2"
        />
      </details>
      <label v-if="clearsResults" class="quick-set-confirm"
        ><input v-model="confirmClear" type="checkbox" /> Confirmo retirar los
        valores registrados de esta serie.</label
      >
    </fieldset>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <p v-if="submitted && error" class="field-hint">
      Reintentar conserva el mismo identificador y los mismos datos.
    </p>
    <div class="plan-actions">
      <button class="primary-button" type="submit" :disabled="pending || busy">
        {{
          pending
            ? "Guardando…"
            : submitted
              ? "Reintentar"
              : initial
                ? "Guardar cambios"
                : "Guardar serie"
        }}</button
      ><button
        class="text-button"
        type="button"
        :disabled="pending"
        @click="emit('cancel')"
      >
        Cerrar
      </button>
    </div>
  </form>
</template>

<style scoped>
.quick-set-form {
  margin-block: 1rem;
}
.quick-set-form h4 {
  margin: 0;
}
.quick-set-form fieldset {
  min-width: 0;
}
.quick-set-fields {
  display: grid;
  grid-template-columns:
    minmax(0, 1.2fr) minmax(5rem, 0.8fr) minmax(0, 1.2fr)
    minmax(0, 1fr);
  gap: 0.75rem;
}
.quick-set-fields > div {
  min-width: 0;
}
.quick-set-references {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1rem;
}
.quick-set-references > div {
  min-width: 0;
  flex: 1 1 15rem;
}
.quick-set-references p {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.quick-set-options {
  margin-block: 0.75rem;
}
.quick-set-options summary {
  cursor: pointer;
  min-height: 44px;
  display: list-item;
  align-content: center;
}
.quick-set-confirm {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 44px;
  line-height: 1.5;
  margin-top: 0.75rem;
}
.quick-set-confirm input {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--color-primary);
}
.quick-set-form button,
.quick-set-fields .form-control {
  min-height: 44px;
}
@media (max-width: 640px) {
  .quick-set-fields {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .quick-set-references {
    display: grid;
  }
}
</style>
