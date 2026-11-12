import { RecommendationApplicationError } from '../models/progression/recommendation-application.model';
import type { RecommendationListQuery } from '../models/progression/progression-http.model';
import { prepareApplicationChallenge } from '../domain/progression/application-readiness.policy';
import { resolveEffectiveSettings } from '../domain/progression/effective-settings.policy';
import {
  validateApplicationCommand,
  applicationRequestKey,
  authorizeApplication,
} from '../domain/progression/recommendation-application.policy';
import type { ApplyRecommendationCommand } from '../models/progression/recommendation-application.model';
import {
  inspectReview,
  validateReviewCommand,
  reviewPayloadKey,
} from '../domain/progression/recommendation-review.policy';
import type {
  ReviewCommand,
  ReviewState,
} from '../models/progression/recommendation-review.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import {
  prepareRecommendationInsert,
  validateSaveExpectation,
} from '../domain/progression/recommendation-persistence.policy';
import type { SaveProposalCommand } from '../models/progression/persisted-recommendation.model';
import { RecommendationPersistenceError } from '../models/progression/persisted-recommendation.model';
import { compareDrafts } from '../domain/progression/recommendation.policy';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import type { ProgressionRepository } from './progression.repository';
import { validateRecommendationCommand } from '../domain/progression/recommendation-query.policy';
import type {
  RecommendationCommand,
  RecommendationContext,
} from '../models/progression/recommendation-draft.model';
import {
  prepareRecommendation,
  decideRecommendation,
} from '../domain/progression/recommendation.policy';
import { assessHistory } from './assessment.service';
// Shared application coordinator: all math/policies remain in Domain.
export function deriveRecommendation(
  context: RecommendationContext,
  command: RecommendationCommand,
) {
  const prepared = prepareRecommendation(context, command);
  const assessment = prepared.options
    ? assessHistory(prepared.performance, prepared.options)
    : null;
  return decideRecommendation(context, command, prepared, assessment);
}

@Injectable()
export class RecommendationService {
  constructor(
    @Inject(PROGRESSION_REPOSITORY)
    private readonly repository: ProgressionRepository,
  ) {}
  async contextForMyExercise(
    identity: AuthenticatedIdentity,
    input: RecommendationCommand,
  ) {
    const command = validateRecommendationCommand(input);
    const context = await this.repository.readRecommendationContext(
      identity.account.id,
      command.history,
      command.destination,
    );
    return {
      context,
      configuration: resolveEffectiveSettings(
        context.settings,
        context.history.athleteId,
        context.history.exerciseId,
        context.target.planId,
        command.policy,
      ),
    };
  }
  async listMyRecommendations(
    identity: AuthenticatedIdentity,
    query: RecommendationListQuery,
  ) {
    const actor = this.reviewIdentity(identity, identity.account.id);
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    )
      throw new RecommendationPersistenceError('INVALID_PERSISTENCE_COMMAND');
    return this.repository.listRecommendations(
      actor.userId,
      actor.sessionId,
      query,
    );
  }
  async getMyRevalidationRequest(identity: AuthenticatedIdentity, id: string) {
    const actor = this.reviewIdentity(identity, id);
    return this.repository.getRevalidationRequest(
      actor.userId,
      actor.sessionId,
      id,
    );
  }
  async getMyApplicationReceipt(identity: AuthenticatedIdentity, id: string) {
    const actor = this.reviewIdentity(identity, id);
    return this.repository.getApplicationReceipt(
      actor.userId,
      actor.sessionId,
      id,
    );
  }
  async inspectMyApplication(
    identity: AuthenticatedIdentity,
    id: string,
    input: {
      command: RecommendationCommand;
      activityId: string;
      intentId: string;
    },
  ) {
    const actor = this.reviewIdentity(identity, id),
      command = validateRecommendationCommand(input.command);
    this.reviewIdentity(identity, input.activityId);
    this.reviewIdentity(identity, input.intentId);
    return this.repository.inspectApplication(
      actor.userId,
      actor.sessionId,
      id,
      {
        command,
        activityId: input.activityId,
        intentId: input.intentId,
        prepare: (review, activity) =>
          prepareApplicationChallenge(
            review,
            command,
            activity,
            input.intentId,
          ),
        assess: (state, application) =>
          authorizeApplication(
            state,
            inspectReview(
              state.review,
              state.review.context
                ? deriveRecommendation(state.review.context, command)
                : null,
            ),
            application,
          ),
      },
    );
  }
  private reviewIdentity(identity: AuthenticatedIdentity, id: string) {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !identity?.account ||
      !uuid.test(identity.account.id) ||
      !uuid.test(identity.sessionId) ||
      !uuid.test(id)
    )
      throw new RecommendationReviewError('INVALID_REVIEW_COMMAND');
    return { userId: identity.account.id, sessionId: identity.sessionId };
  }
  async applyMyApprovedRecommendation(
    identity: AuthenticatedIdentity,
    input: ApplyRecommendationCommand,
  ) {
    const command = validateApplicationCommand(input);
    let actor: { userId: string; sessionId: string };
    try {
      actor = this.reviewIdentity(identity, command.recommendationId);
    } catch {
      throw new RecommendationApplicationError('AUTHENTICATION_REQUIRED');
    }
    return this.repository.applyRecommendation(actor.userId, actor.sessionId, {
      input: command,
      requestKey: applicationRequestKey(command),
      assess: (state) =>
        authorizeApplication(
          state,
          inspectReview(
            state.review,
            state.review.context
              ? deriveRecommendation(state.review.context, command.command)
              : null,
          ),
          command,
        ),
    });
  }
  async inspectMyProposal(
    identity: AuthenticatedIdentity,
    id: string,
    input?: RecommendationCommand,
  ) {
    const actor = this.reviewIdentity(identity, id),
      command =
        input === undefined ? undefined : validateRecommendationCommand(input);
    return this.repository.inspectRecommendation(
      actor.userId,
      actor.sessionId,
      id,
      command,
      (state) =>
        inspectReview(
          state,
          state.context && command
            ? deriveRecommendation(state.context, command)
            : null,
        ),
    );
  }
  async reviewMyProposal(
    identity: AuthenticatedIdentity,
    input: ReviewCommand,
  ) {
    const validated = validateReviewCommand(input),
      actor = this.reviewIdentity(identity, validated.recommendationId);
    return this.repository.reviewRecommendation(actor.userId, actor.sessionId, {
      input: validated,
      payloadKey: reviewPayloadKey(validated),
      inspect: (state: ReviewState) =>
        inspectReview(
          state,
          state.context && validated.command
            ? deriveRecommendation(state.context, validated.command)
            : null,
        ),
    });
  }
  async saveMyProposal(
    identity: AuthenticatedIdentity,
    input: SaveProposalCommand,
    recordContext = false,
  ) {
    const command = validateRecommendationCommand(input?.command),
      expected = validateSaveExpectation(input),
      userId = identity.account.id;
    return this.repository.persistRecommendation(userId, {
      ...(recordContext ? { recordContext: true as const } : {}),
      command,
      ...expected,
      prepare: (context) =>
        prepareRecommendationInsert(
          deriveRecommendation(context, command),
          command,
          expected,
        ),
    });
  }
  async getMyProposal(identity: AuthenticatedIdentity, id: string) {
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new RecommendationPersistenceError('INVALID_PERSISTENCE_COMMAND');
    return this.repository.getOwnedRecommendation(identity.account.id, id);
  }
  async checkMyProposal(
    identity: AuthenticatedIdentity,
    id: string,
    input: RecommendationCommand,
  ) {
    const command = validateRecommendationCommand(input),
      userId = identity.account.id;
    const stored = await this.getMyProposal(identity, id);
    if (!stored) throw new RecommendationPersistenceError('SOURCE_NOT_FOUND');
    if (!stored.generation)
      return {
        status: 'LEGACY_UNKNOWN' as const,
        applicationAuthorization: 'NOT_GRANTED' as const,
      };
    const current = deriveRecommendation(
      await this.repository.readRecommendationContext(
        userId,
        command.history,
        command.destination,
      ),
      command,
    );
    const check = compareDrafts(stored.generation.draft, current);
    return {
      status: check.obsolete ? ('OBSOLETE' as const) : ('UNCHANGED' as const),
      changedDependencies: check.changed,
      applicationAuthorization: 'NOT_GRANTED' as const,
    };
  }
  async proposeMyExercise(
    identity: AuthenticatedIdentity,
    input: RecommendationCommand,
  ) {
    const command = validateRecommendationCommand(input),
      userId = identity.account.id;
    const context = await this.repository.readRecommendationContext(
      userId,
      command.history,
      command.destination,
    );
    return deriveRecommendation(context, command);
  }
}
