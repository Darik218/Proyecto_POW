import type {
  RecommendationCommand,
  ValidatedRecommendationCommand,
} from './recommendation-draft.model';
import type { DependencyKeys } from './persisted-recommendation.model';
import type { ReviewState } from './recommendation-review.model';
export type ApplyRecommendationCommand = Readonly<{
  recommendationId: string;
  intentId: string;
  reviewId: string;
  expectedReviewVersion: number;
  expectedSemanticKey: string;
  expectedCycleKey: string;
  expectedDependencyKeys: DependencyKeys;
  destination: {
    planId: string;
    weekId: string;
    dayId: string;
    prescriptionId: string;
  };
  expectedPlanVersion: number;
  activityId: string;
  expectedActivityVersion: number;
  expectedScheduledOn: string;
  timeZone: string;
  previousLoad: string;
  appliedLoad: string;
  loadUnit: 'KG' | 'LB';
  command: RecommendationCommand;
}>;
export type ValidatedApplicationCommand = Omit<
  ApplyRecommendationCommand,
  'command'
> & { command: ValidatedRecommendationCommand };
export type ApplicationTarget = Readonly<{
  planId: string;
  weekId: string;
  dayId: string;
  prescriptionId: string;
  exerciseId: string;
  planVersion: number;
  status: string;
  retired: boolean;
  hasHistory: boolean;
  hasSessions: boolean;
  load: string | null;
  loadUnit: string | null;
  startsOn: string | null;
  endsOn: string | null;
  activities: readonly {
    id: string;
    version: number;
    on: string;
    timeZone: string;
    status: string;
    hasWorkouts: boolean;
  }[];
  truncated: boolean;
}>;
export type ApplicationState = Readonly<{
  review: ReviewState;
  target: ApplicationTarget | null;
  now: Date;
  actorUserId: string;
}>;
export type ApplicationAudit = Readonly<{
  schemaVersion: 'manual-progression-application-v1';
  action: 'APPLY';
  fromStatus: 'APPROVED';
  toStatus: 'APPLIED';
  authorization: {
    reviewId: string;
    reviewVersion: number;
    authorizationKey: string;
    semanticKey: string;
    cycleKey: string;
    dependencyKeys: DependencyKeys;
  };
  destination: {
    planId: string;
    weekId: string;
    dayId: string;
    prescriptionId: string;
    exerciseId: string;
    planVersionBefore: number;
    planVersionAfter: number;
  };
  load: { previousLoad: string; appliedLoad: string; unit: 'KG' | 'LB' };
  temporal: {
    activityId: string;
    activityVersion: number;
    scheduledOn: string;
    timeZone: string;
    checkedAt: string;
    localOn: string;
    relatedActivityIds: readonly string[];
  };
}>;
export type ApplicationReceipt = Readonly<{
  id: string;
  recommendationId: string;
  athleteId: string;
  actorUserId: string;
  intentId: string;
  requestKey: string;
  reviewId: string;
  planExerciseId: string;
  scheduledActivityId: string;
  cycleKey: string;
  previousLoad: string;
  appliedLoad: string;
  loadUnit: 'KG' | 'LB';
  origin: 'MANUAL';
  effectiveAt: Date;
  audit: ApplicationAudit;
}>;
export type ApplyOperation = Readonly<{
  input: ValidatedApplicationCommand;
  requestKey: string;
  assess: (state: ApplicationState) => ApplicationAudit;
}>;
export class RecommendationApplicationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_APPLICATION_COMMAND'
      | 'AUTHENTICATION_REQUIRED'
      | 'SOURCE_NOT_FOUND'
      | 'APPLICATION_BLOCKED'
      | 'STALE_APPLICATION'
      | 'INTENT_REUSED'
      | 'ALREADY_APPLIED'
      | 'LEGACY_APPLICATION_UNKNOWN'
      | 'SOURCE_BUSY'
      | 'APPLICATION_CORRUPT',
    readonly reasons: readonly string[] = [],
  ) {
    super(code);
  }
}

// Shared target preconditions contain no manual acceptance or identity.
export type FutureTargetExpectation = Pick<
  ApplyRecommendationCommand,
  | 'destination'
  | 'expectedPlanVersion'
  | 'activityId'
  | 'expectedActivityVersion'
  | 'expectedScheduledOn'
  | 'timeZone'
  | 'previousLoad'
  | 'appliedLoad'
  | 'loadUnit'
>;
