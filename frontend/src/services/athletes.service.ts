import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

import { athleteProfileSchema, bodyMeasurementSchema, updateAthleteRequestSchema, createMeasurementRequestSchema } from '../schemas/athletes.schema'
import type { AthleteProfile, BodyMeasurement, UpdateAthleteRequest, CreateMeasurementRequest } from '../types/athletes'
export { measurementUnitSchema, athleteProfileSchema, bodyMeasurementSchema, updateAthleteRequestSchema, createMeasurementRequestSchema } from '../schemas/athletes.schema'

export type { MeasurementUnit, AthleteProfile, BodyMeasurement, UpdateAthleteRequest, CreateMeasurementRequest } from '../types/athletes'

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
