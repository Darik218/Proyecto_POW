import { z } from "zod";
import { api } from "./api";
import { workoutProgressSchema } from "../schemas/workout-progress.schema";
import type { ProgressPeriod } from "../schemas/workout-progress.schema";
export const workoutProgressService = {
  async get(
    period: ProgressPeriod = "30",
    exerciseId?: string,
    signal?: AbortSignal,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    planDayId?: string,
    planId?: string,
  ) {
    const { data } = await api.get<unknown>("/workout-sessions/progress", {
      params: {
        timeZone: z.string().min(1).max(100).parse(timeZone),
        period: z.enum(["7", "30", "90", "all"]).parse(period),
        ...(exerciseId ? { exerciseId: z.uuidv4().parse(exerciseId) } : {}),
        ...(planDayId ? { planDayId: z.uuidv4().parse(planDayId) } : {}),
        ...(planId ? { planId: z.uuidv4().parse(planId) } : {}),
      },
      signal,
    });
    return workoutProgressSchema.parse(data);
  },
};
