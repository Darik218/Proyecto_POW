import axios from 'axios'
import { z } from 'zod'
import { api } from './api'

export const exerciseEnums = {
  equipmentType: ['BARBELL', 'EZ_BAR', 'DUMBBELL', 'MACHINE', 'SMITH_MACHINE', 'CABLE', 'BODYWEIGHT', 'KETTLEBELL', 'RESISTANCE_BAND', 'MEDICINE_BALL', 'RINGS', 'LANDMINE', 'OTHER'],
  machineType: ['SELECTORIZED', 'PLATE_LOADED', 'CONVERGING', 'SMITH', 'CABLE', 'LEVER', 'HACK_SQUAT', 'LEG_PRESS', 'OTHER'],
  resistanceType: ['FREE_WEIGHT', 'BODYWEIGHT', 'WEIGHT_STACK', 'PLATE_LOADED', 'CABLE', 'ELASTIC', 'MEDICINE_BALL', 'ISOMETRIC', 'OTHER'],
  movementType: ['COMPOUND', 'ISOLATION', 'OLYMPIC', 'PLYOMETRIC', 'ISOMETRIC', 'CARRY', 'MOBILITY'],
  movementPattern: ['SQUAT', 'HIP_HINGE', 'LUNGE', 'HORIZONTAL_PUSH', 'VERTICAL_PUSH', 'HORIZONTAL_PULL', 'VERTICAL_PULL', 'ELBOW_FLEXION', 'ELBOW_EXTENSION', 'SHOULDER_ABDUCTION', 'SHOULDER_ROTATION', 'HIP_EXTENSION', 'HIP_ABDUCTION', 'HIP_ADDUCTION', 'KNEE_EXTENSION', 'KNEE_FLEXION', 'CALF_RAISE', 'TRUNK_FLEXION', 'TRUNK_EXTENSION', 'ROTATION', 'ANTI_ROTATION', 'CARRY', 'OLYMPIC_LIFT', 'JUMP', 'OTHER'],
  grip: ['PRONATED', 'SUPINATED', 'NEUTRAL', 'MIXED', 'HOOK', 'STRAPPED', 'NONE', 'VARIABLE'],
  gripWidth: ['NARROW', 'SHOULDER_WIDTH', 'WIDE', 'VARIABLE', 'NOT_APPLICABLE'],
  bodyPosition: ['STANDING', 'SEATED', 'SUPINE', 'PRONE', 'SIDE_LYING', 'KNEELING', 'HALF_KNEELING', 'HANGING', 'QUADRUPED', 'OTHER'],
  laterality: ['UNILATERAL', 'BILATERAL', 'ALTERNATING', 'NOT_APPLICABLE'],
  movementPlane: ['SAGITTAL', 'FRONTAL', 'TRANSVERSE', 'MULTIPLANAR'],
  difficulty: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
  oneRmSuitability: ['SUITABLE', 'NOT_SUITABLE', 'UNDETERMINED'],
} as const

const uuidV4Schema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'El identificador del ejercicio no es un UUID v4 válido.',
)

const muscleGroupSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
}).strict()

export const exerciseSchema = z.object({
  aliases:z.array(z.string()).optional(),
  id: uuidV4Schema,
  name: z.string().min(1),
  description: z.string().nullable(),
  equipment: z.string(),
  equipmentType: z.enum(exerciseEnums.equipmentType),
  machineType: z.enum(exerciseEnums.machineType).nullable(),
  resistanceType: z.enum(exerciseEnums.resistanceType).nullable(),
  movementType: z.enum(exerciseEnums.movementType).nullable(),
  movementPattern: z.enum(exerciseEnums.movementPattern).nullable(),
  grip: z.enum(exerciseEnums.grip).nullable(),
  gripWidth: z.enum(exerciseEnums.gripWidth).nullable(),
  bodyPosition: z.enum(exerciseEnums.bodyPosition).nullable(),
  laterality: z.enum(exerciseEnums.laterality).nullable(),
  movementPlane: z.enum(exerciseEnums.movementPlane).nullable(),
  difficulty: z.enum(exerciseEnums.difficulty).nullable(),
  oneRmSuitability: z.enum(exerciseEnums.oneRmSuitability),
  instructions: z.string().nullable(),
  origin: z.enum(['GLOBAL', 'PERSONAL']),
  isOwner: z.boolean(),
  primaryMuscleGroup: muscleGroupSchema,
  secondaryMuscleGroups: z.array(muscleGroupSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()

export const exercisePageSchema = z.object({
  items: z.array(exerciseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
}).strict()

export const listExercisesQuerySchema = z.object({
  origin:z.enum(['GLOBAL','PERSONAL']).optional(),
  selection:z.enum(['ALL','FEATURED','RECENT']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  search: z.string().trim().max(100).optional(),
  primaryMuscleGroupKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  secondaryMuscleGroupKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  equipmentType: z.enum(exerciseEnums.equipmentType).optional(),
  machineType: z.enum(exerciseEnums.machineType).optional(),
  resistanceType: z.enum(exerciseEnums.resistanceType).optional(),
  movementType: z.enum(exerciseEnums.movementType).optional(),
  movementPattern: z.enum(exerciseEnums.movementPattern).optional(),
  difficulty: z.enum(exerciseEnums.difficulty).optional(),
}).strict()

const exerciseInputObjectSchema = z.object({
  aliases:z.array(z.string().trim().min(2).max(160)).max(20).refine(values=>new Set(values.map(v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())).size===values.length,'Los alias deben ser diferentes, incluso sin tildes.').optional(),
  name: z.string().trim().min(2).max(160),
  primaryMuscleGroupKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  secondaryMuscleGroupKeys: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(12).refine((keys) => new Set(keys).size === keys.length),
  equipment: z.string().trim().min(1).max(100),
  equipmentType: z.enum(exerciseEnums.equipmentType),
  machineType: z.enum(exerciseEnums.machineType).nullable().optional(),
  resistanceType: z.enum(exerciseEnums.resistanceType).nullable().optional(),
  movementType: z.enum(exerciseEnums.movementType).nullable().optional(),
  movementPattern: z.enum(exerciseEnums.movementPattern).nullable().optional(),
  grip: z.enum(exerciseEnums.grip).nullable().optional(),
  gripWidth: z.enum(exerciseEnums.gripWidth).nullable().optional(),
  bodyPosition: z.enum(exerciseEnums.bodyPosition).nullable().optional(),
  laterality: z.enum(exerciseEnums.laterality).nullable().optional(),
  movementPlane: z.enum(exerciseEnums.movementPlane).nullable().optional(),
  difficulty: z.enum(exerciseEnums.difficulty).nullable().optional(),
  oneRmSuitability: z.enum(exerciseEnums.oneRmSuitability).optional(),
  description: z.string().max(4000).nullable().optional(),
  instructions: z.string().max(4000).nullable().optional(),
}).strict()

function validateExerciseMuscleGroups(
  value: { primaryMuscleGroupKey?: string; secondaryMuscleGroupKeys?: string[] },
  context: z.RefinementCtx,
): void {
  if (value.primaryMuscleGroupKey && value.secondaryMuscleGroupKeys?.includes(value.primaryMuscleGroupKey)) {
    context.addIssue({ code: 'custom', path: ['secondaryMuscleGroupKeys'], message: 'El grupo principal no puede repetirse como secundario.' })
  }
}

export const exerciseInputSchema = exerciseInputObjectSchema.superRefine(validateExerciseMuscleGroups)

export const muscleGroupListSchema = z.array(muscleGroupSchema.extend({ description: z.string().nullable() }).strict())

export type Exercise = z.infer<typeof exerciseSchema>
export type ExercisePage = z.infer<typeof exercisePageSchema>
export type ExerciseScope = 'global' | 'mine' | 'visible'
export type ListExercisesQuery = z.input<typeof listExercisesQuerySchema>
export type ExerciseInput = z.input<typeof exerciseInputSchema>
export type MuscleGroup = z.infer<typeof muscleGroupListSchema>[number]

export class InvalidExerciseIdError extends Error {
  constructor() {
    super('El identificador del ejercicio no es un UUID v4 válido.')
    this.name = 'InvalidExerciseIdError'
  }
}

export const exercisesService = {
  async list(input: ListExercisesQuery = {}, scope: ExerciseScope = 'global', signal?: AbortSignal): Promise<ExercisePage> {
    const params = listExercisesQuerySchema.parse(input)
    const path = scope === 'mine' ? '/exercises/mine' : scope==='visible'?'/exercises/visible':'/exercises'
    const { data } = await api.get<unknown>(path, { params, signal })
    return exercisePageSchema.parse(data)
  },

  async listMuscleGroups(signal?: AbortSignal): Promise<MuscleGroup[]> {
    const { data } = await api.get<unknown>('/exercises/muscle-groups', { signal })
    return muscleGroupListSchema.parse(data)
  },

  async getById(exerciseId: string, signal?: AbortSignal): Promise<Exercise> {
    const parsedId = uuidV4Schema.safeParse(exerciseId)
    if (!parsedId.success) throw new InvalidExerciseIdError()
    const { data } = await api.get<unknown>(`/exercises/${encodeURIComponent(parsedId.data)}`, { signal })
    return exerciseSchema.parse(data)
  },

  async create(input: ExerciseInput): Promise<Exercise> {
    const payload = exerciseInputSchema.parse(input)
    const { data } = await api.post<unknown>('/exercises', payload)
    return exerciseSchema.parse(data)
  },

  async update(exerciseId: string, input: Partial<ExerciseInput>): Promise<Exercise> {
    const parsedId = uuidV4Schema.safeParse(exerciseId)
    if (!parsedId.success) throw new InvalidExerciseIdError()
    const payload = exerciseInputObjectSchema.partial().strict().superRefine(validateExerciseMuscleGroups).parse(input)
    if (Object.keys(payload).length === 0) throw new z.ZodError([])
    const { data } = await api.patch<unknown>(`/exercises/${encodeURIComponent(parsedId.data)}`, payload)
    return exerciseSchema.parse(data)
  },

  async deactivate(exerciseId: string): Promise<{ deactivated: true }> {
    const parsedId = uuidV4Schema.safeParse(exerciseId)
    if (!parsedId.success) throw new InvalidExerciseIdError()
    const { data } = await api.delete<unknown>(`/exercises/${encodeURIComponent(parsedId.data)}`)
    return z.object({ deactivated: z.literal(true) }).strict().parse(data)
  },
}

export function exerciseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof InvalidExerciseIdError) return 'El identificador del ejercicio no es válido.'
  if (error instanceof z.ZodError) {
    return 'El servidor devolvió datos con un formato inesperado. Inténtalo de nuevo más tarde.'
  }
  if (!axios.isAxiosError(error)) return fallback
  if (!error.response) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'

  switch (error.response.status) {
    case 400:
      return 'El ejercicio o los filtros enviados no son válidos. Revisa los campos e inténtalo de nuevo.'
    case 401:
      return 'Tu sesión expiró o ya no está disponible. Inicia sesión de nuevo.'
    case 403:
      return 'No tienes permiso para realizar esta operación.'
    case 404:
      return 'No se encontró el ejercicio o ya no está disponible.'
    case 409:
      return 'Este ejercicio ya se utiliza en un plan o historial y no puede editarse.'
    case 429:
      return 'Has realizado muchas solicitudes. Espera un momento e inténtalo de nuevo.'
    default:
      return error.response.status >= 500
        ? 'El catálogo no está disponible en este momento. Inténtalo de nuevo más tarde.'
        : fallback
  }
}

export function isExerciseUnavailableError(error: unknown): boolean {
  return error instanceof InvalidExerciseIdError ||
    (axios.isAxiosError(error) && error.response?.status === 404)
}

export function exerciseEnumLabel(value: string | null | undefined): string {
  if (!value) return 'No especificado'
  const labels: Record<string, string> = {
    BARBELL: 'Barra olímpica', EZ_BAR: 'Barra EZ', DUMBBELL: 'Mancuernas', MACHINE: 'Máquina',
    SMITH_MACHINE: 'Máquina Smith', CABLE: 'Polea', BODYWEIGHT: 'Peso corporal', KETTLEBELL: 'Kettlebell',
    RESISTANCE_BAND: 'Banda elástica', MEDICINE_BALL: 'Balón medicinal', RINGS: 'Anillas', LANDMINE: 'Landmine',
    OTHER: 'Otro', SELECTORIZED: 'Selectorizada', PLATE_LOADED: 'Cargada con discos', CONVERGING: 'Convergente',
    SMITH: 'Smith', LEVER: 'Palanca', HACK_SQUAT: 'Hack squat', LEG_PRESS: 'Prensa', FREE_WEIGHT: 'Peso libre',
    WEIGHT_STACK: 'Pila de pesas', ELASTIC: 'Elástica', ISOMETRIC: 'Isométrica', COMPOUND: 'Compuesto',
    ISOLATION: 'Aislamiento', OLYMPIC: 'Olímpico', PLYOMETRIC: 'Pliométrico', CARRY: 'Transporte', MOBILITY: 'Movilidad',
    SQUAT: 'Sentadilla', HIP_HINGE: 'Bisagra de cadera', LUNGE: 'Zancada', HORIZONTAL_PUSH: 'Empuje horizontal',
    VERTICAL_PUSH: 'Empuje vertical', HORIZONTAL_PULL: 'Tracción horizontal', VERTICAL_PULL: 'Tracción vertical',
    ELBOW_FLEXION: 'Flexión de codo', ELBOW_EXTENSION: 'Extensión de codo', SHOULDER_ABDUCTION: 'Abducción de hombro',
    SHOULDER_ROTATION: 'Rotación de hombro', HIP_EXTENSION: 'Extensión de cadera', HIP_ABDUCTION: 'Abducción de cadera',
    HIP_ADDUCTION: 'Aducción de cadera', KNEE_EXTENSION: 'Extensión de rodilla', KNEE_FLEXION: 'Flexión de rodilla',
    CALF_RAISE: 'Elevación de talón', TRUNK_FLEXION: 'Flexión del tronco', TRUNK_EXTENSION: 'Extensión del tronco',
    ROTATION: 'Rotación', ANTI_ROTATION: 'Antirrotación', OLYMPIC_LIFT: 'Levantamiento olímpico', JUMP: 'Salto',
    PRONATED: 'Prono', SUPINATED: 'Supino', NEUTRAL: 'Neutro', MIXED: 'Mixto', HOOK: 'Gancho', STRAPPED: 'Con correas',
    NONE: 'Sin agarre específico', VARIABLE: 'Variable', NARROW: 'Cerrado', SHOULDER_WIDTH: 'Ancho de hombros',
    WIDE: 'Ancho', NOT_APPLICABLE: 'No aplica', STANDING: 'De pie', SEATED: 'Sentado', SUPINE: 'Boca arriba',
    PRONE: 'Boca abajo', SIDE_LYING: 'De lado', KNEELING: 'De rodillas', HALF_KNEELING: 'Medio arrodillado',
    HANGING: 'Suspendido', QUADRUPED: 'Cuadrupedia', UNILATERAL: 'Unilateral', BILATERAL: 'Bilateral',
    ALTERNATING: 'Alternado', SAGITTAL: 'Sagital', FRONTAL: 'Frontal', TRANSVERSE: 'Transversal',
    MULTIPLANAR: 'Multiplanar', BEGINNER: 'Principiante', INTERMEDIATE: 'Intermedio', ADVANCED: 'Avanzado',
    SUITABLE: 'Apto', NOT_SUITABLE: 'No apto', UNDETERMINED: 'Sin determinar', GLOBAL: 'Catálogo PULSO', PERSONAL: 'Propio',
  }
  return labels[value] ?? value
}
