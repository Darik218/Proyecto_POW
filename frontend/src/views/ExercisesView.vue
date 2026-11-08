<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  exerciseEnumLabel,
  exerciseErrorMessage,
  exerciseInputSchema,
  exerciseEnums,
  exercisesService,
  type Exercise,
  type ExerciseInput,
  type ExerciseScope,
  type MuscleGroup,
} from '../services/exercises.service'
import { useExercisesCatalog } from '../composables/useExercisesCatalog'

type EnumValue<T extends readonly string[]> = T[number]
type ExerciseForm = {
  aliases:string

  name: string
  primaryMuscleGroupKey: string
  secondaryMuscleGroupKeys: string[]
  equipment: string
  equipmentType: EnumValue<typeof exerciseEnums.equipmentType> | ''
  machineType: EnumValue<typeof exerciseEnums.machineType> | ''
  resistanceType: EnumValue<typeof exerciseEnums.resistanceType> | ''
  movementType: EnumValue<typeof exerciseEnums.movementType> | ''
  movementPattern: EnumValue<typeof exerciseEnums.movementPattern> | ''
  grip: EnumValue<typeof exerciseEnums.grip> | ''
  gripWidth: EnumValue<typeof exerciseEnums.gripWidth> | ''
  bodyPosition: EnumValue<typeof exerciseEnums.bodyPosition> | ''
  laterality: EnumValue<typeof exerciseEnums.laterality> | ''
  movementPlane: EnumValue<typeof exerciseEnums.movementPlane> | ''
  difficulty: EnumValue<typeof exerciseEnums.difficulty> | ''
  oneRmSuitability: EnumValue<typeof exerciseEnums.oneRmSuitability>
  description: string
  instructions: string
}

const {
  exercises, offset, total, scope, loading, errorMessage, pageSize, load, retry, refresh,
  previousPage, nextPage, dispose,
} = useExercisesCatalog()
const groups = ref<MuscleGroup[]>([])
const groupsError = ref('')
const search = ref('')
const primaryGroup = ref('')
const secondaryGroup = ref('')
const equipmentType = ref('')
const movementType = ref('')
const difficulty = ref('')
const showForm = ref(false)
const saving = ref(false)
const retiringId = ref('')
const editingId = ref('')
const formError = ref('')
const notice = ref('')
const form = reactive<ExerciseForm>(emptyForm())
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function emptyForm(): ExerciseForm {
  return {
    aliases:'', name: '', primaryMuscleGroupKey: '', secondaryMuscleGroupKeys: [], equipment: '', equipmentType: '',
    machineType: '', resistanceType: '', movementType: '', movementPattern: '', grip: '', gripWidth: '',
    bodyPosition: '', laterality: '', movementPlane: '', difficulty: '', oneRmSuitability: 'UNDETERMINED',
    description: '', instructions: '',
  }
}

const filters = computed(() => ({
  ...(search.value.trim() ? { search: search.value.trim() } : {}),
  ...(primaryGroup.value ? { primaryMuscleGroupKey: primaryGroup.value } : {}),
  ...(secondaryGroup.value ? { secondaryMuscleGroupKey: secondaryGroup.value } : {}),
  ...(equipmentType.value ? { equipmentType: equipmentType.value as EnumValue<typeof exerciseEnums.equipmentType> } : {}),
  ...(movementType.value ? { movementType: movementType.value as EnumValue<typeof exerciseEnums.movementType> } : {}),
  ...(difficulty.value ? { difficulty: difficulty.value as EnumValue<typeof exerciseEnums.difficulty> } : {}),
}))
const supportsMachineType = computed(() => ['MACHINE', 'SMITH_MACHINE', 'CABLE'].includes(form.equipmentType))
const supportsGrip = computed(() => ['BARBELL', 'EZ_BAR', 'DUMBBELL', 'CABLE', 'KETTLEBELL', 'RESISTANCE_BAND', 'RINGS', 'LANDMINE'].includes(form.equipmentType))
const supportsGripWidth = computed(() => ['BARBELL', 'EZ_BAR', 'CABLE'].includes(form.equipmentType))
const resultRange = computed(() => {
  if (!total.value) return 'Sin resultados'
  return 'Resultados ' + (offset.value + 1) + '–' +
    Math.min(offset.value + exercises.value.length, total.value) + ' de ' + total.value
})

async function loadGroups(): Promise<void> {
  groupsError.value = ''
  try {
    groups.value = await exercisesService.listMuscleGroups()
  } catch (error) {
    groupsError.value = exerciseErrorMessage(error, 'No se pudieron cargar los grupos musculares.')
  }
}

function requestCatalog(nextOffset = 0, force = false): Promise<void> {
  return load(filters.value, scope.value, nextOffset, force)
}

watch([search, primaryGroup, secondaryGroup, equipmentType, movementType, difficulty], () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void requestCatalog(0), search.value ? 250 : 0)
})
watch(() => form.equipmentType, (value) => {
  if (!['MACHINE', 'SMITH_MACHINE', 'CABLE'].includes(value)) form.machineType = ''
  if (!['BARBELL', 'EZ_BAR', 'DUMBBELL', 'CABLE', 'KETTLEBELL', 'RESISTANCE_BAND', 'RINGS', 'LANDMINE'].includes(value)) {
    form.grip = ''
    form.gripWidth = ''
  } else if (!['BARBELL', 'EZ_BAR', 'CABLE'].includes(value)) form.gripWidth = ''
})

function selectScope(nextScope: ExerciseScope): void {
  if (scope.value === nextScope) return
  notice.value = ''
  void load(filters.value, nextScope, 0)
}

function startCreate(): void {
  editingId.value = ''
  Object.assign(form, emptyForm())
  formError.value = ''
  notice.value = ''
  showForm.value = true
  if (scope.value !== 'mine') void load(filters.value, 'mine', 0)
}

function startEdit(exercise: Exercise): void {
  if (!exercise.isOwner || exercise.origin !== 'PERSONAL') return
  editingId.value = exercise.id
  Object.assign(form, {
    aliases:(exercise.aliases??[]).join('\n'),
    name: exercise.name,
    primaryMuscleGroupKey: exercise.primaryMuscleGroup.key,
    secondaryMuscleGroupKeys: exercise.secondaryMuscleGroups.map(({ key }) => key),
    equipment: exercise.equipment,
    equipmentType: exercise.equipmentType,
    machineType: exercise.machineType ?? '',
    resistanceType: exercise.resistanceType ?? '',
    movementType: exercise.movementType ?? '',
    movementPattern: exercise.movementPattern ?? '',
    grip: exercise.grip ?? '',
    gripWidth: exercise.gripWidth ?? '',
    bodyPosition: exercise.bodyPosition ?? '',
    laterality: exercise.laterality ?? '',
    movementPlane: exercise.movementPlane ?? '',
    difficulty: exercise.difficulty ?? '',
    oneRmSuitability: exercise.oneRmSuitability,
    description: exercise.description ?? '',
    instructions: exercise.instructions ?? '',
  } satisfies ExerciseForm)
  formError.value = ''
  notice.value = ''
  showForm.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function toInput(): ExerciseInput {
  return {
    aliases:form.aliases.split('\n').map(v=>v.trim()).filter(Boolean),
    name: form.name,
    primaryMuscleGroupKey: form.primaryMuscleGroupKey,
    secondaryMuscleGroupKeys: form.secondaryMuscleGroupKeys,
    equipment: form.equipment,
    equipmentType: form.equipmentType as EnumValue<typeof exerciseEnums.equipmentType>,
    machineType: form.machineType || null,
    resistanceType: form.resistanceType || null,
    movementType: form.movementType || null,
    movementPattern: form.movementPattern || null,
    grip: form.grip || null,
    gripWidth: form.gripWidth || null,
    bodyPosition: form.bodyPosition || null,
    laterality: form.laterality || null,
    movementPlane: form.movementPlane || null,
    difficulty: form.difficulty || null,
    oneRmSuitability: form.oneRmSuitability,
    description: form.description.trim() || null,
    instructions: form.instructions.trim() || null,
  }
}

function validationMessage(path: string): string {
  const labels: Record<string, string> = {
    name: 'Revisa el nombre del ejercicio.',
    primaryMuscleGroupKey: 'Selecciona el grupo muscular principal.',
    secondaryMuscleGroupKeys: 'Revisa los grupos musculares secundarios.',
    equipment: 'Indica el equipamiento.',
    equipmentType: 'Selecciona el tipo de equipamiento.',
    description: 'La descripción supera la longitud permitida.',
    instructions: 'Las instrucciones superan la longitud permitida.',
  }
  return labels[path] ?? 'Revisa los datos del ejercicio.'
}

async function submitExercise(): Promise<void> {
  if (saving.value) return
  formError.value = ''
  const parsed = exerciseInputSchema.safeParse(toInput())
  if (!parsed.success) {
    formError.value = validationMessage(String(parsed.error.issues[0]?.path[0] ?? ''))
    return
  }
  saving.value = true
  try {
    if (editingId.value) await exercisesService.update(editingId.value, parsed.data)
    else await exercisesService.create(parsed.data)
    notice.value = editingId.value ? 'Los cambios del ejercicio se guardaron.' : 'El ejercicio se agregó a tus ejercicios.'
    showForm.value = false
    editingId.value = ''
    await refresh()
  } catch (error) {
    formError.value = exerciseErrorMessage(error, 'No se pudo guardar el ejercicio.')
  } finally {
    saving.value = false
  }
}

async function retireExercise(exercise: Exercise): Promise<void> {
  if (!exercise.isOwner || exercise.origin !== 'PERSONAL' || retiringId.value) return
  if (!window.confirm('¿Retirar “' + exercise.name + '” de tus ejercicios? No se borrarán referencias históricas.')) return
  retiringId.value = exercise.id
  notice.value = ''
  try {
    await exercisesService.deactivate(exercise.id)
    notice.value = 'El ejercicio se retiró. Sus referencias históricas se conservaron.'
    await requestCatalog(offset.value, true)
    if (exercises.value.length === 0 && offset.value > 0 && total.value > 0) {
      await requestCatalog(Math.max(0, offset.value - pageSize), true)
    }
  } catch (error) {
    errorMessage.value = exerciseErrorMessage(error, 'No se pudo retirar el ejercicio.')
  } finally {
    retiringId.value = ''
  }
}

function closeForm(): void {
  showForm.value = false
  editingId.value = ''
  formError.value = ''
}

onMounted(() => {
  void requestCatalog()
  void loadGroups()
})
onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  dispose()
})
</script>

<template>
  <section class="page-view exercises-page" aria-labelledby="exercises-title">
    <header class="page-heading exercises-heading">
      <div>
        <p class="eyebrow">CATÁLOGO DE MOVIMIENTOS</p>
        <h1 id="exercises-title">Ejercicios</h1>
        <p class="intro">Explora movimientos y variantes, y organiza tus propios ejercicios.</p>
      </div>
      <button class="primary-button" type="button" @click="startCreate">Crear ejercicio</button>
    </header>
    <p v-if="notice" class="notice-card" role="status" aria-live="polite">{{ notice }}</p>

    <section v-if="showForm" class="exercise-form-card" aria-labelledby="exercise-form-title">
      <div class="section-title-row">
        <div>
          <p class="eyebrow">{{ editingId ? 'EJERCICIO PROPIO' : 'NUEVO MOVIMIENTO' }}</p>
          <h2 id="exercise-form-title">{{ editingId ? 'Editar ejercicio' : 'Crear ejercicio' }}</h2>
        </div>
        <button class="text-button" type="button" :disabled="saving" @click="closeForm">Cerrar</button>
      </div>
      <p v-if="groupsError" class="inline-error" role="alert">{{ groupsError }}</p>
      <form class="exercise-form" @submit.prevent="submitExercise">
        <label class="form-field"><span>Nombre <b aria-hidden="true">*</b></span><input v-model="form.name" required minlength="2" maxlength="160" autocomplete="off"></label>
        <label class="form-field"><span>Grupo muscular principal <b aria-hidden="true">*</b></span><select v-model="form.primaryMuscleGroupKey" required><option value="" disabled>Selecciona un grupo</option><option v-for="group in groups" :key="group.key" :value="group.key">{{ group.name }}</option></select></label>
        <label class="form-field"><span>Equipamiento <b aria-hidden="true">*</b></span><input v-model="form.equipment" required maxlength="100" autocomplete="off" placeholder="Barra olímpica y banco"></label>
        <label class="form-field"><span>Tipo de equipamiento <b aria-hidden="true">*</b></span><select v-model="form.equipmentType" required><option value="" disabled>Selecciona un tipo</option><option v-for="item in exerciseEnums.equipmentType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field form-field--wide">
          <span>Grupos musculares secundarios</span>
          <select v-model="form.secondaryMuscleGroupKeys" multiple size="4" aria-describedby="secondary-groups-help">
            <option v-for="group in groups" :key="group.key" :value="group.key" :disabled="group.key === form.primaryMuscleGroupKey">{{ group.name }}</option>
          </select>
          <small id="secondary-groups-help">Puedes seleccionar varios. El grupo principal no puede repetirse aquí.</small>
        </label>
        <label class="form-field"><span>Tipo de resistencia</span><select v-model="form.resistanceType"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.resistanceType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label v-if="supportsMachineType" class="form-field"><span>Tipo de máquina</span><select v-model="form.machineType"><option value="">No aplica</option><option v-for="item in exerciseEnums.machineType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Tipo de movimiento</span><select v-model="form.movementType"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.movementType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Patrón de movimiento</span><select v-model="form.movementPattern"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.movementPattern" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label v-if="supportsGrip" class="form-field"><span>Agarre</span><select v-model="form.grip"><option value="">No aplica</option><option v-for="item in exerciseEnums.grip" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label v-if="supportsGripWidth" class="form-field"><span>Anchura del agarre</span><select v-model="form.gripWidth"><option value="">No aplica</option><option v-for="item in exerciseEnums.gripWidth" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Posición corporal</span><select v-model="form.bodyPosition"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.bodyPosition" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Lateralidad</span><select v-model="form.laterality"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.laterality" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Plano de movimiento</span><select v-model="form.movementPlane"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.movementPlane" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Dificultad</span><select v-model="form.difficulty"><option value="">Sin especificar</option><option v-for="item in exerciseEnums.difficulty" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field"><span>Aptitud para estimar 1RM</span><select v-model="form.oneRmSuitability"><option v-for="item in exerciseEnums.oneRmSuitability" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
        <label class="form-field form-field--wide"><span>Alias (uno por línea, hasta 20)</span><textarea v-model="form.aliases" rows="2"></textarea></label><label class="form-field form-field--wide"><span>Descripción</span><textarea v-model="form.description" rows="3" maxlength="4000"></textarea></label>
        <label class="form-field form-field--wide"><span>Instrucciones técnicas</span><textarea v-model="form.instructions" rows="3" maxlength="4000"></textarea></label>
        <p v-if="formError" class="inline-error form-field--wide" role="alert">{{ formError }}</p>
        <div class="form-actions form-field--wide">
          <button class="primary-button" type="submit" :disabled="saving || groups.length === 0">{{ saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear ejercicio' }}</button>
          <button class="secondary-button" type="button" :disabled="saving" @click="closeForm">Cancelar</button>
        </div>
      </form>
    </section>

    <div class="exercise-scope-tabs" role="tablist" aria-label="Origen de ejercicios">
      <button class="scope-tab" :class="{ 'scope-tab--active': scope === 'global' }" type="button" role="tab" :aria-selected="scope === 'global'" @click="selectScope('global')">Catálogo PULSO</button>
      <button class="scope-tab" :class="{ 'scope-tab--active': scope === 'mine' }" type="button" role="tab" :aria-selected="scope === 'mine'" @click="selectScope('mine')">Mis ejercicios</button>
    </div>
    <section class="exercise-filters" aria-label="Filtros del catálogo">
      <label class="form-field exercise-search"><span>Buscar por nombre o descripción</span><input v-model="search" type="search" maxlength="100" placeholder="Ej. press de banca"></label>
      <label class="form-field"><span>Grupo principal</span><select v-model="primaryGroup"><option value="">Todos</option><option v-for="group in groups" :key="group.key" :value="group.key">{{ group.name }}</option></select></label>
      <label class="form-field"><span>Grupo secundario</span><select v-model="secondaryGroup"><option value="">Todos</option><option v-for="group in groups" :key="group.key" :value="group.key">{{ group.name }}</option></select></label>
      <label class="form-field"><span>Equipamiento</span><select v-model="equipmentType"><option value="">Todos</option><option v-for="item in exerciseEnums.equipmentType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
      <label class="form-field"><span>Movimiento</span><select v-model="movementType"><option value="">Todos</option><option v-for="item in exerciseEnums.movementType" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
      <label class="form-field"><span>Dificultad</span><select v-model="difficulty"><option value="">Todas</option><option v-for="item in exerciseEnums.difficulty" :key="item" :value="item">{{ exerciseEnumLabel(item) }}</option></select></label>
    </section>

    <div v-if="groupsError && !showForm" class="inline-error" role="alert">{{ groupsError }} <button class="text-button" type="button" @click="loadGroups">Reintentar grupos musculares</button></div>
    <div v-if="loading && exercises.length === 0" class="state-card" role="status" aria-live="polite"><p>Cargando ejercicios…</p></div>
    <div v-else-if="errorMessage && exercises.length === 0" class="state-card state-card--error" role="alert">
      <p>{{ errorMessage }}</p><button class="secondary-button" type="button" :disabled="loading" @click="retry">{{ loading ? 'Cargando…' : 'Reintentar' }}</button>
    </div>
    <template v-else>
      <div v-if="errorMessage" class="catalog-error-banner" role="alert"><span>{{ errorMessage }}</span><button class="text-button" type="button" :disabled="loading" @click="retry">Reintentar</button></div>
      <div v-if="loading && exercises.length" class="catalog-loading" role="status" aria-live="polite">Actualizando resultados…</div>
      <div v-if="!loading && total === 0" class="empty-state state-card">
        <span class="empty-state__mark" aria-hidden="true">○</span>
        <strong>{{ scope === 'mine' ? 'Aún no has creado ejercicios' : 'No encontramos ejercicios' }}</strong>
        <p>{{ scope === 'mine' ? 'Crea un ejercicio propio para organizarlo en tus planes.' : 'Prueba con otros filtros o vuelve a intentarlo.' }}</p>
        <button v-if="scope === 'mine'" class="secondary-button" type="button" @click="startCreate">Crear ejercicio</button>
      </div>
      <p v-if="total > 0" class="exercise-result-count">{{ resultRange }}</p>
      <ul v-if="exercises.length" class="exercise-grid" :aria-busy="loading">
        <li v-for="exercise in exercises" :key="exercise.id">
          <article class="exercise-card">
            <div class="exercise-card__heading">
              <h2>{{ exercise.name }}</h2>
              <span class="exercise-origin-badge" :class="exercise.origin === 'PERSONAL' ? 'exercise-origin-badge--personal' : ''">{{ exercise.origin === 'PERSONAL' ? 'Propio' : 'PULSO' }}</span>
            </div>
            <p v-if="exercise.description" class="exercise-card__description">{{ exercise.description }}</p>
            <dl class="exercise-card__meta">
              <div><dt>Grupo principal</dt><dd>{{ exercise.primaryMuscleGroup.name }}</dd></div>
              <div><dt>Equipamiento</dt><dd>{{ exercise.equipment }}</dd></div>
              <div v-if="exercise.secondaryMuscleGroups.length"><dt>Secundarios</dt><dd>{{ exercise.secondaryMuscleGroups.map(({ name }) => name).join(', ') }}</dd></div>
            </dl>
            <div class="exercise-card__actions">
              <RouterLink class="exercise-card__action" :to="{ name: 'exercise-detail', params: { exerciseId: exercise.id } }">Ver detalle</RouterLink>
              <template v-if="exercise.isOwner && exercise.origin === 'PERSONAL'">
                <button class="text-button" type="button" @click="startEdit(exercise)">Editar</button>
                <button class="text-button text-button--danger" type="button" :disabled="retiringId === exercise.id" @click="retireExercise(exercise)">{{ retiringId === exercise.id ? 'Retirando…' : 'Retirar' }}</button>
              </template>
            </div>
          </article>
        </li>
      </ul>
      <nav v-if="total > pageSize" class="catalog-pagination" aria-label="Paginación del catálogo">
        <button class="secondary-button" type="button" :disabled="offset === 0 || loading" @click="previousPage">Anterior</button>
        <span>{{ resultRange }}</span>
        <button class="secondary-button" type="button" :disabled="offset + exercises.length >= total || loading" @click="nextPage">Siguiente</button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.exercises-heading,.section-title-row,.form-actions,.exercise-card__actions{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.exercises-heading{margin-bottom:1.5rem}
.exercise-scope-tabs{display:flex;gap:.55rem;margin:1.25rem 0;border-bottom:1px solid #dce4dc}
.scope-tab{border:0;border-bottom:3px solid transparent;background:transparent;padding:.8rem 1rem;color:#53605a;cursor:pointer;font:inherit}
.scope-tab--active{border-color:#174b3a;color:#174b3a;font-weight:700}
.exercise-filters{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:.8rem;margin-bottom:1.2rem;padding:1rem;border:1px solid #dce4dc;border-radius:16px;background:#fff}
.exercise-search{grid-column:span 2}
.form-field{display:flex;min-width:0;flex-direction:column;gap:.4rem;color:#33413a;font-size:.9rem}
.form-field input,.form-field select,.form-field textarea{box-sizing:border-box;width:100%;min-height:2.75rem;border:1px solid #cbd6ce;border-radius:9px;background:#fff;padding:.65rem .75rem;color:#20332a;font:inherit}
.form-field select[multiple]{min-height:7rem}
.form-field input:focus-visible,.form-field select:focus-visible,.form-field textarea:focus-visible,.text-button:focus-visible,.scope-tab:focus-visible{outline:3px solid #a4c83d;outline-offset:2px}
.exercise-form-card{margin:1.2rem 0;border:1px solid #dce4dc;border-radius:18px;background:#fff;padding:1.25rem;box-shadow:0 8px 28px #172f2410}
.exercise-form-card h2{margin:.15rem 0 0;color:#173e31}
.exercise-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin-top:1rem}
.form-field--wide{grid-column:1/-1}
.form-field small{color:#637068}
.form-actions{justify-content:flex-start}
.text-button{border:0;background:transparent;color:#175540;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:3px}
.text-button:disabled{cursor:wait;opacity:.65}
.text-button--danger{color:#97483e}
.inline-error{color:#8d382d}
.notice-card{border:1px solid #bcd4a3;border-radius:12px;background:#f2f8e9;padding:.85rem 1rem;color:#234a32}
.catalog-error-banner{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.8rem 0;border-radius:10px;background:#fff1ee;padding:.8rem 1rem;color:#8d382d}
.exercise-result-count{margin:.8rem 0;color:#56635b;font-size:.92rem}
.exercise-origin-badge{flex:0 0 auto;border-radius:999px;background:#e9f2df;padding:.32rem .55rem;color:#285639;font-size:.75rem;font-weight:700}
.exercise-origin-badge--personal{background:#e9edf8;color:#394a75}
.exercise-card__actions{justify-content:flex-start;flex-wrap:wrap;margin-top:auto;padding-top:1rem}
.exercise-card{display:flex;height:100%;flex-direction:column}
.exercise-card__heading{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}
.exercise-card__heading h2{min-width:0}
.catalog-loading{color:#526159}
@media(max-width:900px){.exercise-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.exercise-search{grid-column:1/-1}}
@media(max-width:600px){.exercises-heading{align-items:flex-start;flex-direction:column}.exercise-filters,.exercise-form{grid-template-columns:1fr}.exercise-search,.form-field--wide{grid-column:1}.exercise-form-card{padding:1rem}.catalog-error-banner{align-items:flex-start;flex-direction:column}}
</style>
