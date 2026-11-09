import type { Decimal } from '@prisma/client/runtime/client';
import type {
  MeasurementUnit,
  PlanStatus,
} from '../../generated/prisma/client';

export type PlanAttributes = {
  id: string;
  name: string;
  startsOn: Date | null;
  endsOn: Date | null;
  status: PlanStatus;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
};
export type PlanWeekAttributes = {
  id: string;
  weekNumber: number;
  startsOn?: Date | null;
  objective: string | null;
};
export type PlanningExercise = {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  description: string | null;
  primaryMuscleGroup?: { name: string };
};
export type PlanPrescription = {
  id: string;
  position: number;
  targetSets: number;
  targetReps: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetLoadUnit?: MeasurementUnit | null;
  targetRpe: Decimal | null;
  targetLoad: Decimal | null;
  notes: string | null;
  exercise: PlanningExercise;
};
export type PlanDetailAttributes = PlanAttributes & {
  weeks: Array<PlanWeekAttributes & { exercises: PlanPrescription[] }>;
};

// An application projection, not a Prisma row or a public JSON representation.
export class TrainingPlan<T extends PlanAttributes = PlanAttributes> {
  constructor(readonly attributes: Readonly<T>) {}

  get isDraft(): boolean {
    return this.attributes.status === 'DRAFT';
  }
}
