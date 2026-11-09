import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

export const workoutStatuses = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'El identificador no es válido.')
const date = z.iso.datetime({ offset: true })
const zoneSchema = z.string().min(1).max(100).refine(value => { try { if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) return false; new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Usa una zona horaria IANA válida.')
const notes = z.string().max(4000, 'Las notas admiten hasta 4000 caracteres.').nullable().optional()
export const createWorkoutSchema = z.object({ scheduledActivityId: uuid.optional(), id: uuid, performedOn: z.iso.date(), timeZone: zoneSchema, recordingMode: z.enum(['LIVE', 'RETROSPECTIVE']).default('LIVE'), name: z.string().trim().min(1).max(160).optional(), planDayId: uuid.optional(), repeatFromId: uuid.optional(), trainingPlanId: uuid.optional(), planWeekId: uuid.optional(), notes }).strict()
  .refine(value => [value.trainingPlanId, value.planWeekId, value.planDayId].filter(Boolean).length === 0 || [value.trainingPlanId, value.planWeekId, value.planDayId].every(Boolean), 'Selecciona plan, semana y día juntos.').refine(value => !value.repeatFromId || value.repeatFromId !== value.id && !value.trainingPlanId && !value.planWeekId && !value.planDayId, 'Repetir crea una sesión independiente.')
const targetFields = { targetSets: z.number().int().min(1).max(1000).nullable(), targetRepsMin: z.number().int().min(1).max(10000).nullable(), targetRepsMax: z.number().int().min(1).max(10000).nullable(), targetLoad: z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'La carga admite hasta tres decimales.').nullable(), targetLoadUnit: z.enum(['KG', 'LB']).nullable(), targetRpe: z.number().min(0).max(10).refine(value => Number(value.toFixed(1)) === value, 'RPE admite un decimal.').nullable() }
const rangeValid = (value: { targetRepsMin?: number | null; targetRepsMax?: number | null }) => value.targetRepsMin == null && value.targetRepsMax == null || value.targetRepsMin != null && value.targetRepsMax != null && value.targetRepsMin <= value.targetRepsMax
export const workoutTargetsSchema = z.object(targetFields).strict().refine(rangeValid, 'Indica un rango completo con mínimo menor o igual al máximo.')
export const editWorkoutTargetsSchema = z.object({ ...targetFields, notes: z.string().max(4000).nullable() }).strict().refine(rangeValid, 'Indica un rango completo con mínimo menor o igual al máximo.')
export type WorkoutTargets = z.infer<typeof workoutTargetsSchema>
export type WorkoutTargetsInput = z.infer<typeof editWorkoutTargetsSchema>
const exerciseIdentitySchema = z.object({ id: uuid, name: z.string(), equipment: z.string(), muscleGroup: z.string() }).strict()
const originalSchema = z.object({ source: z.object({ kind: z.enum(['PLAN_DAY', 'SESSION', 'FREE']), id: uuid.nullable(), plan: z.object({ id: uuid, name: z.string() }).strict().optional(), week: z.object({ id: uuid, weekNumber: z.number().int() }).strict().optional(), day: z.object({ id: uuid, name: z.string(), weekday: z.number().int().min(1).max(7).nullable() }).strict().optional() }).strict(), exercise: exerciseIdentitySchema, targets: workoutTargetsSchema, position: z.number().int().positive(), notes: z.string().nullable() }).strict()
const sourceSchema = z.object({ schedule: z.object({id:uuid,scheduledOn:z.iso.date(),timeZone:zoneSchema}).strict().optional(), kind: z.enum(['PLAN_DAY', 'SESSION', 'FREE']), plan: z.object({ id: uuid, name: z.string() }).strict().nullable(), week: z.object({ id: uuid, weekNumber: z.number().int() }).strict().nullable(), day: z.object({ id: uuid, name: z.string(), weekday: z.number().int().nullable() }).strict().nullable(), session: z.object({ id: uuid, name: z.string().nullable() }).strict().nullable() }).strict()
export const addWorkoutExerciseSchema = z.object({ ...z.object(targetFields).partial().shape, id: uuid, exerciseId: uuid, notes, expectedVersion: z.number().int().nonnegative().default(0), replacesWorkoutExerciseId: uuid.optional() }).strict()
export const workoutQuerySchema = z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).max(1000000).default(0), planWeekId:uuid.optional(), planDayId: uuid.optional(), scheduledActivityId: uuid.optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), status: z.enum(workoutStatuses).optional(), trainingPlanId: uuid.optional() }).strict()
export const workoutSummarySchema = z.object({
  scheduledActivityId: uuid.nullable().optional(),
  actualSetCount: z.number().int().nonnegative().optional(), completedSetCount: z.number().int().nonnegative().optional(), sourceSnapshot: sourceSchema.nullable().optional(), id: uuid, performedOn: date.nullable().optional(), timeZone: zoneSchema.nullable().optional(), recordingMode: z.enum(['LIVE','RETROSPECTIVE']).nullable().optional(), name: z.string().nullable().optional(), version: z.number().int().nonnegative().optional(), completedAt: date.nullable().optional(), planDay: z.object({ id: uuid, name: z.string(), weekday: z.number().int().nullable() }).strict().nullable().optional(), status: z.enum(workoutStatuses), startedAt: date.nullable(), finishedAt: date.nullable(), notes: z.string().nullable(), createdAt: date, updatedAt: date,
  trainingPlan: z.object({ id: uuid, name: z.string() }).strict().nullable(), planWeek: z.object({ id: uuid, weekNumber: z.number().int() }).strict().nullable(), exerciseCount: z.number().int().nonnegative(),
}).strict()
export const setStatuses = ['PENDING', 'COMPLETED', 'INCOMPLETE', 'FAILED', 'SKIPPED'] as const
export const setRecordSchema = z.object({ id: uuid, setNumber: z.number().int().positive(), load: z.string().nullable(), loadUnit: z.enum(['KG', 'LB']).nullable(), loadKg: z.string().nullable(), repetitions: z.number().int().nullable(), rpe: z.number().nullable(), kind: z.enum(['WARMUP','WORK']).nullable(), status: z.enum(setStatuses).nullable(), isCompleted: z.boolean(), notes: z.string().nullable(), recordedAt: date, version: z.number().int().nonnegative() }).strict()
export const setInputSchema = z.object({ setNumber: z.number().int().min(1).max(1000), load: z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'La carga admite hasta tres decimales.').nullable().optional(), loadUnit: z.enum(['KG','LB']).nullable().optional(), repetitions: z.number().int().min(0).max(10000).nullable().optional(), rpe: targetFields.targetRpe.optional(), status: z.enum(setStatuses), kind: z.enum(['WARMUP','WORK']), notes }).strict().superRefine((value, context) => {
  const pending = ['PENDING','SKIPPED'].includes(value.status)
  if (pending && [value.load,value.loadUnit,value.repetitions,value.rpe].some(item => item != null)) context.addIssue({code:'custom',message:'Las series pendientes u omitidas no contienen resultados.'})
  if (!pending && (value.load == null || value.loadUnit == null || value.repetitions == null)) context.addIssue({code:'custom',message:'Indica carga, unidad y repeticiones reales.'})
  if (value.status === 'COMPLETED' && !(value.repetitions! > 0) || value.status === 'FAILED' && value.repetitions !== 0) context.addIssue({code:'custom',message:'Una serie completada requiere repeticiones; un intento fallido registra cero.'})
})
export type SetRecord = z.infer<typeof setRecordSchema>
export type SetInput = z.infer<typeof setInputSchema>
export function setStatusLabel(set: { status: SetRecord['status']; isCompleted: boolean }): string { return set.status === null ? (set.isCompleted ? 'Histórica completada' : 'Histórica sin clasificación') : { PENDING:'Pendiente', COMPLETED:'Completada', INCOMPLETE:'Incompleta', FAILED:'Intento fallido', SKIPPED:'Omitida' }[set.status] }
export const workoutSchema = workoutSummarySchema.extend({ exercises: z.array(z.object({
  sets: z.array(setRecordSchema).optional(), original: originalSchema.nullable().optional(), targets: workoutTargetsSchema.optional(), isOmitted: z.boolean().optional(), replacesWorkoutExerciseId: uuid.nullable().optional(), id: uuid, orderInSession: z.number().int().positive(), notes: z.string().nullable(),
  exercise: z.object({ id: uuid, name: z.string(), equipment: z.string(), muscleGroup: z.string() }).strict(),
  prescription: z.object({ id: uuid, targetSets: z.number().int(), targetReps: z.number().int().nullable(), targetRepsMin: z.number().int().nullable().optional(), targetRepsMax: z.number().int().nullable().optional(), targetLoadUnit: z.enum(['KG', 'LB']).nullable().optional(), targetLoad: z.number().nullable(), targetRpe: z.number().nullable(), notes: z.string().nullable() }).strict().nullable(),
}).strict()) })
export const workoutPageSchema = z.object({ items: z.array(workoutSummarySchema), total: z.number().int().nonnegative(), limit: z.number().int().min(1).max(100), offset: z.number().int().nonnegative() }).strict()
export type Workout = z.infer<typeof workoutSchema>
export type WorkoutSummary = z.infer<typeof workoutSummarySchema>
export type WorkoutQuery = z.input<typeof workoutQuerySchema>
export type CreateWorkout = z.infer<typeof createWorkoutSchema>
export type AddWorkoutExercise = z.infer<typeof addWorkoutExerciseSchema>
class InvalidWorkoutIdError extends Error {}
const path = '/workout-sessions'
function resourcePath(id: string) { if (!uuid.safeParse(id).success) throw new InvalidWorkoutIdError(); return `${path}/${id}` }
const suggestionSchema = z.object({ performedOn: z.iso.date(), timeZone: z.string(), resolution: z.enum(['SINGLE', 'MULTIPLE', 'NONE']), candidates: z.array(z.object({ scheduledActivityId:uuid.optional(), trainingPlanId: uuid, planWeekId: uuid, planDayId: uuid, planName: z.string(), weekNumber: z.number().int(), name: z.string() }).strict()) }).strict()
export type WorkoutSuggestion = z.infer<typeof suggestionSchema>['candidates'][number]
export { localTrainingDate } from '../utils/dates'
const versionSchema = z.number().int().nonnegative()
export const updateWorkoutSchema = z.object({ expectedVersion: versionSchema, name: z.string().trim().min(1).max(160).optional(), notes, performedOn: z.iso.date().optional(), timeZone: zoneSchema.optional(), recordingMode: z.enum(['LIVE', 'RETROSPECTIVE']).optional() }).strict()
export type UpdateWorkout = z.infer<typeof updateWorkoutSchema>
export const workoutSessionsService = {
  async createSet(id: string, exerciseId: string, input: SetInput & { id: string; expectedVersion: number }): Promise<Workout> { const { id: setId, expectedVersion, ...values } = input; const { data } = await api.post<unknown>(`${resourcePath(id)}/exercises/${uuid.parse(exerciseId)}/sets`, { ...setInputSchema.parse(values), id: uuid.parse(setId), expectedVersion: versionSchema.parse(expectedVersion) }); return workoutSchema.parse(data) },
  async updateSet(id: string, exerciseId: string, setId: string, input: SetInput & { expectedVersion: number; expectedSetVersion: number }): Promise<Workout> { const { expectedVersion, expectedSetVersion, ...values } = input; const { data } = await api.patch<unknown>(`${resourcePath(id)}/exercises/${uuid.parse(exerciseId)}/sets/${uuid.parse(setId)}`, { ...setInputSchema.parse(values), expectedVersion: versionSchema.parse(expectedVersion), expectedSetVersion: versionSchema.parse(expectedSetVersion) }); return workoutSchema.parse(data) },
  async cancel(id: string, expectedVersion: number): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/cancel`, { expectedVersion: versionSchema.parse(expectedVersion) }); return workoutSchema.parse(data) },
  async update(id: string, input: UpdateWorkout): Promise<Workout> { const { data } = await api.patch<unknown>(resourcePath(id), updateWorkoutSchema.parse(input)); return workoutSchema.parse(data) },
  async updateExercise(id: string, exerciseId: string, input: Partial<WorkoutTargetsInput> & { expectedVersion: number; isOmitted?: boolean }): Promise<Workout> { const parsed = z.object({ ...z.object(targetFields).partial().shape, notes, expectedVersion: versionSchema, isOmitted: z.boolean().optional() }).strict().parse(input); const { data } = await api.patch<unknown>(`${resourcePath(id)}/exercises/${uuid.parse(exerciseId)}`, parsed); return workoutSchema.parse(data) },
  async reorder(id: string, ids: string[], expectedVersion: number): Promise<Workout> { const input = z.object({ ids: z.array(uuid).min(1).max(1000).refine(value => new Set(value).size === value.length), expectedVersion: versionSchema }).parse({ ids, expectedVersion }); const { data } = await api.patch<unknown>(`${resourcePath(id)}/exercises/order`, input); return workoutSchema.parse(data) },
  async importDay(id: string, operationId: string, expectedVersion: number, planDayId: string): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/import-day`, { id: uuid.parse(operationId), planDayId: uuid.parse(planDayId), expectedVersion: versionSchema.parse(expectedVersion) }); return workoutSchema.parse(data) },
  async saveAsDay(id: string, input: { id: string; trainingPlanId: string; planWeekId: string; name: string; position: number; weekday?: number | null }) { const parsed = z.object({ id: uuid, trainingPlanId: uuid, planWeekId: uuid, name: z.string().trim().min(1).max(160), position: z.number().int().min(1).max(1000), weekday: z.number().int().min(1).max(7).nullable().optional() }).strict().parse(input); const { data } = await api.post<unknown>(`${resourcePath(id)}/save-as-plan-day`, parsed); return z.object({ id: uuid, name: z.string(), planWeekId: uuid, trainingPlanId: uuid }).strict().parse(data) },
  async suggestions(performedOn: string, timeZone: string, signal?: AbortSignal) { const { data } = await api.get<unknown>(`${path}/suggestions`, { params: { performedOn: z.iso.date().parse(performedOn), timeZone }, signal }); return suggestionSchema.parse(data) },
  async associate(id: string, input: { trainingPlanId: string; planWeekId: string; planDayId: string; expectedVersion: number }): Promise<Workout> { const { data } = await api.patch<unknown>(`${resourcePath(id)}/association`, z.object({ trainingPlanId: uuid, planWeekId: uuid, planDayId: uuid, expectedVersion: z.number().int().nonnegative() }).strict().parse(input)); return workoutSchema.parse(data) },
  async list(query: WorkoutQuery = {}, signal?: AbortSignal) { const { data } = await api.get<unknown>(path, { params: workoutQuerySchema.parse(query), signal }); return workoutPageSchema.parse(data) },
  async get(id: string, signal?: AbortSignal): Promise<Workout> { const { data } = await api.get<unknown>(resourcePath(id), { signal }); return workoutSchema.parse(data) },
  async create(input: CreateWorkout): Promise<Workout> { const { data } = await api.post<unknown>(path, createWorkoutSchema.parse(input)); return workoutSchema.parse(data) },
  async addExercise(id: string, input: AddWorkoutExercise): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/exercises`, addWorkoutExerciseSchema.parse(input)); return workoutSchema.parse(data) },
  async start(id: string, expectedVersion = 0): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/start`, { expectedVersion }); return workoutSchema.parse(data) },
  async complete(id: string, expectedVersion = 0, confirmWithoutResults = false): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/complete`, { expectedVersion, confirmWithoutResults }); return workoutSchema.parse(data) },
}
export function workoutStatusLabel(status: WorkoutSummary['status']): string { return { PLANNED: 'Planificada', IN_PROGRESS: 'En progreso', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada' }[status] }
export function workoutDate(value: string | null, timeZone?: string | null): string { return value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(value)) : 'Sin registrar' }
export function workoutWriteRejected(error: unknown): boolean { return axios.isAxiosError(error) && [400,403,404,409,422].includes(error.response?.status ?? 0) }
export function workoutErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof InvalidWorkoutIdError) return 'El identificador de la sesión no es válido.'
  if (error instanceof z.ZodError) return 'La respuesta no tiene el formato esperado. Comprueba la sesión antes de iniciar otra.'
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'No se pudo confirmar la operación. Revisa tu conexión y reintenta la misma solicitud.'
  const message = String(error.response.data?.message ?? '')
  switch (error.response.status) {
    case 400:
      if (message.includes('IANA')) return 'Introduce una zona horaria IANA válida.'
      if (message.includes('retrospective')) return 'Un entrenamiento anterior no puede tener una fecha futura.'
      if (message.includes('repetition range')) return 'Indica un rango completo con mínimo menor o igual al máximo.'
      if (message.includes('unit')) return 'Comprueba la carga y su unidad explícita.'
      if (message.includes('executed')) return 'Comprueba los resultados y el estado de la serie.'
      return 'Revisa los datos. Selecciona plan, semana y día juntos y comprueba la fecha y los campos.'
    case 401: return 'Tu sesión de acceso expiró. Inicia sesión de nuevo.'
    case 403: return 'No tienes permiso para realizar esta operación.'
    case 404: return 'No se encontró la sesión o alguno de los recursos seleccionados, o no tienes acceso.'
    case 409:
      if (message.includes('changed')) return 'La sesión cambió en otra operación. Actualiza el detalle antes de volver a editar.'
      if (message.includes('training date')) return 'Revisa la fecha y la zona horaria antes de empezar, o selecciona el registro de un entrenamiento anterior.'
      if (message.includes('editable destination')) return 'Elige una semana de un plan en borrador. Los planes activos no se modifican automáticamente.'
      if (message.includes('objectives are missing')) return 'La sesión no tiene objetivos verificables para todos sus ejercicios. Crea el día manualmente; los resultados no se convertirán en objetivos.'
      if (message.includes('estimates')) return 'Esta serie tiene estimaciones históricas asociadas y no puede modificarse.'
      if (message.includes('actual results')) return 'Este ejercicio ya tiene resultados. Consérvalos y añade otro ejercicio si necesitas cambiar la sesión.'
      if (message.includes('without') || message.includes('at least one')) return 'Confirma expresamente la finalización sin resultados.'
      return 'La sesión o el plan no admiten este cambio, el ejercicio no está disponible o la solicitud ya se usó con otros datos. Actualiza el detalle para comprobarlo.'
    default: return error.response.status >= 500 ? 'El servicio de entrenamientos no está disponible. Reintenta la misma solicitud más tarde.' : fallback
  }
}
