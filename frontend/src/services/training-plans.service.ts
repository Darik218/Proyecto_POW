import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'El identificador no es válido.')
const name = z.string().trim().min(1, 'Escribe el nombre del plan.').max(160, 'El nombre admite hasta 160 caracteres.')
const date = z.iso.date({ error: 'Introduce una fecha válida.' })
const timestamp = z.iso.datetime({ offset: true })
const integer = (max: number) => z.number().int('Introduce un número entero.').min(1, 'El valor mínimo es 1.').max(max, `El valor máximo es ${max}.`)
const decimal = (max: number, places: number) => z.number().min(0, 'El valor mínimo es 0.').max(max, `El valor máximo es ${max}.`)
  .refine((value) => Number(value.toFixed(places)) === value, `Se admiten hasta ${places} decimales.`)
const objective = z.string().trim().min(1, 'Escribe un objetivo o deja el campo vacío.').max(4000, 'El objetivo admite hasta 4000 caracteres.')
const notes = z.string().max(4000, 'Las notas admiten hasta 4000 caracteres.')
const planFields = { name, startsOn: date, endsOn: date.nullable().optional() }
const validDateRange = (value: { startsOn?: string; endsOn?: string | null }) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn
const notEmpty = (value: object) => Object.keys(value).length > 0

export const createTrainingPlanSchema = z.object(planFields).strict().refine(validDateRange, {
  path: ['endsOn'], message: 'La fecha final no puede ser anterior a la inicial.',
})
export const updateTrainingPlanSchema = z.object(planFields).partial().strict()
  .refine(notEmpty, 'Indica al menos un cambio.')
  .refine(validDateRange, { path: ['endsOn'], message: 'La fecha final no puede ser anterior a la inicial.' })
export const createPlanWeekSchema = z.object({ weekNumber: integer(520), objective: objective.optional() }).strict()
export const updatePlanWeekSchema = z.object({ weekNumber: integer(520).optional(), objective: objective.nullable().optional() }).strict()
  .refine(notEmpty, 'Indica al menos un cambio.')
const prescriptionFields = {
  position: integer(1000), targetSets: integer(1000), targetReps: integer(10000),
  targetRpe: decimal(10, 1).nullable().optional(), targetLoad: decimal(99999.999, 3).nullable().optional(),
  notes: notes.nullable().optional(),
}
export const createPrescriptionSchema = z.object({ exerciseId: uuid, ...prescriptionFields }).strict()
export const updatePrescriptionSchema = z.object(prescriptionFields).partial().strict().refine(notEmpty, 'Indica al menos un cambio.')

export const trainingPlanSchema = z.object({
  id: uuid, name: z.string(), startsOn: timestamp, endsOn: timestamp.nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']), createdAt: timestamp, updatedAt: timestamp,
}).strict()
export const planWeekSchema = z.object({ id: uuid, weekNumber: z.number().int(), objective: z.string().nullable() }).strict()
export const prescriptionSchema = z.object({
  id: uuid, position: z.number().int(), targetSets: z.number().int(), targetReps: z.number().int().nullable(),
  targetRepsMin: z.number().int().nullable().optional(), targetRepsMax: z.number().int().nullable().optional(), targetLoadUnit: z.enum(['KG', 'LB']).nullable().optional(),
  targetRpe: z.number().nullable(), targetLoad: z.number().nullable(), notes: z.string().nullable(),
  // Writes also return primaryMuscleGroup; normalize to the public detail fields.
  exercise: z.object({ id: uuid, name: z.string(), muscleGroup: z.string(), equipment: z.string(), description: z.string().nullable() }),
}).strict()
export const dailyPrescriptionSchema = prescriptionSchema.extend({
  targetRepsMin: integer(10000), targetRepsMax: integer(10000), targetLoadUnit: z.enum(['KG', 'LB']).nullable(), hasHistory: z.boolean(),
}).refine(value => value.targetRepsMin <= value.targetRepsMax && (value.targetRepsMin === value.targetRepsMax ? value.targetReps === value.targetRepsMin : value.targetReps === null), 'Rango de repeticiones incoherente.')
export const planDaySchema = z.object({ id: uuid, name: z.string(), position: integer(1000), weekday: integer(7).nullable(), hasHistory: z.boolean(), exercises: z.array(dailyPrescriptionSchema) }).strict()
export const planningWeekSchema = planWeekSchema.extend({ days: z.array(planDaySchema), pendingExercises: z.array(dailyPrescriptionSchema) })
export const planningSchema = trainingPlanSchema.extend({ weeks: z.array(planningWeekSchema) })
export const createPlanDaySchema = z.object({ name: z.string().trim().min(1, 'Escribe el nombre del día.').max(160, 'El nombre admite hasta 160 caracteres.'), position: integer(1000), weekday: integer(7).nullable().optional() }).strict()
export const updatePlanDaySchema = createPlanDaySchema.omit({ position: true }).partial().refine(notEmpty, 'Indica al menos un cambio.')
const dailyFields = { ...prescriptionFields, targetReps: integer(10000).nullable().optional(), targetRepsMin: integer(10000), targetRepsMax: integer(10000), targetLoadUnit: z.enum(['KG', 'LB']).nullable().optional() }
const validReps = (value: { targetReps?: number | null; targetRepsMin?: number; targetRepsMax?: number }) => {
  if (value.targetRepsMin === undefined && value.targetRepsMax === undefined) return true
  return value.targetRepsMin !== undefined && value.targetRepsMax !== undefined && value.targetRepsMin <= value.targetRepsMax && (value.targetReps == null || value.targetReps === value.targetRepsMin && value.targetReps === value.targetRepsMax)
}
export const createDailyPrescriptionSchema = z.object({ exerciseId: uuid, ...dailyFields }).strict().refine(validReps, 'Indica un rango completo: mínimo menor o igual al máximo.')
  .refine(value => value.targetLoad == null || value.targetLoadUnit != null, 'Selecciona la unidad de la carga.')
  .refine(value => value.targetLoad != null || value.targetLoadUnit == null, 'La unidad requiere una carga.')
export const updateDailyPrescriptionSchema = z.object(dailyFields).partial().strict().refine(notEmpty, 'Indica al menos un cambio.').refine(validReps, 'Indica un rango completo: mínimo menor o igual al máximo.')
export type Planning = z.infer<typeof planningSchema>
export type PlanningWeek = z.infer<typeof planningWeekSchema>
export type PlanDay = z.infer<typeof planDaySchema>
export type DailyPrescription = z.infer<typeof dailyPrescriptionSchema>
export type CreatePlanDay = z.infer<typeof createPlanDaySchema>
export type UpdatePlanDay = z.infer<typeof updatePlanDaySchema>
export type CreateDailyPrescription = z.infer<typeof createDailyPrescriptionSchema>
export type UpdateDailyPrescription = z.infer<typeof updateDailyPrescriptionSchema>
export function repsLabel(value: { targetReps: number | null; targetRepsMin?: number | null; targetRepsMax?: number | null }): string {
  return value.targetReps !== null ? String(value.targetReps) : `${value.targetRepsMin ?? '?'}–${value.targetRepsMax ?? '?'}`
}
export function weekdayLabel(weekday: number | null): string { return weekday === null ? 'Flexible' : ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][weekday - 1] ?? 'Sin asignar' }
export const trainingPlanDetailSchema = trainingPlanSchema.extend({
  weeks: z.array(planWeekSchema.extend({ exercises: z.array(prescriptionSchema) })),
})

export type TrainingPlan = z.infer<typeof trainingPlanSchema>
export type TrainingPlanDetail = z.infer<typeof trainingPlanDetailSchema>
export type PlanWeek = TrainingPlanDetail['weeks'][number]
export type Prescription = z.infer<typeof prescriptionSchema>
export type CreateTrainingPlan = z.infer<typeof createTrainingPlanSchema>
export type UpdateTrainingPlan = z.infer<typeof updateTrainingPlanSchema>
export type CreatePlanWeek = z.infer<typeof createPlanWeekSchema>
export type UpdatePlanWeek = z.infer<typeof updatePlanWeekSchema>
export type CreatePrescription = z.infer<typeof createPrescriptionSchema>
export type UpdatePrescription = z.infer<typeof updatePrescriptionSchema>

const path = '/training-plans'
class InvalidPlanIdError extends Error {}
function resourceId(id: string): string {
  const parsed = uuid.safeParse(id)
  if (!parsed.success) throw new InvalidPlanIdError('El identificador del recurso no es válido.')
  return parsed.data
}
const planPath = (id: string) => `${path}/${resourceId(id)}`
const weekPath = (planId: string, weekId: string) => `${planPath(planId)}/weeks/${resourceId(weekId)}`

async function planningWrite(method: 'post' | 'patch' | 'delete', url: string, input?: unknown): Promise<Planning> {
  const { data } = await api.request<unknown>({ method, url, ...(input === undefined ? {} : { data: input }) })
  return planningSchema.parse(data)
}
const dayPath = (planId: string, weekId: string, dayId: string) => `${weekPath(planId, weekId)}/days/${resourceId(dayId)}`
const orderSchema = z.object({ ids: z.array(uuid).min(1).max(1000).refine(ids => new Set(ids).size === ids.length, 'No repitas identificadores.') }).strict()
export const trainingPlansService = {
  async getPlanning(id: string, signal?: AbortSignal): Promise<Planning> {
    const { data } = await api.get<unknown>(`${planPath(id)}/planning`, { signal })
    return planningSchema.parse(data)
  },
  async createDay(planId: string, weekId: string, input: CreatePlanDay) {
    return planningWrite('post', `${weekPath(planId, weekId)}/days`, createPlanDaySchema.parse(input))
  },
  async updateDay(planId: string, weekId: string, dayId: string, input: UpdatePlanDay) {
    return planningWrite('patch', dayPath(planId, weekId, dayId), updatePlanDaySchema.parse(input))
  },
  async reorderDays(planId: string, weekId: string, ids: string[]) {
    return planningWrite('patch', `${weekPath(planId, weekId)}/days/order`, orderSchema.parse({ ids }))
  },
  async copyDay(planId: string, weekId: string, dayId: string, position: number) {
    return planningWrite('post', `${dayPath(planId, weekId, dayId)}/copy`, z.object({ position: integer(1000) }).parse({ position }))
  },
  async copyWeek(planId: string, weekId: string, weekNumber: number) {
    return planningWrite('post', `${weekPath(planId, weekId)}/copy`, createPlanWeekSchema.parse({ weekNumber }))
  },
  async createDailyPrescription(planId: string, weekId: string, dayId: string, input: CreateDailyPrescription) {
    return planningWrite('post', `${dayPath(planId, weekId, dayId)}/exercises`, createDailyPrescriptionSchema.parse(input))
  },
  async updateDailyPrescription(planId: string, weekId: string, dayId: string, id: string, input: UpdateDailyPrescription) {
    return planningWrite('patch', `${dayPath(planId, weekId, dayId)}/exercises/${resourceId(id)}`, updateDailyPrescriptionSchema.parse(input))
  },
  async removeDailyPrescription(planId: string, weekId: string, dayId: string, id: string) {
    return planningWrite('delete', `${dayPath(planId, weekId, dayId)}/exercises/${resourceId(id)}`)
  },
  async reorderExercises(planId: string, weekId: string, dayId: string, ids: string[]) {
    return planningWrite('patch', `${dayPath(planId, weekId, dayId)}/exercises/order`, orderSchema.parse({ ids }))
  },
  async distribute(planId: string, weekId: string, id: string, dayId: string, position: number, copy: boolean) {
    return planningWrite('post', `${weekPath(planId, weekId)}/pending-exercises/${resourceId(id)}/distribute`, z.object({ dayId: uuid, position: integer(1000), copy: z.boolean() }).parse({ dayId, position, copy }))
  },
  async list(signal?: AbortSignal): Promise<TrainingPlan[]> {
    const { data } = await api.get<unknown>(path, { signal })
    return z.array(trainingPlanSchema).parse(data)
  },
  async get(id: string, signal?: AbortSignal): Promise<TrainingPlanDetail> {
    const { data } = await api.get<unknown>(planPath(id), { signal })
    return trainingPlanDetailSchema.parse(data)
  },
  async create(input: CreateTrainingPlan): Promise<TrainingPlan> {
    const { data } = await api.post<unknown>(path, createTrainingPlanSchema.parse(input))
    return trainingPlanSchema.parse(data)
  },
  async update(id: string, input: UpdateTrainingPlan): Promise<TrainingPlan> {
    const { data } = await api.patch<unknown>(planPath(id), updateTrainingPlanSchema.parse(input))
    return trainingPlanSchema.parse(data)
  },
  async createWeek(planId: string, input: CreatePlanWeek) {
    const { data } = await api.post<unknown>(`${planPath(planId)}/weeks`, createPlanWeekSchema.parse(input))
    return planWeekSchema.parse(data)
  },
  async updateWeek(planId: string, weekId: string, input: UpdatePlanWeek) {
    const { data } = await api.patch<unknown>(weekPath(planId, weekId), updatePlanWeekSchema.parse(input))
    return planWeekSchema.parse(data)
  },
  async createPrescription(planId: string, weekId: string, input: CreatePrescription): Promise<Prescription> {
    const { data } = await api.post<unknown>(`${weekPath(planId, weekId)}/exercises`, createPrescriptionSchema.parse(input))
    return prescriptionSchema.parse(data)
  },
  async updatePrescription(planId: string, weekId: string, id: string, input: UpdatePrescription): Promise<Prescription> {
    const { data } = await api.patch<unknown>(`${weekPath(planId, weekId)}/exercises/${resourceId(id)}`, updatePrescriptionSchema.parse(input))
    return prescriptionSchema.parse(data)
  },
}

export function planStatusLabel(status: TrainingPlan['status']): string {
  return { DRAFT: 'Borrador', ACTIVE: 'Activo', COMPLETED: 'Completado', ARCHIVED: 'Archivado' }[status]
}
export function planDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
}
export function trainingPlanErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof InvalidPlanIdError) return error.message
  if (error instanceof z.ZodError) return 'El servidor devolvió datos con un formato inesperado. Vuelve a cargar el plan antes de intentar otro cambio.'
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
  const message = String(error.response.data?.message ?? '')
  switch (error.response.status) {
    case 400: return 'El servidor no aceptó los datos. Revisa los campos del formulario.'
    case 401: return 'Tu sesión expiró. Inicia sesión de nuevo.'
    case 403: return 'No tienes permiso para realizar esta operación.'
    case 404: return 'No se encontró el plan, la semana o el ejercicio, o no tienes acceso.'
    case 409:
      if (message.includes('week with this number')) return 'Ya existe una semana con ese número en el plan.'
      if (message.includes('position in the week')) return 'Ya existe una prescripción en esa posición. Elige otra posición.'
      if (message.includes('training history') || message.includes('historical')) return 'Este recurso tiene historial asociado. Conserva el original y utiliza una copia para la nueva programación.'
      if (message.includes('occupied')) return 'Esa posición o número de semana ya está ocupado. Actualiza el detalle y elige otro.'
      return 'El plan ya no admite este cambio. Actualiza el detalle y comprueba su estado.'
    case 429: return 'Has realizado muchas solicitudes. Espera un momento e inténtalo de nuevo.'
    default: return error.response.status >= 500 ? 'El servicio de planes no está disponible. Inténtalo de nuevo más tarde.' : fallback
  }
}
