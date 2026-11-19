import { Decimal } from '@prisma/client/runtime/client';
import type {
  EstimateCommand,
  EstimateSource,
} from '../../models/progression/one-rm-estimate.model';
import {
  assertPersistableDecimal,
  evidenceIdentity,
  prepareEstimates,
} from './estimate-evidence.policy';

const source = (): EstimateSource => ({
  userId: 'user',
  athleteId: 'athlete',
  exerciseId: 'exercise',
  sessionId: 'session',
  workoutExerciseId: 'workout',
  sourceSetId: 'set',
  sourceSetVersion: 0,
  sessionVersion: 3,
  sessionStatus: 'COMPLETED',
  status: 'COMPLETED',
  kind: 'WORK',
  isCompleted: true,
  isOmitted: false,
  load: new Decimal('100'),
  loadUnit: 'KG',
  loadKg: new Decimal('100'),
  repetitions: 5,
  rpe: null,
  oneRmSuitability: 'SUITABLE',
  recordedAt: '2026-01-01T12:00:00.000Z',
  performedOn: '2026-01-01',
  timeZone: 'America/Bogota',
});
const command = (): EstimateCommand => ({
  sourceSetId: 'set',
  expectedSetVersion: 0,
  formulas: ['EPLEY', 'BRZYCKI'],
  interpretation: {
    meaning: 'EXTERNAL_TOTAL',
    source: 'OWNER_DECLARATION_AFTER_RECORDING',
  },
});

describe('persistable descriptive estimation evidence', () => {
  it('builds two reproducible, separate descriptive snapshots from source data', () => {
    const drafts = prepareEstimates(source(), command());
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      formula: 'EPLEY',
      estimatedOneRm: '116.666667',
      inputLoad: '100',
      resultUnit: 'KG',
      estimateKind: 'DESCRIPTIVE',
      snapshot: {
        schemaVersion: 'one-rm-evidence-v1',
        evidenceStatus: 'NOT_ASSESSED',
        interpretation: {
          meaning: 'EXTERNAL_TOTAL',
          source: 'OWNER_DECLARATION_AFTER_RECORDING',
          declaredByUserId: 'user',
        },
        input: { rpe: null },
        eligibility: { warnings: ['EFFORT_UNVERIFIED'] },
      },
    });
    expect(drafts[1]).toMatchObject({
      formula: 'BRZYCKI',
      estimatedOneRm: '112.500000',
    });
    expect(drafts[0].calculationKey).not.toBe(drafts[1].calculationKey);
    expect(drafts).toEqual(prepareEstimates(source(), command()));
    expect(drafts[0].snapshot).not.toHaveProperty('calculatedAt');
  });
  it('canonicalizes field order while distinguishing absent, null and zero', () => {
    expect(evidenceIdentity({ b: [1, { x: '2', a: null }], a: true })).toBe(
      evidenceIdentity({ a: true, b: [1, { a: null, x: '2' }] }),
    );
    expect(
      new Set([
        evidenceIdentity({}),
        evidenceIdentity({ rpe: null }),
        evidenceIdentity({ rpe: '0' }),
      ]).size,
    ).toBe(3);
  });
  it('normalizes equivalent decimal inputs without dropping the original unit', () => {
    const a = prepareEstimates(source(), command());
    expect(
      prepareEstimates(
        { ...source(), load: '100.000', loadKg: '100.000000' },
        command(),
      ),
    ).toEqual(a);
    const pounds = prepareEstimates(
      { ...source(), loadUnit: 'LB', loadKg: '45.359237' },
      command(),
    );
    expect(pounds[0]).toMatchObject({
      inputLoad: '100',
      inputLoadUnit: 'LB',
      inputLoadKg: '45.359237',
      estimatedOneRm: '52.919110',
    });
    expect(pounds[0].calculationKey).not.toBe(a[0].calculationKey);
  });
  it('supports results beyond the old Decimal(8,3) limit', () => {
    expect(
      prepareEstimates(
        {
          ...source(),
          load: '99999.999',
          loadKg: '99999.999',
          repetitions: 10,
        },
        command(),
      )[0].estimatedOneRm,
    ).toBe('133333.332000');
  });
  it.each(['1000000000000000000', '0.0000001', '-1', 'Infinity'])(
    'rejects %s rather than truncating a Decimal(24,6)',
    (value) => {
      expect(() => assertPersistableDecimal(value, 24, 6)).toThrow(
        'DECIMAL_NOT_PERSISTABLE',
      );
    },
  );
  it('accepts the exact maximum and does not use global Decimal precision', () => {
    expect(() =>
      assertPersistableDecimal('999999999999999999.999999', 24, 6),
    ).not.toThrow();
    const before = prepareEstimates(source(), command());
    const precision = Decimal.precision;
    try {
      Decimal.set({ precision: 3 });
      expect(prepareEstimates(source(), command())).toEqual(before);
    } finally {
      Decimal.set({ precision });
    }
  });
  it.each([
    [{ sessionStatus: 'IN_PROGRESS' }, 'NOT_ELIGIBLE'],
    [{ loadUnit: null }, 'NOT_ELIGIBLE'],
    [{ status: null }, 'NOT_ELIGIBLE'],
    [{ kind: 'WARMUP' }, 'NOT_ELIGIBLE'],
    [{ isOmitted: true }, 'NOT_ELIGIBLE'],
    [{ oneRmSuitability: 'NOT_SUITABLE' }, 'NOT_ELIGIBLE'],
    [{ sourceSetVersion: 1 }, 'SOURCE_CHANGED'],
  ] satisfies Array<[Partial<EstimateSource>, string]>)(
    'rejects invalid source %j (%s)',
    (change, error) => {
      expect(() =>
        prepareEstimates({ ...source(), ...change }, command()),
      ).toThrow(error);
    },
  );
  it('rejects unverified or missing context and invalid formula requests', () => {
    expect(() =>
      prepareEstimates(source(), {
        ...command(),
        interpretation: undefined,
      } as unknown as EstimateCommand),
    ).toThrow('CONTEXT_REQUIRED');
    expect(() =>
      prepareEstimates(source(), { ...command(), formulas: [] }),
    ).toThrow('INVALID_COMMAND');
    expect(() =>
      prepareEstimates(source(), {
        ...command(),
        formulas: ['EPLEY', 'EPLEY'],
      }),
    ).toThrow('INVALID_COMMAND');
  });
  it('changes identity for changed versions, eligibility or interpretation provenance', () => {
    const [draft] = prepareEstimates(source(), command());
    expect(
      evidenceIdentity({ ...draft.snapshot, calculationVersion: 'future' }),
    ).not.toBe(draft.calculationKey);
    expect(
      evidenceIdentity({ ...draft.snapshot, eligibilityVersion: 'future' }),
    ).not.toBe(draft.calculationKey);
    expect(
      evidenceIdentity({
        ...draft.snapshot,
        interpretation: { meaning: 'EXTERNAL_TOTAL', source: 'OTHER' },
      }),
    ).not.toBe(draft.calculationKey);
  });

  it('selects interpretation fields explicitly instead of capturing arbitrary caller data', () => {
    const input = command();
    const [draft] = prepareEstimates(source(), {
      ...input,
      interpretation: {
        ...input.interpretation,
        unrelatedPrivateData: 'must-not-be-captured',
      },
    } as EstimateCommand);
    expect(draft.snapshot.interpretation).toEqual({
      meaning: 'EXTERNAL_TOTAL',
      source: 'OWNER_DECLARATION_AFTER_RECORDING',
      declaredByUserId: 'user',
    });
  });
});
