import { z } from 'zod'
import { progressionPolicySchema } from './progression.schema'
const uuid = z.uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  decimal = z.string().regex(/^\d+(\.\d+)?$/),
  instant = z.iso.datetime({ offset: true })
export const settingParametersSchema = z
  .object({
    minSuccessfulSessions: z.number().int().min(1).max(2147483647),
    targetRpeMin: decimal,
    targetRpeMax: decimal,
    incrementPercent: decimal.nullable(),
    incrementAbsolute: decimal.nullable(),
    maxIncrementPercent: decimal,
    maxLoad: decimal.nullable(),
  })
  .strict()
export const settingScopeSchema = z
  .object({ exerciseId: uuid.nullable(), trainingPlanId: uuid.nullable() })
  .strict()
  .refine((v) => v.trainingPlanId === null || v.exerciseId !== null, {
    message: 'El ámbito de plan requiere ejercicio',
  })
export const settingRecordSchema = z
  .object({
    id: uuid,
    scope: z.enum(['ATHLETE', 'EXERCISE', 'EXERCISE_PLAN']),
    exerciseId: uuid.nullable(),
    trainingPlanId: uuid.nullable(),
    exerciseName: z.string().nullable(),
    planName: z.string().nullable(),
    parameters: settingParametersSchema,
    revision: hash,
    createdAt: instant,
    updatedAt: instant,
    historicalAutoApplyAuthorized: z.boolean(),
    parameterIssues: z.array(z.string()),
    loadUnitSource: z.literal('EXPLICIT_POLICY_REQUIRED'),
    provenance: z
      .object({
        parameters: z.literal('PERSISTED_ROW'),
        originalEntryMethod: z.literal('NOT_DETERMINED_BY_THIS_READ'),
        unit: z.literal('NOT_STORED_IN_SETTING'),
      })
      .strict(),
    parameterSources: z.record(
      z.string(),
      z
        .object({ settingId: uuid, source: z.literal('PERSISTED_ROW') })
        .strict(),
    ),
    executionAuthorized: z.literal(false),
  })
  .strict()
export const settingContextSchema = z
  .object({
    exerciseId: uuid,
    trainingPlanId: uuid.nullable(),
    policy: progressionPolicySchema.optional(),
  })
  .strict()
export const settingResolutionSchema = z
  .object({
    context: z
      .object({ exerciseId: uuid, trainingPlanId: uuid.nullable() })
      .strict(),
    scope: z.enum(['ATHLETE', 'EXERCISE', 'EXERCISE_PLAN']).nullable(),
    selected: settingRecordSchema.nullable(),
    status: z.enum(['VALID', 'CONFIGURATION_REQUIRED']),
    reasons: z.array(z.string()),
    settingReasons: z.array(z.string()),
    externalRequirements: z.array(z.string()),
    policyProvided: z.boolean(),
    mode: z.enum(['ABSOLUTE', 'PERCENT']).nullable(),
    precedence: z.literal('WHOLE_ROW_EXERCISE_PLAN_EXERCISE_ATHLETE'),
    executionAuthorized: z.literal(false),
  })
  .strict()
export const settingListSchema = z
  .object({
    items: z.array(settingRecordSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  })
  .strict()
export const settingCreateSchema = z
  .object({
    intentId: uuid,
    scope: settingScopeSchema,
    parameters: settingParametersSchema,
  })
  .strict()
export const settingReplaceSchema = z
  .object({
    intentId: uuid,
    expectedRevision: hash,
    parameters: settingParametersSchema,
    confirmImpact: z.literal(true),
  })
  .strict()
export const settingReceiptSchema = z
  .object({
    id: uuid,
    settingId: uuid,
    intentId: uuid,
    action: z.enum(['CREATE', 'REPLACE']),
    beforeRevision: hash.nullable(),
    revision: hash,
    result: settingRecordSchema,
    effective: settingResolutionSchema.nullable(),
    recordedAt: instant,
    executionAuthorized: z.literal(false),
  })
  .strict()
export const settingImpactSchema = z
  .object({
    settingId: uuid,
    expectedRevision: hash,
    parametersChanged: z.boolean(),
    recommendationIds: z.array(uuid),
    recommendationRevisionChanges: z.boolean(),
    consents: z.array(
      z
        .object({
          id: uuid,
          state: z.string(),
          compatibility: z.enum([
            'UNCHANGED',
            'REQUIRES_REEVALUATION',
            'UNAVAILABLE',
          ]),
          challengeMayBeStale: z.boolean(),
        })
        .strict(),
    ),
    coverage: z.enum(['COMPLETE', 'TRUNCATED']),
    warnings: z.array(z.string()),
    executionAuthorized: z.literal(false),
  })
  .strict()
