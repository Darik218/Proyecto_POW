import type { z } from 'zod'
import type {
  consentContractSchema,
  consentAcceptSchema,
  consentChallengeSchema,
  consentAcknowledgmentsSchema,
  consentSnapshotSchema,
  consentInspectionSchema,
  consentReceiptSchema,
  consentPreviewSchema,
  consentCandidatesSchema,
  consentListSchema,
  consentRequestSchema,
  consentRevisionSchema,
  consentRevocationSchema,
} from '../schemas/automation-consent.schema'
export type ConsentContract = z.infer<typeof consentContractSchema>
export type ConsentSnapshot = z.infer<typeof consentSnapshotSchema>
export type ConsentInspection = z.infer<typeof consentInspectionSchema>
export type ConsentReceipt = z.infer<typeof consentReceiptSchema>
export type ConsentPreview = z.infer<typeof consentPreviewSchema>
export type ConsentCandidates = z.infer<typeof consentCandidatesSchema>
export type ConsentList = z.infer<typeof consentListSchema>
export type ConsentRequest = z.infer<typeof consentRequestSchema>
export type ConsentRevision = z.infer<typeof consentRevisionSchema>
export type ConsentRevocation = z.infer<typeof consentRevocationSchema>

export type ConsentAccept = z.infer<typeof consentAcceptSchema>
export type ConsentChallenge = z.infer<typeof consentChallengeSchema>
export type ConsentAcknowledgments = z.infer<
  typeof consentAcknowledgmentsSchema
>
