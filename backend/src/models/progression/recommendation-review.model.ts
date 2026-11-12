import type { RecommendationStatus } from '../../generated/prisma/client';
import type {
  RecommendationCommand,
  RecommendationContext,
  ValidatedRecommendationCommand,
} from './recommendation-draft.model';
import type {
  DependencyKeys,
  PersistedRecommendation,
} from './persisted-recommendation.model';
export type ReviewAction = 'APPROVE' | 'REJECT';
export type ManualAcceptance = Readonly<{
  schemaVersion: 'manual-proposal-acceptance-v1';
  scope: 'THIS_PROPOSAL_ONLY';
  authorizationKey: string;
  policyKey: string;
  acceptPolicy: true;
  acceptEvidence: true;
}>;
export type ReviewCommand = Readonly<{
  recommendationId: string;
  intentId: string;
  action: ReviewAction;
  expectedStatus: 'PENDING';
  expectedVersion: number | null;
  expectedSemanticKey: string | null;
  expectedCycleKey: string | null;
  expectedDependencyKeys: DependencyKeys | null;
  justification?: string;
  acceptance?: ManualAcceptance;
  command?: RecommendationCommand;
}>;
export type ValidatedReviewCommand = Omit<ReviewCommand, 'command'> & {
  command?: ValidatedRecommendationCommand;
};
export type ReviewEvent = Readonly<{
  id: string;
  recommendationId: string;
  athleteId: string;
  actorUserId: string;
  action: ReviewAction;
  fromStatus: RecommendationStatus;
  toStatus: RecommendationStatus;
  fromVersion: number | null;
  version: number;
  semanticKey: string | null;
  cycleKey: string | null;
  dependencyKeys: DependencyKeys | null;
  intentId: string;
  payloadKey: string;
  decidedAt: Date;
  justification: string | null;
  acceptance: ManualAcceptance | null;
}>;
export type ReviewState = Readonly<{
  proposal: PersistedRecommendation;
  events: readonly ReviewEvent[];
  context: RecommendationContext | null;
  sourceUnavailable: boolean;
  cycleConflict: boolean;
  now: Date;
  target: Readonly<{
    editable: boolean;
    hasHistory: boolean;
    retired: boolean;
    loadUnit: string | null;
  }> | null;
}>;
export type ReviewValidity =
  | 'CURRENT'
  | 'OBSOLETE'
  | 'NOT_EVALUABLE'
  | 'SOURCE_INACCESSIBLE'
  | 'CONFIGURATION_INCOMPATIBLE'
  | 'DESTINATION_MODIFIED'
  | 'DESTINATION_RETIRED'
  | 'LEGACY_UNKNOWN';
export type ReviewInspection = Readonly<{
  proposal: PersistedRecommendation;
  events: readonly ReviewEvent[];
  validity: { state: ReviewValidity; changedDependencies: readonly string[] };
  compatibility: { compatible: boolean; reasons: readonly string[] };
  cycle: { key: string | null; reserved: boolean; conflict: boolean };
  approvalBlockers: readonly string[];
  acceptanceChallenge: Omit<
    ManualAcceptance,
    'acceptPolicy' | 'acceptEvidence'
  > | null;
  manualAuthorization: Readonly<{
    state: 'ACCEPTED_FOR_THIS_PROPOSAL' | 'NOT_GRANTED' | 'UNKNOWN_UNAUDITED';
    eventId: string | null;
    requiresRevalidation: true;
  }>;
}>;
export class RecommendationReviewError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REVIEW_COMMAND'
      | 'SOURCE_NOT_FOUND'
      | 'AUTHENTICATION_REQUIRED'
      | 'REVIEW_CONFLICT'
      | 'INTENT_REUSED'
      | 'APPROVAL_BLOCKED'
      | 'ACCEPTANCE_REQUIRED'
      | 'SOURCE_BUSY',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}
export type ReviewOperation = Readonly<{
  input: ValidatedReviewCommand;
  payloadKey: string;
  inspect: (state: ReviewState) => ReviewInspection;
}>;
