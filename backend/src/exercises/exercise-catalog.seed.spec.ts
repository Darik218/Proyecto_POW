import { exercises, muscleGroups } from '../../prisma/exercise-catalog.seed';
import { exerciseAliases } from '../../prisma/exercise-aliases.seed';

describe('initial exercise catalog data', () => {
  it('contains a broad catalog with stable unique keys and names', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(200);
    expect(exercises.length).toBeLessThanOrEqual(300);
    expect(new Set(exercises.map(({ catalogKey }) => catalogKey)).size).toBe(
      exercises.length,
    );
    expect(new Set(exercises.map(({ name }) => name)).size).toBe(
      exercises.length,
    );
  });

  it('covers the required muscle groups and references only seeded groups', () => {
    const keys = new Set(muscleGroups.map(({ key }) => key));
    expect([...keys]).toEqual(
      expect.arrayContaining([
        'pectorales',
        'dorsales',
        'espalda-alta',
        'trapecio',
        'deltoides',
        'biceps',
        'triceps',
        'antebrazos',
        'abdominales',
        'oblicuos',
        'erectores-espinales',
        'gluteos',
        'cuadriceps',
        'isquiotibiales',
        'aductores',
        'abductores',
        'gemelos',
        'soleo',
      ]),
    );
    for (const exercise of exercises) {
      expect(keys.has(exercise.primaryMuscleGroupKey)).toBe(true);
      expect(
        exercise.secondaryMuscleGroupKeys.every((key) => keys.has(key)),
      ).toBe(true);
      expect(exercise.secondaryMuscleGroupKeys).not.toContain(
        exercise.primaryMuscleGroupKey,
      );
    }
  });

  it('marks 1RM suitability explicitly and conservatively', () => {
    expect(
      exercises.every(({ oneRmSuitability }) =>
        ['SUITABLE', 'NOT_SUITABLE', 'UNDETERMINED'].includes(oneRmSuitability),
      ),
    ).toBe(true);
    expect(
      exercises.some(
        ({ oneRmSuitability }) => oneRmSuitability === 'UNDETERMINED',
      ),
    ).toBe(true);
  });

  it('covers the seven requested Push variants with independent stable identities and searchable aliases', () => {
    const keys = [
      'apertura-pecho-pec-deck',
      'press-banca-smith-inclinado',
      'apertura-pecho-polea-alta',
      'extension-triceps-pushdown-barra',
      'extension-triceps-overhead-cuerda',
      'press-vertical-smith',
      'elevacion-lateral-polea-unilateral',
    ];
    const rows = keys.map((key) =>
      exercises.find((row) => row.catalogKey === key)!,
    );
    expect(rows.every(Boolean)).toBe(true);
    expect(new Set(rows.map((row) => row.catalogKey)).size).toBe(7);
    for (const key of keys)
      expect(exerciseAliases[key]?.length).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({
      equipmentType: 'SMITH_MACHINE',
      movementPattern: 'HORIZONTAL_PUSH',
      movementType: 'COMPOUND',
    });
    expect(rows[0]).toMatchObject({
      equipmentType: 'MACHINE',
      movementType: 'ISOLATION',
      oneRmSuitability: 'NOT_SUITABLE',
    });
    expect(rows[6]).toMatchObject({
      movementPattern: 'SHOULDER_ABDUCTION',
      laterality: 'UNILATERAL',
    });
  });

  it('adds distinct common variants without reusing identities or claiming equivalent load conventions', () => {
    const keys = [
      'press-banca-maquina-inclinada',
      'remo-horizontal-t-bar-apoyado',
      'traccion-vertical-jalon-neutro-independiente',
      'press-vertical-polea-unilateral',
      'elevacion-lateral-polea-bilateral',
      'deltoide-posterior-polea-sentado',
      'extension-triceps-overhead-barra',
      'curl-biceps-predicador-polea',
      'sentadilla-pendular',
      'flexion-rodilla-unilateral-tumbado',
      'hip-thrust-glute-bridge-smith',
      'pantorrilla-prensa-unilateral',
    ];
    for (const key of keys) {
      const row = exercises.find((value) => value.catalogKey === key);
      expect(row).toBeDefined();
      expect(row?.instructions).toMatch(/Registro:/);
      expect(exerciseAliases[key]?.length).toBeGreaterThan(0);
    }
  });
});
