import type {
  PerformanceQuery,
  ValidatedPerformanceQuery,
} from '../../models/progression/performance-analysis.model';
import { PerformanceError } from '../../models/progression/performance-analysis.model';

export const PERFORMANCE_LIMITS = Object.freeze({
  tasks: 100,
  sets: 1000,
  estimates: 2000,
  comparisons: 50,
});
export function validSportDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith('0000') &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  );
}
export function validatePerformanceQuery(
  input: PerformanceQuery,
): ValidatedPerformanceQuery {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const invalid = () => {
    throw new PerformanceError('INVALID_QUERY');
  };
  if (
    !input ||
    !uuid.test(input.exerciseId) ||
    !validSportDate(input.from) ||
    !validSportDate(input.to) ||
    input.from > input.to ||
    typeof input.timeZone !== 'string' ||
    input.timeZone.length > 100 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > PERFORMANCE_LIMITS.tasks
  )
    invalid();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(0);
  } catch {
    invalid();
  }
  const contexts = input.contexts ?? [],
    comparisons = input.comparisons ?? [];
  if (
    !Array.isArray(contexts) ||
    contexts.length > PERFORMANCE_LIMITS.tasks ||
    !Array.isArray(comparisons) ||
    comparisons.length > PERFORMANCE_LIMITS.comparisons
  )
    invalid();
  const ids = new Set<string>();
  for (const item of contexts) {
    if (
      !item ||
      typeof item !== 'object' ||
      !uuid.test(item.workoutExerciseId) ||
      ids.has(item.workoutExerciseId) ||
      item.source !== 'OWNER_DECLARATION_FOR_ANALYSIS' ||
      ![
        'EXTERNAL_TOTAL',
        'PER_HAND',
        'MACHINE_NOMINAL',
        'BODYWEIGHT',
        'ASSISTANCE',
        'NON_QUANTIFIABLE',
        'UNKNOWN',
      ].includes(item.loadMeaning)
    )
      invalid();
    for (const key of [item.protocolKey, item.equipmentKey])
      if (
        key !== null &&
        (typeof key !== 'string' || !key.trim() || key.length > 120)
      )
        invalid();
    ids.add(item.workoutExerciseId);
  }
  for (const pair of comparisons)
    if (
      !pair ||
      typeof pair !== 'object' ||
      !uuid.test(pair.previousTaskId) ||
      !uuid.test(pair.currentTaskId) ||
      pair.previousTaskId === pair.currentTaskId
    )
      invalid();
  return {
    exerciseId: input.exerciseId,
    from: input.from,
    to: input.to,
    timeZone: input.timeZone,
    limit: input.limit,
    contexts: contexts.map((c) => ({
      workoutExerciseId: c.workoutExerciseId,
      loadMeaning: c.loadMeaning,
      protocolKey: c.protocolKey,
      equipmentKey: c.equipmentKey,
      source: c.source,
    })),
    comparisons: comparisons.map((p) => ({
      previousTaskId: p.previousTaskId,
      currentTaskId: p.currentTaskId,
    })),
  };
}
