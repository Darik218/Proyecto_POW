import { z } from "zod";
const id = z.uuidv4(),
  decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
export const referenceSetSchema = z
  .object({
    id,
    setNumber: z.number().int().positive(),
    load: decimal.nullable(),
    loadUnit: z.enum(["KG", "LB"]).nullable(),
    repetitions: z.number().int().nullable(),
    rpe: z.number().min(0).max(10).nullable(),
    status: z
      .enum(["PENDING", "COMPLETED", "INCOMPLETE", "FAILED", "SKIPPED"])
      .nullable(),
    kind: z.enum(["WORK", "WARMUP"]).nullable(),
    isCompleted: z.boolean(),
  })
  .strict();
export const workoutReferenceSchema = z
  .object({
    sessionId: id,
    sessionLabel: z.string(),
    performedOn: z.iso.date().nullable(),
    sets: z.array(referenceSetSchema),
  })
  .strict();
const eligibility = z
  .object({
    policyVersion: z.string(),
    status: z.string(),
    mathematicallyUsable: z.boolean(),
    descriptiveEligible: z.boolean(),
    officialEvidence: z.literal("NOT_ASSESSED"),
    reasons: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();
const calculation = z
  .object({
    ok: z.literal(true),
    policyVersion: z.string(),
    load: z
      .object({
        originalLoad: decimal,
        originalUnit: z.enum(["KG", "LB"]),
        loadKg: decimal,
      })
      .strict(),
    repetitions: z.number().int().min(1).max(10),
    estimates: z.array(
      z
        .object({
          formula: z.enum(["EPLEY", "BRZYCKI"]),
          estimatedOneRm: decimal,
          unit: z.literal("KG"),
          warnings: z.array(z.string()),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
  })
  .strict();
export const workoutInsightsSchema = z
  .object({
    sessionId: id,
    status: z.literal("COMPLETED"),
    exercises: z.array(
      z
        .object({
          workoutExerciseId: id,
          exerciseId: id,
          name: z.string(),
          actualSets: z.array(referenceSetSchema),
          reference: workoutReferenceSchema.nullable(),
          oneRm: z.array(
            z
              .object({
                setId: id,
                eligibility,
                calculation: calculation.nullable(),
              })
              .strict(),
          ),
          orientation: z
            .object({
              action: z.enum([
                "REPEAT_REFERENCE",
                "RECORD_BASELINE",
                "REVIEW_DATA",
              ]),
              message: z.string(),
            })
            .strict(),
          loadMeaning: z.enum(["UNKNOWN", "EXTERNAL_TOTAL"]),
          loadMeaningSource: z.enum(["UNKNOWN", "REQUEST_DECLARATION"]),
        })
        .strict(),
    ),
  })
  .strict();
export const exerciseReferenceSchema = z
  .object({ exerciseId: id, reference: workoutReferenceSchema.nullable() })
  .strict();
