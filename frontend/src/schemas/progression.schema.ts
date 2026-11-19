import { z } from 'zod'
const uuid = z.uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  date = z.iso.date(),
  timestamp = z.iso.datetime({ offset: true })
export const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(256)
const unit = z.enum(['KG', 'LB']),
  reasons = z.array(z.string()),
  basis = z.enum(['ORIGINAL', 'ADJUSTED'])
const rule = z
  .object({
    repetitions: z.enum(['MINIMUM', 'UPPER_BOUND']),
    load: z.enum([
      'IGNORE',
      'AT_LEAST_TARGET',
      'EXACT_TARGET',
      'IF_PRESENT_AT_LEAST',
    ]),
    rpe: z.union([
      z.enum(['DESCRIBE', 'AT_MOST_TARGET']),
      z.object({ minimum: decimal, maximum: decimal }).strict(),
    ]),
    coverage: z.literal('ALL_REQUIRED'),
  })
  .strict()
export const progressionPolicySchema = z
  .object({
    id: z.string().min(1).max(120),
    version: z.string().min(1).max(120),
    provenance: z
      .object({
        source: z.literal('EXPLICIT_INTERNAL_POLICY'),
        reference: z.string().min(1).max(120),
      })
      .strict(),
    basis,
    baseline: z.enum([
      'DESTINATION_PRESCRIPTION',
      'ANCHOR_ORIGINAL',
      'ANCHOR_ADJUSTED',
    ]),
    cohort: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('SAME_PRESCRIPTION') }).strict(),
      z
        .object({
          mode: z.literal('EXPLICIT_TASK_SET'),
          taskIds: z.array(uuid).min(1).max(100),
        })
        .strict(),
    ]),
    assessment: z
      .object({
        compliance: z
          .object({
            id: z.string(),
            slots: z
              .array(
                z
                  .object({
                    taskId: uuid,
                    original: z.array(z.number().int().positive()).max(1000),
                    adjusted: z.array(z.number().int().positive()).max(1000),
                    originalLoadMeaning: z.literal('EXTERNAL_TOTAL').optional(),
                    adjustedLoadMeaning: z.literal('EXTERNAL_TOTAL').optional(),
                  })
                  .strict(),
              )
              .max(100),
            basic: rule.optional(),
            readiness: rule.optional(),
          })
          .strict()
          .optional(),
        count: z
          .object({
            id: z.string(),
            basis,
            criterion: z.enum(['BASIC', 'READINESS']),
            mode: z.enum(['ACCUMULATED', 'CONSECUTIVE']),
            sameDate: z.enum(['DISTINCT_SESSIONS', 'DISTINCT_DATES']),
            minimumSessions: z.number().int().positive(),
            anchorTaskId: uuid,
          })
          .strict()
          .optional(),
        signal: z
          .object({
            id: z.string(),
            basis,
            rpeComparison: z.enum(['STRICT_PROG2', 'MATCHED_LOAD_DESCRIPTIVE']),
            referenceSize: z.number().int().min(1).max(100),
            rpeThreshold: decimal,
            performanceThresholdPercent: decimal,
            minimumRpeCoveragePercent: decimal,
          })
          .strict()
          .optional(),
        persistence: z
          .object({
            id: z.string(),
            k: z.number().int().positive(),
            m: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    settingRpeUse: z.enum(['REQUIRE_INTERVAL', 'CONTEXT_ONLY_EXPLICIT']),
    review: z.enum(['NOT_REQUIRED_EXPLICIT', 'ANY_SIGNAL', 'TEMPORAL_SIGNAL']),
    oneRm: z.enum(['DESCRIPTIVE_CONTEXT_ONLY', 'DECISION_CRITERION']),
    requireClosedWeek: z.boolean(),
    knowledge: z.literal('CURRENT_RECORDS_FOR_SPORTING_CUTOFF'),
    loadMeaning: z.enum(['EXTERNAL_TOTAL', 'UNKNOWN']),
    settingLoadUnit: unit.optional(),
    incrementMode: z.enum(['ABSOLUTE', 'PERCENT']).optional(),
    grid: z
      .object({
        unit,
        step: decimal,
        origin: decimal,
        rounding: z.literal('FLOOR'),
        source: z.string().min(1).max(120),
      })
      .strict(),
  })
  .strict()
const destinationInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('PRESCRIPTION'),
      planId: uuid,
      weekId: uuid,
      dayId: uuid.nullable(),
      prescriptionId: uuid,
    })
    .strict(),
  z.object({ kind: z.literal('WORKOUT_TASK'), taskId: uuid }).strict(),
])
export const progressionCommandSchema = z
  .object({
    history: z
      .object({
        exerciseId: uuid,
        from: date,
        to: date,
        timeZone: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(100),
        contexts: z
          .array(
            z
              .object({
                workoutExerciseId: uuid,
                loadMeaning: z.enum([
                  'EXTERNAL_TOTAL',
                  'PER_HAND',
                  'MACHINE_NOMINAL',
                  'BODYWEIGHT',
                  'ASSISTANCE',
                  'NON_QUANTIFIABLE',
                  'UNKNOWN',
                ]),
                protocolKey: z.string().nullable(),
                equipmentKey: z.string().nullable(),
                source: z.literal('OWNER_DECLARATION_FOR_ANALYSIS'),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        comparisons: z
          .array(
            z.object({ previousTaskId: uuid, currentTaskId: uuid }).strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
    period: z
      .object({
        start: date,
        endExclusive: date,
        cutoffOn: date,
        timeZone: z.string().min(1).max(100),
        weekStartsOn: z.number().int().min(1).max(7),
      })
      .strict(),
    destination: destinationInput,
    expectedPlanVersion: z.number().int().nonnegative().optional(),
    policy: progressionPolicySchema.optional(),
  })
  .strict()
export const dependencyKeysSchema = z
  .object({
    configuration: hash,
    period: hash,
    destination: hash,
    evidence: hash,
  })
  .strict()
const targets = z
  .object({
    targetSets: z.number().int().nullable(),
    targetRepsMin: z.number().int().nullable(),
    targetRepsMax: z.number().int().nullable(),
    targetLoad: decimal.nullable(),
    targetLoadUnit: unit.nullable(),
    targetRpe: decimal.nullable(),
  })
  .strict()
const destination = z
  .object({
    kind: z.enum(['PRESCRIPTION', 'WORKOUT_TASK']),
    taskId: uuid.nullable(),
    planId: uuid.nullable(),
    weekId: uuid.nullable(),
    dayId: uuid.nullable(),
    prescriptionId: uuid.nullable(),
    planVersion: z.number().int().nullable(),
    planStatus: z.string().nullable(),
    retired: z.boolean(),
    targets,
  })
  .strict()
const selected = z
  .object({
    minSuccessfulSessions: z.number().int(),
    targetRpeMin: decimal,
    targetRpeMax: decimal,
    incrementPercent: decimal.nullable(),
    incrementAbsolute: decimal.nullable(),
    maxIncrementPercent: decimal,
    maxLoad: decimal.nullable(),
  })
  .strict()
const configuration = z
  .object({
    status: z.string(),
    scope: z.string().nullable(),
    reasons,
    mode: z.string().nullable(),
    selected: selected.nullable(),
    policy: progressionPolicySchema.nullable(),
  })
  .strict()
const task = z
  .object({
    id: uuid,
    sessionId: uuid,
    performedOn: date.nullable(),
    timeZone: z.string().nullable(),
    isOmitted: z.boolean(),
    availableSets: z.number().int(),
    original: targets,
    adjusted: targets,
  })
  .strict()
const set = z
  .object({
    id: uuid,
    workoutExerciseId: uuid,
    setNumber: z.number().int(),
    status: z.string().nullable(),
    kind: z.string().nullable(),
    isCompleted: z.boolean(),
    load: decimal.nullable(),
    loadUnit: unit.nullable(),
    loadKg: decimal.nullable(),
    repetitions: z.number().int().nullable(),
    rpe: decimal.nullable(),
  })
  .strict()
const truncated = z
  .object({ tasks: z.boolean(), sets: z.boolean(), estimates: z.boolean() })
  .strict()
export const progressionContextSchema = z
  .object({
    exerciseId: uuid,
    destination,
    configuration,
    history: z
      .object({ tasks: z.array(task), sets: z.array(set), truncated })
      .strict(),
  })
  .strict()
// Derived metrics are returned by the server; Vue never recomputes official decisions.
const metric = z
  .object({
    status: z.string(),
    reasons,
    basic: z.string(),
    readiness: z.string(),
    rpeCoverage: decimal.nullable(),
    coverage: z
      .object({
        required: z.number().int().nullable(),
        mapped: z.number().int(),
        recorded: z.number().int(),
        completedWork: z.number().int(),
        availableSets: z.number().int(),
        reviewedSets: z.number().int(),
      })
      .strict(),
  })
  .strict()
export const previewSchema = z
  .object({
    kind: z.literal('PREVIEW'),
    decision: z.enum([
      'INCREASE',
      'MAINTAIN',
      'REVIEW_REQUIRED',
      'INSUFFICIENT_DATA',
      'CONFIGURATION_REQUIRED',
      'NO_REPRESENTABLE_INCREMENT',
    ]),
    reasons,
    semanticKey: hash,
    dependencyKeys: dependencyKeysSchema,
    exerciseId: uuid,
    engineVersion: z.string(),
    period: z
      .object({
        start: date,
        endExclusive: date,
        cutoffOn: date,
        timeZone: z.string(),
        weekStartsOn: z.number().int(),
        closed: z.boolean(),
      })
      .strict(),
    historyWindow: z
      .object({ from: date, to: date, timeZone: z.string() })
      .passthrough(),
    destination,
    configuration,
    increment: z
      .object({
        status: z.string(),
        reasons,
        unit: unit.nullable(),
        currentLoad: decimal.nullable(),
        proposedLoad: decimal.nullable(),
        currentLoadKg: decimal.nullable(),
        proposedLoadKg: decimal.nullable(),
        requestedDelta: decimal.nullable(),
        allowedUpperLoad: decimal.nullable(),
      })
      .strict()
      .nullable(),
    evidence: z
      .object({
        tasks: z.array(task),
        sets: z.array(set),
        assessments: z.array(
          z
            .object({ taskId: uuid, original: metric, adjusted: metric })
            .strict(),
        ),
        satisfactory: z
          .object({
            status: z.string(),
            reasons,
            qualifyingCount: z.number().int(),
            distinctSessions: z.number().int(),
            meetsMinimum: z.boolean().nullable(),
          })
          .strict()
          .nullable(),
        signals: z.array(
          z
            .object({
              taskId: uuid,
              status: z.string(),
              reasons,
              reviewSignal: z.boolean().nullable(),
              currentRpe: decimal.nullable(),
              referenceRpe: decimal.nullable(),
              deltaRpe: decimal.nullable(),
              deltaPerformancePercent: decimal.nullable(),
              coveragePercent: decimal.nullable(),
            })
            .strict(),
        ),
        temporalSignals: z
          .object({
            status: z.string(),
            reasons,
            persistentReviewSignal: z.boolean().nullable(),
          })
          .strict()
          .nullable(),
        oneRm: z
          .object({
            interpretation: z.literal('DESCRIPTIVE_ONLY_NOT_OFFICIAL'),
            points: z.array(
              z
                .object({
                  id: uuid,
                  taskId: uuid.nullable(),
                  performedOn: date.nullable(),
                  formula: z.string(),
                  resultKg: decimal,
                  warnings: reasons,
                  evidenceStatus: z.string().nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
        coverage: z
          .object({
            uniqueSessions: z.number().int(),
            tasksReturned: z.number().int(),
            reviewedSets: z.number().int(),
            truncated,
          })
          .strict(),
        excludedTasks: z.array(
          z.object({ taskId: uuid, reasons }).passthrough(),
        ),
        interpretation: z.literal('DESCRIPTIVE_ONLY_NOT_A_FATIGUE_DIAGNOSIS'),
      })
      .strict(),
    applicationAuthorization: z.literal('NOT_GRANTED'),
  })
  .strict()
export const proposalSchema = z
  .object({
    id: uuid,
    exerciseId: uuid,
    status: z.enum([
      'PENDING',
      'APPROVED',
      'REJECTED',
      'APPLIED',
      'BLOCKED',
      'EXPIRED',
    ]),
    createdAt: timestamp,
    reviewVersion: z.number().int().nullable(),
    reviewedAt: timestamp.nullable(),
    expiresAt: timestamp.nullable(),
    previousLoad: decimal.nullable(),
    recommendedLoad: decimal.nullable(),
    loadUnit: unit.nullable(),
    generation: previewSchema.nullable(),
    cycleKey: hash.nullable(),
    generationState: z.enum(['MODERN', 'LEGACY_UNKNOWN']),
  })
  .strict()
const challenge = z
  .object({
    schemaVersion: z.literal('manual-proposal-acceptance-v1'),
    scope: z.literal('THIS_PROPOSAL_ONLY'),
    authorizationKey: hash,
    policyKey: hash,
  })
  .strict()
export const reviewSchema = z
  .object({
    id: uuid,
    recommendationId: uuid,
    intentId: uuid,
    action: z.enum(['APPROVE', 'REJECT']),
    fromStatus: z.string(),
    status: z.string(),
    version: z.number().int(),
    decidedAt: timestamp,
    justification: z.string().nullable(),
    acceptance: z
      .object({
        scope: z.literal('THIS_PROPOSAL_ONLY'),
        acceptPolicy: z.literal(true),
        acceptEvidence: z.literal(true),
      })
      .strict()
      .nullable(),
  })
  .strict()
export const inspectionSchema = z
  .object({
    proposal: proposalSchema,
    events: z.array(reviewSchema),
    validity: z
      .object({ state: z.string(), changedDependencies: reasons })
      .strict(),
    compatibility: z.object({ compatible: z.boolean(), reasons }).strict(),
    cycle: z
      .object({
        key: hash.nullable(),
        reserved: z.boolean(),
        conflict: z.boolean(),
      })
      .strict(),
    approvalBlockers: reasons,
    acceptanceChallenge: challenge.nullable(),
    manualAuthorization: z
      .object({
        state: z.enum([
          'ACCEPTED_FOR_THIS_PROPOSAL',
          'NOT_GRANTED',
          'UNKNOWN_UNAUDITED',
        ]),
        eventId: uuid.nullable(),
        requiresRevalidation: z.literal(true),
      })
      .strict(),
  })
  .strict()
export const saveRequestSchema = z
  .object({
    command: progressionCommandSchema,
    expectedSemanticKey: hash,
    expectedDependencyKeys: dependencyKeysSchema,
  })
  .strict()
export const reviewRequestSchema = z
  .object({
    intentId: uuid,
    action: z.enum(['APPROVE', 'REJECT']),
    expectedStatus: z.literal('PENDING'),
    expectedVersion: z.number().int().nullable(),
    expectedSemanticKey: hash.nullable(),
    expectedCycleKey: hash.nullable(),
    expectedDependencyKeys: dependencyKeysSchema.nullable(),
    justification: z.string().max(2000).optional(),
    acceptance: challenge
      .extend({
        acceptPolicy: z.literal(true),
        acceptEvidence: z.literal(true),
      })
      .optional(),
    command: progressionCommandSchema.optional(),
  })
  .strict()
export const applicationRequestSchema = saveRequestSchema
  .extend({
    recommendationId: uuid,
    intentId: uuid,
    reviewId: uuid,
    expectedReviewVersion: z.number().int(),
    expectedCycleKey: hash,
    destination: z
      .object({ planId: uuid, weekId: uuid, dayId: uuid, prescriptionId: uuid })
      .strict(),
    expectedPlanVersion: z.number().int(),
    activityId: uuid,
    expectedActivityVersion: z.number().int(),
    expectedScheduledOn: date,
    timeZone: z.string(),
    previousLoad: decimal,
    appliedLoad: decimal,
    loadUnit: unit,
  })
  .strict()
export const receiptSchema = z
  .object({
    id: uuid,
    auditId: uuid,
    recommendationId: uuid,
    intentId: uuid,
    status: z.literal('APPLIED'),
    origin: z.string(),
    previousLoad: decimal,
    appliedLoad: decimal,
    loadUnit: unit,
    planExerciseId: uuid,
    scheduledActivityId: uuid,
    reviewId: uuid,
    effectiveAt: timestamp,
    destination: z
      .object({
        planId: uuid,
        weekId: uuid,
        dayId: uuid,
        prescriptionId: uuid,
        planVersionBefore: z.number().int(),
        planVersionAfter: z.number().int(),
      })
      .strict(),
    temporal: z.object({ scheduledOn: date, timeZone: z.string() }).strict(),
  })
  .strict()
export const readinessSchema = z
  .object({
    eligible: z.boolean(),
    reasons,
    command: applicationRequestSchema.nullable(),
    receipt: receiptSchema.nullable(),
    inspectedAt: timestamp,
  })
  .strict()
export const recommendationListSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: uuid,
          exerciseId: uuid,
          exerciseName: z.string(),
          status: z.string(),
          createdAt: timestamp,
          previousLoad: decimal.nullable(),
          recommendedLoad: decimal.nullable(),
          loadUnit: unit.nullable(),
          generationKnown: z.boolean(),
        })
        .strict(),
    ),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  })
  .strict()
export const recipeSchema = z
  .object({
    schemaVersion: z.literal('manual-revalidation-request-v1'),
    command: progressionCommandSchema,
    recordedAt: timestamp,
    provenance: z.enum(['HTTP_SAVE_REQUEST', 'MATCHING_REPLAY_REQUEST']),
  })
  .strict()
  .nullable()

export const validitySchema = z
  .object({
    status: z.enum(['LEGACY_UNKNOWN', 'OBSOLETE', 'UNCHANGED']),
    changedDependencies: z.array(z.string()).optional(),
    applicationAuthorization: z.literal('NOT_GRANTED'),
  })
  .strict()
