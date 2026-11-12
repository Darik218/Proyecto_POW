import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service';
import { PrismaProgressionRepository } from '../../src/progression/prisma-progression.repository';
import { RecommendationService } from '../../src/progression/recommendation.service';
import type { ApplyRecommendationCommand } from '../../src/models/progression/recommendation-application.model';
import {
  reviewFixture,
  plannedReviewTarget,
} from './recommendation-review-fixtures';
export type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export async function applicationFixture(
  db: PrismaService,
  options: {
    approve?: boolean;
    unit?: 'KG' | 'LB';
    increment?: string;
    percent?: string;
    step?: string;
  } = {},
) {
  const service = new RecommendationService(
      new PrismaProgressionRepository(db),
    ),
    f = await reviewFixture(db, options.unit ?? 'KG'),
    target = await plannedReviewTarget(db, f);
  if (options.unit === 'LB')
    await db.planExercise.update({
      where: { id: target.p.id },
      data: { targetLoadUnit: 'LB' },
    });
  if (options.increment)
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: options.increment },
    });
  if (options.step) f.command.policy!.grid.step = options.step;
  if (options.percent) {
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementPercent: options.percent, incrementAbsolute: null },
    });
    f.command.policy!.incrementMode = 'PERCENT';
  }
  const dates = await db.$queryRaw<
    { on: string }[]
  >`SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date+7)::text AS on`;
  const activity = await db.scheduledActivity.create({
    data: {
      athleteId: f.athleteId,
      planWeekId: target.week.id,
      planDayId: target.day.id,
      originalPlanDayId: target.day.id,
      originalOn: new Date(dates[0].on),
      scheduledOn: new Date(dates[0].on),
      timeZone: 'UTC',
      title: 'Authorized future fixture',
    },
  });
  const draft = await service.proposeMyExercise(f.identity, f.command);
  if (draft.decision !== 'INCREASE')
    throw Error(
      'Fixture must generate an increase: ' + draft.reasons.join(','),
    );
  const proposal = await service.saveMyProposal(f.identity, {
      command: f.command,
      expectedSemanticKey: draft.semanticKey,
      expectedDependencyKeys: draft.dependencyKeys,
    }),
    view = await service.inspectMyProposal(f.identity, proposal.id, f.command);
  const review =
    options.approve === false
      ? null
      : await service.reviewMyProposal(f.identity, {
          recommendationId: proposal.id,
          intentId: randomUUID(),
          action: 'APPROVE',
          expectedStatus: 'PENDING',
          expectedVersion: null,
          expectedSemanticKey: draft.semanticKey,
          expectedCycleKey: proposal.generation!.cycleKey,
          expectedDependencyKeys: draft.dependencyKeys,
          command: f.command,
          acceptance: {
            ...view.acceptanceChallenge!,
            acceptPolicy: true,
            acceptEvidence: true,
          },
        });
  const input: Mutable<ApplyRecommendationCommand> = {
    recommendationId: proposal.id,
    intentId: randomUUID(),
    reviewId: review?.id ?? randomUUID(),
    expectedReviewVersion: 1,
    expectedSemanticKey: draft.semanticKey,
    expectedCycleKey: proposal.generation!.cycleKey,
    expectedDependencyKeys: structuredClone(draft.dependencyKeys),
    destination: {
      planId: target.plan.id,
      weekId: target.week.id,
      dayId: target.day.id,
      prescriptionId: target.p.id,
    },
    expectedPlanVersion: target.plan.version,
    activityId: activity.id,
    expectedActivityVersion: activity.version,
    expectedScheduledOn: dates[0].on,
    timeZone: activity.timeZone,
    previousLoad: draft.increment!.currentLoad!,
    appliedLoad: draft.increment!.proposedLoad!,
    loadUnit: options.unit ?? 'KG',
    command: structuredClone(f.command),
  };
  return { ...f, target, activity, draft, proposal, review, input };
}
