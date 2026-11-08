import { z } from 'zod'
import { api } from './api'
const uuid = z.uuidv4()
const dayTemplate = z
  .object({
    name: z.string().trim().min(1,'Escribe el nombre del día.').max(160,'El nombre admite hasta 160 caracteres.'),
    weekday: z.number().int().min(1).max(7).nullable(),
  })
  .strict()
export const generateRoutineSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1, 'Escribe el nombre de tu plan.').max(160,'El nombre admite hasta 160 caracteres.'),
    durationWeeks:z.number({error:'Introduce un número de semanas.'}).int('Usa semanas completas.').min(1,'La duración mínima es una semana.').max(52,'La duración máxima es 52 semanas.'),
    frequency:z.number({error:'Introduce un número de días.'}).int('Usa un número entero de días.').min(1,'Selecciona al menos un día.').max(7,'Selecciona hasta siete días iniciales.'),
    startsOn: z.iso.date({error:'Introduce una fecha inicial válida.'}).nullable().optional(),
    timeZone: z.string().min(1).max(100),
    days: z.array(dayTemplate).min(1).max(7),
  })
  .strict()
  .refine(
    (value) => value.days.length === value.frequency,
    'La frecuencia y los días deben coincidir.',
  )
export type GenerateRoutine = z.infer<typeof generateRoutineSchema>
const activitySchema = z
  .object({
    id: uuid,
    planWeekId: uuid.nullable(),
    planDayId: uuid.nullable(),
    originalPlanDayId: uuid.nullable(),
    originalOn: z.iso.datetime({ offset: true }),
    scheduledOn: z.iso.datetime({ offset: true }),
    timeZone: z.string(),
    title: z.string(),
    status: z.enum(['PLANNED', 'RESCHEDULED', 'OMITTED', 'WITHDRAWN', 'REST']),
    version: z.number().int().nonnegative(),
    workouts: z.array(
      z.object({
        id: uuid,
        status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
        performedOn: z.iso.datetime({ offset: true }).nullable(),
      }),
    ),
  })
  .strict()
export type ScheduledActivity = z.infer<typeof activitySchema>
export type PlanningVersion = { id: string; expectedVersion: number }
const resultSchema = z.object({ planId: uuid, dayIds: z.array(uuid).optional() }).strict()
const path = (id: string) => `/routine/plans/${uuid.parse(id)}`
export const routineService = {
  async generate(input: GenerateRoutine) {
    const { data } = await api.post<unknown>('/routine/plans', generateRoutineSchema.parse(input))
    return z.object({ id: uuid }).strict().parse(data)
  },
  async activities(
    query: { weekId?: string; from: string; to: string; timeZone: string },
    signal?: AbortSignal,
  ) {
    const { data } = await api.get<unknown>('/routine/activities', { params: query, signal })
    return z.array(activitySchema).parse(data)
  },
  async createActivity(input: {
    id: string
    planWeekId?: string
    planDayId?: string
    scheduledOn: string
    timeZone: string
    title: string
    status: 'PLANNED' | 'REST'
  }) {
    const { data } = await api.post<unknown>('/routine/activities', input)
    return activitySchema.parse(data)
  },
  async updateActivity(
    id: string,
    input: {
      expectedVersion: number
      scheduledOn?: string
      status?: 'PLANNED' | 'OMITTED' | 'WITHDRAWN'
    },
  ) {
    const { data } = await api.patch<unknown>(`/routine/activities/${uuid.parse(id)}`, input)
    return activitySchema.parse(data)
  },
  async transition(id: string, action: 'activate' | 'archive', input: PlanningVersion) {
    const { data } = await api.post<unknown>(`${path(id)}/${action}`, input)
    return resultSchema.parse(data)
  },
  async newDay(
    id: string,
    input: PlanningVersion & {
      timeZone?:string
      weekId: string
      name: string
      position: number
      weekday: number | null
    },
  ) {
    const { data } = await api.post<unknown>(`${path(id)}/days`, input)
    return resultSchema.parse(data)
  },
  async copy(
    id: string,
    input: PlanningVersion & {
      timeZone?:string
      sourceDayId: string
      mode: 'NEW_DAY' | 'APPEND'
      targetDayId?: string
      weekIds?: string[]
    },
  ) {
    const { data } = await api.post<unknown>(`${path(id)}/copy`, input)
    return resultSchema.parse(data)
  },
  async future(
    id: string,
    dayId: string,
    action: 'future-copy' | 'withdraw',
    input: PlanningVersion & { fromDate: string; timeZone: string },
  ) {
    const { data } = await api.post<unknown>(
      `${path(id)}/days/${uuid.parse(dayId)}/${action}`,
      input,
    )
    return resultSchema.parse(data)
  },
}
export function activityLabel(activity: ScheduledActivity) {
  if (activity.status === 'REST') return 'Descanso voluntario'
  if (activity.workouts.some((w) => w.status === 'COMPLETED')) return 'Completado'
  if (activity.workouts.some((w) => w.status === 'IN_PROGRESS')) return 'En curso'
  return {
    PLANNED: 'Programado · sin registro',
    RESCHEDULED: 'Reprogramado · sin registro',
    OMITTED: 'Omitido voluntariamente',
    WITHDRAWN: 'Retirado de la programación',
  }[activity.status]
}
