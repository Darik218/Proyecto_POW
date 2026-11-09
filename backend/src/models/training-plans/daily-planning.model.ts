import type {
  TrainingPlan,
  PlanAttributes,
  PlanWeekAttributes,
  PlanPrescription,
} from './training-plan.model';
import type { MeasurementUnit } from '../../generated/prisma/client';

// The same plan aggregate, loaded with daily organization and history facts.
export type DailyPrescription = PlanPrescription & {
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoadUnit: MeasurementUnit | null;
  hasHistory: boolean;
};
export type PlanDayAttributes = {
  id: string;
  name: string;
  position: number;
  weekday: number | null;
  retiredAt?: Date | null;
  retiredFromOn?: Date | null;
  isEditableOverride?: boolean;
  hasHistory: boolean;
  exercises: DailyPrescription[];
};
export type DailyPlanAttributes = PlanAttributes & {
  weeks: Array<
    PlanWeekAttributes & {
      days: PlanDayAttributes[];
      pendingExercises: DailyPrescription[];
    }
  >;
};
export type DailyPlan = TrainingPlan<DailyPlanAttributes>;
