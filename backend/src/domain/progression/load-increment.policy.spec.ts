import { calculateIncrement } from './load-increment.policy';
const base = {
  current: '80',
  unit: 'KG' as const,
  meaning: 'EXTERNAL_TOTAL' as const,
  mode: 'ABSOLUTE' as const,
  absolute: '2.5',
  percent: null,
  maximumPercent: '10',
  maximumLoad: null,
  grid: {
    unit: 'KG' as const,
    step: '2.5',
    origin: '0',
    rounding: 'FLOOR' as const,
  },
};
describe('PROG-4A native-unit Decimal increments and downward grid', () => {
  it('calculates example A without binary arithmetic', () => {
    expect(calculateIncrement(base)).toMatchObject({
      status: 'INCREASE',
      currentLoad: '80',
      currentLoadKg: '80.000000',
      proposedLoad: '82.500000',
      proposedLoadKg: '82.500000',
      requestedDelta: '2.500000',
    });
  });
  it('does not force the 2 percent increase onto a higher grid point', () => {
    expect(
      calculateIncrement({
        ...base,
        mode: 'PERCENT',
        absolute: null,
        percent: '2',
      }).status,
    ).toBe('NO_REPRESENTABLE_INCREMENT');
  });
  it('does not cross the 102 KG cap for example C', () => {
    expect(
      calculateIncrement({
        ...base,
        current: '100',
        absolute: '5',
        maximumLoad: '102',
      }).status,
    ).toBe('NO_REPRESENTABLE_INCREMENT');
  });
  it('caps the requested increment by maximum percent before grid selection', () => {
    expect(
      calculateIncrement({ ...base, absolute: '10', maximumPercent: '5' }),
    ).toMatchObject({
      status: 'INCREASE',
      proposedLoad: '82.500000',
      allowedUpperLoad: '84.000000',
    });
  });
  it('uses a nonzero grid origin and floor', () => {
    expect(
      calculateIncrement({
        ...base,
        current: '81',
        absolute: '4',
        grid: { ...base.grid, origin: '1' },
      }).proposedLoad,
    ).toBe('83.500000');
  });
  it('supports pounds natively and preserves canonical representation', () => {
    expect(
      calculateIncrement({
        ...base,
        current: '100',
        unit: 'LB',
        grid: { ...base.grid, unit: 'LB' },
      }),
    ).toMatchObject({
      status: 'INCREASE',
      proposedLoad: '102.500000',
      proposedLoadKg: '46.493218',
    });
  });
  it.each([null, 'MILES'])('does not infer unit %s', (unit) => {
    expect(calculateIncrement({ ...base, unit } as never).status).toBe(
      'CONFIGURATION_REQUIRED',
    );
  });
  it('does not infer EXTERNAL_TOTAL from a known unit', () => {
    expect(calculateIncrement({ ...base, meaning: 'UNKNOWN' }).status).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it.each(['0', '-1', 'no', 'Infinity'])(
    'rejects invalid baseline %s',
    (current) => {
      expect(calculateIncrement({ ...base, current }).status).toBe(
        'INSUFFICIENT_DATA',
      );
    },
  );
  it.each(['0', '-1', 'oops'])('rejects invalid step %s', (step) => {
    expect(
      calculateIncrement({ ...base, grid: { ...base.grid, step } }).status,
    ).toBe('CONFIGURATION_REQUIRED');
  });
  it('rejects unsupported grid precision instead of silently rounding off grid', () => {
    expect(
      calculateIncrement({ ...base, grid: { ...base.grid, step: '0.0000007' } })
        .reasons,
    ).toContain('GRID_SCALE_UNSUPPORTED');
  });
  it('does not compare native load and a grid expressed in another unit', () => {
    expect(
      calculateIncrement({ ...base, grid: { ...base.grid, unit: 'LB' } })
        .reasons,
    ).toContain('UNIT_POLICY_MISMATCH');
  });
  it('distinguishes zero percent cap from absent maxLoad', () => {
    expect(calculateIncrement({ ...base, maximumPercent: '0' }).status).toBe(
      'NO_REPRESENTABLE_INCREMENT',
    );
  });
  it('requires review when current load already exceeds maxLoad', () => {
    expect(calculateIncrement({ ...base, maximumLoad: '70' }).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it('compares caps without six-decimal rounding before floor', () => {
    expect(
      calculateIncrement({
        ...base,
        absolute: '2.5',
        maximumLoad: '82.4999999',
      }).status,
    ).toBe('NO_REPRESENTABLE_INCREMENT');
  });
  it('is deterministic and does not mutate its inputs', () => {
    const before = JSON.stringify(base);
    expect(calculateIncrement(base)).toEqual(calculateIncrement(base));
    expect(JSON.stringify(base)).toBe(before);
  });
});
