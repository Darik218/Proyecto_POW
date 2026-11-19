import type { PersistedRecommendation } from './persisted-recommendation.model';
import type {
  RecommendationCommand,
  ValidatedRecommendationCommand,
} from './recommendation-draft.model';
import type {
  ApplicationReceipt,
  ApplicationState,
  ValidatedApplicationCommand,
  ApplicationAudit,
} from './recommendation-application.model';
import type { ReviewState } from './recommendation-review.model';
export type RecommendationListQuery = Readonly<{
  page: number;
  limit: number;
  exerciseId?: string;
  status?: string;
  semanticKey?: string;
}>;
export type RecommendationListItem = Pick<
  PersistedRecommendation,
  | 'id'
  | 'exerciseId'
  | 'status'
  | 'createdAt'
  | 'previousLoad'
  | 'recommendedLoad'
  | 'loadUnit'
> & { exerciseName: string; generationKnown: boolean };
export type RecommendationListResult = Readonly<{
  items: readonly RecommendationListItem[];
  total: number;
  page: number;
  limit: number;
}>;
export type RevalidationRecipe = Readonly<{
  schemaVersion: 'manual-revalidation-request-v1';
  command: RecommendationCommand;
  recordedAt: Date;
  provenance: 'HTTP_SAVE_REQUEST' | 'MATCHING_REPLAY_REQUEST';
}>;
export type ApplicationActivity = Readonly<{
  id: string;
  version: number;
  scheduledOn: string;
  timeZone: string;
}>;
export type ApplicationReadiness = Readonly<{
  eligible: boolean;
  reasons: readonly string[];
  command: ValidatedApplicationCommand | null;
  receipt: ApplicationReceipt | null;
  inspectedAt: Date;
}>;
export type ApplicationReadinessOperation = Readonly<{
  command: ValidatedRecommendationCommand;
  activityId: string;
  intentId: string;
  prepare: (
    review: ReviewState,
    activity: ApplicationActivity,
  ) => ValidatedApplicationCommand;
  assess: (
    state: ApplicationState,
    command: ValidatedApplicationCommand,
  ) => ApplicationAudit;
}>;
export class ProgressionRequestError extends Error {
  constructor(
    readonly code:
      | 'RESOURCE_NOT_FOUND'
      | 'REVALIDATION_PARAMETERS_REQUIRED'
      | 'ROUTE_RESOURCE_MISMATCH',
  ) {
    super(code);
  }
}
