import type { DailyPrescriptionDto } from './dto/daily-planning.dto';

export class PlanningError extends Error {
  constructor(
    public readonly kind: 'missing' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
export type Targets = {
  targetReps: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: number | null;
  targetLoadUnit: 'KG' | 'LB' | null;
};
export function prescriptionTargets(
  input: DailyPrescriptionDto,
  previous?: Targets,
) {
  const changingReps =
    input.targetReps !== undefined ||
    input.targetRepsMin !== undefined ||
    input.targetRepsMax !== undefined;
  let min = previous?.targetRepsMin ?? previous?.targetReps ?? null;
  let max = previous?.targetRepsMax ?? previous?.targetReps ?? null;
  if (changingReps) {
    min = input.targetRepsMin ?? input.targetReps ?? null;
    max = input.targetRepsMax ?? input.targetReps ?? null;
    if (
      min === null ||
      max === null ||
      min > max ||
      (input.targetReps != null &&
        (input.targetReps !== min || input.targetReps !== max))
    ) {
      throw new PlanningError(
        'invalid',
        'Provide exact repetitions or a complete, consistent repetition range.',
      );
    }
  }
  if (min === null || max === null)
    throw new PlanningError('invalid', 'Target repetitions are required.');
  const load =
    input.targetLoad === undefined
      ? (previous?.targetLoad ?? null)
      : input.targetLoad;
  const unit =
    input.targetLoadUnit === undefined
      ? (previous?.targetLoadUnit ?? null)
      : input.targetLoadUnit;
  if (load === null && input.targetLoadUnit != null)
    throw new PlanningError('invalid', 'A load unit requires a target load.');
  // Existing ambiguous raw values are preserved unless the client changes them.
  const unchangedUnknown =
    previous?.targetLoadUnit === null &&
    load === previous.targetLoad &&
    input.targetLoadUnit == null;
  if (load !== null && unit === null && !unchangedUnknown)
    throw new PlanningError('invalid', 'An explicit load unit is required.');
  return {
    targetReps: min === max ? min : null,
    targetRepsMin: min,
    targetRepsMax: max,
    targetLoad: load,
    targetLoadUnit: load === null ? null : unit,
  };
}
export function assertPermutation(ids: string[], rows: Array<{ id: string }>) {
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !rows.some((row) => row.id === id))
  ) {
    throw new PlanningError(
      'invalid',
      'Reordering requires exactly the identifiers belonging to this resource.',
    );
  }
}
