import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

export const measurementUnitSchema = z.enum(['KG', 'LB'])

const serializedDateSchema = z.string().refine(
  (value) => value.length > 0 && !Number.isNaN(Date.parse(value)),
  'La fecha recibida no es válida.',
)

export const athleteProfileSchema = z.object({
  id: z.string().uuid(),
  birthDate: serializedDateSchema.nullable(),
  preferredUnit: measurementUnitSchema,
  createdAt: serializedDateSchema,
  updatedAt: serializedDateSchema,
})

export const bodyMeasurementSchema = z.object({
  id: z.string().uuid(),
  bodyWeight: z.number().min(0.001).max(9999.999),
  measuredAt: serializedDateSchema,
  notes: z.string().nullable(),
})

export const updateAthleteRequestSchema = z
  .object({
    birthDate: z.union([z.iso.date(), z.null()]).optional(),
    preferredUnit: measurementUnitSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar.')

export const createMeasurementRequestSchema = z
  .object({
    bodyWeight: z
      .number()
      .min(0.001, 'El peso mínimo es 0,001.')
      .max(9999.999, 'El peso máximo es 9999,999.')
      .refine(
        (value) => (String(value).split('.')[1]?.length ?? 0) <= 3,
        'El peso admite hasta tres decimales.',
      ),
    measuredAt: z.iso.date(),
    notes: z.string().max(1000, 'La nota admite hasta 1000 caracteres.').optional(),
  })
  .strict()

export type MeasurementUnit = z.infer<typeof measurementUnitSchema>
export type AthleteProfile = z.infer<typeof athleteProfileSchema>
export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>
export type UpdateAthleteRequest = z.infer<typeof updateAthleteRequestSchema>
export type CreateMeasurementRequest = z.infer<typeof createMeasurementRequestSchema>

const athletePath = '/athletes/me'

export const athletesService = {
  async getProfile(): Promise<AthleteProfile> {
    const { data } = await api.get<unknown>(athletePath)
    return athleteProfileSchema.parse(data)
  },

  async updateProfile(input: UpdateAthleteRequest): Promise<AthleteProfile> {
    const payload = updateAthleteRequestSchema.parse(input)
    const { data } = await api.patch<unknown>(athletePath, payload)
    return athleteProfileSchema.parse(data)
  },

  async getMeasurements(): Promise<BodyMeasurement[]> {
    const { data } = await api.get<unknown>(`${athletePath}/measurements`)
    return z.array(bodyMeasurementSchema).parse(data)
  },

  async addMeasurement(input: CreateMeasurementRequest): Promise<BodyMeasurement> {
    const payload = createMeasurementRequestSchema.parse(input)
    const { data } = await api.post<unknown>(`${athletePath}/measurements`, payload)
    return bodyMeasurementSchema.parse(data)
  },
}

export function athleteErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) {
    return 'El servidor devolvió datos con un formato inesperado. Inténtalo de nuevo más tarde.'
  }
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'

  switch (error.response.status) {
    case 400:
      return 'El servidor no aceptó los datos. Revísalos e inténtalo de nuevo.'
    case 401:
      return 'Tu sesión expiró o ya no está disponible. Inicia sesión de nuevo.'
    case 403:
      return 'No tienes permiso para realizar esta operación.'
    case 404:
      return 'No se encontró el perfil del atleta.'
    case 429:
      return 'Has realizado muchas solicitudes. Espera un momento e inténtalo de nuevo.'
    default:
      return error.response.status >= 500
        ? 'El servicio no está disponible en este momento. Inténtalo de nuevo más tarde.'
        : fallback
  }
}
