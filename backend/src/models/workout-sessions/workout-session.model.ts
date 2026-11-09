import type {
  WorkoutStatus,
  WorkoutSetStatus,
} from '../../generated/prisma/client';
import type { WorkoutExerciseAttributes } from './workout-exercise.model';

export type PlanReference = { id: string; name: string };
export type WeekReference = { id: string; weekNumber: number };
export type DayReference = { id: string; name: string; weekday: number | null };
export type WorkoutSource = {
  kind: 'PLAN_DAY' | 'SESSION' | 'FREE';
  plan: PlanReference | null;
  week: WeekReference | null;
  day: DayReference | null;
  session: { id: string; name: string | null } | null;
  schedule?: { id: string; scheduledOn: string; timeZone: string };
};
export type WorkoutSummaryAttributes = {
  id: string;
  status: WorkoutStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  trainingPlan: PlanReference | null;
  planWeek: WeekReference | null;
  exerciseCount: number;
  scheduledActivityId?: string | null;
  planDay?: DayReference | null;
  performedOn?: Date | null;
  timeZone?: string | null;
  recordingMode?: string | null;
  actualSetCount?: number;
  completedSetCount?: number;
  sourceSnapshot?: WorkoutSource | null;
  name?: string | null;
  version?: number;
  completedAt?: Date | null;
};
export type WorkoutDetailAttributes = WorkoutSummaryAttributes & {
  exercises: WorkoutExerciseAttributes[];
};

export class WorkoutSession<
  T extends WorkoutSummaryAttributes = WorkoutSummaryAttributes,
> {
  constructor(readonly attributes: Readonly<T>) {}

  static resultCounts(
    exercises: ReadonlyArray<{
      sets: ReadonlyArray<{
        status: WorkoutSetStatus | null;
        isCompleted: boolean;
      }>;
    }>,
  ) {
    return {
      actualSetCount: exercises.reduce(
        (count, item) =>
          count +
          item.sets.filter(
            (set) =>
              set.status === null ||
              ['COMPLETED', 'INCOMPLETE', 'FAILED'].includes(set.status),
          ).length,
        0,
      ),
      completedSetCount: exercises.reduce(
        (count, item) =>
          count + item.sets.filter((set) => set.isCompleted).length,
        0,
      ),
    };
  }
}
export type WorkoutSuggestions = {
  performedOn: string;
  timeZone: string;
  resolution: 'SINGLE' | 'MULTIPLE' | 'NONE';
  candidates: Array<{
    scheduledActivityId?: string;
    trainingPlanId: string;
    planWeekId: string;
    planDayId: string;
    planName: string;
    weekNumber: number;
    name: string;
  }>;
};
export type SavedWorkoutDay = {
  id: string;
  name: string;
  planWeekId: string;
  trainingPlanId: string;
};
