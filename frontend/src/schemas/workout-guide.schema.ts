import { z } from "zod";
const id = z.uuidv4(),
  unit = z.enum(["KG", "LB"]).nullable();
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .nullable();
const target = z.object({
  targetSets: z.number().int().nullable(),
  targetRepsMin: z.number().int().nullable(),
  targetRepsMax: z.number().int().nullable(),
  targetLoad: decimal,
  targetLoadUnit: unit,
  targetRpe: decimal,
});
const set = z.object({
  setNumber: z.number().int(),
  load: decimal,
  loadUnit: unit,
  repetitions: z.number().int().nullable(),
  rpe: decimal,
  status: z.string().nullable(),
  kind: z.string().nullable(),
  isCompleted: z.boolean(),
});
export const workoutGuideQuerySchema = z
  .object({
    activityId: id.optional(),
    planDayId: id.optional(),
    sessionId: id.optional(),
    performedOn: z.iso.date().optional(),
    timeZone: z.string().optional(),
  })
  .strict()
  .refine(
    (q) =>
      [q.activityId, q.planDayId, q.sessionId].filter(Boolean).length === 1,
    "Selecciona un único origen",
  )
  .refine(
    (q) => !q.planDayId || !!(q.performedOn && q.timeZone),
    "Indica fecha y zona horaria",
  );
export const workoutGuideSchema = z.object({
  schemaVersion: z.literal("workout-guide-v1"),
  historyCutoffOn: z.iso.date().nullable(),
  executionAuthorized: z.literal(false),
  status: z.enum(["TRAINABLE", "REST", "OMITTED", "UNAVAILABLE"]),
  source: z.object({
    kind: z.enum(["ACTIVITY", "PLAN_DAY", "SESSION"]),
    id,
    activityId: id.nullable(),
    planDayId: id.nullable(),
    sessionId: id.nullable(),
    trainingPlanId: id.nullable(),
    planWeekId: id.nullable(),
    performedOn: z.iso.date().nullable(),
    timeZone: z.string().nullable(),
    status: z.string(),
    title: z.string().nullable(),
  }),
  exercises: z.array(
    z.object({
      id,
      exerciseId: id,
      name: z.string(),
      position: z.number().int(),
      isOmitted: z.boolean(),
      target,
      originalTarget: target.nullable(),
      lastReference: z
        .object({
          performedOn: z.iso.date(),
          gapDays: z.number().int().nullable(),
          sessions: z.array(
            z.object({
              sessionId: id,
              taskId: id,
              performedOn: z.iso.date().nullable(),
              timeZone: z.string().nullable(),
              sets: z.array(set),
            }),
          ),
        })
        .nullable(),
      guidance: z.object({
        state: z.enum([
          "FIRST_BASELINE",
          "REFERENCE_AVAILABLE",
          "INSUFFICIENT_DATA",
        ]),
        reasons: z.array(z.string()),
        message: z.string(),
      }),
      guidanceSuggested: z
        .object({
          origin: z.enum([
            "CALCULATED",
            "PERSISTED_PROPOSAL",
            "HISTORICAL_REFERENCE",
            "INSUFFICIENT_DATA",
          ]),
          action: z.string(),
          load: decimal,
          unit,
          reps: z.number().int().nullable(),
          sets: z.number().int().nullable(),
          reason: z.string(),
          reasons: z.array(z.string()),
          policyVersion: z.string().nullable(),
          executionAuthorized: z.literal(false),
        })
        .optional(),
      calculationContext: z
        .object({
          contextKey: z.string().nullable(),
          comparisonKey: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable()
            .optional(),
          ready: z.boolean(),
          reasons: z.array(z.string()),
          setting: z
            .object({
              minSuccessfulSessions: z.number().int(),
              targetRpeMin: z.string(),
              targetRpeMax: z.string(),
              incrementAbsolute: decimal,
              incrementPercent: decimal,
              maxIncrementPercent: z.string(),
              maxLoad: decimal,
            })
            .nullable(),
          unit,
          incrementModes: z.array(z.enum(["ABSOLUTE", "PERCENT"])),
          tasks: z.array(
            z.object({
              id,
              sessionId: id,
              performedOn: z.string().nullable(),
              timeZone: z.string().nullable(),
              status: z.string(),
              sets: z.number().int(),
            }),
          ),
          policyContract: z.literal("session-readiness-preview-v1"),
          executionAuthorized: z.literal(false),
        })
        .nullable()
        .optional(),
      repetitionContext: z
        .object({
          contextKey: z.string().nullable(),
          comparisonKey: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable()
            .optional(),
          ready: z.boolean(),
          reasons: z.array(z.string()),
          minimumSessions: z.number().int().positive(),
          minimumSource: z.enum([
            "PERSISTED_SETTING",
            "PLAN_BOUND_INITIAL_POLICY",
          ]),
          baselineSource: z
            .enum(["PRESCRIPTION", "RECORDED_HISTORY"])
            .nullable()
            .optional(),
          tasks: z.array(
            z.object({
              id,
              sessionId: id,
              performedOn: z.iso.date().nullable(),
              timeZone: z.string().nullable(),
            }),
          ),
          policyContract: z.literal("session-repetition-preview-v1"),
          executionAuthorized: z.literal(false),
        })
        .nullable()
        .optional(),
      proposal: z
        .object({
          id,
          status: z.enum(["CURRENT", "REQUIRES_REVIEW"]),
          recommendedLoad: decimal,
          loadUnit: unit,
          reasons: z.array(z.string()),
          href: z.string().regex(/^\/app\/progression/),
        })
        .nullable(),
    }),
  ),
});
export type WorkoutGuide = z.infer<typeof workoutGuideSchema>;
export type WorkoutGuideQuery = z.infer<typeof workoutGuideQuerySchema>;
export const workoutGuidePreviewInputSchema = z
  .object({
    source: workoutGuideQuerySchema,
    exerciseId: id,
    contextKey: z.string().regex(/^[a-f0-9]{64}$/),
    gridStep: z.string().regex(/^\d+(?:\.\d+)?$/),
    incrementMode: z.enum(["ABSOLUTE", "PERCENT"]),
    declaration: z
      .object({
        sameVariant: z.literal(true),
        sameEquipment: z.literal(true),
        externalTotal: z.literal(true),
      })
      .strict(),
    policyContract: z.enum([
      "session-readiness-preview-v1",
      "session-load-compliance-preview-v1",
    ]),
  })
  .strict();
export type WorkoutGuidePreviewInput = z.infer<
  typeof workoutGuidePreviewInputSchema
>;
export const workoutRepetitionPreviewInputSchema = z
  .object({
    source: workoutGuideQuerySchema,
    exerciseId: id,
    contextKey: z.string().regex(/^[a-f0-9]{64}$/),
    declaration: z
      .object({
        sameVariant: z.literal(true),
        sameEquipment: z.literal(true),
        sameLoadConvention: z.literal(true),
      })
      .strict(),
    policyContract: z.literal("session-repetition-preview-v1"),
  })
  .strict();
export type WorkoutRepetitionPreviewInput = z.infer<
  typeof workoutRepetitionPreviewInputSchema
>;
