import { Decimal } from '@prisma/client/runtime/client';
import type { HistoricalSetInput } from '../../models/progression/one-rm-calculation.model';
import {
  evaluateOneRmEligibility,
  calculateHistoricalOneRm,
} from './eligibility.policy';

const valid = (): HistoricalSetInput => ({
  load: '100',
  loadUnit: 'KG',
  loadKg: '100.000000',
  repetitions: 5,
  sessionStatus: 'COMPLETED',
  status: 'COMPLETED',
  kind: 'WORK',
  isCompleted: true,
  isOmitted: false,
  oneRmSuitability: 'SUITABLE',
  loadMeaning: 'EXTERNAL_TOTAL',
});

describe('one-RM historical series eligibility', () => {
  it('allows descriptive estimates with warnings but makes no official claim', () => {
    expect(evaluateOneRmEligibility(valid())).toMatchObject({
      status: 'ELIGIBLE_WITH_WARNINGS',
      mathematicallyUsable: true,
      descriptiveEligible: true,
      officialEvidence: 'NOT_ASSESSED',
      reasons: [],
      warnings: ['EFFORT_UNVERIFIED'],
    });
  });

  it.each([
    [{ kind: 'WARMUP' }, 'SET_NOT_WORK'],
    [{ status: 'INCOMPLETE', isCompleted: false }, 'SET_NOT_COMPLETED'],
    [
      { status: 'FAILED', repetitions: 0, isCompleted: false },
      'SET_NOT_COMPLETED',
    ],
    [{ status: 'PENDING', isCompleted: false }, 'SET_NOT_COMPLETED'],
    [{ status: 'SKIPPED', isCompleted: false }, 'SET_NOT_COMPLETED'],
    [{ sessionStatus: 'CANCELLED' }, 'SESSION_NOT_COMPLETED'],
    [{ sessionStatus: 'IN_PROGRESS' }, 'SESSION_NOT_COMPLETED'],
    [{ sessionStatus: 'PLANNED' }, 'SESSION_NOT_COMPLETED'],
    [{ isOmitted: true }, 'EXERCISE_OMITTED'],
    [{ oneRmSuitability: 'NOT_SUITABLE' }, 'EXERCISE_NOT_SUITABLE'],
    [{ repetitions: 0 }, 'REPETITIONS_OUT_OF_RANGE'],
    [{ repetitions: 11 }, 'REPETITIONS_OUT_OF_RANGE'],
    [{ load: '0', loadKg: '0' }, 'LOAD_NOT_POSITIVE'],
    [{ load: '-1', loadKg: '-1' }, 'LOAD_NOT_POSITIVE'],
    [{ loadKg: '99.999999' }, 'CANONICAL_LOAD_INCONSISTENT'],
    [{ isCompleted: false }, 'SET_COMPLETION_INCONSISTENT'],
    [{ loadMeaning: 'PER_HAND' }, 'LOAD_MEANING_UNSUPPORTED'],
    [{ loadMeaning: 'MACHINE_NOMINAL' }, 'LOAD_MEANING_UNSUPPORTED'],
    [{ loadMeaning: 'BODYWEIGHT' }, 'LOAD_MEANING_UNSUPPORTED'],
    [{ loadMeaning: 'ASSISTANCE' }, 'LOAD_MEANING_UNSUPPORTED'],
    [{ loadMeaning: 'NON_QUANTIFIABLE' }, 'LOAD_MEANING_UNSUPPORTED'],
  ] satisfies Array<[Partial<HistoricalSetInput>, string]>)(
    'excludes %j with explicit reason %s',
    (change, reason) => {
      const input = { ...valid(), ...change };
      const result = evaluateOneRmEligibility(input);
      expect(result).toMatchObject({
        status: 'NOT_ELIGIBLE',
        descriptiveEligible: false,
      });
      expect(result.reasons).toContain(reason);
      expect(calculateHistoricalOneRm(input).calculation).toBeNull();
    },
  );

  it.each([
    [{ load: null }, 'LOAD_MISSING'],
    [{ load: 'oops' }, 'LOAD_INVALID'],
    [{ loadUnit: null }, 'UNIT_UNKNOWN'],
    [{ loadKg: null }, 'CANONICAL_LOAD_MISSING'],
    [{ loadKg: 'invalid' }, 'CANONICAL_LOAD_INVALID'],
    [{ status: null, isCompleted: false }, 'SET_STATUS_UNKNOWN'],
    [{ kind: null }, 'SET_KIND_UNKNOWN'],
    [{ sessionStatus: null }, 'SESSION_STATUS_UNKNOWN'],
    [{ isCompleted: null }, 'SET_COMPLETION_UNKNOWN'],
    [{ isOmitted: null }, 'OMISSION_UNKNOWN'],
    [{ oneRmSuitability: 'UNDETERMINED' }, 'SUITABILITY_UNKNOWN'],
    [{ oneRmSuitability: null }, 'SUITABILITY_UNKNOWN'],
    [{ loadMeaning: null }, 'LOAD_MEANING_UNKNOWN'],
    [{ loadMeaning: 'UNKNOWN' }, 'LOAD_MEANING_UNKNOWN'],
    [{ repetitions: null }, 'REPETITIONS_MISSING'],
    [{ repetitions: 2.5 }, 'REPETITIONS_INVALID'],
    [{ rpe: '-1' }, 'RPE_INVALID'],
    [{ rpe: '10.1' }, 'RPE_INVALID'],
    [{ rpe: 'NaN' }, 'RPE_INVALID'],
  ] satisfies Array<[Partial<HistoricalSetInput>, string]>)(
    'leaves missing/invalid evidence %j unevaluable (%s)',
    (change, reason) => {
      const input = { ...valid(), ...change };
      const result = evaluateOneRmEligibility(input);
      expect(result).toMatchObject({
        status: 'NOT_EVALUABLE',
        descriptiveEligible: false,
      });
      expect(result.reasons).toContain(reason);
      expect(calculateHistoricalOneRm(input).calculation).toBeNull();
    },
  );

  it.each([undefined, null, 0, 8, 10, '9.5', new Decimal('8.5')])(
    'never replaces RPE %s or infers RIR/max effort',
    (rpe) => {
      const input = { ...valid(), rpe };
      const result = evaluateOneRmEligibility(input);
      expect(result.status).toBe('ELIGIBLE_WITH_WARNINGS');
      expect(result.warnings).toEqual(['EFFORT_UNVERIFIED']);
      expect(result).not.toHaveProperty('rir');
      expect(input.rpe).toBe(rpe);
    },
  );

  it('separates mathematical input from unevaluable canonical historical evidence', () => {
    expect(
      evaluateOneRmEligibility({ ...valid(), loadKg: null }),
    ).toMatchObject({
      mathematicallyUsable: true,
      descriptiveEligible: false,
      status: 'NOT_EVALUABLE',
    });
  });

  it('does not infer legacy state from isCompleted=false', () => {
    const input = {
      ...valid(),
      status: null,
      kind: null,
      loadUnit: null,
      loadKg: null,
      isCompleted: false,
    };
    const result = evaluateOneRmEligibility(input);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'SET_STATUS_UNKNOWN',
        'SET_KIND_UNKNOWN',
        'UNIT_UNKNOWN',
        'CANONICAL_LOAD_MISSING',
      ]),
    );
    expect(result.reasons).not.toContain('SET_NOT_COMPLETED');
    expect(result.reasons).not.toContain('SET_COMPLETION_INCONSISTENT');
  });

  it('retains caller-provided provenance without inventing IDs or timestamps', () => {
    const provenance = Object.freeze({
      setId: 'provided-set',
      sessionId: 'provided-session',
    });
    const input = Object.freeze({ ...valid(), provenance });
    const first = calculateHistoricalOneRm(input);
    expect(first.provenance).toEqual(provenance);
    expect(first.provenance).not.toBe(provenance);
    expect(first.calculation).toMatchObject({
      ok: true,
      estimates: [
        { formula: 'EPLEY', estimatedOneRm: '116.666667' },
        { formula: 'BRZYCKI', estimatedOneRm: '112.500000' },
      ],
    });
    expect(first).toEqual(calculateHistoricalOneRm(input));
    expect(first).not.toHaveProperty('calculatedAt');
    expect(calculateHistoricalOneRm(valid()).provenance).toBeUndefined();
  });

  it('compares pound canonical values by decimal equality without rounding corrupt evidence', () => {
    const input = {
      ...valid(),
      loadUnit: 'LB',
      loadKg: new Decimal('45.359237000'),
    } as const;
    expect(evaluateOneRmEligibility(input).descriptiveEligible).toBe(true);
    expect(
      evaluateOneRmEligibility({ ...input, loadKg: '45.3592371' }).reasons,
    ).toContain('CANONICAL_LOAD_INCONSISTENT');
  });
});
