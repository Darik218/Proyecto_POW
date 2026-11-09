import type { Decimal } from '@prisma/client/runtime/client';
import type { MeasurementUnit } from '../../generated/prisma/client';
import type { SetRecordAttributes } from './set-record.model';

export type WorkoutTargets = {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: string | null;
  targetLoadUnit: 'KG' | 'LB' | null;
  targetRpe: number | null;
};
export type ExerciseIdentity = {
  id: string;
  name: string;
  equipment: string;
  muscleGroup: string;
};
// Historical JSON uses canonical strings, whereas live persisted targets retain Decimal.
export type ExerciseSnapshot = {
  source: {
    kind: 'PLAN_DAY' | 'SESSION' | 'FREE';
    id: string | null;
    plan?: { id: string; name: string };
    week?: { id: string; weekNumber: number };
    day?: { id: string; name: string; weekday: number | null };
  };
  exercise: ExerciseIdentity;
  targets: WorkoutTargets;
  position: number;
  notes: string | null;
};
export type WorkoutTargetAttributes = Omit<
  WorkoutTargets,
  'targetLoad' | 'targetRpe'
> & {
  targetLoad: Decimal | null;
  targetRpe: Decimal | null;
};
export type WorkoutPrescription = {
  id: string;
  targetSets: number;
  targetReps: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetLoadUnit?: MeasurementUnit | null;
  targetRpe: Decimal | null;
  targetLoad: Decimal | null;
  notes: string | null;
};
export type WorkoutExerciseAttributes = {
  id: string;
  orderInSession: number;
  notes: string | null;
  exercise: ExerciseIdentity;
  prescription: WorkoutPrescription | null;
  sets?: SetRecordAttributes[];
  original?: ExerciseSnapshot | null;
  targets?: WorkoutTargetAttributes;
  isOmitted?: boolean;
  replacesWorkoutExerciseId?: string | null;
};
