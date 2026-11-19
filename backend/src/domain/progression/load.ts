import type { LoadResult } from '../../models/progression/one-rm-calculation.model';
import { readDecimal } from './decimal';

export function interpretLoad(load: unknown, unit: unknown): LoadResult {
  if (load == null) return { ok: false, reasons: ['LOAD_MISSING'] };
  const parsed = readDecimal(load);
  if (!parsed.ok)
    return {
      ok: false,
      reasons: [
        parsed.reason === 'OUT_OF_RANGE'
          ? 'DECIMAL_OUT_OF_RANGE'
          : 'LOAD_INVALID',
      ],
    };
  if (parsed.value.lte(0)) return { ok: false, reasons: ['LOAD_NOT_POSITIVE'] };
  if (unit !== 'KG' && unit !== 'LB')
    return { ok: false, reasons: ['UNIT_UNKNOWN'] };
  // Same exact factor and canonical rounding as executedSet; regression-tested
  // against that consumer without changing the recording flow in PROG-1A.
  const canonical = parsed.value
    .mul(unit === 'LB' ? '0.45359237' : '1')
    .toDecimalPlaces(6);
  if (canonical.lte(0))
    return { ok: false, reasons: ['CANONICAL_LOAD_NOT_POSITIVE'] };
  const loadKg = canonical.toFixed(6);
  return {
    ok: true,
    value: { originalLoad: parsed.original, originalUnit: unit, loadKg },
  };
}
