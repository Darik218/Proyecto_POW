import type { z } from 'zod'
import type {
  measurementUnitSchema,
  athleteProfileSchema,
  bodyMeasurementSchema,
  updateAthleteRequestSchema,
  createMeasurementRequestSchema,
} from '../schemas/athletes.schema'

export type MeasurementUnit = z.infer<typeof measurementUnitSchema>
export type AthleteProfile = z.infer<typeof athleteProfileSchema>
export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>
export type UpdateAthleteRequest = z.infer<typeof updateAthleteRequestSchema>
export type CreateMeasurementRequest = z.infer<typeof createMeasurementRequestSchema>
