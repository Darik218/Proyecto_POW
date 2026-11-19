import type {
  ScheduledActivity,
  PlanningChange,
} from '../../models/training-plans/scheduled-activity.model';

export class FlexiblePlanningPresenter {
  created(result: { id: string }) {
    return { id: result.id };
  }
  changed(result: PlanningChange) {
    return {
      planId: result.planId,
      ...(result.dayIds === undefined ? {} : { dayIds: [...result.dayIds] }),
    };
  }
  activity(activity: ScheduledActivity) {
    const row = activity.attributes;
    return {
      id: row.id,
      planWeekId: row.planWeekId,
      planDayId: row.planDayId,
      originalPlanDayId: row.originalPlanDayId,
      originalOn: row.originalOn,
      scheduledOn: row.scheduledOn,
      timeZone: row.timeZone,
      title: row.title,
      status: row.status,
      version: row.version,
      workouts: row.workouts.map((workout) => ({
        id: workout.id,
        status: workout.status,
        performedOn: workout.performedOn,
      })),
    };
  }
  activities(activities: ScheduledActivity[]) {
    return activities.map((activity) => this.activity(activity));
  }
}
