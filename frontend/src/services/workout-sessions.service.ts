import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

export const workoutStatuses = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'El identificador no es válido.')
const date = z.iso.datetime({ offset: true })
const notes = z.string().max(4000, 'Las notas admiten hasta 4000 caracteres.').nullable().optional()
export const createWorkoutSchema = z.object({ id: uuid, trainingPlanId: uuid.optional(), planWeekId: uuid.optional(), notes }).strict()
  .refine(value => Boolean(value.trainingPlanId) === Boolean(value.planWeekId), 'Selecciona un plan y una semana juntos.')
export const addWorkoutExerciseSchema = z.object({ id: uuid, exerciseId: uuid, notes }).strict()
export const workoutQuerySchema = z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).max(1000000).default(0), status: z.enum(workoutStatuses).optional(), trainingPlanId: uuid.optional() }).strict()
export const workoutSummarySchema = z.object({
  id: uuid, status: z.enum(workoutStatuses), startedAt: date.nullable(), finishedAt: date.nullable(), notes: z.string().nullable(), createdAt: date, updatedAt: date,
  trainingPlan: z.object({ id: uuid, name: z.string() }).strict().nullable(), planWeek: z.object({ id: uuid, weekNumber: z.number().int() }).strict().nullable(), exerciseCount: z.number().int().nonnegative(),
}).strict()
export const workoutSchema = workoutSummarySchema.extend({ exercises: z.array(z.object({
  id: uuid, orderInSession: z.number().int().positive(), notes: z.string().nullable(),
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
export const workoutSessionsService = {
  async list(query: WorkoutQuery = {}, signal?: AbortSignal) { const { data } = await api.get<unknown>(path, { params: workoutQuerySchema.parse(query), signal }); return workoutPageSchema.parse(data) },
  async get(id: string, signal?: AbortSignal): Promise<Workout> { const { data } = await api.get<unknown>(resourcePath(id), { signal }); return workoutSchema.parse(data) },
  async create(input: CreateWorkout): Promise<Workout> { const { data } = await api.post<unknown>(path, createWorkoutSchema.parse(input)); return workoutSchema.parse(data) },
  async addExercise(id: string, input: AddWorkoutExercise): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/exercises`, addWorkoutExerciseSchema.parse(input)); return workoutSchema.parse(data) },
  async start(id: string): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/start`, {}); return workoutSchema.parse(data) },
  async complete(id: string): Promise<Workout> { const { data } = await api.post<unknown>(`${resourcePath(id)}/complete`, {}); return workoutSchema.parse(data) },
}
export function workoutStatusLabel(status: WorkoutSummary['status']): string { return { PLANNED: 'Planificada', IN_PROGRESS: 'En progreso', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada' }[status] }
export function workoutDate(value: string | null): string { return value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin registrar' }
export function workoutErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof InvalidWorkoutIdError) return 'El identificador de la sesión no es válido.'
  if (error instanceof z.ZodError) return 'La respuesta no tiene el formato esperado. Comprueba la sesión antes de iniciar otra.'
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'No se pudo confirmar la operación. Revisa tu conexión y reintenta la misma solicitud.'
  switch (error.response.status) {
    case 400: return 'Revisa los datos. El plan y la semana deben seleccionarse juntos.'
    case 401: return 'Tu sesión de acceso expiró. Inicia sesión de nuevo.'
    case 403: return 'No tienes permiso para realizar esta operación.'
    case 404: return 'No se encontró la sesión o alguno de los recursos seleccionados, o no tienes acceso.'
    case 409: return 'La sesión o el plan no admiten este cambio, el ejercicio no está disponible o la solicitud ya se usó con otros datos. Actualiza el detalle para comprobarlo.'
    default: return error.response.status >= 500 ? 'El servicio de entrenamientos no está disponible. Reintenta la misma solicitud más tarde.' : fallback
  }
}
