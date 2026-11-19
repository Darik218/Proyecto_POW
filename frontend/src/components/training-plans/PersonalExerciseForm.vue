<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from "vue";
import {
  exercisesService,
  exerciseInputSchema,
  exerciseEnums,
  exerciseEnumLabel,
  exerciseErrorMessage,
  type Exercise,
  type MuscleGroup,
} from "../../services/exercises.service";
const emit = defineEmits<{ created: [exercise: Exercise]; cancel: [] }>();
const id = useId(),
  busy = ref(false),
  error = ref(""),
  groups = ref<MuscleGroup[]>([]);
const form = reactive({
  name: "",
  equipment: "",
  equipmentType: "" as (typeof exerciseEnums.equipmentType)[number] | "",
  primaryMuscleGroupKey: "",
  secondaryMuscleGroupKeys: [] as string[],
  description: "",
  aliases: "",
  movementType: "" as (typeof exerciseEnums.movementType)[number] | "",
  difficulty: "" as (typeof exerciseEnums.difficulty)[number] | "",
});
const secondary = computed(() =>
  groups.value.filter((g) => g.key !== form.primaryMuscleGroupKey),
);
async function loadGroups() {
  error.value = "";
  try {
    groups.value = await exercisesService.listMuscleGroups();
  } catch (cause) {
    error.value = exerciseErrorMessage(
      cause,
      "No se pudieron cargar los grupos musculares.",
    );
  }
}
async function save() {
  if (busy.value) return;
  error.value = "";
  const parsed = exerciseInputSchema.safeParse({
    ...form,
    equipment:
      form.equipment.trim() ||
      (form.equipmentType ? exerciseEnumLabel(form.equipmentType) : ""),
    aliases: form.aliases
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
    movementType: form.movementType || null,
    difficulty: form.difficulty || null,
    description: form.description || null,
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    error.value =
      (
        {
          name: "El nombre debe tener entre 2 y 160 caracteres.",
          primaryMuscleGroupKey: "Selecciona un grupo muscular principal.",
          secondaryMuscleGroupKeys:
            "Revisa los grupos secundarios; no repitas el principal.",
          equipment: "Indica el equipamiento (hasta 100 caracteres).",
          aliases: "Usa hasta 20 alias diferentes, de 2 a 160 caracteres.",
          description: "La descripción admite hasta 4000 caracteres.",
        } as Record<string, string>
      )[field] ?? "Revisa los campos del ejercicio.";
    return;
  }
  busy.value = true;
  try {
    emit("created", await exercisesService.create(parsed.data));
  } catch (cause) {
    error.value = exerciseErrorMessage(cause, "No se pudo crear tu ejercicio.");
  } finally {
    busy.value = false;
  }
}
onMounted(() => void loadGroups());
</script>
<template>
  <section class="state-card training-editor personal-training-exercise">
    <h3>Crear ejercicio privado</h3>
    <p class="field-hint">
      Solo tú podrás utilizarlo. Los detalles adicionales son opcionales y
      podrás editarlos después.
    </p>
    <fieldset :disabled="busy">
      <legend class="training-section-legend">Nombre, músculo y equipo</legend>
      <label :for="id + 'name'" class="field-label">Nombre</label
      ><input
        :id="id + 'name'"
        v-model="form.name"
        class="form-control"
        minlength="2"
        maxlength="160"
        required
      />
      <label :for="id + 'group'" class="field-label"
        >Grupo muscular principal</label
      ><select
        :id="id + 'group'"
        v-model="form.primaryMuscleGroupKey"
        class="form-control"
        required
      >
        <option value="">Selecciona un grupo</option>
        <option v-for="group in groups" :key="group.key" :value="group.key">
          {{ group.name }}
        </option>
      </select>
      <label :for="id + 'type'" class="field-label">Equipo</label
      ><select
        :id="id + 'type'"
        v-model="form.equipmentType"
        class="form-control"
        required
      >
        <option value="">Selecciona el equipo</option>
        <option
          v-for="value in exerciseEnums.equipmentType"
          :key="value"
          :value="value"
        >
          {{ exerciseEnumLabel(value) }}
        </option>
      </select>
      <details>
        <summary>Más detalles (opcional)</summary>
        <label :for="id + 'equipment'" class="field-label"
          >Detalle del equipo</label
        ><input
          :id="id + 'equipment'"
          v-model="form.equipment"
          class="form-control"
          maxlength="100"
          placeholder="Por defecto se usa el equipo que seleccionaste"
        />
        <label :for="id + 'secondary'" class="field-label"
          >Grupos secundarios</label
        ><select
          :id="id + 'secondary'"
          v-model="form.secondaryMuscleGroupKeys"
          class="form-control"
          multiple
        >
          <option
            v-for="group in secondary"
            :key="group.key"
            :value="group.key"
          >
            {{ group.name }}
          </option>
        </select>
        <label :for="id + 'description'" class="field-label">Descripción</label
        ><textarea
          :id="id + 'description'"
          v-model="form.description"
          class="form-control"
          maxlength="4000"
        />
        <label :for="id + 'aliases'" class="field-label"
          >Alias (uno por línea)</label
        ><textarea
          :id="id + 'aliases'"
          v-model="form.aliases"
          class="form-control"
        />
        <label :for="id + 'movement'">Tipo de movimiento</label
        ><select
          :id="id + 'movement'"
          v-model="form.movementType"
          class="form-control"
        >
          <option value="">Sin especificar</option>
          <option
            v-for="value in exerciseEnums.movementType"
            :key="value"
            :value="value"
          >
            {{ exerciseEnumLabel(value) }}
          </option>
        </select>
        <label :for="id + 'difficulty'">Dificultad</label
        ><select
          :id="id + 'difficulty'"
          v-model="form.difficulty"
          class="form-control"
        >
          <option value="">Sin especificar</option>
          <option
            v-for="value in exerciseEnums.difficulty"
            :key="value"
            :value="value"
          >
            {{ exerciseEnumLabel(value) }}
          </option>
        </select>
      </details>
    </fieldset>
    <p v-if="error" class="form-error" role="alert">
      {{ error
      }}<button
        v-if="!groups.length"
        type="button"
        class="text-button"
        @click="loadGroups"
      >
        Reintentar grupos
      </button>
    </p>
    <div class="plan-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="busy || !groups.length"
        @click="save"
      >
        {{ busy ? "Creando…" : "Crear y seleccionar" }}</button
      ><button
        type="button"
        class="text-button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Cancelar
      </button>
    </div>
  </section>
</template>
