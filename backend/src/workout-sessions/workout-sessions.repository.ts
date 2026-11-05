import type { WorkoutStatus } from '../generated/prisma/client';
import type { CreateWorkoutSessionDto, AddWorkoutExerciseDto, ListWorkoutSessionsDto } from './dto/workout-session.dto';

export const WORKOUT_SESSIONS_REPOSITORY = Symbol('WORKOUT_SESSIONS_REPOSITORY');
export type WorkoutSummary = {
  id: string; status: WorkoutStatus; startedAt: Date | null; finishedAt: Date | null;
  notes: string | null; createdAt: Date; updatedAt: Date;
  trainingPlan: { id: string; name: string } | null;
  planWeek: { id: string; weekNumber: number } | null;
  exerciseCount: number;
};
export type WorkoutDetail = WorkoutSummary & {
  exercises: Array<{
    id: string; orderInSession: number; notes: string | null;
    exercise: { id: string; name: string; equipment: string; muscleGroup: string };
    prescription: { id: string; targetSets: number; targetReps: number | null; targetRepsMin?: number | null; targetRepsMax?: number | null; targetLoadUnit?: 'KG' | 'LB' | null; targetRpe: number | null; targetLoad: number | null; notes: string | null } | null;
  }>;
};
export type WorkoutPage = { items: WorkoutSummary[]; total: number; limit: number; offset: number };
export class WorkoutRepositoryError extends Error {
  constructor(readonly kind: 'missing' | 'conflict', message: string) { super(message); }
}
export interface WorkoutSessionsRepository {
  list(athleteId: string, query: ListWorkoutSessionsDto): Promise<WorkoutPage>;
  get(athleteId: string, id: string): Promise<WorkoutDetail | null>;
  create(athleteId: string, input: CreateWorkoutSessionDto): Promise<WorkoutDetail>;
  addExercise(athleteId: string, id: string, input: AddWorkoutExerciseDto): Promise<WorkoutDetail>;
  start(athleteId: string, id: string): Promise<WorkoutDetail>;
  complete(athleteId: string, id: string): Promise<WorkoutDetail>;
}
