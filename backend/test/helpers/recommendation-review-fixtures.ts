import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service';
import type { AuthenticatedIdentity } from '../../src/auth/auth.types';
import type { RecommendationCommand } from '../../src/models/progression/recommendation-draft.model';
import { recommendationPolicy } from './recommendation-fixtures';
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export async function reviewFixture(
  db: PrismaService,
  unit: 'KG' | 'LB' = 'KG',
) {
  const u = await db.user.create({
    data: {
      email: randomUUID() + '@example.test',
      passwordHash: 'fixture',
      athlete: { create: {} },
    },
    include: { athlete: true },
  });
  const identity: AuthenticatedIdentity = {
    account: {
      id: u.id,
      email: u.email,
      status: u.status,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    },
    sessionId: randomUUID(),
  };
  await db.authSession.create({
    data: {
      id: identity.sessionId,
      userId: u.id,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: randomUUID().replaceAll('-', '').repeat(2),
      expiresAt: new Date('2099-01-01'),
      absoluteExpiresAt: new Date('2099-01-01'),
    },
  });
  const group = await db.muscleGroup.create({
    data: { key: randomUUID(), name: 'Fixture ' + randomUUID() },
  });
  const e = await db.exercise.create({
    data: {
      name: 'Fixture',
      equipment: 'barbell',
      primaryMuscleGroupId: group.id,
      oneRmSuitability: 'SUITABLE',
    },
  });
  const tasks = [];
  for (const date of ['2026-01-05', '2026-01-06']) {
    const session = await db.workoutSession.create({
      data: {
        athleteId: u.athlete!.id,
        status: 'COMPLETED',
        performedOn: new Date(date + 'T00:00:00Z'),
        timeZone: 'UTC',
        startedAt: new Date(date + 'T12:00:00Z'),
        finishedAt: new Date(date + 'T13:00:00Z'),
      },
    });
    const task = await db.workoutExercise.create({
      data: {
        sessionId: session.id,
        exerciseId: e.id,
        orderInSession: 1,
        targetSets: 1,
        targetRepsMin: 5,
        targetRepsMax: 6,
        targetLoad: '80',
        targetLoadUnit: unit,
        targetRpe: '8',
        originalSnapshot: {
          exercise: { id: e.id },
          targets: {
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: 6,
            targetLoad: '80',
            targetLoadUnit: unit,
            targetRpe: '8',
          },
        },
      },
    });
    await db.setRecord.create({
      data: {
        workoutExerciseId: task.id,
        setNumber: 1,
        status: 'COMPLETED',
        kind: 'WORK',
        isCompleted: true,
        repetitions: 6,
        load: '80',
        loadUnit: unit,
        loadKg: unit === 'KG' ? '80' : '36.287390',
        rpe: '7',
      },
    });
    tasks.push(task);
  }
  const setting = await db.progressionSetting.create({
    data: {
      athleteId: u.athlete!.id,
      minSuccessfulSessions: 2,
      targetRpeMin: 6,
      targetRpeMax: 8,
      incrementAbsolute: '2.5',
      maxIncrementPercent: '10',
    },
  });
  const ids = tasks.map((t) => t.id),
    policy = recommendationPolicy();
  policy.cohort = { mode: 'EXPLICIT_TASK_SET', taskIds: ids };
  policy.assessment.compliance!.slots = ids.map((taskId) => ({
    taskId,
    original: [1],
    adjusted: [1],
    originalLoadMeaning: 'EXTERNAL_TOTAL',
    adjustedLoadMeaning: 'EXTERNAL_TOTAL',
  }));
  policy.assessment.count!.anchorTaskId = ids[1];
  policy.settingLoadUnit = unit;
  policy.grid.unit = unit;
  const command: Mutable<RecommendationCommand> = {
    history: {
      exerciseId: e.id,
      from: '2026-01-01',
      to: '2026-01-11',
      timeZone: 'UTC',
      limit: 100,
      contexts: ids.map((workoutExerciseId) => ({
        workoutExerciseId,
        loadMeaning: 'EXTERNAL_TOTAL',
        protocolKey: 'fixture',
        equipmentKey: 'barbell',
        source: 'OWNER_DECLARATION_FOR_ANALYSIS',
      })),
      comparisons: [{ previousTaskId: ids[0], currentTaskId: ids[1] }],
    },
    period: {
      start: '2026-01-05',
      endExclusive: '2026-01-12',
      timeZone: 'UTC',
      cutoffOn: '2026-01-11',
      weekStartsOn: 1,
    },
    destination: { kind: 'WORKOUT_TASK', taskId: ids[1] },
    policy,
  };
  return { identity, athleteId: u.athlete!.id, e, tasks, setting, command };
}
export async function plannedReviewTarget(
  db: PrismaService,
  f: Awaited<ReturnType<typeof reviewFixture>>,
) {
  const plan = await db.trainingPlan.create({
    data: { athleteId: f.athleteId, name: 'Editable intended destination' },
  });
  const week = await db.planWeek.create({
    data: { trainingPlanId: plan.id, weekNumber: 1 },
  });
  const day = await db.planDay.create({
    data: { planWeekId: week.id, name: 'Day', position: 1 },
  });
  const p = await db.planExercise.create({
    data: {
      planWeekId: week.id,
      planDayId: day.id,
      exerciseId: f.e.id,
      position: 1,
      targetSets: 1,
      targetRepsMin: 5,
      targetRepsMax: 6,
      targetLoad: '80',
      targetLoadUnit: 'KG',
      targetRpe: '8',
    },
  });
  f.command.destination = {
    kind: 'PRESCRIPTION',
    planId: plan.id,
    weekId: week.id,
    dayId: day.id,
    prescriptionId: p.id,
  };
  f.command.expectedPlanVersion = plan.version;
  f.command.policy!.baseline = 'DESTINATION_PRESCRIPTION';
  return { plan, week, day, p };
}
