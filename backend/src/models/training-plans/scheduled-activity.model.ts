import type {
  ScheduledActivityStatus,
  WorkoutStatus,
} from '../../generated/prisma/client';

export type ScheduledActivityAttributes = {
  id: string;
  planWeekId: string | null;
  planDayId: string | null;
  originalPlanDayId: string | null;
  originalOn: Date;
  scheduledOn: Date;
  timeZone: string;
  title: string;
  status: ScheduledActivityStatus;
  version: number;
  workouts: Array<{
    id: string;
    status: WorkoutStatus;
    performedOn: Date | null;
  }>;
};

// Calendar intent and its execution references remain distinct concepts.
export class ScheduledActivity {
  constructor(readonly attributes: Readonly<ScheduledActivityAttributes>) {}
}

// Durable application result of a planning command, also used on idempotent replay.
export type PlanningChange = { planId: string; dayIds?: string[] };
