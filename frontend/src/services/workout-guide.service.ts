import { api } from "./api";
import {
  workoutGuideSchema,
  workoutGuidePreviewInputSchema,
  type WorkoutGuidePreviewInput,
  workoutGuideQuerySchema,
  workoutRepetitionPreviewInputSchema,
  type WorkoutRepetitionPreviewInput,
  type WorkoutGuideQuery,
} from "../schemas/workout-guide.schema";
export const workoutGuideService = {
  async repetitionPreview(
    input: WorkoutRepetitionPreviewInput,
    signal?: AbortSignal,
  ) {
    const { data } = await api.post<unknown>(
      "/progression/workout-guide/repetition-preview",
      workoutRepetitionPreviewInputSchema.parse(input),
      { signal },
    );
    return workoutGuideSchema.parse(data);
  },
  async preview(input: WorkoutGuidePreviewInput, signal?: AbortSignal) {
    const { data } = await api.post<unknown>(
      "/progression/workout-guide/preview",
      workoutGuidePreviewInputSchema.parse(input),
      { signal },
    );
    return workoutGuideSchema.parse(data);
  },
  async get(query: WorkoutGuideQuery, signal?: AbortSignal) {
    const { data } = await api.get<unknown>("/progression/workout-guide", {
      params: workoutGuideQuerySchema.parse(query),
      signal,
    });
    return workoutGuideSchema.parse(data);
  },
};
