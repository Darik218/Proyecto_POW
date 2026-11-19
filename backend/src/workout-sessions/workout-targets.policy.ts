import { Decimal } from '@prisma/client/runtime/client';
import type { WorkoutTargetsDto } from './dto/workout-preparation.dto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
import type { WorkoutTargets } from '../models/workout-sessions/workout-exercise.model';
export type { WorkoutTargets, ExerciseSnapshot } from '../models/workout-sessions/workout-exercise.model';
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
