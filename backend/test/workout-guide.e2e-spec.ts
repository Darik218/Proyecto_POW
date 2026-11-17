import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ProgressionModule } from '../src/progression/progression.module';
import { PrismaService } from '../src/database/prisma.service';
import { WorkoutGuideService } from '../src/progression/workout-guide.service';
import { RecommendationService } from '../src/progression/recommendation.service';
import {
  reviewFixture,
  plannedReviewTarget,
} from './helpers/recommendation-review-fixtures';
import { progressionIsolation } from './helpers/progression-isolation';
import type { WorkoutGuidePreviewInput } from '../src/models/progression/workout-guide.model';
const isolated = process.env.PROG1B_TEST_DATABASE_URL
  ? describe
  : describe.skip;
isolated('daily workout guide real PostgreSQL read snapshot', () => {
  let app: INestApplication,
    db: PrismaService,
    guide: WorkoutGuideService,
    recommendations: RecommendationService;
  beforeAll(async () => {
    await progressionIsolation();
    const module = await Test.createTestingModule({
      imports: [ProgressionModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    guide = app.get(WorkoutGuideService);
    recommendations = app.get(RecommendationService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function fixture() {
    const f = await reviewFixture(db),
      target = await plannedReviewTarget(db, f);
    return { ...f, target };
  }
  it('keeps an exact comparison identity across activity to session and invalidates changed occurrence, history and settings', async () => {
    const f = await fixture();
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: { planExerciseId: f.target.p.id },
    });
    const activity = await db.scheduledActivity.create({
      data: {
        athleteId: f.athleteId,
        planWeekId: f.target.week.id,
        planDayId: f.target.day.id,
        originalOn: new Date('2026-01-14'),
        scheduledOn: new Date('2026-01-14'),
        timeZone: 'UTC',
        title: 'Comparison occurrence',
      },
    });
    const calendar = await guide.forMyWorkout(f.identity, {
      activityId: activity.id,
    });
    const session = await db.workoutSession.create({
      data: {
        athleteId: f.athleteId,
        trainingPlanId: f.target.plan.id,
        planWeekId: f.target.week.id,
        planDayId: f.target.day.id,
        scheduledActivityId: activity.id,
        performedOn: new Date('2026-01-14'),
        timeZone: 'UTC',
        status: 'IN_PROGRESS',
        version: 1,
        exercises: {
          create: {
            exerciseId: f.e.id,
            planExerciseId: f.target.p.id,
            orderInSession: 1,
            targetSets: f.target.p.targetSets,
            targetRepsMin: f.target.p.targetRepsMin,
            targetRepsMax: f.target.p.targetRepsMax,
            targetLoad: f.target.p.targetLoad,
            targetLoadUnit: f.target.p.targetLoadUnit,
            targetRpe: f.target.p.targetRpe,
            originalSnapshot: { exercise: { id: f.e.id } },
          },
        },
      },
    });
    const current = () =>
      guide.forMyWorkout(f.identity, { sessionId: session.id });
    const live = await current();
    const keys = (g: Awaited<ReturnType<typeof current>>) => ({
      repetition: g.exercises[0].repetitionContext!.comparisonKey,
      load: g.exercises[0].calculationContext!.comparisonKey,
    });
    expect(keys(live)).toEqual(keys(calendar));
    expect(keys(live).repetition).toMatch(/^[a-f0-9]{64}$/);
    expect(live.exercises[0].repetitionContext!.contextKey).not.toBe(
      calendar.exercises[0].repetitionContext!.contextKey,
    );
    await db.scheduledActivity.update({
      where: { id: activity.id },
      data: { version: { increment: 1 } },
    });
    const revised = await current();
    expect(keys(revised).repetition).not.toBe(keys(live).repetition);
    expect(keys(revised)).toEqual(
      keys(await guide.forMyWorkout(f.identity, { activityId: activity.id })),
    );
    await db.setRecord.updateMany({
      where: { workoutExerciseId: f.tasks[1].id },
      data: { version: { increment: 1 } },
    });
    const editedHistory = await current();
    expect(keys(editedHistory).repetition).not.toBe(keys(revised).repetition);
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5' },
    });
    expect(keys(await current()).repetition).not.toBe(
      keys(editedHistory).repetition,
    );
    // A standalone session keeps the same historical comparison while its own
    // recording version changes. Its current series are not historical input.
    await db.workoutSession.update({
      where: { id: session.id },
      data: { scheduledActivityId: null },
    });
    const standalone = await current();
    const currentTask = await db.workoutExercise.findFirstOrThrow({
      where: { sessionId: session.id },
    });
    await db.setRecord.create({
      data: {
        workoutExerciseId: currentTask.id,
        setNumber: 1,
        repetitions: 8,
        load: '80',
        loadUnit: 'KG',
        loadKg: '80',
        kind: 'WORK',
        status: 'COMPLETED',
        isCompleted: true,
      },
    });
    await db.workoutSession.update({
      where: { id: session.id },
      data: {
        notes: 'Normal current-session recording',
        version: { increment: 1 },
      },
    });
    expect(keys(await current())).toEqual(keys(standalone));
    await db.workoutExercise.update({
      where: { id: currentTask.id },
      data: { targetLoad: '90' },
    });
    const adjusted = await current();
    expect(keys(adjusted).repetition).not.toBe(keys(standalone).repetition);
    await db.setRecord.updateMany({
      where: { workoutExerciseId: f.tasks[1].id },
      data: { version: { increment: 1 } },
    });
    expect(keys(await current()).repetition).not.toBe(
      keys(adjusted).repetition,
    );
  });
  it('calculates plan-bound repetitions without a setting or subjective effort, re-evaluates new results and writes nothing', async () => {
    const f = await fixture();
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    await db.planExercise.update({
      where: { id: f.target.p.id },
      data: { targetRepsMin: 6, targetRepsMax: 10 },
    });
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: {
        planExerciseId: f.target.p.id,
        targetRepsMin: 6,
        targetRepsMax: 10,
      },
    });
    await db.setRecord.updateMany({
      where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      data: { rpe: null, repetitions: 8 },
    });
    const source = {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    };
    const persisted = async () => ({
      plan: await db.trainingPlan.findUnique({
        where: { id: f.target.plan.id },
      }),
      target: await db.planExercise.findUnique({
        where: { id: f.target.p.id },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
      applications: await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
      consents: await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
      recommendations: await db.progressionRecommendation.count({
        where: { athleteId: f.athleteId },
      }),
    });
    const initial = await guide.forMyWorkout(f.identity, source),
      before = await persisted();
    expect(initial.exercises[0].guidanceSuggested.origin).toBe(
      'HISTORICAL_REFERENCE',
    );
    expect(initial.exercises[0].repetitionContext).toMatchObject({
      ready: true,
      minimumSessions: 1,
      minimumSource: 'PLAN_BOUND_INITIAL_POLICY',
      tasks: [{ id: f.tasks[1].id }],
    });
    const input = {
      source,
      exerciseId: f.e.id,
      contextKey: initial.exercises[0].repetitionContext!.contextKey!,
      declaration: {
        sameVariant: true as const,
        sameEquipment: true as const,
        sameLoadConvention: true as const,
      },
      policyContract: 'session-repetition-preview-v1' as const,
    };
    const calculated = await guide.forMyWorkout(f.identity, source, input);
    expect(calculated.exercises[0].guidanceSuggested).toMatchObject({
      origin: 'CALCULATED',
      load: '80.000000',
      reps: 9,
      sets: 1,
      executionAuthorized: false,
    });
    expect(await persisted()).toEqual(before);
    await db.setRecord.updateMany({
      where: { workoutExerciseId: f.tasks[1].id },
      data: { repetitions: 9 },
    });
    await expect(guide.forMyWorkout(f.identity, source, input)).rejects.toThrow(
      'INVALID_COMMAND',
    );
    const updated = await guide.forMyWorkout(f.identity, source);
    expect(
      (
        await guide.forMyWorkout(f.identity, source, {
          ...input,
          contextKey: updated.exercises[0].repetitionContext!.contextKey!,
        })
      ).exercises[0].guidanceSuggested.reps,
    ).toBe(10);
    const foreign = await fixture();
    await expect(
      guide.forMyWorkout(foreign.identity, source, input),
    ).rejects.toThrow('SOURCE_NOT_FOUND');
    await db.authSession.update({
      where: { id: f.identity.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(
      guide.forMyWorkout(f.identity, source, input),
    ).rejects.toThrow();
  });
  it('uses exact executed load when a beginner plan specifies repetitions but no load, keeping null prescription snapshots intact', async () => {
    const f = await fixture();
    await db.progressionSetting.delete({ where: { id: f.setting.id } });
    await db.planExercise.update({
      where: { id: f.target.p.id },
      data: {
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetLoad: null,
        targetLoadUnit: null,
      },
    });
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: {
        planExerciseId: f.target.p.id,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetLoad: null,
        targetLoadUnit: null,
      },
    });
    await db.setRecord.updateMany({
      where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      data: { load: '40', loadKg: '40', repetitions: 8, rpe: null },
    });
    const source = {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    };
    const before = {
      plan: await db.planExercise.findUnique({ where: { id: f.target.p.id } }),
      tasks: await db.workoutExercise.findMany({
        where: { id: { in: f.tasks.map((t) => t.id) } },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
    };
    const initial = await guide.forMyWorkout(f.identity, source);
    expect(initial.exercises[0].repetitionContext).toMatchObject({
      ready: true,
      baselineSource: 'RECORDED_HISTORY',
      minimumSource: 'PLAN_BOUND_INITIAL_POLICY',
    });
    const result = await guide.forMyWorkout(f.identity, source, {
      source,
      exerciseId: f.e.id,
      contextKey: initial.exercises[0].repetitionContext!.contextKey!,
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
      policyContract: 'session-repetition-preview-v1',
    });
    expect(result.exercises[0].guidanceSuggested).toMatchObject({
      origin: 'CALCULATED',
      load: '40.000000',
      unit: 'KG',
      reps: 9,
      reasons: expect.arrayContaining(['LOAD_FROM_RECORDED_HISTORY']),
      executionAuthorized: false,
    });
    expect({
      plan: await db.planExercise.findUnique({ where: { id: f.target.p.id } }),
      tasks: await db.workoutExercise.findMany({
        where: { id: { in: f.tasks.map((t) => t.id) } },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
    }).toEqual(before);
  });
  it('calculates a configured load increment without RPE through explicit BASIC compliance, while readiness keeps its effort requirement', async () => {
    const f = await fixture();
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: { planExerciseId: f.target.p.id },
    });
    await db.setRecord.updateMany({
      where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      data: { rpe: null },
    });
    const source = {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    };
    const initial = await guide.forMyWorkout(f.identity, source);
    const input = {
      source,
      exerciseId: f.e.id,
      contextKey: initial.exercises[0].calculationContext!.contextKey!,
      gridStep: '2.5',
      incrementMode: 'ABSOLUTE' as const,
      declaration: {
        sameVariant: true as const,
        sameEquipment: true as const,
        externalTotal: true as const,
      },
      policyContract: 'session-load-compliance-preview-v1' as const,
    };
    const before = {
      target: await db.planExercise.findUnique({
        where: { id: f.target.p.id },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
      count: await db.progressionRecommendation.count({
        where: { athleteId: f.athleteId },
      }),
      applications: await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    };
    expect(
      (await guide.forMyWorkout(f.identity, source, input)).exercises[0]
        .guidanceSuggested,
    ).toMatchObject({
      origin: 'CALCULATED',
      action: 'INCREASE',
      load: '82.500000',
      reps: 6,
      policyVersion: 'session-load-compliance-preview-v1',
      executionAuthorized: false,
    });
    expect(
      (
        await guide.forMyWorkout(f.identity, source, {
          ...input,
          policyContract: 'session-readiness-preview-v1',
        })
      ).exercises[0].guidanceSuggested,
    ).toMatchObject({ action: 'INSUFFICIENT_DATA', load: null });
    expect({
      target: await db.planExercise.findUnique({
        where: { id: f.target.p.id },
      }),
      sets: await db.setRecord.findMany({
        where: { workoutExerciseId: { in: f.tasks.map((t) => t.id) } },
      }),
      count: await db.progressionRecommendation.count({
        where: { athleteId: f.athleteId },
      }),
      applications: await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
    }).toEqual(before);
  });
  it('calculates a voluntary preview without a saved proposal, preserves sources and rejects stale declarations', async () => {
    const f = await fixture(),
      before = await db.progressionRecommendation.count();
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: { planExerciseId: f.target.p.id },
    });
    const initial = await guide.forMyWorkout(f.identity, {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    });
    const unchanged = async () => ({
      plan: await db.trainingPlan.findUnique({
        where: { id: f.target.plan.id },
      }),
      target: await db.planExercise.findUnique({
        where: { id: f.target.p.id },
      }),
      sessions: await db.workoutSession.findMany({
        where: { athleteId: f.athleteId },
      }),
      setting: await db.progressionSetting.findUnique({
        where: { id: f.setting.id },
      }),
      proposals: await db.progressionRecommendation.count({
        where: { athleteId: f.athleteId },
      }),
      consents: await db.progressionAutomationConsent.count({
        where: { athleteId: f.athleteId },
      }),
      applications: await db.progressionApplication.count({
        where: { athleteId: f.athleteId },
      }),
      reviews: await db.recommendationReview.count({
        where: { athleteId: f.athleteId },
      }),
    });
    const previous = await unchanged();
    const input: WorkoutGuidePreviewInput = {
      source: {
        planDayId: f.target.day.id,
        performedOn: '2026-01-14',
        timeZone: 'UTC',
      },
      exerciseId: f.e.id,
      contextKey: initial.exercises[0].calculationContext!.contextKey!,
      gridStep: '2.5',
      incrementMode: 'ABSOLUTE',
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        externalTotal: true,
      },
      policyContract: 'session-readiness-preview-v1',
    };
    const result = await guide.forMyWorkout(
      f.identity,
      {
        planDayId: f.target.day.id,
        performedOn: '2026-01-14',
        timeZone: 'UTC',
      },
      input,
    );
    expect(result.exercises[0]).toMatchObject({
      proposal: null,
      guidanceSuggested: {
        origin: 'CALCULATED',
        action: 'INCREASE',
        load: '82.500000',
        unit: 'KG',
        executionAuthorized: false,
      },
    });
    expect(await db.progressionRecommendation.count()).toBe(before);
    expect(await unchanged()).toEqual(previous);
    expect(
      (
        await db.planExercise.findUniqueOrThrow({
          where: { id: f.target.p.id },
        })
      ).targetLoad?.toFixed(3),
    ).toBe('80.000');
    await expect(
      guide.forMyWorkout(
        f.identity,
        { ...input.source, performedOn: '2026-01-15' },
        input,
      ),
    ).rejects.toThrow('INVALID_COMMAND');
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5' },
    });
    await expect(
      guide.forMyWorkout(f.identity, input.source, input),
    ).rejects.toThrow('INVALID_COMMAND');
    const refreshed = await guide.forMyWorkout(f.identity, input.source);
    const next = await guide.forMyWorkout(f.identity, input.source, {
      ...input,
      contextKey: refreshed.exercises[0].calculationContext!.contextKey!,
    });
    expect(next.exercises[0]).toMatchObject({
      guidanceSuggested: { origin: 'CALCULATED', load: '85.000000' },
    });
    await db.setRecord.updateMany({
      where: { workoutExerciseId: f.tasks[1].id },
      data: { rpe: null },
    });
    const withoutRpe = await guide.forMyWorkout(f.identity, input.source);
    const insufficient = await guide.forMyWorkout(f.identity, input.source, {
      ...input,
      contextKey: withoutRpe.exercises[0].calculationContext!.contextKey!,
    });
    expect(insufficient.exercises[0]).toMatchObject({
      guidanceSuggested: {
        action: 'INSUFFICIENT_DATA',
        load: null,
        reps: null,
        sets: null,
      },
    });
  });
  it('recalculates a verified explicit recipe for another compatible destination without an existing proposal there', async () => {
    const f = await fixture(),
      preview = await recommendations.proposeMyExercise(f.identity, f.command);
    await recommendations.saveMyProposal(
      f.identity,
      {
        command: f.command,
        expectedSemanticKey: preview.semanticKey,
        expectedDependencyKeys: preview.dependencyKeys,
      },
      true,
    );
    const destination = await plannedReviewTarget(db, f);
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5' },
    });
    const result = await guide.forMyWorkout(f.identity, {
      planDayId: destination.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    });
    expect(result.exercises[0]).toMatchObject({
      proposal: null,
      guidanceSuggested: {
        origin: 'CALCULATED',
        action: 'INCREASE',
        load: '85.000000',
      },
    });
    expect(
      await db.progressionRecommendation.count({
        where: { planExerciseId: destination.p.id },
      }),
    ).toBe(0);
  });
  it('shows an explicit fresh preview separately from an existing current persisted proposal', async () => {
    const f = await fixture();
    await db.workoutExercise.updateMany({
      where: { id: { in: f.tasks.map((t) => t.id) } },
      data: { planExerciseId: f.target.p.id },
    });
    const draft = await recommendations.proposeMyExercise(
      f.identity,
      f.command,
    );
    const saved = await recommendations.saveMyProposal(
      f.identity,
      {
        command: f.command,
        expectedSemanticKey: draft.semanticKey,
        expectedDependencyKeys: draft.dependencyKeys,
      },
      true,
    );
    const source = {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    };
    const current = await guide.forMyWorkout(f.identity, source);
    expect(current.exercises[0].proposal).toMatchObject({
      id: saved.id,
      status: 'CURRENT',
    });
    const fresh = await guide.forMyWorkout(f.identity, source, {
      source,
      exerciseId: f.e.id,
      contextKey: current.exercises[0].calculationContext!.contextKey!,
      gridStep: '5',
      incrementMode: 'ABSOLUTE',
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        externalTotal: true,
      },
      policyContract: 'session-readiness-preview-v1',
    });
    expect(fresh.exercises[0]).toMatchObject({
      proposal: {
        id: saved.id,
        status: 'CURRENT',
        recommendedLoad: '82.500000',
      },
      guidanceSuggested: {
        origin: 'CALCULATED',
        action: 'NO_REPRESENTABLE_INCREMENT',
        load: null,
      },
    });
    const laterSource = { ...source, performedOn: '2026-02-10' };
    const later = await guide.forMyWorkout(f.identity, laterSource);
    expect(later.exercises[0]).toMatchObject({
      proposal: {
        id: saved.id,
        status: 'CURRENT',
        recommendedLoad: '82.500000',
      },
      guidanceSuggested: {
        origin: 'HISTORICAL_REFERENCE',
        action: 'REVIEW_REQUIRED',
        load: null,
        reps: null,
        sets: null,
        reasons: expect.arrayContaining(['REFERENCE_OUTSIDE_PREVIEW_PERIOD']),
      },
    });
    const laterPreview = await guide.forMyWorkout(f.identity, laterSource, {
      source: laterSource,
      exerciseId: f.e.id,
      contextKey: later.exercises[0].calculationContext!.contextKey!,
      gridStep: '2.5',
      incrementMode: 'ABSOLUTE',
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        externalTotal: true,
      },
      policyContract: 'session-readiness-preview-v1',
    });
    expect(laterPreview.exercises[0]).toMatchObject({
      proposal: { id: saved.id, status: 'CURRENT' },
      guidanceSuggested: {
        action: 'REVIEW_REQUIRED',
        load: null,
        reps: null,
        sets: null,
        reasons: expect.arrayContaining(['REFERENCE_OUTSIDE_PREVIEW_PERIOD']),
      },
    });
    expect(
      (
        await db.progressionRecommendation.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).status,
    ).toBe('PENDING');
  });
  it('resolves owned prescriptions and preserves moved activity date/zone while REST/OMITTED are explicit', async () => {
    const f = await fixture(),
      other = await reviewFixture(db);
    const activity = await db.scheduledActivity.create({
      data: {
        athleteId: f.athleteId,
        planWeekId: f.target.week.id,
        planDayId: f.target.day.id,
        originalOn: new Date('2026-01-12'),
        scheduledOn: new Date('2026-01-14'),
        timeZone: 'America/Bogota',
        status: 'RESCHEDULED',
        title: 'Movido',
      },
    });
    const result = await guide.forMyWorkout(f.identity, {
      activityId: activity.id,
      performedOn: '2026-02-01',
      timeZone: 'UTC',
    });
    expect(result.source).toMatchObject({
      planDayId: f.target.day.id,
      trainingPlanId: f.target.plan.id,
      planWeekId: f.target.week.id,
      performedOn: '2026-01-14',
      timeZone: 'America/Bogota',
    });
    expect(result.exercises[0]).toMatchObject({
      id: f.target.p.id,
      target: { targetLoad: '80.000', targetLoadUnit: 'KG' },
      lastReference: { performedOn: '2026-01-06', gapDays: 8 },
    });
    await expect(
      guide.forMyWorkout(other.identity, { activityId: activity.id }),
    ).rejects.toThrow('SOURCE_NOT_FOUND');
    await expect(
      guide.forMyWorkout(other.identity, {
        planDayId: f.target.day.id,
        performedOn: '2026-01-14',
        timeZone: 'UTC',
      }),
    ).rejects.toThrow('SOURCE_NOT_FOUND');
    for (const status of ['REST', 'OMITTED'] as const) {
      await db.scheduledActivity.update({
        where: { id: activity.id },
        data: { status, planDayId: status === 'REST' ? null : f.target.day.id },
      });
      const read = await guide.forMyWorkout(f.identity, {
        activityId: activity.id,
      });
      expect(read.status).toBe(status);
      expect(read.exercises).toEqual([]);
      expect(read.executionAuthorized).toBe(false);
    }
  });
  it('shows a genuinely current engine proposal, withholds it after settings drift and never writes from GET', async () => {
    const f = await fixture(),
      preview = await recommendations.proposeMyExercise(f.identity, f.command);
    expect(preview.decision).toBe('INCREASE');
    const saved = await recommendations.saveMyProposal(
      f.identity,
      {
        command: f.command,
        expectedSemanticKey: preview.semanticKey,
        expectedDependencyKeys: preview.dependencyKeys,
      },
      true,
    );
    const before = {
      plan: await db.trainingPlan.findUniqueOrThrow({
        where: { id: f.target.plan.id },
      }),
      prescription: await db.planExercise.findUniqueOrThrow({
        where: { id: f.target.p.id },
      }),
      proposals: await db.progressionRecommendation.count(),
      requests: await db.progressionRevalidationRequest.count(),
      sessions: await db.workoutSession.count(),
      reviews: await db.recommendationReview.count(),
    };
    const result = await guide.forMyWorkout(f.identity, {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    });
    expect(result.exercises[0].proposal).toMatchObject({
      id: saved.id,
      status: 'CURRENT',
      recommendedLoad: '82.500000',
      loadUnit: 'KG',
    });
    expect(result.executionAuthorized).toBe(false);
    expect(
      await db.trainingPlan.findUniqueOrThrow({
        where: { id: f.target.plan.id },
      }),
    ).toEqual(before.plan);
    expect(
      await db.planExercise.findUniqueOrThrow({ where: { id: f.target.p.id } }),
    ).toEqual(before.prescription);
    expect({
      proposals: await db.progressionRecommendation.count(),
      requests: await db.progressionRevalidationRequest.count(),
      sessions: await db.workoutSession.count(),
      reviews: await db.recommendationReview.count(),
    }).toEqual({
      proposals: before.proposals,
      requests: before.requests,
      sessions: before.sessions,
      reviews: before.reviews,
    });
    await db.progressionSetting.update({
      where: { id: f.setting.id },
      data: { incrementAbsolute: '5.0' },
    });
    const stale = await guide.forMyWorkout(f.identity, {
      planDayId: f.target.day.id,
      performedOn: '2026-01-14',
      timeZone: 'UTC',
    });
    expect(stale.exercises[0].proposal).toMatchObject({
      id: saved.id,
      status: 'REQUIRES_REVIEW',
      recommendedLoad: null,
    });
    const unchanged = await db.progressionRecommendation.findUniqueOrThrow({
      where: { id: saved.id },
    });
    expect(unchanged.status).toBe('PENDING');
    expect(unchanged.recommendedLoad.toFixed(6)).toBe(saved.recommendedLoad);
  });
  it('keeps session original and adjusted targets separate and excludes same-date chronology', async () => {
    const f = await fixture();
    await db.workoutExercise.update({
      where: { id: f.tasks[1].id },
      data: {
        targetLoad: '75.500',
        targetSets: 2,
        targetRpe: '7.5',
        originalSnapshot: {
          exercise: { id: f.e.id },
          targets: {
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: 6,
            targetLoad: '80',
            targetLoadUnit: 'KG',
            targetRpe: 8,
          },
        },
      },
    });
    const result = await guide.forMyWorkout(f.identity, {
      sessionId: f.tasks[1].sessionId,
      performedOn: '2026-02-01',
      timeZone: 'America/Bogota',
    });
    expect(result.source).toMatchObject({
      performedOn: '2026-01-06',
      timeZone: 'UTC',
    });
    expect(result.exercises[0]).toMatchObject({
      id: f.tasks[1].id,
      target: { targetLoad: '75.500', targetSets: 2, targetRpe: '7.5' },
      originalTarget: { targetLoad: '80', targetSets: 1, targetRpe: '8' },
      lastReference: { performedOn: '2026-01-05' },
    });
  });
  it('retains unclassified historical actual values without treating isCompleted=false as a failed set', async () => {
    const f = await fixture();
    await db.setRecord.updateMany({
      where: { workoutExerciseId: f.tasks[0].id },
      data: {
        status: null,
        kind: null,
        isCompleted: false,
        loadUnit: null,
        loadKg: null,
      },
    });
    const result = await guide.forMyWorkout(f.identity, {
      planDayId: f.target.day.id,
      performedOn: '2026-01-06',
      timeZone: 'UTC',
    });
    expect(result.exercises[0].lastReference).toMatchObject({
      performedOn: '2026-01-05',
      sessions: [
        {
          sets: [
            {
              status: null,
              kind: null,
              isCompleted: false,
              load: '80.000',
              loadUnit: null,
            },
          ],
        },
      ],
    });
    expect(result.exercises[0].guidance.state).toBe('REFERENCE_AVAILABLE');
    expect(result.executionAuthorized).toBe(false);
  });
});
