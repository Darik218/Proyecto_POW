import { z } from 'zod'

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
