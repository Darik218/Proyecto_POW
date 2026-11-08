import { Decimal } from '@prisma/client/runtime/client';
import type { WorkoutTargetsDto } from './dto/workout-preparation.dto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
export type WorkoutTargets = {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: string | null;
  targetLoadUnit: 'KG' | 'LB' | null;
  targetRpe: number | null;
};
export type ExerciseSnapshot = {
  source: {
    kind: 'PLAN_DAY' | 'SESSION' | 'FREE';
    id: string | null;
    plan?: { id: string; name: string };
    week?: { id: string; weekNumber: number };
    day?: { id: string; name: string; weekday: number | null };
  };
  exercise: {
    id: string;
    name: string;
    equipment: string;
    muscleGroup: string;
  };
  targets: WorkoutTargets;
  position: number;
  notes: string | null;
};
export const emptyTargets: WorkoutTargets = {
  targetSets: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetLoad: null,
  targetLoadUnit: null,
  targetRpe: null,
};
export function targets(
  input: WorkoutTargetsDto,
  previous: WorkoutTargets = emptyTargets,
): WorkoutTargets {
  const result = { ...previous };
  for (const key of [
    'targetSets',
    'targetRepsMin',
    'targetRepsMax',
    'targetLoad',
    'targetLoadUnit',
    'targetRpe',
  ] as const) {
    if (input[key] !== undefined) Object.assign(result, { [key]: input[key] });
  }
  if (
    (result.targetRepsMin === null) !== (result.targetRepsMax === null) ||
    (result.targetRepsMin !== null &&
      result.targetRepsMax! < result.targetRepsMin)
  )
    throw new WorkoutRepositoryError(
      'invalid',
      'Provide a complete repetition range with minimum <= maximum.',
    );
  if (result.targetLoad === null) {
    if (input.targetLoadUnit != null)
      throw new WorkoutRepositoryError('invalid', 'A unit requires a load.');
    result.targetLoadUnit = null;
  } else {
    result.targetLoad = new Decimal(result.targetLoad).toString();
    const unchangedUnknown =
      previous.targetLoad !== null &&
      previous.targetLoadUnit === null &&
      new Decimal(previous.targetLoad).equals(result.targetLoad);
    if (result.targetLoadUnit === null && !unchangedUnknown)
      throw new WorkoutRepositoryError(
        'invalid',
        'An explicit load unit is required.',
      );
  }
  return result;
}
