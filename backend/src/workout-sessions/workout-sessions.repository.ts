import type {
  ExerciseSnapshot,
  WorkoutTargets,
} from './workout-targets.policy';
import type { PreparationCommand } from './prisma-workout-sessions.repository';
import type {
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
  SaveWorkoutDayDto,
} from './dto/workout-preparation.dto';
import type { WorkoutStatus } from '../generated/prisma/client';
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
export type WorkoutSummary = {
  scheduledActivityId?: string | null;
  id: string;
  status: WorkoutStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  trainingPlan: { id: string; name: string } | null;
  planWeek: { id: string; weekNumber: number } | null;
  exerciseCount: number;
  planDay?: { id: string; name: string; weekday: number | null } | null;
  performedOn?: Date | null;
  timeZone?: string | null;
  recordingMode?: string | null;
  actualSetCount?: number;
  completedSetCount?: number;
  sourceSnapshot?: unknown;
  name?: string | null;
  version?: number;
  completedAt?: Date | null;
};
export type WorkoutDetail = WorkoutSummary & {
  exercises: Array<{
    sets?: Array<{
      id: string;
      setNumber: number;
      load: string | null;
      loadUnit: 'KG' | 'LB' | null;
      loadKg: string | null;
      repetitions: number | null;
      rpe: number | null;
      kind: 'WARMUP' | 'WORK' | null;
      status:
        'PENDING' | 'COMPLETED' | 'INCOMPLETE' | 'FAILED' | 'SKIPPED' | null;
      isCompleted: boolean;
      notes: string | null;
      recordedAt: Date;
      version: number;
    }>;
    original?: ExerciseSnapshot | null;
    targets?: WorkoutTargets;
    isOmitted?: boolean;
    replacesWorkoutExerciseId?: string | null;
    id: string;
    orderInSession: number;
    notes: string | null;
    exercise: {
      id: string;
      name: string;
      equipment: string;
      muscleGroup: string;
    };
    prescription: {
      id: string;
      targetSets: number;
      targetReps: number | null;
      targetRepsMin?: number | null;
      targetRepsMax?: number | null;
      targetLoadUnit?: 'KG' | 'LB' | null;
      targetRpe: number | null;
      targetLoad: number | null;
      notes: string | null;
    } | null;
  }>;
};
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
  ): Promise<{
    id: string;
    name: string;
    planWeekId: string;
    trainingPlanId: string;
  }>;
  associate(
    athleteId: string,
    id: string,
    input: AssociateWorkoutDto,
  ): Promise<WorkoutDetail>;
  suggestions(
    athleteId: string,
    input: WorkoutSuggestionsDto,
  ): Promise<unknown>;
}
