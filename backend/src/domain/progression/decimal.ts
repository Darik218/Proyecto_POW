import { Decimal } from '@prisma/client/runtime/client';

// Local arithmetic only. Never call Decimal.set/config on the shared constructor.
const LocalDecimal = Decimal.clone({
  precision: 128,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -7,
  toExpPos: 21,
  minE: -1000,
  maxE: 1000,
});
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export type ParsedDecimal =
  | { ok: true; value: Decimal; original: string }
  | { ok: false; reason: 'INVALID' | 'OUT_OF_RANGE' };

export function readDecimal(input: unknown): ParsedDecimal {
  if (typeof input !== 'string' && !(input instanceof Decimal))
    return { ok: false, reason: 'INVALID' };
  // A Decimal has already lost lexical formatting (e.g. trailing zeros).
  // Serialize its value using our context, not the caller's mutable constructor.
  const original =
    typeof input === 'string' ? input : new LocalDecimal(input).toString();
  // Bounded computation, independent of the much smaller persistence range.
  // 128 significant digits cover 100 input digits plus conversion/final rounding.
  if (original.length > 256) return { ok: false, reason: 'OUT_OF_RANGE' };
  if (!DECIMAL_TEXT.test(original)) return { ok: false, reason: 'INVALID' };
  const value = new LocalDecimal(original);
  if (!value.isFinite()) return { ok: false, reason: 'INVALID' };
  if (value.e > 100 || value.e < -100 || value.sd() > 100)
    return { ok: false, reason: 'OUT_OF_RANGE' };
  return { ok: true, value, original };
}
