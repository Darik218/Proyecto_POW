import { z } from "zod";
import { decimal } from "./progression.schema";
const uuid = z.uuid(),
  instant = z.iso.datetime({ offset: true }),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const activationTermsVersion =
  "saved-recommendations-activation-v1" as const;
export const operationalGrantSchema = z
  .object({
    id: uuid,
    consentId: uuid,
    state: z.enum(["ACTIVE", "REVOKED"]),
    version: z.number().int().positive(),
    activatedAt: instant,
    revokedAt: instant.nullable(),
  })
  .strict();
export const automaticRunSchema = z
  .object({
    id: uuid,
    grantId: uuid,
    recommendationId: uuid,
    result: z.enum(["APPLIED", "BLOCKED"]),
    reasons: z.array(z.string()),
    applicationId: uuid.nullable(),
    previousLoad: decimal.nullable(),
    appliedLoad: decimal.nullable(),
    unit: z.enum(["KG", "LB"]).nullable(),
    recordedAt: instant,
    cycleKey: hash.nullable(),
  })
  .strict();
export const operationalStatusSchema = z
  .object({
    consentId: uuid,
    consentVersion: z.number().int().positive(),
    contractKey: hash,
    acceptanceEventId: uuid.nullable(),
    activationTermsVersion: z.literal(activationTermsVersion),
    conditionsKey: hash,
    grant: operationalGrantSchema.nullable(),
    effectiveState: z.enum([
      "INACTIVE",
      "ACTIVE",
      "REVOKED",
      "CONSENT_NOT_ACCEPTED",
      "EXPIRED",
      "NOT_YET_VALID",
      "CONFIGURATION_CHANGED",
      "UNAVAILABLE",
    ]),
    executionAuthorized: z.boolean(),
    reasons: z.array(z.string()),
    principal: z.literal("PULSO_INTERNAL_PROGRESSION_WORKER_V1"),
  })
  .strict();
export const activationSchema = z
  .object({
    intentId: uuid,
    expectedConsentVersion: z.number().int().positive(),
    expectedContractKey: hash,
    acceptanceEventId: uuid,
    activationTermsVersion: z.literal(activationTermsVersion),
    conditionsKey: hash,
    confirmActivation: z.literal(true),
  })
  .strict();
export const operationalRevocationSchema = z
  .object({
    intentId: uuid,
    grantId: uuid,
    expectedGrantVersion: z.number().int().positive(),
    confirmRevocation: z.literal(true),
  })
  .strict();
export const processAutomaticSchema = z.object({ intentId: uuid }).strict();
export const operationalReceiptSchema = z
  .object({
    eventId: uuid,
    intentId: uuid,
    action: z.enum(["ACTIVATE", "REVOKE", "CHECK"]),
    consentId: uuid,
    grant: operationalGrantSchema.nullable(),
    results: z.array(automaticRunSchema),
    recordedAt: instant,
  })
  .strict();
export const automaticHistorySchema = z
  .object({
    items: z.array(automaticRunSchema),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export const automaticApplicationSchema = z
  .object({ consentId: uuid, run: automaticRunSchema })
  .strict();
