import { Decimal } from '@prisma/client/runtime/client';
import { readDecimal } from './decimal';
import { interpretLoad } from './load';
import type {
  Decision,
  LoadUnit,
} from '../../models/progression/recommendation-draft.model';
export const LOAD_INCREMENT_NUMERIC_POLICY = Object.freeze({
  version: 'native-grid-decimal-v1',
  precision: 384,
  nativeScale: 6,
  rounding: 'FLOOR',
  canonicalConversion: 'PROG_1A_INTERPRET_LOAD',
});
// Local precision covers products of bounded PROG-1A inputs and grid residues.
const Arithmetic = Decimal.clone({
  precision: LOAD_INCREMENT_NUMERIC_POLICY.precision,
  rounding: Decimal.ROUND_HALF_UP,
  minE: -1000,
  maxE: 1000,
  toExpNeg: -7,
  toExpPos: 21,
});
function parsed(value: unknown) {
  const d = readDecimal(value);
  return d.ok ? new Arithmetic(d.value.toFixed()) : null;
}
const exact = (v: Decimal) => v.toFixed(Math.max(6, v.decimalPlaces()));
export type IncrementInput = Readonly<{
  current: string | null;
  unit: LoadUnit | null;
  meaning: string;
  mode: 'ABSOLUTE' | 'PERCENT';
  absolute: string | null;
  percent: string | null;
  maximumPercent: string;
  maximumLoad: string | null;
  grid: { unit: LoadUnit; step: string; origin: string; rounding: 'FLOOR' };
}>;
export function calculateIncrement(input: IncrementInput) {
  let currentLoadKg: string | null = null;
  const output = (status: Decision, reasons: string[]) => ({
    status,
    reasons,
    unit: input.unit,
    currentLoad: input.current,
    currentLoadKg,
    numericPolicy: LOAD_INCREMENT_NUMERIC_POLICY,
    proposedLoad: null as string | null,
    proposedLoadKg: null as string | null,
    requestedDelta: null as string | null,
    allowedUpperLoad: null as string | null,
  });
  if (input.unit !== 'KG' && input.unit !== 'LB')
    return output('CONFIGURATION_REQUIRED', ['UNIT_REQUIRED']);
  if (input.meaning !== 'EXTERNAL_TOTAL')
    return output('INSUFFICIENT_DATA', ['LOAD_MEANING_UNKNOWN']);
  const current = parsed(input.current),
    interpreted = interpretLoad(input.current, input.unit);
  if (!current || current.lte(0) || !interpreted.ok)
    return output('INSUFFICIENT_DATA', ['BASELINE_LOAD_INVALID']);
  currentLoadKg = interpreted.value.loadKg;
  if (input.grid?.unit !== input.unit)
    return output('CONFIGURATION_REQUIRED', ['UNIT_POLICY_MISMATCH']);
  const step = parsed(input.grid.step),
    origin = parsed(input.grid.origin),
    cap = parsed(input.maximumPercent),
    max = input.maximumLoad === null ? null : parsed(input.maximumLoad);
  if (
    !step ||
    step.lte(0) ||
    !origin ||
    origin.lt(0) ||
    input.grid.rounding !== 'FLOOR' ||
    !cap ||
    cap.lt(0) ||
    (input.maximumLoad !== null && (!max || max.lte(0)))
  )
    return output('CONFIGURATION_REQUIRED', ['INVALID_GRID_OR_LIMIT']);
  if (
    step.decimalPlaces() > LOAD_INCREMENT_NUMERIC_POLICY.nativeScale ||
    origin.decimalPlaces() > LOAD_INCREMENT_NUMERIC_POLICY.nativeScale ||
    current.decimalPlaces() > LOAD_INCREMENT_NUMERIC_POLICY.nativeScale
  )
    return output('CONFIGURATION_REQUIRED', ['GRID_SCALE_UNSUPPORTED']);
  if (max && max.lt(current))
    return output('REVIEW_REQUIRED', ['BASELINE_ABOVE_MAXIMUM_LOAD']);
  const selected = parsed(
    input.mode === 'ABSOLUTE'
      ? input.absolute
      : input.mode === 'PERCENT'
        ? input.percent
        : null,
  );
  if (!selected || selected.lte(0))
    return output('CONFIGURATION_REQUIRED', ['INCREMENT_REQUIRED']);
  const requested =
    input.mode === 'ABSOLUTE' ? selected : current.mul(selected).div(100);
  const percentCap = current.mul(cap).div(100);
  const permitted = requested.lte(percentCap) ? requested : percentCap;
  let upper = current.plus(permitted);
  if (max && upper.gt(max)) upper = max;
  const candidate = origin.plus(
    step.mul(upper.minus(origin).div(step).floor()),
  );
  const common = {
    ...output('NO_REPRESENTABLE_INCREMENT', ['GRID_HAS_NO_POSITIVE_INCREMENT']),
    requestedDelta: exact(requested),
    allowedUpperLoad: exact(upper),
  };
  if (candidate.lte(current) || candidate.gt(upper) || candidate.lte(0))
    return common;
  const native = candidate.toFixed(LOAD_INCREMENT_NUMERIC_POLICY.nativeScale),
    kg = interpretLoad(native, input.unit);
  if (!kg.ok)
    return {
      ...common,
      status: 'CONFIGURATION_REQUIRED' as const,
      reasons: ['NUMERIC_RESULT_UNSUPPORTED'],
    };
  return {
    ...common,
    status: 'INCREASE' as const,
    reasons: [],
    proposedLoad: native,
    proposedLoadKg: kg.value.loadKg,
  };
}
