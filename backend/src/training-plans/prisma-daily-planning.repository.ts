import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TrainingPlan } from '../models/training-plans/training-plan.model';
import {
  assertPermutation,
  PlanningError,
  prescriptionTargets,
} from './daily-planning.policy';
import type {
  PlanningRevisionDto,
  CopyPlanDayDto,
  CopyPlanWeekDto,
  CreateDailyPrescriptionDto,
  CreatePlanDayDto,
  DailyPrescriptionDto,
  DistributePrescriptionDto,
  ReorderPlanningDto,
  UpdatePlanDayDto,
} from './dto/daily-planning.dto';

export type PlanningCommand =
  | { action: 'createDay'; input: CreatePlanDayDto }
  | { action: 'updateDay'; dayId: string; input: UpdatePlanDayDto }
  | { action: 'reorderDays'; input: ReorderPlanningDto }
  | { action: 'copyDay'; dayId: string; input: CopyPlanDayDto }
  | { action: 'copyWeek'; input: CopyPlanWeekDto }
  | {
      action: 'createExercise';
      dayId: string;
      input: CreateDailyPrescriptionDto;
    }
  | {
      action: 'updateExercise';
      dayId: string;
      prescriptionId: string;
      input: DailyPrescriptionDto;
    }
  | {
      action: 'removeExercise';
      dayId: string;
      prescriptionId: string;
      input?: PlanningRevisionDto;
    }
  | { action: 'reorderExercises'; dayId: string; input: ReorderPlanningDto }
  | {
      action: 'distribute';
      prescriptionId: string;
      input: DistributePrescriptionDto;
    };
const prescriptionInclude = {
  exercise: {
    select: {
      id: true,
      origin: true,
      owner: { select: { athlete: { select: { id: true } } } },
      name: true,
      equipment: true,
      description: true,
      primaryMuscleGroup: { select: { name: true } },
    },
  },
  _count: { select: { workoutExercises: true, recommendations: true } },
} satisfies Prisma.PlanExerciseInclude;
type Row = Prisma.PlanExerciseGetPayload<{
  include: typeof prescriptionInclude;
}>;
function hasHistory(row: Pick<Row, '_count'>) {
  return row._count.workoutExercises > 0 || row._count.recommendations > 0;
}
export function protect(rows: readonly Pick<Row, '_count'>[]) {
  if (rows.some(hasHistory))
    throw new PlanningError(
      'conflict',
      'This resource has training history. Copy it to new programming instead of modifying it.',
    );
}
function editableValues(input: DailyPrescriptionDto) {
  return {
    position: input.position,
    targetSets: input.targetSets,
    targetRpe: input.targetRpe,
    notes: input.notes,
  };
}
function values(row: Row) {
  return {
    exerciseId: row.exerciseId,
    position: row.position,
    targetSets: row.targetSets,
    targetReps: row.targetReps,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetRpe: row.targetRpe,
    targetLoad: row.targetLoad,
    targetLoadUnit: row.targetLoadUnit,
    notes: row.notes,
  };
}
function prescriptionModel(row: Row) {
  return {
    id: row.id,
    position: row.position,
    targetSets: row.targetSets,
    targetReps: row.targetReps,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetRpe: row.targetRpe,
    targetLoad: row.targetLoad,
    targetLoadUnit: row.targetLoadUnit,
    notes: row.notes,
    hasHistory: hasHistory(row),
    exercise: {
      id: row.exercise.id,
      name: row.exercise.name,
      muscleGroup: row.exercise.primaryMuscleGroup.name,
      equipment: row.exercise.equipment,
      description: row.exercise.description,
    },
  };
}

@Injectable()
export class PrismaDailyPlanningRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async read(
    tx: Prisma.TransactionClient,
    athleteId: string,
    planId: string,
  ) {
    const plan = await tx.trainingPlan.findFirst({
      where: { id: planId, athleteId },
      select: {
        id: true,
        name: true,
        startsOn: true,
        endsOn: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        weeks: {
          orderBy: { weekNumber: 'asc' },
          select: {
            id: true,
            weekNumber: true,
            objective: true,
            startsOn: true,
            days: {
              select: {
                id: true,
                planWeekId: true,
                name: true,
                position: true,
                weekday: true,
                retiredAt: true,
                retiredFromOn: true,
                isEditableOverride: true,
                _count: { select: { workoutSessions: true } },
              },
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
            },
            planExercises: {
              include: prescriptionInclude,
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (!plan) throw new PlanningError('missing', 'Training plan not found.');
    if (
      plan.weeks.some((week) =>
        week.planExercises.some(
          (row) =>
            row.exercise.origin === 'PERSONAL' &&
            row.exercise.owner?.athlete?.id !== athleteId,
        ),
      )
    ) {
      throw new PlanningError(
        'missing',
        'The plan contains an unavailable private resource.',
      );
    }
    return new TrainingPlan({
      ...plan,
      weeks: plan.weeks.map(({ days, planExercises, ...week }) => ({
        ...week,
        pendingExercises: planExercises
          .filter((row) => row.planDayId === null)
          .map(prescriptionModel),
        days: days.map(({ planWeekId: _weekId, _count, ...day }) => ({
          ...day,
          hasHistory:
            _count.workoutSessions > 0 ||
            planExercises.some(
              (row) => row.planDayId === day.id && hasHistory(row),
            ),
          exercises: planExercises
            .filter((row) => row.planDayId === day.id)
            .map(prescriptionModel),
        })),
      })),
    });
  }
  get(athleteId: string, planId: string) {
    return this.prisma.$transaction((tx) => this.read(tx, athleteId, planId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  private async catalog(
    tx: Prisma.TransactionClient,
    athleteId: string,
    exerciseId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM exercises WHERE id = ${exerciseId}::uuid FOR SHARE`;
    const exercise = await tx.exercise.findFirst({
      where: {
        id: exerciseId,
        isActive: true,
        OR: [
          { origin: 'GLOBAL' },
          { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
        ],
      },
      select: { id: true },
    });
    if (!exercise)
      throw new PlanningError('missing', 'Active catalog exercise not found.');
  }
  async change(
    athleteId: string,
    planId: string,
    weekId: string,
    command: PlanningCommand,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Same lock used by legacy F05 and F06 session creation: history cannot appear between check and write.
        await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${planId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
        const week = await tx.planWeek.findFirst({
          where: {
            id: weekId,
            trainingPlanId: planId,
            trainingPlan: { athleteId },
          },
          include: {
            trainingPlan: { select: { status: true, version: true } },
            days: {
              include: { _count: { select: { workoutSessions: true } } },
            },
            planExercises: { include: prescriptionInclude },
          },
        });
        if (!week) throw new PlanningError('missing', 'Plan week not found.');
        if (
          command.input?.expectedVersion !== undefined &&
          command.input.expectedVersion !== week.trainingPlan.version
        )
          throw new PlanningError(
            'conflict',
            'The plan changed. Reload before editing.',
          );
        if (!['DRAFT', 'ACTIVE'].includes(week.trainingPlan.status))
          throw new PlanningError(
            'conflict',
            'Only draft training plans can be modified.',
          );
        const dayId =
          'dayId' in command
            ? command.dayId
            : command.action === 'distribute'
              ? command.input.dayId
              : undefined;
        const day = dayId
          ? week.days.find((item) => item.id === dayId)
          : undefined;
        if (dayId && !day)
          throw new PlanningError(
            'missing',
            'Plan day not found in this week.',
          );
        if (day?.retiredAt)
          throw new PlanningError(
            'conflict',
            'This programming has been withdrawn. Use the current day.',
          );
        if (
          week.trainingPlan.status === 'ACTIVE' &&
          (!day?.isEditableOverride ||
            day._count.workoutSessions > 0 ||
            ![
              'updateDay',
              'createExercise',
              'updateExercise',
              'removeExercise',
              'reorderExercises',
            ].includes(command.action))
        )
          throw new PlanningError(
            'conflict',
            'Create an editable future copy before changing active programming.',
          );
        const dayRows = week.planExercises.filter(
          (row) => row.planDayId === dayId,
        );
        if (week.trainingPlan.status === 'ACTIVE') protect(dayRows);
        switch (command.action) {
          case 'createDay':
            await tx.planDay.create({
              data: {
                planWeekId: weekId,
                name: command.input.name,
                position: command.input.position,
                weekday: command.input.weekday,
              },
            });
            break;
          case 'updateDay':
            protect(dayRows);
            if (day!._count.workoutSessions > 0)
              throw new PlanningError(
                'conflict',
                'This day has training history. Copy it instead.',
              );
            await tx.planDay.update({
              where: { id: command.dayId },
              data: {
                name: command.input.name,
                weekday: command.input.weekday,
              },
            });
            break;
          case 'reorderDays': {
            week.days = week.days.filter((day) => !day.retiredAt);
            assertPermutation(command.input.ids, week.days);
            const changed = week.days.filter(
              (item) =>
                item.position !== command.input.ids.indexOf(item.id) + 1,
            );
            if (changed.some((item) => item._count.workoutSessions > 0))
              throw new PlanningError(
                'conflict',
                'This day has training history. Copy it instead.',
              );
            protect(
              week.planExercises.filter((row) =>
                changed.some((item) => item.id === row.planDayId),
              ),
            );
            // Two positive-position passes avoid transient unique collisions, including sparse old orderings.
            const offset =
              Math.max(0, ...week.days.map((item) => item.position)) + 1001;
            for (const [index, id] of command.input.ids.entries())
              await tx.planDay.update({
                where: { id },
                data: { position: offset + index },
              });
            for (const [index, id] of command.input.ids.entries())
              await tx.planDay.update({
                where: { id },
                data: { position: index + 1 },
              });
            break;
          }
          case 'copyDay': {
            const created = await tx.planDay.create({
              data: {
                planWeekId: weekId,
                name:
                  command.input.name ?? `${day!.name.slice(0, 152)} (copia)`,
                position: command.input.position,
                weekday: day!.weekday,
              },
            });
            for (const row of [...dayRows].sort((a, b) =>
              a.exerciseId.localeCompare(b.exerciseId),
            )) {
              await this.catalog(tx, athleteId, row.exerciseId);
              await tx.planExercise.create({
                data: {
                  ...values(row),
                  planWeekId: weekId,
                  planDayId: created.id,
                },
              });
            }
            break;
          }
          case 'copyWeek': {
            const created = await tx.planWeek.create({
              data: {
                trainingPlanId: planId,
                weekNumber: command.input.weekNumber,
                objective: week.objective,
              },
            });
            const days = new Map<string, string>();
            for (const source of week.days.filter((day) => !day.retiredAt)) {
              const copy = await tx.planDay.create({
                data: {
                  planWeekId: created.id,
                  name: source.name,
                  position: source.position,
                  weekday: source.weekday,
                },
              });
              days.set(source.id, copy.id);
            }
            for (const row of week.planExercises
              .filter(
                (row) => row.planDayId === null || days.has(row.planDayId),
              )
              .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))) {
              await this.catalog(tx, athleteId, row.exerciseId);
              await tx.planExercise.create({
                data: {
                  ...values(row),
                  planWeekId: created.id,
                  planDayId: row.planDayId ? days.get(row.planDayId)! : null,
                },
              });
            }
            break;
          }
          case 'createExercise': {
            await this.catalog(tx, athleteId, command.input.exerciseId);
            await tx.planExercise.create({
              data: {
                ...editableValues(command.input),
                exerciseId: command.input.exerciseId,
                position: command.input.position,
                targetSets: command.input.targetSets,
                ...prescriptionTargets(command.input),
                planWeekId: weekId,
                planDayId: command.dayId,
              },
            });
            break;
          }
          case 'updateExercise': {
            const row = dayRows.find(
              (item) => item.id === command.prescriptionId,
            );
            if (!row)
              throw new PlanningError(
                'missing',
                'Plan exercise not found in this day.',
              );
            protect([row]);
            await tx.planExercise.update({
              where: { id: row.id },
              data: {
                ...editableValues(command.input),
                ...prescriptionTargets(command.input, {
                  ...row,
                  targetLoad:
                    row.targetLoad === null ? null : Number(row.targetLoad),
                }),
              },
            });
            break;
          }
          case 'removeExercise': {
            const row = dayRows.find(
              (item) => item.id === command.prescriptionId,
            );
            if (!row)
              throw new PlanningError(
                'missing',
                'Plan exercise not found in this day.',
              );
            protect([row]);
            await tx.planExercise.delete({ where: { id: row.id } });
            break;
          }
          case 'reorderExercises': {
            assertPermutation(command.input.ids, dayRows);
            protect(
              dayRows.filter(
                (row) => row.position !== command.input.ids.indexOf(row.id) + 1,
              ),
            );
            const offset =
              Math.max(0, ...dayRows.map((item) => item.position)) + 1001;
            for (const [index, id] of command.input.ids.entries())
              await tx.planExercise.update({
                where: { id },
                data: { position: offset + index },
              });
            for (const [index, id] of command.input.ids.entries())
              await tx.planExercise.update({
                where: { id },
                data: { position: index + 1 },
              });
            break;
          }
          case 'distribute': {
            const row = week.planExercises.find(
              (item) =>
                item.id === command.prescriptionId && item.planDayId === null,
            );
            if (!row)
              throw new PlanningError(
                'missing',
                'Pending prescription not found.',
              );
            if (!command.input.copy) protect([row]);
            await this.catalog(tx, athleteId, row.exerciseId);
            if (command.input.copy)
              await tx.planExercise.create({
                data: {
                  ...values(row),
                  planWeekId: weekId,
                  planDayId: command.input.dayId,
                  position: command.input.position,
                },
              });
            else
              await tx.planExercise.update({
                where: { id: row.id },
                data: {
                  planDayId: command.input.dayId,
                  position: command.input.position,
                },
              });
            break;
          }
        }
        await tx.trainingPlan.update({
          where: { id: planId },
          data: { version: { increment: 1 } },
        });
        return this.read(tx, athleteId, planId);
      },
      { timeout: 15000 },
    );
  }
}
