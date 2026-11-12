import { z } from 'zod'
import { progressionPolicySchema, decimal } from './progression.schema'
const uuid = z.uuid(),
  instant = z.iso.datetime({ offset: true }),
  unit = z.enum(['KG', 'LB']),
  state = z.enum(['PENDING_CONFIRMATION', 'ACCEPTED_INACTIVE', 'REVOKED'])
const setting = z
  .object({
    minSuccessfulSessions: z.number().int(),
    targetRpeMin: decimal,
    targetRpeMax: decimal,
    incrementAbsolute: decimal.nullable(),
    incrementPercent: decimal.nullable(),
    maxIncrementPercent: decimal,
    maxLoad: decimal.nullable(),
  })
  .strict()
export const consentContractSchema = z
  .object({
    schemaVersion: z.literal('automation-consent-contract-v1'),
    exerciseId: uuid,
    trainingPlanId: uuid.nullable(),
    policy: progressionPolicySchema,
    historyWindowDays: z.number().int().min(1).max(3660),
    limits: z
      .object({
        unit,
        loadMeaning: z.literal('EXTERNAL_TOTAL'),
        maximumAbsoluteIncrement: decimal,
        maximumPercentIncrement: decimal,
        maximumLoad: decimal,
        maximumApplicationsPerWeek: z.number().int().min(1).max(2147483647),
        weekStartsOn: z.number().int().min(1).max(7),
      })
      .strict(),
    selector: z
      .object({
        kind: z.literal('EXACT_PRESCRIPTION_ALLOWLIST'),
        prescriptionIds: z
          .array(uuid)
          .min(1)
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
        futureOnly: z.literal(true),
        planState: z.literal('DRAFT'),
        versionPolicy: z.literal('READ_CURRENT_AND_CAS'),
      })
      .strict(),
    validity: z
      .object({
        startsAt: instant,
        endsAt: instant,
        timeZone: z.string().min(1).max(100),
      })
      .strict(),
    termsVersion: z.string().min(1).max(160),
    provenance: z
      .object({
        source: z.literal('INTERNAL_CONFIGURATION_REQUEST'),
        reference: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict()
export const consentSnapshotSchema = z
  .object({
    schemaVersion: z.literal('automation-consent-snapshot-v1'),
    engine: z
      .object({ recommendation: z.string(), numeric: z.string() })
      .strict(),
    contract: consentContractSchema,
    destinations: z.array(
      z
        .object({
          prescriptionId: uuid,
          exerciseId: uuid,
          planId: uuid,
          weekId: uuid,
          dayId: uuid,
          recordedPlanVersion: z.number().int(),
        })
        .strict(),
    ),
    bindings: z.array(
      z.object({ planId: uuid, selected: setting.nullable() }).strict(),
    ),
    humanAcceptance: z.literal('NOT_RECORDED'),
    operationalAuthorization: z.literal('NOT_AVAILABLE_IN_PROG_5C_A'),
  })
  .strict()
export const consentAcknowledgmentsSchema = z
  .object({
    policy: z.literal(true),
    limits: z.literal(true),
    destinations: z.literal(true),
    validity: z.literal(true),
    revocation: z.literal(true),
  })
  .strict()
const hash = z.string().regex(/^[0-9a-f]{64}$/)
export const consentAcceptanceEvidenceSchema = z
  .object({
    schemaVersion: z.literal('recurring-consent-acceptance-v1'),
    challengeId: uuid,
    acceptedVersion: z.number().int().positive(),
    contractKey: hash,
    conditionsKey: hash,
    contextKey: hash,
    termsVersion: z.string(),
    presentationVersion: z.literal('recurring-consent-presentation-v1'),
    conditionsPresented: z.literal(true),
    acknowledgments: consentAcknowledgmentsSchema,
    provenance: z.literal('AUTHENTICATED_CONSENT_CONFIRMATION'),
    acceptanceKey: hash,
  })
  .strict()
export const consentAcceptSchema = z
  .object({
    intentId: uuid,
    challengeId: uuid,
    expectedVersion: z.number().int().min(1).max(2147483646),
    expectedState: z.literal('PENDING_CONFIRMATION'),
    contractKey: hash,
    conditionsKey: hash,
    contextKey: hash,
    termsVersion: z.string().min(1).max(160),
    presentationVersion: z.literal('recurring-consent-presentation-v1'),
    conditionsPresented: z.literal(true),
    acknowledgments: consentAcknowledgmentsSchema,
  })
  .strict()
export const consentChallengeSchema = z
  .object({
    id: uuid,
    consentId: uuid,
    version: z.number().int().positive(),
    state: z.literal('PENDING_CONFIRMATION'),
    schemaVersion: z.literal('recurring-consent-acceptance-v1'),
    scope: z.literal('RECURRING_BOUNDED'),
    contractKey: hash,
    conditionsKey: hash,
    contextKey: hash,
    termsVersion: z.string(),
    presentationVersion: z.literal('recurring-consent-presentation-v1'),
    snapshot: consentSnapshotSchema,
    requiredAcknowledgments: z.tuple([
      z.literal('policy'),
      z.literal('limits'),
      z.literal('destinations'),
      z.literal('validity'),
      z.literal('revocation'),
    ]),
    issuedAt: instant,
    expiresAt: instant,
    executionAuthorized: z.literal(false),
  })
  .strict()
export const consentReceiptSchema = z
  .object({
    id: uuid,
    consentId: uuid,
    intentId: uuid,
    action: z.enum(['CREATE', 'REVISE', 'ACCEPT', 'REVOKE']),
    fromVersion: z.number().int().nullable(),
    version: z.number().int(),
    fromState: state.nullable(),
    state,
    snapshot: consentSnapshotSchema,
    recordedAt: instant,
    reason: z.string().nullable(),
    acceptanceEvidence: consentAcceptanceEvidenceSchema.nullable().optional(),
    executionAuthorized: z.literal(false),
  })
  .strict()
export const consentInspectionSchema = z
  .object({
    id: uuid,
    exerciseId: uuid,
    trainingPlanId: uuid.nullable(),
    state,
    version: z.number().int(),
    snapshot: consentSnapshotSchema,
    currentSnapshot: consentSnapshotSchema.nullable(),
    createdAt: instant,
    updatedAt: instant,
    revokedAt: instant.nullable(),
    effectiveState: z.enum([
      'PENDING_CONFIRMATION',
      'ACCEPTED_INACTIVE',
      'REVOKED',
      'EXPIRED',
      'NOT_YET_VALID',
    ]),
    currentConfiguration: z.enum(['MATCH', 'CHANGED', 'UNAVAILABLE']),
    conditionChanges: z.array(z.string()),
    inspectedAt: instant,
    events: z.array(consentReceiptSchema),
    acceptance: z
      .object({
        available: z.boolean(),
        reason: z.enum([
          'AVAILABLE',
          'ALREADY_RECORDED',
          'CONSENT_REVOKED',
          'CONSENT_EXPIRED',
          'CONDITIONS_CHANGED',
          'RECURRENT_ACCEPTANCE_TRANSITION_UNDEFINED',
        ]),
        schemaVersion: z.literal('recurring-consent-acceptance-v1'),
        scope: z.literal('RECURRING_BOUNDED'),
        humanAcceptance: z.enum(['NOT_RECORDED', 'RECORDED']),
        recordedEventId: uuid.nullable().optional(),
        recordedAt: instant.nullable().optional(),
      })
      .strict(),
    executionAuthorized: z.literal(false),
  })
  .strict()
export const consentPreviewSchema = z
  .object({
    snapshot: consentSnapshotSchema,
    inspectedAt: instant,
    executionAuthorized: z.literal(false),
    acceptanceAvailable: z.literal(false),
  })
  .strict()
export const consentCandidatesSchema = z
  .object({
    items: z.array(
      z
        .object({
          prescriptionId: uuid,
          exerciseId: uuid,
          planId: uuid,
          planName: z.string(),
          weekId: uuid,
          weekNumber: z.number().int(),
          dayId: uuid,
          dayName: z.string(),
          recordedPlanVersion: z.number().int(),
          load: decimal,
          unit,
        })
        .strict(),
    ),
    hasMore: z.boolean(),
    page: z.number().int(),
    settings: z.array(
      z
        .object({
          planId: uuid,
          status: z.string(),
          scope: z.string().nullable(),
          reasons: z.array(z.string()),
          selected: setting.nullable(),
        })
        .strict(),
    ),
    tasks: z.array(
      z
        .object({
          id: uuid,
          performedOn: z.iso.date().nullable(),
          sessionId: uuid,
        })
        .strict(),
    ),
    tasksTruncated: z.boolean(),
    futureApplicabilityVerified: z.literal(false),
  })
  .strict()
export const consentListSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: uuid,
          exerciseId: uuid,
          exerciseName: z.string(),
          trainingPlanId: uuid.nullable(),
          planName: z.string().nullable(),
          state,
          version: z.number().int(),
          startsAt: instant,
          endsAt: instant,
          updatedAt: instant,
          executionAuthorized: z.literal(false),
        })
        .strict(),
    ),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  })
  .strict()
export const consentRequestSchema = z
  .object({ intentId: uuid, contract: consentContractSchema })
  .strict()
export const consentRevisionSchema = consentRequestSchema
  .extend({ expectedVersion: z.number().int().min(1).max(2147483646) })
  .strict()
export const consentRevocationSchema = z
  .object({
    intentId: uuid,
    expectedVersion: z.number().int().min(1).max(2147483646),
    reason: z.literal('OWNER_REQUEST'),
  })
  .strict()
