import type {
  WorkoutGuideQuery,
  WorkoutGuideSnapshot,
  WorkoutGuidePreviewInput,
  WorkoutGuideRepetitionPreviewInput,
} from '../models/progression/workout-guide.model';
export const WORKOUT_GUIDE_REPOSITORY = Symbol('WORKOUT_GUIDE_REPOSITORY');
export interface WorkoutGuideRepository {
  read(
    userId: string,
    authSessionId: string,
    query: WorkoutGuideQuery,
    preview?: WorkoutGuidePreviewInput | WorkoutGuideRepetitionPreviewInput,
  ): Promise<WorkoutGuideSnapshot>;
}
