import { comparableTasks } from './comparability.policy';
import { validatePerformanceQuery } from './performance-query.policy';
import type {
  PerformanceTask,
  TaskContext,
  PerformanceQuery,
} from '../../models/progression/performance-analysis.model';

const id = '00000000-0000-4000-8000-000000000001';
const query = (): PerformanceQuery => ({
  exerciseId: id,
  from: '2026-01-01',
  to: '2026-01-31',
  timeZone: 'America/Bogota',
  limit: 20,
});
const task = (date: string): PerformanceTask => ({
  id: 'task',
  athleteId: 'athlete',
  exerciseId: 'exercise',
  sessionId: 'session',
  sessionVersion: 0,
  sessionStatus: 'COMPLETED',
  orderInSession: 1,
  isOmitted: false,
  performedOn: date,
  timeZone: 'America/Bogota',
  availableSets: 1,
  originalTargets: null,
  adjustedTargets: {
    targetSets: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetLoad: null,
    targetLoadUnit: null,
    targetRpe: null,
  },
});
const context = (): TaskContext => ({
  workoutExerciseId: 'task',
  loadMeaning: 'EXTERNAL_TOTAL',
  protocolKey: 'explicit-protocol',
  equipmentKey: 'explicit-equipment',
  source: 'OWNER_DECLARATION_FOR_ANALYSIS',
});

describe('performance query and conservative comparability', () => {
  it('accepts an explicit window and makes independent copies of contexts', () => {
    const input = {
      ...query(),
      contexts: [{ ...context(), workoutExerciseId: id }],
    };
    expect(validatePerformanceQuery(input)).toMatchObject({
      ...input,
      comparisons: [],
    });
    expect(validatePerformanceQuery(input).contexts[0]).not.toBe(
      input.contexts[0],
    );
  });
  it.each([
    { from: '2026-02-30' },
    { from: '2026-02-01' },
    { to: 'not-date' },
    { timeZone: 'not-zone' },
    { limit: 0 },
    { limit: 101 },
    { limit: 2.5 },
  ])('rejects invalid query %j', (change) => {
    expect(() => validatePerformanceQuery({ ...query(), ...change })).toThrow(
      'INVALID_QUERY',
    );
  });
  it.each([{ contexts: [null] }, { comparisons: [null] }])(
    'rejects malformed nested input with a typed error',
    (change) => {
      expect(() =>
        validatePerformanceQuery({
          ...query(),
          ...change,
        } as unknown as PerformanceQuery),
      ).toThrow('INVALID_QUERY');
    },
  );
  it('accepts matching explicit context for distinct sporting dates', () => {
    expect(
      comparableTasks(
        task('2026-01-01'),
        { ...task('2026-01-08'), id: 'other' },
        context(),
        context(),
        'America/Bogota',
      ),
    ).toEqual([]);
  });
  it.each([
    [{ athleteId: 'other' }, 'ATHLETE_MISMATCH'],
    [{ exerciseId: 'other' }, 'EXERCISE_MISMATCH'],
    [{ performedOn: null }, 'DATE_UNKNOWN'],
    [{ performedOn: '2026-01-01' }, 'INTRADAY_ORDER_UNKNOWN'],
    [{ performedOn: '2025-12-31' }, 'REVERSED_DATE_ORDER'],
    [{ timeZone: 'UTC' }, 'TIME_ZONE_MISMATCH'],
    [{ sessionStatus: 'IN_PROGRESS' }, 'SESSION_NOT_COMPLETED'],
    [{ isOmitted: true }, 'EXERCISE_OMITTED'],
  ] satisfies Array<[Partial<PerformanceTask>, string]>)(
    'does not claim temporal comparability for %j',
    (change, reason) => {
      expect(
        comparableTasks(
          task('2026-01-01'),
          { ...task('2026-01-08'), ...change },
          context(),
          context(),
          'America/Bogota',
        ),
      ).toContain(reason);
    },
  );
  it.each([
    [null, 'PROTOCOL_NOT_COMPARABLE'],
    [{ ...context(), protocolKey: 'another' }, 'PROTOCOL_NOT_COMPARABLE'],
    [{ ...context(), equipmentKey: 'another' }, 'EQUIPMENT_NOT_COMPARABLE'],
    [{ ...context(), loadMeaning: 'PER_HAND' }, 'LOAD_MEANING_CONFLICT'],
  ] satisfies Array<[TaskContext | null, string]>)(
    'requires explicit protocol, equipment and load meaning',
    (other, reason) => {
      expect(
        comparableTasks(
          task('2026-01-01'),
          task('2026-01-08'),
          context(),
          other,
          'America/Bogota',
        ),
      ).toContain(reason);
    },
  );
});
