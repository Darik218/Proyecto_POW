import {
  recommendationDependencyKeys,
  recommendationIdentity,
} from './recommendation-evidence.policy';
import {
  prepareRecommendationInsert,
  recommendationCycleKey,
  validateSaveExpectation,
  inspectGeneration,
} from './recommendation-persistence.policy';
import { deriveRecommendation } from '../../progression/recommendation.service';
import {
  command,
  context,
} from '../../../test/helpers/recommendation-fixtures';
const draft = () => deriveRecommendation(context(), command());
const prepared = () => {
  const d = draft();
  return prepareRecommendationInsert(d, command(), {
    expectedSemanticKey: d.semanticKey,
    expectedDependencyKeys: d.dependencyKeys,
  });
};
describe('neutral recommendation persistence policy', () => {
  it('only prepares a complete INCREASE with exact native/canonical values', () => {
    expect(prepared()).toMatchObject({
      proposalKind: 'NEUTRAL_INTERNAL',
      loadUnit: 'KG',
      previousLoad: '80',
      recommendedLoad: '82.500000',
      sessionIds: ['session-a', 'session-b'],
    });
  });
  it('keeps the engine evidence unchanged and reproducible', () => {
    const d = draft();
    const i = prepareRecommendationInsert(d, command(), {
      expectedSemanticKey: d.semanticKey,
      expectedDependencyKeys: d.dependencyKeys,
    });
    expect(i.snapshot).toEqual(d.evidence);
    expect(i.semanticKey).toBe(d.semanticKey);
    expect(
      inspectGeneration(i.snapshot, i.semanticKey, i.dependencyKeys).decision,
    ).toBe('INCREASE');
  });
  it('rejects a stale semantic proposal and reports changed dependencies', () => {
    const old = draft(),
      c = context();
    c.settings = [{ ...c.settings[0], incrementAbsolute: '5' }];
    const next = deriveRecommendation(c, command());
    expect(() =>
      prepareRecommendationInsert(next, command(), {
        expectedSemanticKey: old.semanticKey,
        expectedDependencyKeys: old.dependencyKeys,
      }),
    ).toThrow('STALE_PROPOSAL');
  });
  it('does not create a recommendation for missing policy or missing evidence', () => {
    const c = command();
    c.policy = undefined;
    const d = deriveRecommendation(context(), c);
    expect(() =>
      prepareRecommendationInsert(d, c, {
        expectedSemanticKey: d.semanticKey,
        expectedDependencyKeys: d.dependencyKeys,
      }),
    ).toThrow('NOT_PERSISTIBLE');
  });
  it('does not bind weekly identity to evidence/configuration revisions or cutoff', () => {
    const a = draft(),
      c = command(),
      h = context();
    h.settings = [{ ...h.settings[0], incrementAbsolute: '5' }];
    const b = deriveRecommendation(h, c);
    expect(recommendationCycleKey(a.evidence)).toBe(
      recommendationCycleKey(b.evidence),
    );
    expect(a.semanticKey).not.toBe(b.semanticKey);
  });
  it('keeps cycle identity stable when configuration scope gets more specific', () => {
    const a = draft(),
      h = context();
    h.settings = [{ ...h.settings[0], exerciseId: 'exercise' }];
    expect(
      recommendationCycleKey(deriveRecommendation(h, command()).evidence),
    ).toBe(recommendationCycleKey(a.evidence));
  });
  it('changes cycle for a different week or intended task', () => {
    const a = draft(),
      b = structuredClone(a.evidence);
    b.period.start = '2026-01-12';
    b.period.endExclusive = '2026-01-19';
    expect(recommendationCycleKey(a.evidence)).not.toBe(
      recommendationCycleKey(b),
    );
    b.period = a.evidence.period;
    b.destination = { ...b.destination, taskId: 'different' };
    expect(recommendationCycleKey(a.evidence)).not.toBe(
      recommendationCycleKey(b),
    );
  });
  it('does not treat a different anchor from the same prescription as another target cycle', () => {
    const a = structuredClone(draft().evidence),
      b = structuredClone(a);
    a.destination = {
      ...a.destination,
      planId: 'plan',
      weekId: 'week',
      dayId: 'day',
      prescriptionId: 'prescription',
      taskId: 'a',
    };
    b.destination = { ...a.destination, taskId: 'b' };
    expect(recommendationCycleKey(a)).toBe(recommendationCycleKey(b));
  });
  it('rejects malformed snapshots, unknown versions and mismatched signatures', () => {
    const d = draft();
    for (const value of [null, {}, { ...d.evidence, schemaVersion: 'future' }])
      expect(() =>
        inspectGeneration(value, d.semanticKey, d.dependencyKeys),
      ).toThrow('SNAPSHOT_INVALID');
    expect(() =>
      inspectGeneration(
        { ...d.evidence, decision: 'MAINTAIN' },
        d.semanticKey,
        d.dependencyKeys,
      ),
    ).toThrow();
  });
  it('rejects decimal values outside the persistence range without truncating', () => {
    const d = draft();
    d.increment!.proposedLoad = '1000000000000000000';
    d.evidence.increment!.proposedLoad = '1000000000000000000';
    expect(() =>
      prepareRecommendationInsert(d, command(), {
        expectedSemanticKey: d.semanticKey,
        expectedDependencyKeys: d.dependencyKeys,
      }),
    ).toThrow();
  });
  it.each([null, {}, { expectedSemanticKey: 'x', expectedDependencyKeys: {} }])(
    'requires exact typed expected signatures',
    (v) => {
      expect(() => validateSaveExpectation(v)).toThrow(
        'INVALID_PERSISTENCE_COMMAND',
      );
    },
  );
  it('rejects inconsistent expected dependency keys even with the exact semantic key', () => {
    const d = draft();
    expect(() =>
      prepareRecommendationInsert(d, command(), {
        expectedSemanticKey: d.semanticKey,
        expectedDependencyKeys: {
          ...d.dependencyKeys,
          configuration: '0'.repeat(64),
        },
      }),
    ).toThrow('STALE_PROPOSAL');
  });

  it.each(['period', 'destination', 'historyWindow'] as const)(
    'rejects malformed %s even if its hash is recomputed',
    (key) => {
      const e = structuredClone(draft().evidence);
      Object.assign(e, { [key]: {} });
      expect(() =>
        inspectGeneration(
          e,
          recommendationIdentity(e),
          recommendationDependencyKeys(e),
        ),
      ).toThrow('SNAPSHOT_INVALID');
    },
  );

  it('rejects an internally valid increase outside Decimal(24,6) without truncating', () => {
    const c = context(),
      request = command(),
      value = '999999999999999999.999999';
    for (const task of c.history.tasks) {
      task.adjustedTargets.targetLoad = value;
      if (task.originalTargets) task.originalTargets.targetLoad = value;
    }
    for (const set of c.history.sets) {
      set.load = value;
      set.loadKg = value;
    }
    const d = deriveRecommendation(c, request);
    expect(d.decision).toBe('INCREASE');
    expect(() =>
      prepareRecommendationInsert(d, request, {
        expectedSemanticKey: d.semanticKey,
        expectedDependencyKeys: d.dependencyKeys,
      }),
    ).toThrow('DECIMAL_NOT_PERSISTABLE');
  });
});
