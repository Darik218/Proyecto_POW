import { z } from "zod";
const date = z.iso.date(),
  uuid = z.uuidv4(),
  decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const point = z.object({
  sessionId: uuid,
  setId: uuid,
  performedOn: date,
  setNumber: z.number().int().positive(),
  repetitions: z.number().int().positive(),
});
export const workoutProgressSchema = z.object({
  period: z.enum(["7", "30", "90", "all"]),
  from: date.nullable(),
  to: date,
  timeZone: z.string().min(1),
  selectedExerciseId: uuid.nullable(),
  selectedPlanId: uuid.nullable().default(null),
  plans: z
    .array(
      z.object({
        id: uuid,
        name: z.string(),
        status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
      }),
    )
    .default([]),
  nextSession: z
    .object({
      activityId: uuid,
      planId: uuid,
      planWeekId: uuid,
      planDayId: uuid,
      performedOn: date,
      timeZone: z.string().min(1),
      title: z.string(),
    })
    .nullable()
    .default(null),
  selectedPlanDayId: uuid.nullable().default(null),
  planDays: z
    .array(
      z.object({
        id: uuid,
        name: z.string(),
        planName: z.string(),
        planId: uuid.optional(),
        weekId: uuid.optional(),
        weekNumber: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  exercises: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      resistanceType: z.string().nullable(),
      oneRmSuitability: z.enum(["SUITABLE", "NOT_SUITABLE", "UNDETERMINED"]),
    }),
  ),
  completedSessions: z.number().int().nonnegative(),
  frequency: z.array(
    z.object({ week: date, sessions: z.number().int().positive() }),
  ),
  series: z.array(
    z.object({
      kind: z.enum(["RECORDED_LOAD_REPETITIONS", "BODYWEIGHT_REPETITIONS"]),
      load: decimal.nullable(),
      unit: z.enum(["KG", "LB"]).nullable(),
      points: z.array(point),
      bestRepetitions: z.number().int().positive(),
      comparison: z.object({
        state: z.enum(["COMPARED", "BASELINE", "AMBIGUOUS"]),
        repetitionsDelta: z.number().int().nullable(),
      }),
    }),
  ),
  estimates: z.array(
    z.object({
      id: uuid,
      sessionId: uuid,
      setId: uuid,
      performedOn: date.nullable(),
      formula: z.enum(["EPLEY", "BRZYCKI"]),
      value: decimal,
      unit: z.literal("KG"),
      algorithmVersion: z.string().min(1),
      eligibilityVersion: z.string().min(1),
      numericPolicyKey: z.string().regex(/^[a-f0-9]{64}$/),
      warnings: z.array(z.string()),
    }),
  ),
  volume: z.object({ status: z.literal("UNAVAILABLE"), message: z.string() }),
  duration: z.object({ status: z.literal("UNSUPPORTED"), message: z.string() }),
  metadata: z.object({
    dateBasis: z.literal("PERFORMED_ON"),
    weekStartsOn: z.literal("MONDAY"),
    undatedSessions: z.number().int().nonnegative(),
    truncated: z.object({
      sessions: z.boolean(),
      exercises: z.boolean(),
      tasks: z.boolean(),
      sets: z.boolean(),
      estimates: z.boolean(),
    }),
    limits: z.object({
      sessions: z.number(),
      exercises: z.number(),
      tasks: z.number(),
      sets: z.number(),
      estimates: z.number(),
    }),
    observedFrom: date.nullable(),
    observedTo: date.nullable(),
  }),
});
export type WorkoutProgress = z.infer<typeof workoutProgressSchema>;
export type ProgressPeriod = WorkoutProgress["period"];
