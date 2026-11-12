import { validateRoutineTemplates } from './routine-template.policy';
const exercise = {
  exerciseId: 'catalog',
  position: 1,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetLoad: '60.125',
  targetLoadUnit: 'KG' as const,
};
const day = { name: 'Push', weekday: 1, exercises: [exercise] };
describe('routine builder template integrity', () => {
  it('accepts repeated blocks on different weekdays without changing exact loads', () => {
    expect(() =>
      validateRoutineTemplates([day, { ...day, weekday: 4 }], [7]),
    ).not.toThrow();
    expect(day.exercises[0].targetLoad).toBe('60.125');
  });
  it.each([
    [[{ ...day, exercises: [{ ...exercise, targetSets: 0 }] }], []],
    [[day], [1]],
    [[{ ...day, exercises: [{ ...exercise, targetLoadUnit: null }] }], []],
    [[{ ...day, exercises: [{ ...exercise, targetLoad: '0.0001' }] }], []],
    [[{ ...day, exercises: [{ ...exercise, targetRepsMin: 12 }] }], []],
    [
      [
        {
          ...day,
          exercises: [exercise, { ...exercise, exerciseId: 'second' }],
        },
      ],
      [],
    ],
  ])(
    'rejects invalid targets, conflicting rest, unknown units, lost precision and invalid prescriptions',
    (days, rest) => {
      expect(() =>
        validateRoutineTemplates(days as never, rest as number[]),
      ).toThrow();
    },
  );
});
