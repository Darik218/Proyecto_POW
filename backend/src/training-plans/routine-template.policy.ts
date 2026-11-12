import type { RoutineDayTemplateDto } from './dto/flexible-planning.dto';
import { PlanningError, prescriptionTargets } from './daily-planning.policy';
/** Only the builder's explicit distribution and input integrity; no training policy defaults. */
export function validateRoutineTemplates(
  days: RoutineDayTemplateDto[],
  rest: number[] = [],
) {
  const weekdays = days.flatMap((d) => (d.weekday == null ? [] : [d.weekday]));
  if (
    new Set(rest).size !== rest.length ||
    rest.some(
      (d) => !Number.isInteger(d) || d < 1 || d > 7 || weekdays.includes(d),
    )
  )
    throw new PlanningError(
      'invalid',
      'Training weekdays and rest must be distinct.',
    );
  for (const day of days) {
    const rows = day.exercises ?? [];
    if (new Set(rows.map((r) => r.position)).size !== rows.length)
      throw new PlanningError(
        'invalid',
        'Prescription positions must be unique.',
      );
    for (const row of rows) {
      // Reuse the current repetition/range policy, with exact decimal handling kept separate.
      prescriptionTargets({
        targetReps: row.targetReps,
        targetRepsMin: row.targetRepsMin,
        targetRepsMax: row.targetRepsMax,
        targetLoad: null,
        targetLoadUnit: null,
      });
      if (
        !Number.isInteger(row.targetSets) ||
        row.targetSets < 1 ||
        row.targetSets > 1000 ||
        !Number.isInteger(row.position) ||
        row.position < 1 ||
        row.position > 1000
      )
        throw new PlanningError(
          'invalid',
          'Invalid prescription sets or position.',
        );
      if (
        (row.targetLoad != null &&
          (!/^\d{1,5}(\.\d{1,3})?$/.test(row.targetLoad) ||
            !['KG', 'LB'].includes(row.targetLoadUnit ?? ''))) ||
        (row.targetLoad == null && row.targetLoadUnit != null)
      )
        throw new PlanningError(
          'invalid',
          'A target load requires its explicit unit and at most three decimals.',
        );
    }
  }
}
