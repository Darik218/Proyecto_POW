import type {
  CalculationInput,
  CalculationResult,
} from '../../models/progression/one-rm-calculation.model';
import { interpretLoad } from './load';
import { readDecimal } from './decimal';

export const ONE_RM_POLICY_VERSION = 'prog-1a-literal-v1';
export function calculateOneRm(input: CalculationInput): CalculationResult {
  const load = interpretLoad(input.load, input.loadUnit);
  if (!load.ok) return { ...load, policyVersion: ONE_RM_POLICY_VERSION };
  const r = input.repetitions;
  if (r == null)
    return {
      ok: false,
      policyVersion: ONE_RM_POLICY_VERSION,
      reasons: ['REPETITIONS_MISSING'],
    };
  if (typeof r !== 'number' || !Number.isSafeInteger(r))
    return {
      ok: false,
      policyVersion: ONE_RM_POLICY_VERSION,
      reasons: ['REPETITIONS_INVALID'],
    };
  if (r < 1 || r > 10)
    return {
      ok: false,
      policyVersion: ONE_RM_POLICY_VERSION,
      reasons: ['REPETITIONS_OUT_OF_RANGE'],
    };
  const parsed = readDecimal(load.value.loadKg);
  if (!parsed.ok)
    return {
      ok: false,
      policyVersion: ONE_RM_POLICY_VERSION,
      reasons: ['DECIMAL_OUT_OF_RANGE'],
    };
  const kg = parsed.value;
  return {
    ok: true,
    policyVersion: ONE_RM_POLICY_VERSION,
    load: load.value,
    repetitions: r,
    warnings: ['EFFORT_UNVERIFIED'],
    estimates: [
      {
        formula: 'EPLEY',
        estimatedOneRm: kg
          .mul(30 + r)
          .div(30)
          .toFixed(6),
        unit: 'KG',
        warnings: r === 1 ? ['EPLEY_SINGLE_REPETITION_LITERAL'] : [],
      },
      {
        formula: 'BRZYCKI',
        estimatedOneRm: kg
          .mul(36)
          .div(37 - r)
          .toFixed(6),
        unit: 'KG',
        warnings: [],
      },
    ],
  };
}
