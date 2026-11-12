import type { PersistedRecommendation } from '../../models/progression/persisted-recommendation.model';
import type { RecommendationDraft } from '../../models/progression/persisted-recommendation.model';
import type {
  ReviewCommand,
  ValidatedReviewCommand,
  ReviewInspection,
  ReviewState,
  ReviewValidity,
} from '../../models/progression/recommendation-review.model';
import { RecommendationReviewError as Failure } from '../../models/progression/recommendation-review.model';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { validateSaveExpectation } from './recommendation-persistence.policy';
import { validateRecommendationCommand } from './recommendation-query.policy';
import { compareDrafts } from './recommendation.policy';
import { assertPersistableDecimal } from './estimate-evidence.policy';
export const REVIEW_VERSION = 'manual-recommendation-review-v1';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validateReviewCommand(value: unknown): ValidatedReviewCommand {
  const fail = (): never => {
    throw new Failure('INVALID_REVIEW_COMMAND');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const v = value as ReviewCommand;
  if (
    !uuid(v.recommendationId) ||
    !uuid(v.intentId) ||
    !['APPROVE', 'REJECT'].includes(v.action) ||
    v.expectedStatus !== 'PENDING' ||
    (v.expectedVersion !== null &&
      (!Number.isSafeInteger(v.expectedVersion) || v.expectedVersion < 1)) ||
    (v.justification !== undefined &&
      (typeof v.justification !== 'string' ||
        !v.justification.trim() ||
        v.justification.length > 2000)) ||
    (v.action === 'REJECT' && !v.justification)
  )
    return fail();
  if (v.expectedSemanticKey === null) {
    if (v.expectedCycleKey !== null || v.expectedDependencyKeys !== null)
      return fail();
  } else {
    try {
      validateSaveExpectation(v);
    } catch {
      return fail();
    }
    if (
      typeof v.expectedCycleKey !== 'string' ||
      !/^[0-9a-f]{64}$/.test(v.expectedCycleKey)
    )
      return fail();
  }
  if (v.acceptance !== undefined) {
    const a = v.acceptance;
    if (
      !a ||
      a.schemaVersion !== 'manual-proposal-acceptance-v1' ||
      a.scope !== 'THIS_PROPOSAL_ONLY' ||
      a.acceptPolicy !== true ||
      a.acceptEvidence !== true ||
      !/^[0-9a-f]{64}$/.test(a.authorizationKey) ||
      !/^[0-9a-f]{64}$/.test(a.policyKey) ||
      Object.keys(a).sort().join(',') !==
        'acceptEvidence,acceptPolicy,authorizationKey,policyKey,schemaVersion,scope'
    )
      return fail();
  }
  if (v.action === 'REJECT' && v.acceptance !== undefined) return fail();
  return structuredClone({
    recommendationId: v.recommendationId,
    intentId: v.intentId,
    action: v.action,
    expectedStatus: v.expectedStatus,
    expectedVersion: v.expectedVersion,
    expectedSemanticKey: v.expectedSemanticKey,
    expectedCycleKey: v.expectedCycleKey,
    expectedDependencyKeys: v.expectedDependencyKeys,
    justification: v.justification,
    acceptance: v.acceptance,
    command:
      v.command === undefined
        ? undefined
        : validateRecommendationCommand(v.command),
  });
}
export function reviewPayloadKey(input: ValidatedReviewCommand): string {
  return recommendationIdentity({
    schemaVersion: REVIEW_VERSION,
    command: JSON.parse(JSON.stringify(input)),
  });
}
export function inspectReview(
  state: ReviewState,
  current: RecommendationDraft | null,
): ReviewInspection {
  const p = state.proposal,
    g = p.generation,
    reasons: string[] = [],
    blockers: string[] = [];
  let validity: ReviewValidity = 'NOT_EVALUABLE',
    changed: readonly string[] = [];
  if (!g) validity = 'LEGACY_UNKNOWN';
  else if (state.sourceUnavailable) validity = 'SOURCE_INACCESSIBLE';
  else if (current) {
    const compared = compareDrafts(g.draft, current);
    changed = compared.changed;
    validity = state.context?.target.retired
      ? 'DESTINATION_RETIRED'
      : changed.includes('destination')
        ? 'DESTINATION_MODIFIED'
        : current.decision === 'CONFIGURATION_REQUIRED'
          ? 'CONFIGURATION_INCOMPATIBLE'
          : compared.obsolete || changed.length
            ? 'OBSOLETE'
            : 'CURRENT';
  }
  if (
    !g ||
    g.draft.evidence.destination.kind !== 'PRESCRIPTION' ||
    !state.target
  )
    reasons.push('TARGET_NOT_RESOLVED');
  else {
    if (state.target.retired) reasons.push('TARGET_RETIRED');
    if (!state.target.editable) reasons.push('TARGET_NOT_EDITABLE');
    if (state.target.hasHistory) reasons.push('TARGET_HAS_HISTORY');
    if (!p.loadUnit || state.target.loadUnit !== p.loadUnit)
      reasons.push('TARGET_UNIT_MISMATCH');
  }
  try {
    assertPersistableDecimal(p.recommendedLoad, 8, 3);
  } catch {
    reasons.push('DESTINATION_DECIMAL_INCOMPATIBLE');
  }
  if (p.status !== 'PENDING' || p.reviewVersion !== null)
    blockers.push('STATE_NOT_PENDING');
  if (p.reviewedAt !== null && p.reviewVersion === null)
    blockers.push('UNVERIFIED_PRIOR_REVIEW');
  if (validity !== 'CURRENT') blockers.push(validity);
  if (p.expiresAt !== null && p.expiresAt.getTime() <= state.now.getTime())
    blockers.push('PROPOSAL_EXPIRED');
  if (state.cycleConflict) blockers.push('CYCLE_CONFLICT');
  if (!g || g.cycleSlot !== g.cycleKey) blockers.push('CYCLE_UNRESERVED');
  blockers.push(...reasons);
  const acceptance =
    g && blockers.length === 0 ? challengeFor(p, p.reviewVersion) : null;
  const approved = state.events.find(
    (e) =>
      e.action === 'APPROVE' &&
      e.toStatus === 'APPROVED' &&
      e.recommendationId === p.id &&
      e.athleteId === p.athleteId &&
      e.version === p.reviewVersion &&
      e.fromVersion === null &&
      e.semanticKey === g?.semanticKey &&
      e.cycleKey === g?.cycleKey &&
      recommendationIdentity(e.dependencyKeys) ===
        recommendationIdentity(g?.draft.dependencyKeys ?? null) &&
      e.acceptance !== null &&
      recommendationIdentity(e.acceptance) ===
        recommendationIdentity({
          ...challengeFor(p, e.fromVersion),
          acceptPolicy: true,
          acceptEvidence: true,
        }),
  );

  return {
    proposal: p,
    events: state.events,
    validity: { state: validity, changedDependencies: changed },
    compatibility: { compatible: reasons.length === 0, reasons },
    cycle: {
      key: g?.cycleKey ?? null,
      reserved: !!g && g.cycleSlot === g.cycleKey,
      conflict: state.cycleConflict,
    },
    approvalBlockers: [...new Set(blockers)],
    acceptanceChallenge: acceptance,
    manualAuthorization: {
      state: approved
        ? 'ACCEPTED_FOR_THIS_PROPOSAL'
        : p.status === 'APPROVED' || p.status === 'APPLIED'
          ? 'UNKNOWN_UNAUDITED'
          : 'NOT_GRANTED',
      eventId: approved?.id ?? null,
      requiresRevalidation: true,
    },
  };
}
function challengeFor(p: PersistedRecommendation, version: number | null) {
  const g = p.generation!;
  return {
    schemaVersion: 'manual-proposal-acceptance-v1' as const,
    scope: 'THIS_PROPOSAL_ONLY' as const,
    authorizationKey: recommendationIdentity({
      schemaVersion: REVIEW_VERSION,
      scope: 'THIS_PROPOSAL_ONLY',
      recommendationId: p.id,
      athleteId: p.athleteId,
      reviewVersion: version,
      semanticKey: g.semanticKey,
      cycleKey: g.cycleKey,
      cycleSlot: g.cycleKey,
      dependencyKeys: g.draft.dependencyKeys,
      configuration: g.draft.evidence.configuration,
      destination: g.draft.evidence.destination,
      proposedLoad: p.recommendedLoad,
      loadUnit: p.loadUnit,
    }),
    policyKey: recommendationIdentity(g.draft.evidence.configuration),
  };
}
export function authorizeReview(
  view: ReviewInspection,
  input: ReviewCommand,
): 'APPROVED' | 'REJECTED' {
  const p = view.proposal,
    g = p.generation;
  if (
    p.id !== input.recommendationId ||
    p.status !== 'PENDING' ||
    input.expectedStatus !== p.status ||
    input.expectedVersion !== p.reviewVersion ||
    p.reviewedAt !== null ||
    input.expectedSemanticKey !== (g?.semanticKey ?? null) ||
    input.expectedCycleKey !== (g?.cycleKey ?? null) ||
    recommendationIdentity(input.expectedDependencyKeys) !==
      recommendationIdentity(g?.draft.dependencyKeys ?? null)
  )
    throw new Failure('REVIEW_CONFLICT');
  if (input.action === 'REJECT') return 'REJECTED';
  if (input.action !== 'APPROVE') throw new Failure('INVALID_REVIEW_COMMAND');
  if (view.approvalBlockers.length)
    throw new Failure('APPROVAL_BLOCKED', view.approvalBlockers);
  if (
    !view.acceptanceChallenge ||
    !input.acceptance ||
    recommendationIdentity(input.acceptance) !==
      recommendationIdentity({
        ...view.acceptanceChallenge,
        acceptPolicy: true,
        acceptEvidence: true,
      })
  )
    throw new Failure('ACCEPTANCE_REQUIRED');
  return 'APPROVED';
}
