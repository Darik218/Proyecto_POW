import { targets, emptyTargets } from './workout-targets.policy';
import { executedSet } from './workout-sets.policy';
import { localDate, requireVersion } from './workout-calendar.policy';
import type { WorkoutSetInputDto } from './dto/workout-preparation.dto';

describe('R2 local calendar, objectives and actual sets', () => {
  it('uses explicit time zones across midnight, rejecting unknown zones', () => {
    const now = new Date('2026-01-06T01:00:00Z');
    expect(localDate('UTC', now)).toBe('2026-01-06');
    expect(localDate('America/Bogota', now)).toBe('2026-01-05');
    expect(() => localDate('Not/AZone')).toThrow();
    expect(() => localDate('+05:00')).toThrow();
  });
  it('detects stale edits without inventing replacement objectives', () => {
    expect(() => requireVersion(2, 1)).toThrow();
    expect(targets({})).toEqual(emptyTargets);
    expect(() => targets({ targetRepsMin: 8 })).toThrow();
    expect(() => targets({ targetRepsMin: 10, targetRepsMax: 8 })).toThrow();
    expect(() => targets({ targetLoad: '80' })).toThrow();
    const unknown = { ...emptyTargets, targetLoad: '42.125' };
    expect(targets({ targetSets: 3 }, unknown).targetLoadUnit).toBeNull();
    expect(() => targets({ targetLoad: '43' }, unknown)).toThrow();
  });
  it('preserves entered lb while calculating canonical kg with decimal arithmetic', () => {
    const input: WorkoutSetInputDto = {
      expectedVersion: 0,
      setNumber: 1,
      status: 'COMPLETED',
      kind: 'WORK',
      load: '165.347',
      loadUnit: 'LB',
      repetitions: 6,
    };
    const stored = executedSet(input);
    expect(stored.load?.toString()).toBe('165.347');
    expect(stored.loadKg?.toString()).toBe('75.000138');
    expect(stored.loadUnit).toBe('LB');
    expect(stored.isCompleted).toBe(true);
  });
  it('keeps pending and skipped sets free of executed data and failed attempts explicit', () => {
    const base = {
      expectedVersion: 0,
      setNumber: 1,
      status: 'PENDING',
      kind: 'WORK',
    } satisfies WorkoutSetInputDto;
    expect(executedSet(base)).toMatchObject({
      load: null,
      repetitions: null,
      isCompleted: false,
    });
    expect(() => executedSet({ ...base, load: '80' })).toThrow();
    expect(() =>
      executedSet({
        ...base,
        status: 'COMPLETED',
        load: '80',
        loadUnit: 'KG',
        repetitions: 0,
      }),
    ).toThrow();
    expect(
      executedSet({
        ...base,
        status: 'FAILED',
        load: '80',
        loadUnit: 'KG',
        repetitions: 0,
      }).isCompleted,
    ).toBe(false);
    expect(() =>
      executedSet({
        ...base,
        status: 'FAILED',
        load: '80',
        loadUnit: 'KG',
        repetitions: 1,
      }),
    ).toThrow();
  });
});
