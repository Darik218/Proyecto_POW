import { deriveRecommendation } from '../../progression/recommendation.service';
import {
  command,
  context,
} from '../../../test/helpers/recommendation-fixtures';
import type {
  ReviewState,
  ReviewCommand,
} from '../../models/progression/recommendation-review.model';
import {
  inspectReview,
  authorizeReview,
  validateReviewCommand,
} from './recommendation-review.policy';
const source = () => {
  const c = context(),
    d = deriveRecommendation(c, command());
  return { context: c, draft: d };
};
function state(): { -readonly [K in keyof ReviewState]: ReviewState[K] } {
  const { context: c, draft: d } = source();
  return {
    proposal: {
      id: '00000000-0000-4000-8000-000000000001',
      athleteId: 'athlete',
      exerciseId: 'exercise',
      status: 'PENDING',
      reviewVersion: null,
      createdAt: new Date('2026-01-12'),
      reviewedAt: null,
      expiresAt: null,
      previousLoad: '80.000000',
      recommendedLoad: '82.500000',
      loadUnit: 'KG',
      previousLoadKg: '80.000000',
      recommendedLoadKg: '82.500000',
      generation: {
        kind: 'NEUTRAL_INTERNAL',
        semanticKey: d.semanticKey,
        cycleKey: 'c'.repeat(64),
        cycleSlot: 'c'.repeat(64),
        requestKey: 'r'.repeat(64),
        draft: {
          ...d,
          evidence: {
            ...d.evidence,
            destination: {
              ...d.evidence.destination,
              kind: 'PRESCRIPTION',
              planId: 'plan',
              weekId: 'week',
              dayId: 'day',
              prescriptionId: 'prescription',
            },
          },
        },
      },
      evidence: [],
      generationAuthorization: 'NOT_GRANTED',
    },
    context: c,
    events: [],
    target: {
      editable: true,
      hasHistory: false,
      retired: false,
      loadUnit: 'KG',
    },
    cycleConflict: false,
    sourceUnavailable: false,
    now: new Date('2026-01-13'),
  };
}
const inspect = (s: ReviewState) =>
  inspectReview(s, s.proposal.generation?.draft ?? null);
function input(
  s: ReviewState,
  action: 'APPROVE' | 'REJECT' = 'APPROVE',
): ReviewCommand {
  const g = s.proposal.generation;
  return {
    recommendationId: s.proposal.id,
    intentId: '00000000-0000-4000-8000-000000000002',
    action,
    expectedStatus: 'PENDING',
    expectedVersion: null,
    expectedSemanticKey: g?.semanticKey ?? null,
    expectedCycleKey: g?.cycleKey ?? null,
    expectedDependencyKeys: g?.draft.dependencyKeys ?? null,
    justification: 'explicit review',
    acceptance: inspect(s).acceptanceChallenge
      ? {
          ...inspect(s).acceptanceChallenge!,
          acceptPolicy: true,
          acceptEvidence: true,
        }
      : undefined,
  };
}
describe('PROG-5A explicit review policy', () => {
  it('binds acceptance to a single valid proposal and never application', () => {
    const s = state(),
      v = inspect(s);
    expect(v.approvalBlockers).toEqual([]);
    expect(v.acceptanceChallenge?.scope).toBe('THIS_PROPOSAL_ONLY');
    expect(authorizeReview(v, input(s))).toBe('APPROVED');
    expect(v.manualAuthorization.state).toBe('NOT_GRANTED');
  });
  it('requires explicit acknowledgement of policy and evidence', () => {
    const s = state();
    expect(() =>
      authorizeReview(inspect(s), { ...input(s), acceptance: undefined }),
    ).toThrow('ACCEPTANCE_REQUIRED');
  });
  it.each(['APPROVED', 'APPLIED', 'REJECTED', 'BLOCKED', 'EXPIRED'] as const)(
    'rejects new reviews from %s',
    (status) => {
      const s = state();
      s.proposal = { ...s.proposal, status };
      expect(() => authorizeReview(inspect(s), input(s, 'REJECT'))).toThrow(
        'REVIEW_CONFLICT',
      );
    },
  );
  it('allows rejection of obsolete evidence without approving it', () => {
    const s = state(),
      d = { ...s.proposal.generation!.draft, semanticKey: 'a'.repeat(64) };
    const v = inspectReview(s, d);
    expect(v.validity.state).toBe('OBSOLETE');
    expect(() => authorizeReview(v, input(s))).toThrow('APPROVAL_BLOCKED');
    expect(authorizeReview(v, input(s, 'REJECT'))).toBe('REJECTED');
  });
  it('keeps legacy unknown, rejectable and never approvable', () => {
    const s = state();
    s.proposal = {
      ...s.proposal,
      generation: null,
      loadUnit: null,
      generationAuthorization: 'LEGACY_UNKNOWN',
    };
    const v = inspectReview(s, null);
    expect(v.validity.state).toBe('LEGACY_UNKNOWN');
    expect(() => authorizeReview(v, input(s))).toThrow('APPROVAL_BLOCKED');
    expect(authorizeReview(v, input(s, 'REJECT'))).toBe('REJECTED');
  });
  it.each(['80.000001', '100000.000000'])(
    'blocks an exact destination that cannot represent %s',
    (value) => {
      const s = state();
      s.proposal = { ...s.proposal, recommendedLoad: value };
      expect(inspect(s).compatibility.reasons).toContain(
        'DESTINATION_DECIMAL_INCOMPATIBLE',
      );
    },
  );
  it('blocks protected destinations and unit conversion', () => {
    const s = state();
    s.target = {
      editable: true,
      hasHistory: true,
      retired: false,
      loadUnit: 'LB',
    };
    expect(inspect(s).approvalBlockers).toEqual(
      expect.arrayContaining(['TARGET_HAS_HISTORY', 'TARGET_UNIT_MISMATCH']),
    );
  });
  it('blocks an unreserved or competing cycle', () => {
    const s = state();
    s.cycleConflict = true;
    s.proposal = {
      ...s.proposal,
      generation: { ...s.proposal.generation!, cycleSlot: null },
    };
    expect(inspect(s).approvalBlockers).toEqual(
      expect.arrayContaining(['CYCLE_CONFLICT', 'CYCLE_UNRESERVED']),
    );
  });
  it('does not silently accept another policy/destination/load digest', () => {
    const s = state(),
      i = input(s);
    const changed = {
      ...i,
      acceptance: { ...i.acceptance!, authorizationKey: 'a'.repeat(64) },
    };
    expect(() => authorizeReview(inspect(s), changed)).toThrow(
      'ACCEPTANCE_REQUIRED',
    );
  });
  it('rejects stale expected review versions', () => {
    const s = state();
    expect(() =>
      authorizeReview(inspect(s), { ...input(s), expectedVersion: 1 }),
    ).toThrow('REVIEW_CONFLICT');
  });
  it('rejects malformed and application actions without widening input', () => {
    for (const x of [null, {}, { ...input(state()), action: 'APPLY' }])
      expect(() => validateReviewCommand(x)).toThrow('INVALID_REVIEW_COMMAND');
  });
  it('does not infer accepted authorization from an audit record with a wrong acceptance digest', () => {
    const s = state(),
      g = s.proposal.generation!;
    s.proposal = { ...s.proposal, status: 'APPROVED', reviewVersion: 1 };
    s.events = [
      {
        id: 'event',
        recommendationId: s.proposal.id,
        athleteId: s.proposal.athleteId,
        actorUserId: 'user',
        action: 'APPROVE',
        fromStatus: 'PENDING',
        toStatus: 'APPROVED',
        fromVersion: null,
        version: 1,
        semanticKey: g.semanticKey,
        cycleKey: g.cycleKey,
        dependencyKeys: g.draft.dependencyKeys,
        intentId: 'intent',
        payloadKey: 'a'.repeat(64),
        decidedAt: new Date('2026-01-13'),
        justification: null,
        acceptance: {
          schemaVersion: 'manual-proposal-acceptance-v1',
          scope: 'THIS_PROPOSAL_ONLY',
          acceptPolicy: true,
          acceptEvidence: true,
          authorizationKey: '0'.repeat(64),
          policyKey: '0'.repeat(64),
        },
      },
    ];
    expect(inspect(s).manualAuthorization.state).toBe('UNKNOWN_UNAUDITED');
  });
});
