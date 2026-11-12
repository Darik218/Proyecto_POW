import { executedSet } from './workout-sets.policy';
import { targets, emptyTargets } from './workout-targets.policy';
import type {
  WorkoutTargets,
  ExerciseSnapshot,
} from './workout-targets.policy';
import type {
  UpdateWorkoutDto,
  UpdateWorkoutExerciseDto,
  ReorderWorkoutDto,
  ImportWorkoutDayDto,
  SaveWorkoutDayDto,
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
} from './dto/workout-preparation.dto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateWorkoutSessionDto,
  AddWorkoutExerciseDto,
  ListWorkoutSessionsDto,
} from './dto/workout-session.dto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
import type {
  WorkoutDetail,
  WorkoutSessionsRepository,
} from './workout-sessions.repository';
import {
  creationHash,
  localDate,
  requireEditable,
  requireVersion,
} from './workout-calendar.policy';
import type {
  AssociateWorkoutDto,
  WorkoutSuggestionsDto,
} from './dto/workout-session.dto';
import { requireInProgress, sessionTransition } from './workout-session.policy';
import { WorkoutSession } from '../models/workout-sessions/workout-session.model';
import type {
  WorkoutSummaryAttributes,
  WorkoutSource,
  WorkoutSuggestions,
} from '../models/workout-sessions/workout-session.model';

export type PreparationCommand =
  | { action: 'update'; input: UpdateWorkoutDto }
  | { action: 'exercise'; exerciseId: string; input: UpdateWorkoutExerciseDto }
  | { action: 'order'; input: ReorderWorkoutDto }
  | { action: 'import'; input: ImportWorkoutDayDto };
const summarySelect = {
  scheduledActivityId: true,
  sourceSnapshot: true,
  id: true,
  performedOn: true,
  timeZone: true,
  recordingMode: true,
  name: true,
  version: true,
  completedAt: true,
  planDay: { select: { id: true, name: true, weekday: true } },
  status: true,
  startedAt: true,
  finishedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  trainingPlan: { select: { id: true, name: true } },
  planWeek: { select: { id: true, weekNumber: true } },
  _count: { select: { exercises: true } },
} satisfies Prisma.WorkoutSessionSelect;
const detailSelect = {
  ...summarySelect,
  exercises: {
    orderBy: [{ orderInSession: 'asc' }, { id: 'asc' }],
    select: {
      sets: {
        orderBy: [{ setNumber: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          setNumber: true,
          load: true,
          loadUnit: true,
          loadKg: true,
          repetitions: true,
          rpe: true,
          kind: true,
          status: true,
          isCompleted: true,
          notes: true,
          recordedAt: true,
          version: true,
        },
      },
      originalSnapshot: true,
      targetSets: true,
      targetRepsMin: true,
      targetRepsMax: true,
      targetLoad: true,
      targetLoadUnit: true,
      targetRpe: true,
      isOmitted: true,
      replacesWorkoutExerciseId: true,
      id: true,
      orderInSession: true,
      notes: true,
      exercise: {
        select: {
          id: true,
          name: true,
          equipment: true,
          primaryMuscleGroup: { select: { name: true } },
          origin: true,
          oneRmSuitability: true,
          owner: { select: { athlete: { select: { id: true } } } },
        },
      },
      planExercise: {
        select: {
          id: true,
          targetSets: true,
          targetReps: true,
          targetRepsMin: true,
          targetRepsMax: true,
          targetLoadUnit: true,
          targetRpe: true,
          targetLoad: true,
          notes: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutSessionSelect;
type SummaryRow = Prisma.WorkoutSessionGetPayload<{
  select: typeof summarySelect;
}>;
type DetailRow = Prisma.WorkoutSessionGetPayload<{
  select: typeof detailSelect;
}>;
function summary(row: SummaryRow): WorkoutSummaryAttributes {
  const { _count, sourceSnapshot, ...fields } = row;
  return {
    ...fields,
    sourceSnapshot: sourceSnapshot as WorkoutSource | null,
    exerciseCount: _count.exercises,
  };
}
function rowTargets(row: {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoad: Prisma.Decimal | null;
  targetLoadUnit: 'KG' | 'LB' | null;
  targetRpe: Prisma.Decimal | null;
}): WorkoutTargets {
  return {
    targetSets: row.targetSets,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetLoad: row.targetLoad?.toString() ?? null,
    targetLoadUnit: row.targetLoadUnit,
    targetRpe: row.targetRpe === null ? null : Number(row.targetRpe),
  };
}
function detail(row: DetailRow, athleteId: string): WorkoutDetail {
  return new WorkoutSession({
    ...summary(row),
    ...WorkoutSession.resultCounts(row.exercises),
    exercises: row.exercises.map(
      ({ exercise, planExercise, originalSnapshot, ...fields }) => {
        const {
          primaryMuscleGroup,
          origin,
          owner,
          oneRmSuitability,
          ...catalog
        } = exercise;
        if (origin === 'PERSONAL' && owner?.athlete?.id !== athleteId)
          throw new WorkoutRepositoryError(
            'missing',
            'Workout session contains an unavailable private resource.',
          );
        const original = originalSnapshot as unknown as ExerciseSnapshot | null;
        return {
          id: fields.id,
          oneRmSuitability,
          orderInSession: fields.orderInSession,
          notes: fields.notes,
          isOmitted: fields.isOmitted,
          replacesWorkoutExerciseId: fields.replacesWorkoutExerciseId,
          sets: fields.sets,
          original,
          targets: {
            targetSets: fields.targetSets,
            targetRepsMin: fields.targetRepsMin,
            targetRepsMax: fields.targetRepsMax,
            targetLoad: fields.targetLoad,
            targetLoadUnit: fields.targetLoadUnit,
            targetRpe: fields.targetRpe,
          },
          exercise: original?.exercise ?? {
            ...catalog,
            muscleGroup: primaryMuscleGroup.name,
          },
          // Legacy reference is not presented as a verified original snapshot.
          prescription: !original && planExercise ? planExercise : null,
        };
      },
    ),
  });
}

@Injectable()
export class PrismaWorkoutSessionsRepository implements WorkoutSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(athleteId: string, query: ListWorkoutSessionsDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const where: Prisma.WorkoutSessionWhereInput = {
          athleteId,
          ...(query.planWeekId ? { planWeekId: query.planWeekId } : {}),
          ...(query.planDayId ? { planDayId: query.planDayId } : {}),
          ...(query.scheduledActivityId
            ? { scheduledActivityId: query.scheduledActivityId }
            : {}),
          ...(query.from || query.to
            ? {
                performedOn: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.trainingPlanId
            ? { trainingPlanId: query.trainingPlanId }
            : {}),
        };
        const rows = await tx.workoutSession.findMany({
          where,
          select: summarySelect,
          orderBy: [
            { performedOn: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          take: query.limit,
          skip: query.offset,
        });
        const total = await tx.workoutSession.count({ where });
        const counts = rows.length
          ? await tx.setRecord.groupBy({
              by: ['workoutExerciseId', 'isCompleted'],
              where: {
                OR: [
                  { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
                  { status: null },
                ],
                workoutExercise: {
                  sessionId: { in: rows.map((row) => row.id) },
                },
              },
              _count: { id: true },
            })
          : [];
        const exercises = counts.length
          ? await tx.workoutExercise.findMany({
              where: { id: { in: counts.map((row) => row.workoutExerciseId) } },
              select: { id: true, sessionId: true },
            })
          : [];
        return {
          items: rows.map((row) => {
            const actual = counts.filter((count) =>
              exercises.some(
                (exercise) =>
                  exercise.id === count.workoutExerciseId &&
                  exercise.sessionId === row.id,
              ),
            );
            return new WorkoutSession({
              ...summary(row),
              actualSetCount: actual.reduce(
                (sum, count) => sum + count._count.id,
                0,
              ),
              completedSetCount: actual
                .filter((count) => count.isCompleted)
                .reduce((sum, count) => sum + count._count.id, 0),
            });
          }),
          total,
          limit: query.limit,
          offset: query.offset,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(athleteId: string, id: string): Promise<WorkoutDetail | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.workoutSession.findFirst({
          where: { id, athleteId },
          select: detailSelect,
        });
        return row ? detail(row, athleteId) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async lastExerciseReference(
    athleteId: string,
    exerciseId: string,
    before?: string,
  ): Promise<WorkoutDetail | null> {
    return this.prisma.$transaction(
      async (tx) => {
        // Historical reads permit inactive owned exercises, but never foreign personal resources.
        const exercise = await tx.exercise.findFirst({
          where: {
            id: exerciseId,
            OR: [
              { origin: 'GLOBAL' },
              { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
            ],
          },
          select: { id: true },
        });
        if (!exercise)
          throw new WorkoutRepositoryError('missing', 'Exercise not found.');
        const row = await tx.workoutSession.findFirst({
          where: {
            athleteId,
            status: 'COMPLETED',
            ...(before ? { performedOn: { lt: new Date(before) } } : {}),
            exercises: {
              some: {
                exerciseId,
                isOmitted: false,
                sets: {
                  some: {
                    OR: [
                      { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
                      { status: null },
                    ],
                  },
                },
              },
            },
          },
          orderBy: [
            { performedOn: { sort: 'desc', nulls: 'last' } },
            { finishedAt: { sort: 'desc', nulls: 'last' } },
            { id: 'desc' },
          ],
          select: detailSelect,
        });
        return row ? detail(row, athleteId) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private async read(
    tx: Prisma.TransactionClient,
    athleteId: string,
    id: string,
  ): Promise<WorkoutDetail> {
    const row = await tx.workoutSession.findFirst({
      where: { id, athleteId },
      select: detailSelect,
    });
    if (!row)
      throw new WorkoutRepositoryError('missing', 'Workout session not found.');
    return detail(row, athleteId);
  }
  private async lockSession(
    tx: Prisma.TransactionClient,
    athleteId: string,
    id: string,
  ) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM workout_sessions WHERE id = ${id}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
    if (!rows.length)
      throw new WorkoutRepositoryError('missing', 'Workout session not found.');
  }
  private async visibleExercise(
    tx: Prisma.TransactionClient,
    athleteId: string,
    id: string,
  ) {
    await tx.$queryRaw`SELECT id FROM exercises WHERE id = ${id}::uuid FOR SHARE`;
    return tx.exercise.findFirst({
      where: {
        id,
        isActive: true,
        OR: [
          { origin: 'GLOBAL' },
          { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        equipment: true,
        primaryMuscleGroup: { select: { name: true } },
      },
    });
  }
  private async planDay(
    tx: Prisma.TransactionClient,
    athleteId: string,
    planId: string,
    weekId: string,
    dayId: string,
    performedOn?: Date | null,
  ) {
    const day = await tx.planDay.findFirst({
      where: {
        id: dayId,
        planWeekId: weekId,
        planWeek: { trainingPlanId: planId, trainingPlan: { athleteId } },
      },
      include: {
        planWeek: { include: { trainingPlan: true } },
        exercises: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!day)
      throw new WorkoutRepositoryError(
        'missing',
        'Training plan, week or day not found.',
      );
    if (
      day.retiredAt &&
      (!performedOn || !day.retiredFromOn || performedOn >= day.retiredFromOn)
    )
      throw new WorkoutRepositoryError(
        'conflict',
        'This day was withdrawn from the selected date. Use its future copy.',
      );
    if (!['DRAFT', 'ACTIVE'].includes(day.planWeek.trainingPlan.status))
      throw new WorkoutRepositoryError(
        'conflict',
        'Only draft or active plans may be associated.',
      );
    return day;
  }
  async associate(athleteId: string, id: string, input: AssociateWorkoutDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, athleteId, id);
      const current = await tx.workoutSession.findUniqueOrThrow({
        where: { id },
      });
      requireEditable(current.status);
      requireVersion(current.version, input.expectedVersion);
      await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${input.trainingPlanId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
      await this.planDay(
        tx,
        athleteId,
        input.trainingPlanId,
        input.planWeekId,
        input.planDayId,
        current.performedOn,
      );
      await tx.workoutSession.update({
        where: { id },
        data: {
          scheduledActivityId: null,
          trainingPlanId: input.trainingPlanId,
          planWeekId: input.planWeekId,
          planDayId: input.planDayId,
          version: { increment: 1 },
        },
      });
      return this.read(tx, athleteId, id);
    });
  }
  async suggestions(
    athleteId: string,
    input: WorkoutSuggestionsDto,
  ): Promise<WorkoutSuggestions> {
    localDate(input.timeZone);
    const on = new Date(input.performedOn);
    const weekday = on.getUTCDay() || 7;
    const from = new Date(on);
    from.setUTCDate(from.getUTCDate() - 6);
    const activities = await this.prisma.scheduledActivity.findMany({
      where: {
        athleteId,
        scheduledOn: on,
        timeZone: input.timeZone,
        status: { in: ['PLANNED', 'RESCHEDULED'] },
        workouts: {
          none: { status: { in: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] } },
        },
        day: {
          planWeek: { trainingPlan: { status: { in: ['DRAFT', 'ACTIVE'] } } },
        },
      },
      include: {
        day: { include: { planWeek: { include: { trainingPlan: true } } } },
      },
      orderBy: { id: 'asc' },
      take: 1000,
    });
    const days = await this.prisma.planDay.findMany({
      where: {
        weekday,
        retiredAt: null,
        activities: { none: { timeZone: input.timeZone } },
        planWeek: {
          startsOn: { gte: from, lte: on },
          trainingPlan: {
            athleteId,
            status: { in: ['DRAFT', 'ACTIVE'] },
            AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: on } }] }],
            OR: [{ endsOn: null }, { endsOn: { gte: on } }],
          },
        },
      },
      select: {
        id: true,
        name: true,
        planWeek: {
          select: {
            id: true,
            weekNumber: true,
            trainingPlan: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ planWeekId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });
    const candidates = [
      ...activities.flatMap((activity) =>
        activity.day
          ? [
              {
                scheduledActivityId: activity.id,
                planDayId: activity.day.id,
                name: activity.day.name,
                planWeekId: activity.day.planWeek.id,
                weekNumber: activity.day.planWeek.weekNumber,
                trainingPlanId: activity.day.planWeek.trainingPlan.id,
                planName: activity.day.planWeek.trainingPlan.name,
              },
            ]
          : [],
      ),
      ...days.map((day) => ({
        planDayId: day.id,
        name: day.name,
        planWeekId: day.planWeek.id,
        weekNumber: day.planWeek.weekNumber,
        trainingPlanId: day.planWeek.trainingPlan.id,
        planName: day.planWeek.trainingPlan.name,
      })),
    ];
    return {
      performedOn: input.performedOn,
      timeZone: input.timeZone,
      resolution:
        candidates.length === 1
          ? 'SINGLE'
          : candidates.length
            ? 'MULTIPLE'
            : 'NONE',
      candidates,
    };
  }
  private async captureDay(
    tx: Prisma.TransactionClient,
    athleteId: string,
    day: Awaited<ReturnType<PrismaWorkoutSessionsRepository['planDay']>>,
  ) {
    const captured = [];
    for (const item of [...day.exercises].sort((a, b) =>
      a.exerciseId.localeCompare(b.exerciseId),
    )) {
      const exercise = await this.visibleExercise(
        tx,
        athleteId,
        item.exerciseId,
      );
      if (!exercise)
        throw new WorkoutRepositoryError(
          'conflict',
          'A prescribed exercise is inactive or unavailable.',
        );
      const values: WorkoutTargets = {
        targetSets: item.targetSets,
        targetRepsMin: item.targetRepsMin ?? item.targetReps,
        targetRepsMax: item.targetRepsMax ?? item.targetReps,
        targetLoad: item.targetLoad?.toString() ?? null,
        targetLoadUnit: item.targetLoadUnit,
        targetRpe: item.targetRpe === null ? null : Number(item.targetRpe),
      };
      const original: ExerciseSnapshot = {
        source: {
          kind: 'PLAN_DAY',
          id: item.id,
          plan: {
            id: day.planWeek.trainingPlan.id,
            name: day.planWeek.trainingPlan.name,
          },
          week: { id: day.planWeek.id, weekNumber: day.planWeek.weekNumber },
          day: { id: day.id, name: day.name, weekday: day.weekday },
        },
        exercise: {
          id: exercise.id,
          name: exercise.name,
          equipment: exercise.equipment,
          muscleGroup: exercise.primaryMuscleGroup.name,
        },
        targets: values,
        position: item.position,
        notes: item.notes,
      };
      captured.push({
        exerciseId: item.exerciseId,
        planExerciseId: item.id,
        orderInSession: item.position,
        notes: item.notes,
        ...values,
        originalSnapshot: original as unknown as Prisma.InputJsonObject,
      });
    }
    return captured
      .sort((a, b) => a.orderInSession - b.orderInSession)
      .map((item, index) => ({ ...item, orderInSession: index + 1 }));
  }
  async create(
    athleteId: string,
    input: CreateWorkoutSessionDto,
  ): Promise<WorkoutDetail> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM athletes WHERE id = ${athleteId}::uuid FOR UPDATE`;
        const hash = creationHash({
          id: input.id,
          performedOn: input.performedOn,
          timeZone: input.timeZone,
          recordingMode: input.recordingMode ?? 'LIVE',
          name: input.name ?? null,
          notes: input.notes ?? null,
          planId: input.trainingPlanId ?? null,
          weekId: input.planWeekId ?? null,
          dayId: input.planDayId ?? null,
          repeatFromId: input.repeatFromId ?? null,
          ...(input.scheduledActivityId
            ? { scheduledActivityId: input.scheduledActivityId }
            : {}),
        });
        const existing = await tx.workoutSession.findUnique({
          where: { id: input.id },
          select: { athleteId: true, creationRequestHash: true },
        });
        if (existing) {
          if (
            existing.athleteId !== athleteId ||
            existing.creationRequestHash !== hash
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'This creation identifier is already in use.',
            );
          return this.read(tx, athleteId, input.id);
        }
        let exercises: Prisma.WorkoutExerciseUncheckedCreateWithoutSessionInput[] =
          [];
        let source: Prisma.InputJsonObject = {
          kind: 'FREE',
          plan: null,
          week: null,
          day: null,
          session: null,
        };
        if (input.trainingPlanId) {
          await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${input.trainingPlanId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
          const day = await this.planDay(
            tx,
            athleteId,
            input.trainingPlanId,
            input.planWeekId!,
            input.planDayId!,
            new Date(input.performedOn),
          );
          exercises = await this.captureDay(tx, athleteId, day);
          source = {
            kind: 'PLAN_DAY',
            plan: {
              id: input.trainingPlanId,
              name: day.planWeek.trainingPlan.name,
            },
            week: {
              id: input.planWeekId!,
              weekNumber: day.planWeek.weekNumber,
            },
            day: { id: day.id, name: day.name, weekday: day.weekday },
            session: null,
          };
        } else if (input.repeatFromId) {
          await this.lockSession(tx, athleteId, input.repeatFromId);
          const prior = (await this.read(tx, athleteId, input.repeatFromId))
            .attributes;
          source = {
            kind: 'SESSION',
            session: { id: prior.id, name: prior.name ?? null },
            plan: null,
            week: null,
            day: null,
          };
          for (const item of [...prior.exercises].sort((a, b) =>
            a.exercise.id.localeCompare(b.exercise.id),
          )) {
            if (!(await this.visibleExercise(tx, athleteId, item.exercise.id)))
              throw new WorkoutRepositoryError(
                'conflict',
                'A source exercise is inactive or unavailable.',
              );
            const values = item.targets
              ? rowTargets(item.targets)
              : emptyTargets;
            const original: ExerciseSnapshot = {
              source: { kind: 'SESSION', id: item.id },
              exercise: item.exercise,
              targets: values,
              position: item.orderInSession,
              notes: item.notes,
            };
            exercises.push({
              exerciseId: item.exercise.id,
              orderInSession: item.orderInSession,
              isOmitted: item.isOmitted ?? false,
              ...values,
              notes: item.notes,
              originalSnapshot: original as unknown as Prisma.InputJsonObject,
            });
          }
        }
        if (input.scheduledActivityId) {
          await tx.$queryRaw`SELECT id FROM scheduled_activities WHERE id=${input.scheduledActivityId}::uuid AND athlete_id=${athleteId}::uuid FOR UPDATE`;
          const activity = await tx.scheduledActivity.findFirst({
            where: {
              id: input.scheduledActivityId,
              athleteId,
              planDayId: input.planDayId ?? null,
              planWeekId: input.planWeekId ?? null,
              status: { in: ['PLANNED', 'RESCHEDULED'] },
            },
          });
          if (
            !activity ||
            !input.planDayId ||
            activity.timeZone !== input.timeZone
          )
            throw new WorkoutRepositoryError(
              'missing',
              'Scheduled training activity not found for the selected day and time zone.',
            );
          source = {
            ...source,
            schedule: {
              id: activity.id,
              scheduledOn: activity.scheduledOn.toISOString().slice(0, 10),
              timeZone: activity.timeZone,
            },
          };
        }
        exercises = exercises
          .sort((a, b) => a.orderInSession - b.orderInSession)
          .map((item, index) => ({ ...item, orderInSession: index + 1 }));
        if (exercises.length > 1000)
          throw new WorkoutRepositoryError(
            'conflict',
            'The session exercise limit has been reached.',
          );
        await tx.workoutSession.create({
          data: {
            id: input.id,
            athleteId,
            scheduledActivityId: input.scheduledActivityId ?? null,
            trainingPlanId: input.trainingPlanId ?? null,
            planWeekId: input.planWeekId ?? null,
            planDayId: input.planDayId ?? null,
            status: 'PLANNED',
            performedOn: new Date(input.performedOn),
            timeZone: input.timeZone,
            recordingMode: input.recordingMode,
            name: input.name ?? null,
            creationRequestHash: hash,
            notes: input.notes ?? null,
            sourceSnapshot: source,
            copiedFromSessionId: input.repeatFromId ?? null,
            exercises: { create: exercises },
          },
        });
        return this.read(tx, athleteId, input.id);
      },
      { timeout: 15000 },
    );
  }
  async addExercise(
    athleteId: string,
    id: string,
    input: AddWorkoutExerciseDto,
  ): Promise<WorkoutDetail> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, athleteId, id);
      const values = targets(input);
      const hash = creationHash({
        sessionId: id,
        exerciseId: input.exerciseId,
        targets: values,
        notes: input.notes ?? null,
        replaces: input.replacesWorkoutExerciseId ?? null,
      });
      const existing = await tx.workoutExercise.findUnique({
        where: { id: input.id },
        select: { sessionId: true, creationRequestHash: true },
      });
      if (existing) {
        if (existing.sessionId !== id || existing.creationRequestHash !== hash)
          throw new WorkoutRepositoryError(
            'conflict',
            'This exercise creation identifier is already in use.',
          );
        return this.read(tx, athleteId, id);
      }
      const session = await tx.workoutSession.findUniqueOrThrow({
        where: { id },
      });
      requireEditable(session.status);
      requireVersion(session.version, input.expectedVersion);
      const exercise = await this.visibleExercise(
        tx,
        athleteId,
        input.exerciseId,
      );
      if (!exercise)
        throw new WorkoutRepositoryError(
          'missing',
          'Exercise not found or unavailable.',
        );
      if (input.replacesWorkoutExerciseId) {
        const previous = await tx.workoutExercise.findFirst({
          where: {
            id: input.replacesWorkoutExerciseId,
            sessionId: id,
            isOmitted: true,
          },
        });
        if (!previous)
          throw new WorkoutRepositoryError(
            'missing',
            'An omitted exercise in this session must be selected for replacement.',
          );
      }
      const last = await tx.workoutExercise.aggregate({
        where: { sessionId: id },
        _max: { orderInSession: true },
      });
      const position = (last._max.orderInSession ?? 0) + 1;
      if (position > 1000)
        throw new WorkoutRepositoryError(
          'conflict',
          'The session exercise limit has been reached.',
        );
      const original: ExerciseSnapshot = {
        source: { kind: 'FREE', id: null },
        exercise: {
          id: exercise.id,
          name: exercise.name,
          equipment: exercise.equipment,
          muscleGroup: exercise.primaryMuscleGroup.name,
        },
        targets: values,
        position,
        notes: input.notes ?? null,
      };
      await tx.workoutExercise.create({
        data: {
          id: input.id,
          sessionId: id,
          exerciseId: input.exerciseId,
          orderInSession: position,
          notes: input.notes ?? null,
          ...values,
          replacesWorkoutExerciseId: input.replacesWorkoutExerciseId ?? null,
          creationRequestHash: hash,
          originalSnapshot: original as unknown as Prisma.InputJsonObject,
        },
      });
      await tx.workoutSession.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      return this.read(tx, athleteId, id);
    });
  }
  async prepare(
    athleteId: string,
    id: string,
    command: PreparationCommand,
  ): Promise<WorkoutDetail> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockSession(tx, athleteId, id);
        const session = await tx.workoutSession.findUniqueOrThrow({
          where: { id },
        });
        const imports = (session.importOperations ?? []) as unknown as Array<{
          id: string;
          dayId: string;
        }>;
        if (command.action === 'import') {
          const previous = imports.find((item) => item.id === command.input.id);
          if (previous) {
            if (previous.dayId !== command.input.planDayId)
              throw new WorkoutRepositoryError(
                'conflict',
                'This import identifier is already in use.',
              );
            return this.read(tx, athleteId, id);
          }
        }
        requireEditable(session.status);
        requireVersion(session.version, command.input.expectedVersion);
        if (command.action === 'update') {
          const { expectedVersion: _version, ...input } = command.input;
          if (!Object.values(input).some((value) => value !== undefined))
            throw new WorkoutRepositoryError(
              'invalid',
              'At least one editable field is required.',
            );
          if (
            session.status !== 'PLANNED' &&
            (input.performedOn !== undefined ||
              input.timeZone !== undefined ||
              input.recordingMode !== undefined)
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'The execution date and time zone are fixed once recording starts.',
            );
          const zone = input.timeZone ?? session.timeZone;
          const date =
            input.performedOn ??
            session.performedOn?.toISOString().slice(0, 10);
          if (zone) localDate(zone);
          if (
            (input.recordingMode ?? session.recordingMode) ===
              'RETROSPECTIVE' &&
            date &&
            zone &&
            date > localDate(zone)
          )
            throw new WorkoutRepositoryError(
              'invalid',
              'A retrospective training date cannot be in the future.',
            );
          if ((date == null) !== (zone == null))
            throw new WorkoutRepositoryError(
              'invalid',
              'Date and time zone must be provided together.',
            );
          await tx.workoutSession.update({
            where: { id },
            data: {
              ...input,
              ...(input.performedOn
                ? { performedOn: new Date(input.performedOn) }
                : {}),
            },
          });
        } else if (command.action === 'exercise') {
          const row = await tx.workoutExercise.findFirst({
            where: { id: command.exerciseId, sessionId: id },
          });
          if (!row)
            throw new WorkoutRepositoryError(
              'missing',
              'Workout exercise not found.',
            );
          const {
            expectedVersion: _version,
            isOmitted,
            notes,
            ...input
          } = command.input;
          if (
            !Object.entries(command.input).some(
              ([key, value]) =>
                key !== 'expectedVersion' && value !== undefined,
            )
          )
            throw new WorkoutRepositoryError(
              'invalid',
              'At least one editable field is required.',
            );
          if (
            isOmitted &&
            (await tx.setRecord.count({
              where: {
                workoutExerciseId: row.id,
                OR: [
                  { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
                  { status: null },
                ],
              },
            }))
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'An exercise with actual results cannot be omitted.',
            );
          await tx.workoutExercise.update({
            where: { id: row.id },
            data: {
              ...targets(input, rowTargets(row)),
              ...(isOmitted !== undefined ? { isOmitted } : {}),
              ...(notes !== undefined ? { notes } : {}),
            },
          });
        } else if (command.action === 'order') {
          const rows = await tx.workoutExercise.findMany({
            where: { sessionId: id },
            select: { id: true, orderInSession: true },
          });
          const ids = command.input.ids;
          if (
            ids.length !== rows.length ||
            new Set(ids).size !== ids.length ||
            ids.some((item) => !rows.some((row) => row.id === item))
          )
            throw new WorkoutRepositoryError(
              'invalid',
              'Provide all and only the exercise identifiers of this session.',
            );
          const offset =
            Math.max(0, ...rows.map((row) => row.orderInSession)) + 1001;
          for (const [index, item] of ids.entries())
            await tx.workoutExercise.update({
              where: { id: item },
              data: { orderInSession: offset + index },
            });
          for (const [index, item] of ids.entries())
            await tx.workoutExercise.update({
              where: { id: item },
              data: { orderInSession: index + 1 },
            });
        } else {
          if (command.input.planDayId !== session.planDayId)
            throw new WorkoutRepositoryError(
              'conflict',
              'The associated day changed. Review the prescriptions before importing.',
            );
          if (imports.length >= 1000)
            throw new WorkoutRepositoryError(
              'conflict',
              'The session import limit has been reached.',
            );
          if (
            !session.planDayId ||
            !session.planWeekId ||
            !session.trainingPlanId
          )
            throw new WorkoutRepositoryError(
              'invalid',
              'Associate a plan day before explicitly importing prescriptions.',
            );
          await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${session.trainingPlanId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
          const day = await this.planDay(
            tx,
            athleteId,
            session.trainingPlanId,
            session.planWeekId,
            session.planDayId,
            session.performedOn,
          );
          const captured = await this.captureDay(tx, athleteId, day);
          const current = await tx.workoutExercise.findMany({
            where: { sessionId: id },
            select: { orderInSession: true, planExerciseId: true },
          });
          let position = Math.max(
            0,
            ...current.map((item) => item.orderInSession),
          );
          const missing = captured.filter(
            (item) =>
              !current.some(
                (row) => row.planExerciseId === item.planExerciseId,
              ),
          );
          if (position + missing.length > 1000)
            throw new WorkoutRepositoryError(
              'conflict',
              'The session exercise limit has been reached.',
            );
          for (const item of missing)
            await tx.workoutExercise.create({
              data: { ...item, sessionId: id, orderInSession: ++position },
            });
          await tx.workoutSession.update({
            where: { id },
            data: {
              importOperations: [
                ...imports,
                { id: command.input.id, dayId: session.planDayId },
              ],
            },
          });
        }
        await tx.workoutSession.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return this.read(tx, athleteId, id);
      },
      { timeout: 15000 },
    );
  }
  async saveDay(athleteId: string, id: string, input: SaveWorkoutDayDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockSession(tx, athleteId, id);
        const session = (await this.read(tx, athleteId, id)).attributes;
        if (!['COMPLETED', 'CANCELLED'].includes(session.status))
          throw new WorkoutRepositoryError(
            'conflict',
            'Only a closed session can be saved as a plan day.',
          );
        const hash = creationHash({
          sessionId: id,
          weekId: input.planWeekId,
          name: input.name,
          position: input.position,
          weekday: input.weekday ?? null,
        });
        const existing = await tx.planDay.findUnique({
          where: { id: input.id },
          include: {
            planWeek: {
              select: {
                trainingPlanId: true,
                trainingPlan: { select: { athleteId: true } },
              },
            },
          },
        });
        if (existing) {
          if (
            existing.planWeekId !== input.planWeekId ||
            existing.planWeek.trainingPlanId !== input.trainingPlanId ||
            existing.planWeek.trainingPlan.athleteId !== athleteId ||
            existing.creationRequestHash !== hash
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'This day creation identifier is already in use.',
            );
          return {
            id: existing.id,
            name: existing.name,
            planWeekId: input.planWeekId,
            trainingPlanId: input.trainingPlanId,
          };
        }
        await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${input.trainingPlanId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
        const week = await tx.planWeek.findFirst({
          where: {
            id: input.planWeekId,
            trainingPlanId: input.trainingPlanId,
            trainingPlan: { athleteId, status: 'DRAFT' },
          },
        });
        if (!week)
          throw new WorkoutRepositoryError(
            'conflict',
            'Choose an owned draft plan and week as an editable destination.',
          );
        const included = session.exercises.filter((item) => !item.isOmitted);
        if (!included.length)
          throw new WorkoutRepositoryError(
            'invalid',
            'The session has no included exercises.',
          );
        await tx.planDay.create({
          data: {
            id: input.id,
            planWeekId: week.id,
            name: input.name,
            position: input.position,
            weekday: input.weekday,
            sourceWorkoutSessionId: id,
            creationRequestHash: hash,
          },
        });
        for (const [index, item] of included.entries()) {
          const value = item.targets ? rowTargets(item.targets) : undefined;
          if (
            !value?.targetSets ||
            !value.targetRepsMin ||
            !value.targetRepsMax
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'Verified programming objectives are missing. Create a plan day manually rather than inferring objectives from executed sets.',
            );
          if (!(await this.visibleExercise(tx, athleteId, item.exercise.id)))
            throw new WorkoutRepositoryError(
              'conflict',
              'An exercise is inactive or unavailable.',
            );
          await tx.planExercise.create({
            data: {
              planWeekId: week.id,
              planDayId: input.id,
              exerciseId: item.exercise.id,
              position: index + 1,
              targetSets: value.targetSets,
              targetReps:
                value.targetRepsMin === value.targetRepsMax
                  ? value.targetRepsMin
                  : null,
              targetRepsMin: value.targetRepsMin,
              targetRepsMax: value.targetRepsMax,
              targetLoad: value.targetLoad,
              targetLoadUnit: value.targetLoadUnit,
              targetRpe: value.targetRpe,
              notes: item.notes,
            },
          });
        }
        return {
          id: input.id,
          name: input.name,
          planWeekId: week.id,
          trainingPlanId: input.trainingPlanId,
        };
      },
      { timeout: 15000 },
    );
  }
  async recordSet(
    athleteId: string,
    id: string,
    exerciseId: string,
    input: CreateWorkoutSetDto | UpdateWorkoutSetDto,
    setId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, athleteId, id);
      const values = executedSet(input);
      const hash = creationHash({
        exerciseId,
        ...values,
        load: values.load?.toString() ?? null,
        loadKg: values.loadKg?.toString() ?? null,
      });
      if (!setId) {
        const previous = await tx.setRecord.findUnique({
          where: { id: (input as CreateWorkoutSetDto).id },
        });
        if (previous) {
          if (
            previous.workoutExerciseId !== exerciseId ||
            previous.creationRequestHash !== hash ||
            !(await tx.workoutExercise.findFirst({
              where: { id: exerciseId, sessionId: id },
            }))
          )
            throw new WorkoutRepositoryError(
              'conflict',
              'This set creation identifier is already in use.',
            );
          return this.read(tx, athleteId, id);
        }
      }
      const session = await tx.workoutSession.findUniqueOrThrow({
        where: { id },
      });
      requireInProgress(session.status);
      requireVersion(session.version, input.expectedVersion);
      const exercise = await tx.workoutExercise.findFirst({
        where: { id: exerciseId, sessionId: id },
      });
      if (!exercise)
        throw new WorkoutRepositoryError(
          'missing',
          'Workout exercise not found in this session.',
        );
      if (exercise.isOmitted)
        throw new WorkoutRepositoryError(
          'conflict',
          'Restore the omitted exercise before recording sets.',
        );
      if (setId) {
        const existing = await tx.setRecord.findFirst({
          where: { id: setId, workoutExerciseId: exerciseId },
          include: { _count: { select: { estimates: true } } },
        });
        if (!existing)
          throw new WorkoutRepositoryError('missing', 'Set record not found.');
        if (existing._count.estimates > 0)
          throw new WorkoutRepositoryError(
            'conflict',
            'This set has historical estimates and cannot be modified.',
          );
        requireVersion(
          existing.version,
          (input as UpdateWorkoutSetDto).expectedSetVersion,
        );
        await tx.setRecord.update({
          where: { id: setId },
          data: { ...values, version: { increment: 1 } },
        });
      } else {
        await tx.setRecord.create({
          data: {
            id: (input as CreateWorkoutSetDto).id,
            workoutExerciseId: exerciseId,
            ...values,
            creationRequestHash: hash,
          },
        });
      }
      await tx.workoutSession.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      return this.read(tx, athleteId, id);
    });
  }
  async cancel(athleteId: string, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, athleteId, id);
      const session = await tx.workoutSession.findUniqueOrThrow({
        where: { id },
      });
      if (session.status !== 'CANCELLED') {
        requireEditable(session.status);
        requireVersion(session.version, expectedVersion);
        await tx.workoutSession.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            ...(session.startedAt
              ? {
                  finishedAt: new Date(
                    Math.max(Date.now(), session.startedAt.getTime()),
                  ),
                }
              : {}),
            version: { increment: 1 },
          },
        });
      }
      return this.read(tx, athleteId, id);
    });
  }
  private async transition(
    athleteId: string,
    id: string,
    action: 'start' | 'complete',
    expectedVersion: number,
    confirmWithoutResults = false,
  ): Promise<WorkoutDetail> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, athleteId, id);
      const session = (await this.read(tx, athleteId, id)).attributes;
      const current = await tx.workoutSession.findUniqueOrThrow({
        where: { id },
      });
      if (action === 'start' && session.status === 'PLANNED') {
        requireVersion(current.version, expectedVersion);
        if (
          current.recordingMode === 'LIVE' &&
          current.performedOn?.toISOString().slice(0, 10) !==
            localDate(current.timeZone!)
        )
          throw new WorkoutRepositoryError(
            'conflict',
            'Update the training date or choose retrospective recording before starting.',
          );
      }
      if (action === 'complete' && session.status !== 'COMPLETED')
        requireVersion(current.version, expectedVersion);
      const completed = await tx.setRecord.count({
        where: {
          workoutExercise: { sessionId: id },
          OR: [
            { status: { in: ['COMPLETED', 'INCOMPLETE', 'FAILED'] } },
            { status: null },
          ],
        },
      });
      const update = sessionTransition(
        session,
        action,
        completed,
        new Date(),
        confirmWithoutResults,
      );
      if (update?.status === 'IN_PROGRESS') {
        if (session.trainingPlan) {
          await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${session.trainingPlan.id}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
          const source = await tx.trainingPlan.findFirst({
            where: {
              id: session.trainingPlan.id,
              athleteId,
              status: { in: ['DRAFT', 'ACTIVE'] },
            },
            select: { id: true },
          });
          if (!source)
            throw new WorkoutRepositoryError(
              'conflict',
              'The source plan is no longer available for starting a session.',
            );
        }
        for (const exerciseId of [
          ...new Set(
            session.exercises
              .filter((item) => !item.isOmitted)
              .map((item) => item.exercise.id),
          ),
        ].sort()) {
          if (!(await this.visibleExercise(tx, athleteId, exerciseId)))
            throw new WorkoutRepositoryError(
              'conflict',
              'A session exercise is inactive or unavailable.',
            );
        }
      }
      if (update)
        await tx.workoutSession.update({
          where: { id },
          data: {
            ...update,
            ...(update.status === 'COMPLETED'
              ? { completedAt: update.finishedAt }
              : {}),
            version: { increment: 1 },
          },
        });
      return this.read(tx, athleteId, id);
    });
  }
  start(athleteId: string, id: string, expectedVersion: number) {
    return this.transition(athleteId, id, 'start', expectedVersion);
  }
  complete(
    athleteId: string,
    id: string,
    expectedVersion: number,
    confirmWithoutResults = false,
  ) {
    return this.transition(
      athleteId,
      id,
      'complete',
      expectedVersion,
      confirmWithoutResults,
    );
  }
}
