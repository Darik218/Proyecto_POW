import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { executedSet } from './workout-sets.policy';
import { WorkoutSetInputDto } from './dto/workout-preparation.dto';
import { creationHash } from './workout-calendar.policy';

const base = {
  expectedVersion: 0,
  setNumber: 1,
  status: 'COMPLETED',
  kind: 'WORK',
  load: '60',
  loadUnit: 'KG',
  repetitions: 8,
} as const;
describe('optional RIR categories', () => {
  it('stores zero and the open upper category independently from RPE', () => {
    expect(
      executedSet({ ...base, rir: '0', rpe: 7 } as WorkoutSetInputDto),
    ).toMatchObject({ rir: '0', rpe: 7 });
    expect(
      executedSet({ ...base, rir: '4_PLUS' } as WorkoutSetInputDto),
    ).toMatchObject({ rir: '4_PLUS', rpe: null });
    expect(
      executedSet({ ...base, rir: null } as WorkoutSetInputDto),
    ).toMatchObject({ rir: null });
  });
  it('rejects RIR results on pending and skipped sets', () => {
    for (const status of ['PENDING', 'SKIPPED'] as const)
      expect(() =>
        executedSet({
          expectedVersion: 0,
          setNumber: 1,
          kind: 'WORK',
          status,
          rir: '0',
        } as WorkoutSetInputDto),
      ).toThrow();
  });
  it('accepts only explicit categories or null at the HTTP boundary', async () => {
    for (const rir of ['0', '1', '2', '3', '4_PLUS', null, undefined])
      expect(
        await validate(plainToInstance(WorkoutSetInputDto, { ...base, rir }), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).toEqual([]);
    for (const rir of ['4', '5', 0, 4, '', 'UNKNOWN'])
      expect(
        (
          await validate(
            plainToInstance(WorkoutSetInputDto, { ...base, rir }),
            { whitelist: true, forbidNonWhitelisted: true },
          )
        ).length,
      ).toBeGreaterThan(0);
  });
  it('keeps omitted-field creation hashes compatible while distinguishing reported categories', () => {
    const hash = (input: WorkoutSetInputDto) => {
      const values = executedSet(input);
      return creationHash({
        exerciseId: 'exercise',
        ...values,
        load: values.load?.toString() ?? null,
        loadKg: values.loadKg?.toString() ?? null,
      });
    };
    expect(hash(base)).toBe(
      creationHash({
        exerciseId: 'exercise',
        setNumber: 1,
        status: 'COMPLETED',
        kind: 'WORK',
        load: '60',
        loadUnit: 'KG',
        loadKg: '60',
        repetitions: 8,
        rpe: null,
        notes: null,
        isCompleted: true,
      }),
    );
    expect(hash({ ...base, rir: '0' } as WorkoutSetInputDto)).not.toBe(
      hash({ ...base, rir: '4_PLUS' } as WorkoutSetInputDto),
    );
  });
});
