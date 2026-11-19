import { z } from "zod";
import { api } from "./api";
import {
  workoutInsightsSchema,
  exerciseReferenceSchema,
} from "../schemas/workout-insights.schema";
export type WorkoutInsights = z.infer<typeof workoutInsightsSchema>;
export const workoutInsightsService = {
  async get(
    sessionId: string,
    externalTotalExerciseId?: string,
    signal?: AbortSignal,
  ) {
    const { data } = await api.get<unknown>(
      `/workout-sessions/${z.uuidv4().parse(sessionId)}/insights`,
      {
        params: externalTotalExerciseId
          ? {
              externalTotalExerciseId: z
                .uuidv4()
                .parse(externalTotalExerciseId),
            }
          : undefined,
        signal,
      },
    );
    return workoutInsightsSchema.parse(data);
  },
  async reference(exerciseId: string, before?: string, signal?: AbortSignal) {
    const { data } = await api.get<unknown>(
      "/workout-sessions/exercise-reference",
      {
        params: {
          exerciseId: z.uuidv4().parse(exerciseId),
          ...(before ? { before: z.iso.date().parse(before) } : {}),
        },
        signal,
      },
    );
    return exerciseReferenceSchema.parse(data);
  },
};
