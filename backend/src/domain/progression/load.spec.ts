import { Decimal } from '@prisma/client/runtime/client';
import { executedSet } from '../../workout-sessions/workout-sets.policy';
import { interpretLoad } from './load';

describe('progression load interpretation', () => {
  it('keeps the entered representation and uses exact pound conversion', () => {
    expect(interpretLoad('100.000', 'LB')).toEqual({
      ok: true,
      value: {
        originalLoad: '100.000',
        originalUnit: 'LB',
        loadKg: '45.359237',
      },
    });
  });

  it.each([
    ['100', 'KG', '100.000000'],
    ['0.001', 'LB', '0.000454'],
    ['1.2345675', 'KG', '1.234568'],
    ['99999.999', 'LB', '45359.236546'],
  ])(
    'converts %s %s consistently with recorded canonical mass',
    (load, unit, kg) => {
      expect(interpretLoad(load, unit)).toMatchObject({
        ok: true,
        value: { loadKg: kg },
      });
    },
  );

  it.each(['KG', 'LB'] as const)(
    'agrees with the existing execution policy for %s',
    (loadUnit) => {
      for (const load of ['0.001', '77.500', '99999.999']) {
        const recorded = executedSet({
          setNumber: 1,
          status: 'COMPLETED',
          kind: 'WORK',
          load,
          loadUnit,
          repetitions: 5,
          expectedVersion: 0,
        });
        expect(interpretLoad(load, loadUnit)).toMatchObject({
          ok: true,
          value: { loadKg: recorded.loadKg!.toFixed(6) },
        });
      }
    },
  );

  it.each([
    [null, 'KG', 'LOAD_MISSING'],
    [undefined, 'KG', 'LOAD_MISSING'],
    ['0', 'KG', 'LOAD_NOT_POSITIVE'],
    ['-1', 'KG', 'LOAD_NOT_POSITIVE'],
    ['100', null, 'UNIT_UNKNOWN'],
    ['100', 'kg', 'UNIT_UNKNOWN'],
    ['100', 'STONE', 'UNIT_UNKNOWN'],
    ['', 'KG', 'LOAD_INVALID'],
    ['NaN', 'KG', 'LOAD_INVALID'],
    ['Infinity', 'KG', 'LOAD_INVALID'],
    ['0xff', 'KG', 'LOAD_INVALID'],
    ['1,5', 'KG', 'LOAD_INVALID'],
    [1.1, 'KG', 'LOAD_INVALID'],
    [{ toString: () => '100' }, 'KG', 'LOAD_INVALID'],
    ['1e101', 'KG', 'DECIMAL_OUT_OF_RANGE'],
    ['1e-101', 'KG', 'DECIMAL_OUT_OF_RANGE'],
    ['0.0000001', 'KG', 'CANONICAL_LOAD_NOT_POSITIVE'],
  ])('rejects invalid/unknown load %s %s with %s', (load, unit, reason) => {
    expect(interpretLoad(load, unit)).toEqual({ ok: false, reasons: [reason] });
  });

  it('accepts domain Decimal without changing it or global precision', () => {
    const load = new Decimal('42.125');
    const precision = Decimal.precision;
    expect(interpretLoad(load, 'KG')).toMatchObject({
      ok: true,
      value: { loadKg: '42.125000' },
    });
    expect(load.toString()).toBe('42.125');
    expect(Decimal.precision).toBe(precision);
  });
});
