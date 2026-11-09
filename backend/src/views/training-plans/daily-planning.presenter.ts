import type {
  DailyPlan,
  DailyPrescription,
  PlanDayAttributes,
} from '../../models/training-plans/daily-planning.model';
import { TrainingPlansPresenter } from './training-plans.presenter';

export class DailyPlanningPresenter {
  private readonly plans = new TrainingPlansPresenter();

  prescriptions(rows: DailyPrescription[]) {
    return rows.map((row) => ({
      ...this.plans.prescription(row),
      targetRepsMin: row.targetRepsMin ?? row.targetReps,
      targetRepsMax: row.targetRepsMax ?? row.targetReps,
      targetLoadUnit: row.targetLoadUnit,
      hasHistory: row.hasHistory,
    }));
  }
  days(days: PlanDayAttributes[]) {
    return days.map((day) => ({
      id: day.id,
      name: day.name,
      position: day.position,
      weekday: day.weekday,
      ...(day.retiredAt === undefined ? {} : { retiredAt: day.retiredAt }),
      ...(day.retiredFromOn === undefined
        ? {}
        : { retiredFromOn: day.retiredFromOn }),
      ...(day.isEditableOverride === undefined
        ? {}
        : { isEditableOverride: day.isEditableOverride }),
      hasHistory: day.hasHistory,
      exercises: this.prescriptions(day.exercises),
    }));
  }
  planning(plan: DailyPlan) {
    return {
      ...this.plans.summary(plan),
      weeks: plan.attributes.weeks.map((week) => ({
        ...this.plans.week(week),
        pendingExercises: this.prescriptions(week.pendingExercises),
        days: this.days(week.days),
      })),
    };
  }
}
