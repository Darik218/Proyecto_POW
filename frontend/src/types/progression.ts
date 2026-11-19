import type { z } from 'zod'
import type {
  progressionCommandSchema,
  progressionContextSchema,
  progressionPolicySchema,
  previewSchema,
  proposalSchema,
  inspectionSchema,
  reviewRequestSchema,
  applicationRequestSchema,
  receiptSchema,
  readinessSchema,
  recommendationListSchema,
  saveRequestSchema,
} from '../schemas/progression.schema'
export type ProgressionCommand = z.infer<typeof progressionCommandSchema>
export type ProgressionPolicy = z.infer<typeof progressionPolicySchema>
export type ProgressionContext = z.infer<typeof progressionContextSchema>
export type ProgressionPreview = z.infer<typeof previewSchema>
export type ProgressionProposal = z.infer<typeof proposalSchema>
export type ProgressionInspection = z.infer<typeof inspectionSchema>
export type ReviewRequest = z.infer<typeof reviewRequestSchema>
export type ApplicationRequest = z.infer<typeof applicationRequestSchema>
export type ApplicationReceipt = z.infer<typeof receiptSchema>
export type ApplicationReadiness = z.infer<typeof readinessSchema>
export type RecommendationList = z.infer<typeof recommendationListSchema>
export type SaveRequest = z.infer<typeof saveRequestSchema>

// Private UI draft, retained only in the auth-scoped progression store; never sent as a command.
export type ProgressionFormDraft = {
  planId: string
  weekId: string
  dayId: string
  prescriptionId: string
  dates: Record<string, string>
  fields: Record<string, string>
  selection: string[]
  anchor: string
  protocol: string
  equipment: string
  slots: Record<string, { original: string; adjusted: string }>
}
