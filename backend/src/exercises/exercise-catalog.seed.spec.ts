import { exercises, muscleGroups } from '../../prisma/exercise-catalog.seed';

describe('initial exercise catalog data', () => {
  it('contains a broad catalog with stable unique keys and names', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(200);
    expect(exercises.length).toBeLessThanOrEqual(300);
    expect(new Set(exercises.map(({ catalogKey }) => catalogKey)).size).toBe(exercises.length);
    expect(new Set(exercises.map(({ name }) => name)).size).toBe(exercises.length);
  });

  it('covers the required muscle groups and references only seeded groups', () => {
    const keys = new Set(muscleGroups.map(({ key }) => key));
    expect([...keys]).toEqual(expect.arrayContaining([
      'pectorales', 'dorsales', 'espalda-alta', 'trapecio', 'deltoides', 'biceps', 'triceps',
      'antebrazos', 'abdominales', 'oblicuos', 'erectores-espinales', 'gluteos', 'cuadriceps',
      'isquiotibiales', 'aductores', 'abductores', 'gemelos', 'soleo',
    ]));
    for (const exercise of exercises) {
      expect(keys.has(exercise.primaryMuscleGroupKey)).toBe(true);
      expect(exercise.secondaryMuscleGroupKeys.every((key) => keys.has(key))).toBe(true);
      expect(exercise.secondaryMuscleGroupKeys).not.toContain(exercise.primaryMuscleGroupKey);
    }
  });

  it('marks 1RM suitability explicitly and conservatively', () => {
    expect(exercises.every(({ oneRmSuitability }) => ['SUITABLE', 'NOT_SUITABLE', 'UNDETERMINED'].includes(oneRmSuitability))).toBe(true);
    expect(exercises.some(({ oneRmSuitability }) => oneRmSuitability === 'UNDETERMINED')).toBe(true);
  });
});
