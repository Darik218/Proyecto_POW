import type { PreparationCommand } from './prisma-workout-sessions.repository';
import type {
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
  SaveWorkoutDayDto,
} from './dto/workout-preparation.dto';
import type { WorkoutSession, WorkoutDetailAttributes, WorkoutSummaryAttributes, WorkoutSuggestions, SavedWorkoutDay } from '../models/workout-sessions/workout-session.model';
import type {
  CreateWorkoutSessionDto,
  AddWorkoutExerciseDto,
  ListWorkoutSessionsDto,
  AssociateWorkoutDto,
  WorkoutSuggestionsDto,
} from './dto/workout-session.dto';

export const WORKOUT_SESSIONS_REPOSITORY = Symbol(
  'WORKOUT_SESSIONS_REPOSITORY',
);
export type WorkoutSummary = WorkoutSession<WorkoutSummaryAttributes>;
export type WorkoutDetail = WorkoutSession<WorkoutDetailAttributes>;
export type WorkoutPage = {
  items: WorkoutSummary[];
  total: number;
  limit: number;
  offset: number;
};
export class WorkoutRepositoryError extends Error {
  constructor(
    readonly kind: 'missing' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
export interface WorkoutSessionsRepository {
  list(athleteId: string, query: ListWorkoutSessionsDto): Promise<WorkoutPage>;
  get(athleteId: string, id: string): Promise<WorkoutDetail | null>;
  create(
    athleteId: string,
    input: CreateWorkoutSessionDto,
  ): Promise<WorkoutDetail>;
  addExercise(
    athleteId: string,
    id: string,
    input: AddWorkoutExerciseDto,
  ): Promise<WorkoutDetail>;
  start(
    athleteId: string,
    id: string,
    expectedVersion: number,
  ): Promise<WorkoutDetail>;
  complete(
    athleteId: string,
    id: string,
    expectedVersion: number,
    confirmWithoutResults?: boolean,
  ): Promise<WorkoutDetail>;
  recordSet(
    athleteId: string,
    id: string,
    exerciseId: string,
    input: CreateWorkoutSetDto | UpdateWorkoutSetDto,
    setId?: string,
  ): Promise<WorkoutDetail>;
  cancel(
    athleteId: string,
    id: string,
    expectedVersion: number,
  ): Promise<WorkoutDetail>;
  prepare(
    athleteId: string,
    id: string,
    command: PreparationCommand,
  ): Promise<WorkoutDetail>;
  saveDay(
    athleteId: string,
    id: string,
    input: SaveWorkoutDayDto,
  ): Promise<SavedWorkoutDay>;
  associate(
    athleteId: string,
    id: string,
    input: AssociateWorkoutDto,
  ): Promise<WorkoutDetail>;
  suggestions(
    athleteId: string,
    input: WorkoutSuggestionsDto,
  ): Promise<WorkoutSuggestions>;
}
