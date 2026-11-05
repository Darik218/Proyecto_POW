import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  assertPermutation,
  PlanningError,
  prescriptionTargets,
} from './daily-planning.policy';
import {
  CreateDailyPrescriptionDto,
  CreatePlanDayDto,
  UpdatePlanDayDto,
} from './dto/daily-planning.dto';

describe('Daily planning targets and DTO boundaries', () => {
  it('represents exact repetitions and ranges without inventing scalar targets', () => {
    expect(prescriptionTargets({ targetReps: 8 })).toMatchObject({
      targetReps: 8,
      targetRepsMin: 8,
      targetRepsMax: 8,
    });
    expect(
      prescriptionTargets({ targetRepsMin: 6, targetRepsMax: 10 }),
    ).toMatchObject({ targetReps: null, targetRepsMin: 6, targetRepsMax: 10 });
    for (const input of [
      {},
      { targetRepsMin: 8 },
      { targetRepsMin: 10, targetRepsMax: 6 },
      { targetReps: 8, targetRepsMin: 6, targetRepsMax: 10 },
    ])
      expect(() => prescriptionTargets(input)).toThrow(PlanningError);
  });
  it('requires explicit units for new loads, preserving unknown legacy values without conversion', () => {
    expect(() =>
      prescriptionTargets({ targetReps: 8, targetLoad: 20 }),
    ).toThrow(PlanningError);
    expect(
      prescriptionTargets({
        targetReps: 8,
        targetLoad: 20,
        targetLoadUnit: 'LB',
      }),
    ).toMatchObject({ targetLoad: 20, targetLoadUnit: 'LB' });
    const previous = {
      targetReps: 8,
      targetRepsMin: 8,
      targetRepsMax: 8,
      targetLoad: 42.125,
      targetLoadUnit: null,
    };
    expect(
      prescriptionTargets({ notes: 'Other change' }, previous),
    ).toMatchObject({ targetLoad: 42.125, targetLoadUnit: null });
    expect(() => prescriptionTargets({ targetLoad: 43 }, previous)).toThrow(
      PlanningError,
    );
    expect(prescriptionTargets({ targetLoad: null }, previous)).toMatchObject({
      targetLoad: null,
      targetLoadUnit: null,
    });
    expect(
      prescriptionTargets({ targetLoadUnit: 'KG' }, previous),
    ).toMatchObject({ targetLoad: 42.125, targetLoadUnit: 'KG' });
    expect(() =>
      prescriptionTargets(
        { targetLoadUnit: 'KG' },
        { ...previous, targetLoad: null },
      ),
    ).toThrow(PlanningError);
  });
  it('requires exact permutations, rejecting duplicates, omissions and foreign identifiers', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(() => assertPermutation(['b', 'a'], rows)).not.toThrow();
    for (const ids of [['a'], ['a', 'a'], ['a', 'c']])
      expect(() => assertPermutation(ids, rows)).toThrow(PlanningError);
  });
  it('accepts fixed and flexible days and rejects missing required fields and unknown ownership', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    for (const weekday of [null, 1, 7])
      expect(
        await validate(
          plainToInstance(CreatePlanDayDto, {
            name: ' Día A ',
            position: 1,
            weekday,
          }),
          options,
        ),
      ).toHaveLength(0);
    for (const input of [
      { position: 1 },
      { name: '', position: 1 },
      { name: 'A', position: 1, weekday: 0 },
      { name: 'A', position: 1, ownerId: 'arbitrary' },
    ])
      expect(
        (await validate(plainToInstance(CreatePlanDayDto, input), options))
          .length,
      ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(UpdatePlanDayDto, { name: null }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(CreateDailyPrescriptionDto, {
            exerciseId: '10000000-0000-4000-8000-000000000001',
            targetReps: 8,
          }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
