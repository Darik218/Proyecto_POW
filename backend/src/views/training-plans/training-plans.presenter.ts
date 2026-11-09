import type {
  TrainingPlan,
  PlanDetailAttributes,
  PlanWeekAttributes,
  PlanPrescription,
} from '../../models/training-plans/training-plan.model';

export class TrainingPlansPresenter {
  summary(plan: TrainingPlan) {
    const fields = plan.attributes;
    return {
      id: fields.id,
      name: fields.name,
      startsOn: fields.startsOn,
      endsOn: fields.endsOn,
      status: fields.status,
      ...(fields.version === undefined ? {} : { version: fields.version }),
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    };
  }
  list(plans: TrainingPlan[]) {
    return plans.map((plan) => this.summary(plan));
  }
  week(week: PlanWeekAttributes) {
    return {
      id: week.id,
      weekNumber: week.weekNumber,
      objective: week.objective,
      ...(week.startsOn === undefined ? {} : { startsOn: week.startsOn }),
    };
  }
  prescription(row: PlanPrescription) {
    return {
      id: row.id,
      position: row.position,
      targetSets: row.targetSets,
      targetReps: row.targetReps,
      ...(row.targetRepsMin === undefined
        ? {}
        : { targetRepsMin: row.targetRepsMin }),
      ...(row.targetRepsMax === undefined
        ? {}
        : { targetRepsMax: row.targetRepsMax }),
      ...(row.targetLoadUnit === undefined
        ? {}
        : { targetLoadUnit: row.targetLoadUnit }),
      targetRpe: row.targetRpe === null ? null : Number(row.targetRpe),
      targetLoad: row.targetLoad === null ? null : Number(row.targetLoad),
      notes: row.notes,
      exercise: {
        id: row.exercise.id,
        name: row.exercise.name,
        muscleGroup: row.exercise.muscleGroup,
        equipment: row.exercise.equipment,
        description: row.exercise.description,
        ...(row.exercise.primaryMuscleGroup === undefined
          ? {}
          : {
              primaryMuscleGroup: {
                name: row.exercise.primaryMuscleGroup.name,
              },
            }),
      },
    };
  }
  prescriptions(rows: PlanPrescription[]) {
    return rows.map((row) => this.prescription(row));
  }
  detail(plan: TrainingPlan<PlanDetailAttributes>) {
    return {
      ...this.summary(plan),
      weeks: plan.attributes.weeks.map((week) => ({
        ...this.week(week),
        exercises: this.prescriptions(week.exercises),
      })),
    };
  }
  deleted(): { deleted: true } {
    return { deleted: true };
  }
}
