import type {
  FutureTargetExpectation,
  ApplicationAudit,
  ApplicationState,
  ApplicationTarget,
  ApplyRecommendationCommand,
  ValidatedApplicationCommand,
} from '../../models/progression/recommendation-application.model';
import { RecommendationApplicationError as Failure } from '../../models/progression/recommendation-application.model';
import type { ReviewInspection } from '../../models/progression/recommendation-review.model';
import { validateRecommendationCommand } from './recommendation-query.policy';
import { validateSaveExpectation } from './recommendation-persistence.policy';
import { recommendationIdentity } from './recommendation-evidence.policy';
import { assertPersistableDecimal } from './estimate-evidence.policy';
import { readDecimal } from './decimal';
import { validSportDate } from './performance-query.policy';
import { localDate } from '../../workout-sessions/workout-calendar.policy';
export const APPLICATION_AUDIT_VERSION = 'manual-progression-application-v1';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const decimal = (v: unknown) => {
  const d = readDecimal(v);
  if (!d.ok || d.value.lte(0)) throw new Failure('INVALID_APPLICATION_COMMAND');
  return d.value.toFixed();
};
export function validateApplicationCommand(
  value: unknown,
): ValidatedApplicationCommand {
  try {
    const v = value as ApplyRecommendationCommand;
    if (
      !v ||
      !['recommendationId', 'intentId', 'reviewId', 'activityId'].every((k) =>
        uuid((v as unknown as Record<string, unknown>)[k]),
      ) ||
      !v.destination ||
      !['planId', 'weekId', 'dayId', 'prescriptionId'].every((k) =>
        uuid(v.destination[k as keyof typeof v.destination]),
      ) ||
      ![
        v.expectedReviewVersion,
        v.expectedPlanVersion,
        v.expectedActivityVersion,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      v.expectedReviewVersion < 1 ||
      typeof v.expectedCycleKey !== 'string' ||
      !/^[0-9a-f]{64}$/.test(v.expectedCycleKey) ||
      !validSportDate(v.expectedScheduledOn) ||
      !['KG', 'LB'].includes(v.loadUnit)
    )
      throw new Error();
    validateSaveExpectation(v);
    localDate(v.timeZone, new Date(0));
    return structuredClone({
      recommendationId: v.recommendationId,
      intentId: v.intentId,
      reviewId: v.reviewId,
      expectedReviewVersion: v.expectedReviewVersion,
      expectedSemanticKey: v.expectedSemanticKey,
      expectedCycleKey: v.expectedCycleKey,
      expectedDependencyKeys: v.expectedDependencyKeys,
      destination: { ...v.destination },
      expectedPlanVersion: v.expectedPlanVersion,
      activityId: v.activityId,
      expectedActivityVersion: v.expectedActivityVersion,
      expectedScheduledOn: v.expectedScheduledOn,
      timeZone: v.timeZone,
      previousLoad: decimal(v.previousLoad),
      appliedLoad: decimal(v.appliedLoad),
      loadUnit: v.loadUnit,
      command: validateRecommendationCommand(v.command),
    });
  } catch {
    throw new Failure('INVALID_APPLICATION_COMMAND');
  }
}
export function applicationRequestKey(
  input: ValidatedApplicationCommand,
): string {
  return recommendationIdentity({
    schemaVersion: APPLICATION_AUDIT_VERSION,
    command: JSON.parse(JSON.stringify(input)),
  });
}
function sameNumber(a: string | null, b: string): boolean {
  const x = readDecimal(a),
    y = readDecimal(b);
  return x.ok && y.ok && x.value.eq(y.value);
}
export function assertFutureTarget(
  target: ApplicationTarget | null,
  input: FutureTargetExpectation,
  now: Date,
) {
  const reasons: string[] = [];
  if (!target)
    throw new Failure('APPLICATION_BLOCKED', ['TARGET_NOT_RESOLVED']);
  if (
    ['planId', 'weekId', 'dayId', 'prescriptionId'].some(
      (k) =>
        target[k as keyof ApplyRecommendationCommand['destination']] !==
        input.destination[k as keyof ApplyRecommendationCommand['destination']],
    )
  )
    throw new Failure('STALE_APPLICATION', ['DESTINATION_CHANGED']);
  if (target.planVersion !== input.expectedPlanVersion)
    throw new Failure('STALE_APPLICATION', ['PLAN_VERSION_CHANGED']);
  if (
    !sameNumber(target.load, input.previousLoad) ||
    target.loadUnit !== input.loadUnit
  )
    throw new Failure('STALE_APPLICATION', ['BASELINE_OR_UNIT_CHANGED']);
  if (target.status !== 'DRAFT') reasons.push('TARGET_NOT_EDITABLE');
  if (target.retired) reasons.push('TARGET_RETIRED');
  if (target.hasHistory || target.hasSessions)
    reasons.push('FUTURE_COPY_REQUIRED');
  if (target.truncated) reasons.push('TEMPORAL_COVERAGE_INCOMPLETE');
  if (target.planVersion >= 2147483647) reasons.push('PLAN_VERSION_EXHAUSTED');
  const witness = target.activities.find((a) => a.id === input.activityId);
  if (!witness) reasons.push('FUTURE_DATE_UNVERIFIED');
  else if (
    witness.version !== input.expectedActivityVersion ||
    witness.on !== input.expectedScheduledOn ||
    witness.timeZone !== input.timeZone
  )
    throw new Failure('STALE_APPLICATION', ['ACTIVITY_CHANGED']);
  let localOn = '';
  try {
    localOn = localDate(witness?.timeZone ?? input.timeZone, now);
    for (const a of target.activities)
      if (
        !['PLANNED', 'RESCHEDULED'].includes(a.status) ||
        a.hasWorkouts ||
        !validSportDate(a.on) ||
        a.on <= localDate(a.timeZone, now)
      )
        reasons.push('AFFECTED_ACTIVITY_NOT_FUTURE_OR_EXECUTABLE');
  } catch {
    reasons.push('TIME_ZONE_UNVERIFIED');
  }
  if (
    witness &&
    ((target.startsOn && witness.on < target.startsOn) ||
      (target.endsOn && witness.on > target.endsOn))
  )
    reasons.push('TARGET_DATE_OUTSIDE_PLAN');
  try {
    assertPersistableDecimal(input.previousLoad, 8, 3);
    assertPersistableDecimal(input.appliedLoad, 8, 3);
  } catch {
    reasons.push('DESTINATION_DECIMAL_INCOMPATIBLE');
  }
  const old = readDecimal(input.previousLoad),
    next = readDecimal(input.appliedLoad);
  if (!old.ok || !next.ok || !next.value.gt(old.value))
    reasons.push('NO_POSITIVE_AUTHORIZED_INCREMENT');
  if (reasons.length)
    throw new Failure('APPLICATION_BLOCKED', [...new Set(reasons)]);
  return { localOn, witness: witness! };
}
export function authorizeApplication(
  state: ApplicationState,
  view: ReviewInspection,
  input: ValidatedApplicationCommand,
): ApplicationAudit {
  const p = state.review.proposal,
    g = p.generation,
    approved = state.review.events.find((e) => e.id === input.reviewId),
    reasons: string[] = [];
  if (
    !g ||
    p.status !== 'APPROVED' ||
    p.reviewVersion !== input.expectedReviewVersion ||
    !approved ||
    approved.action !== 'APPROVE' ||
    approved.actorUserId !== state.actorUserId ||
    approved.version !== p.reviewVersion ||
    view.manualAuthorization.state !== 'ACCEPTED_FOR_THIS_PROPOSAL' ||
    view.manualAuthorization.eventId !== input.reviewId ||
    !approved.acceptance
  )
    throw new Failure('APPLICATION_BLOCKED', ['VERIFIED_APPROVAL_REQUIRED']);
  if (
    g.semanticKey !== input.expectedSemanticKey ||
    g.cycleKey !== input.expectedCycleKey ||
    recommendationIdentity(g.draft.dependencyKeys) !==
      recommendationIdentity(input.expectedDependencyKeys)
  )
    throw new Failure('STALE_APPLICATION', ['ACCEPTED_IDENTITY_CHANGED']);
  if (approved.decidedAt > state.now) reasons.push('REVIEW_TIME_INCONSISTENT');
  if (view.validity.state !== 'CURRENT')
    reasons.push(
      ...view.validity.changedDependencies.map(
        (k) => 'DEPENDENCY_' + k.toUpperCase(),
      ),
      view.validity.state,
    );
  if (!view.compatibility.compatible)
    reasons.push(...view.compatibility.reasons);
  if (!view.cycle.reserved || view.cycle.conflict)
    reasons.push('CYCLE_NOT_EXCLUSIVE');
  if (p.expiresAt && p.expiresAt <= state.now) reasons.push('PROPOSAL_EXPIRED');
  if (
    !sameNumber(p.previousLoad, input.previousLoad) ||
    !sameNumber(p.recommendedLoad, input.appliedLoad) ||
    p.loadUnit !== input.loadUnit
  )
    reasons.push('AUTHORIZED_LOAD_MISMATCH');
  const d = g.draft.evidence.destination;
  if (
    d.kind !== 'PRESCRIPTION' ||
    d.planId !== input.destination.planId ||
    d.weekId !== input.destination.weekId ||
    d.dayId !== input.destination.dayId ||
    d.prescriptionId !== input.destination.prescriptionId ||
    d.planVersion !== input.expectedPlanVersion
  )
    reasons.push('AUTHORIZED_DESTINATION_MISMATCH');
  if (reasons.length)
    throw new Failure('APPLICATION_BLOCKED', [...new Set(reasons)]);
  const future = assertFutureTarget(state.target, input, state.now);
  return {
    schemaVersion: APPLICATION_AUDIT_VERSION,
    action: 'APPLY',
    fromStatus: 'APPROVED',
    toStatus: 'APPLIED',
    authorization: {
      reviewId: approved.id,
      reviewVersion: approved.version,
      authorizationKey: approved.acceptance.authorizationKey,
      semanticKey: g.semanticKey,
      cycleKey: g.cycleKey,
      dependencyKeys: g.draft.dependencyKeys,
    },
    destination: {
      ...input.destination,
      exerciseId: p.exerciseId,
      planVersionBefore: input.expectedPlanVersion,
      planVersionAfter: input.expectedPlanVersion + 1,
    },
    load: {
      previousLoad: input.previousLoad,
      appliedLoad: input.appliedLoad,
      unit: input.loadUnit,
    },
    temporal: {
      activityId: future.witness.id,
      activityVersion: future.witness.version,
      scheduledOn: future.witness.on,
      timeZone: future.witness.timeZone,
      checkedAt: state.now.toISOString(),
      localOn: future.localOn,
      relatedActivityIds: state.target!.activities.map((a) => a.id).sort(),
    },
  };
}
