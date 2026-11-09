import { Decimal } from '@prisma/client/runtime/client';
import { jest } from '@jest/globals';
import { calculateOneRm } from './one-rm';

describe('literal descriptive one-RM formulas', () => {
  it('uses bounded local exponents even when global limits changed before import', async () => {
    await jest.isolateModulesAsync(async () => {
      const { Decimal: ForeignDecimal } =
        await import('@prisma/client/runtime/client');
      const { maxE, minE } = ForeignDecimal;
      try {
        ForeignDecimal.set({ maxE: 2, minE: -2 });
        const modulePath = './one-rm';
        const { calculateOneRm: isolated } = (await import(
          modulePath
        )) as typeof import('./one-rm');
        expect(
          isolated({ load: '100', loadUnit: 'KG', repetitions: 5 }),
        ).toMatchObject({
          ok: true,
          estimates: [
            { estimatedOneRm: '116.666667' },
            { estimatedOneRm: '112.500000' },
          ],
        });
        expect(
          isolated({ load: '0.001', loadUnit: 'KG', repetitions: 5 }),
        ).toMatchObject({
          ok: true,
          estimates: [
            { estimatedOneRm: '0.001167' },
            { estimatedOneRm: '0.001125' },
          ],
        });
      } finally {
        ForeignDecimal.set({ maxE, minE });
      }
    });
  });
  it.each([
    [1, '103.333333', '100.000000'],
    [3, '110.000000', '105.882353'],
    [5, '116.666667', '112.500000'],
    [8, '126.666667', '124.137931'],
    [10, '133.333333', '133.333333'],
  ])(
    'keeps both exact fractions separate at 100 KG x %s',
    (repetitions, epley, brzycki) => {
      const result = calculateOneRm({
        load: '100',
        loadUnit: 'KG',
        repetitions,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected calculable input');
      expect(
        result.estimates.map(({ formula, estimatedOneRm, unit }) => ({
          formula,
          estimatedOneRm,
          unit,
        })),
      ).toEqual([
        { formula: 'EPLEY', estimatedOneRm: epley, unit: 'KG' },
        { formula: 'BRZYCKI', estimatedOneRm: brzycki, unit: 'KG' },
      ]);
      expect(result.warnings).toContain('EFFORT_UNVERIFIED');
      expect(result.estimates[0].warnings).toEqual(
        repetitions === 1 ? ['EPLEY_SINGLE_REPETITION_LITERAL'] : [],
      );
      expect(result.estimates[1].warnings).toEqual([]);
    },
  );

  it('calculates from canonical pounds while preserving the original load', () => {
    const result = calculateOneRm({
      load: '100.000',
      loadUnit: 'LB',
      repetitions: 5,
    });
    expect(result).toMatchObject({
      ok: true,
      load: {
        originalLoad: '100.000',
        originalUnit: 'LB',
        loadKg: '45.359237',
      },
      estimates: [
        { estimatedOneRm: '52.919110' },
        { estimatedOneRm: '51.029142' },
      ],
    });
  });

  it.each([
    [null, 'REPETITIONS_MISSING'],
    [undefined, 'REPETITIONS_MISSING'],
    [0, 'REPETITIONS_OUT_OF_RANGE'],
    [-1, 'REPETITIONS_OUT_OF_RANGE'],
    [11, 'REPETITIONS_OUT_OF_RANGE'],
    [36, 'REPETITIONS_OUT_OF_RANGE'],
    [37, 'REPETITIONS_OUT_OF_RANGE'],
    [1.5, 'REPETITIONS_INVALID'],
    ['5', 'REPETITIONS_INVALID'],
    [NaN, 'REPETITIONS_INVALID'],
    [Infinity, 'REPETITIONS_INVALID'],
  ])(
    'rejects repetitions %s before applying formulas',
    (repetitions, reason) => {
      expect(
        calculateOneRm({ load: '100', loadUnit: 'KG', repetitions }),
      ).toMatchObject({ ok: false, reasons: [reason] });
    },
  );

  it.each([
    ['0.001', 1, '0.001033', '0.001000'],
    ['99999.999', 10, '133333.332000', '133333.332000'],
    [
      '12345678901234567890.123456',
      3,
      '13580246791358024679.135802',
      '13071895307189542471.895424',
    ],
    ['1.0000005', 5, '1.166668', '1.125001'],
  ])(
    'rounds canonical kg then final estimates for %s x %s without persistence limits',
    (load, repetitions, epley, brzycki) => {
      expect(
        calculateOneRm({ load, loadUnit: 'KG', repetitions }),
      ).toMatchObject({
        ok: true,
        estimates: [{ estimatedOneRm: epley }, { estimatedOneRm: brzycki }],
      });
    },
  );

  it('is repeatable, does not mutate input and ignores shared Decimal precision', () => {
    const input = Object.freeze({
      load: new Decimal('99999.999'),
      loadUnit: 'KG',
      repetitions: 10,
    });
    const before = calculateOneRm(input);
    const precision = Decimal.precision;
    try {
      Decimal.set({ precision: 4 });
      expect(calculateOneRm(input)).toEqual(before);
    } finally {
      Decimal.set({ precision });
    }
    expect(input.load.toString()).toBe('99999.999');
  });

  it('keeps Decimal input representation stable when unrelated formatting configuration changes', () => {
    const input = { load: new Decimal('100'), loadUnit: 'KG', repetitions: 5 };
    const before = calculateOneRm(input);
    const { toExpNeg, toExpPos } = Decimal;
    try {
      Decimal.set({ toExpNeg: -2, toExpPos: 2 });
      expect(calculateOneRm(input)).toEqual(before);
    } finally {
      Decimal.set({ toExpNeg, toExpPos });
    }
  });

  it.each([null, '0', '-1', 'invalid'])(
    'never computes estimates for invalid load %s',
    (load) => {
      const result = calculateOneRm({ load, loadUnit: 'KG', repetitions: 5 });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('estimates');
    },
  );
});
