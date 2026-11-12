import type { ReviewState } from '../../models/progression/recommendation-review.model';
import type { ValidatedRecommendationCommand } from '../../models/progression/recommendation-draft.model';
import type { ApplicationActivity } from '../../models/progression/progression-http.model';
import { RecommendationApplicationError } from '../../models/progression/recommendation-application.model';
import { validateApplicationCommand } from './recommendation-application.policy';
export function prepareApplicationChallenge(
  review: ReviewState,
  command: ValidatedRecommendationCommand,
  activity: ApplicationActivity,
  intentId: string,
) {
  const p = review.proposal,
    g = p.generation,
    d = g?.draft.evidence.destination,
    event = review.events.find(
      (e) => e.action === 'APPROVE' && e.version === p.reviewVersion,
    );
  if (
    !g ||
    d?.kind !== 'PRESCRIPTION' ||
    !d.planId ||
    !d.weekId ||
    !d.dayId ||
    !d.prescriptionId ||
    d.planVersion === null ||
    !event ||
    !p.loadUnit ||
    p.previousLoad === null
  )
    throw new RecommendationApplicationError('APPLICATION_BLOCKED', [
      'VERIFIED_APPROVAL_REQUIRED',
    ]);
  return validateApplicationCommand({
    recommendationId: p.id,
    intentId,
    reviewId: event.id,
    expectedReviewVersion: event.version,
    expectedSemanticKey: g.semanticKey,
    expectedCycleKey: g.cycleKey,
    expectedDependencyKeys: g.draft.dependencyKeys,
    destination: {
      planId: d.planId,
      weekId: d.weekId,
      dayId: d.dayId,
      prescriptionId: d.prescriptionId,
    },
    expectedPlanVersion: d.planVersion,
    activityId: activity.id,
    expectedActivityVersion: activity.version,
    expectedScheduledOn: activity.scheduledOn,
    timeZone: activity.timeZone,
    previousLoad: p.previousLoad,
    appliedLoad: p.recommendedLoad,
    loadUnit: p.loadUnit,
    command,
  });
}
