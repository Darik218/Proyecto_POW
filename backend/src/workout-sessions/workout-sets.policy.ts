import { Decimal } from '@prisma/client/runtime/client';
import type { WorkoutSetInputDto } from './dto/workout-preparation.dto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
export function executedSet(input: WorkoutSetInputDto) {
  const load = input.load == null ? null : new Decimal(input.load);
  const reps = input.repetitions ?? null;
  const rpe = input.rpe ?? null;
  if (input.status === 'PENDING' || input.status === 'SKIPPED') {
    if (
      load !== null ||
      reps !== null ||
      rpe !== null ||
      input.loadUnit != null
    )
      throw new WorkoutRepositoryError(
        'invalid',
        'Pending and skipped sets cannot contain executed results.',
      );
  } else {
    if (load === null || load.isNegative() || !input.loadUnit || reps === null)
      throw new WorkoutRepositoryError(
        'invalid',
        'An executed set requires load, unit and repetitions.',
      );
    if (
      (input.status === 'COMPLETED' && reps < 1) ||
      (input.status === 'FAILED' && reps !== 0)
    )
      throw new WorkoutRepositoryError(
        'invalid',
        'Completed sets require repetitions; failed attempts explicitly record zero repetitions.',
      );
  }
  const loadKg =
    load === null
      ? null
      : load
          .mul(input.loadUnit === 'LB' ? '0.45359237' : '1')
          .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  return {
    setNumber: input.setNumber,
    status: input.status,
    kind: input.kind,
    load,
    loadUnit: input.loadUnit ?? null,
    loadKg,
    repetitions: reps,
    rpe,
    notes: input.notes ?? null,
    isCompleted: input.status === 'COMPLETED',
  };
}
