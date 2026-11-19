import type {
  ProgressRead,
  ProgressWindow,
} from '../models/workout-sessions/workout-progress.model';
export const WORKOUT_PROGRESS_REPOSITORY = Symbol(
  'WORKOUT_PROGRESS_REPOSITORY',
);
export class WorkoutProgressError extends Error {
  constructor(readonly code: 'AUTHENTICATION_REQUIRED' | 'SOURCE_NOT_FOUND') {
    super(code);
  }
}
export interface WorkoutProgressRepository {
  read(
    userId: string,
    sessionId: string,
    window: ProgressWindow,
    exerciseId?: string,
    planDayId?: string,
    planId?: string,
  ): Promise<ProgressRead>;
}
