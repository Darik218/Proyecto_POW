import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ScheduledActivity } from '../models/training-plans/scheduled-activity.model';
import { PlanningError } from './daily-planning.policy';
import {
  creationHash,
  localDate,
} from '../workout-sessions/workout-calendar.policy';
import type {
  GenerateRoutineDto,
  PlanningVersionDto,
  NewRoutineDayDto,
  CopyRoutineDto,
  FutureRoutineDto,
  CreateScheduledActivityDto,
  UpdateScheduledActivityDto,
  ActivityQueryDto,
} from './dto/flexible-planning.dto';
const iso = (value: Date) => value.toISOString().slice(0, 10);
function plus(date: string, days: number) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function hash(action: string, input: object) {
  const { expectedVersion: _version, ...fields } = input as {
    expectedVersion?: number;
  };
  return creationHash(canonical({ action, ...fields }) as object);
}
const activitySelect = {
  id: true,
  planWeekId: true,
  planDayId: true,
  originalPlanDayId: true,
  originalOn: true,
  scheduledOn: true,
  timeZone: true,
  title: true,
  status: true,
  version: true,
  workouts: {
    select: { id: true, status: true, performedOn: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.ScheduledActivitySelect;
@Injectable()
export class PrismaFlexiblePlanningRepository {
  constructor(private readonly prisma: PrismaService) {}
  private async lock(
    tx: Prisma.TransactionClient,
    athleteId: string,
    planId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM training_plans WHERE id=${planId}::uuid AND athlete_id=${athleteId}::uuid FOR UPDATE`;
    const plan = await tx.trainingPlan.findFirst({
      where: { id: planId, athleteId },
    });
    if (!plan) throw new PlanningError('missing', 'Training plan not found.');
    return plan;
  }
  private async operation<T extends Prisma.InputJsonObject>(
    athleteId: string,
    planId: string,
    input: PlanningVersionDto,
    action: string,
    work: (
      tx: Prisma.TransactionClient,
      plan: Awaited<ReturnType<PrismaFlexiblePlanningRepository['lock']>>,
    ) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const plan = await this.lock(tx, athleteId, planId);
        const fingerprint = hash(action, input);
        const previous = await tx.planningOperation.findUnique({
          where: { id: input.id },
        });
        if (previous) {
          if (
            previous.athleteId !== athleteId ||
            previous.planId !== planId ||
            previous.requestHash !== fingerprint
          )
            throw new PlanningError(
              'conflict',
              'Creation identifier already in use.',
            );
          return previous.result as T;
        }
        if (plan.version !== input.expectedVersion)
          throw new PlanningError(
            'conflict',
            'The plan changed. Reload before editing.',
          );
        if (!['DRAFT', 'ACTIVE'].includes(plan.status))
          throw new PlanningError('conflict', 'This plan is read-only.');
        const result = await work(tx, plan);
        await tx.trainingPlan.update({
          where: { id: planId },
          data: { version: { increment: 1 } },
        });
        await tx.planningOperation.create({
          data: {
            id: input.id,
            athleteId,
            planId,
            requestHash: fingerprint,
            result,
          },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async generate(athleteId: string, input: GenerateRoutineDto) {
    localDate(input.timeZone);
    const templates =
      input.days ??
      Array.from({ length: input.frequency }, (_, index) => ({
        name: `Día ${index + 1}`,
        weekday: null,
      }));
    if (templates.length !== input.frequency)
      throw new PlanningError(
        'invalid',
        'The day templates must match the initial frequency.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM athletes WHERE id=${athleteId}::uuid FOR UPDATE`;
        const fingerprint = hash('generate', input);
        const previous = await tx.trainingPlan.findUnique({
          where: { id: input.id },
        });
        if (previous) {
          if (
            previous.athleteId !== athleteId ||
            previous.creationRequestHash !== fingerprint
          )
            throw new PlanningError(
              'conflict',
              'Creation identifier already in use.',
            );
          return { id: previous.id };
        }
        await tx.trainingPlan.create({
          data: {
            id: input.id,
            athleteId,
            name: input.name,
            startsOn: input.startsOn ? new Date(input.startsOn) : null,
            endsOn: input.startsOn
              ? plus(input.startsOn, input.durationWeeks * 7 - 1)
              : null,
            creationRequestHash: fingerprint,
          },
        });
        for (let index = 0; index < input.durationWeeks; index++) {
          const start = input.startsOn ? plus(input.startsOn, index * 7) : null;
          const week = await tx.planWeek.create({
            data: {
              trainingPlanId: input.id,
              weekNumber: index + 1,
              startsOn: start,
            },
          });
          for (const [position, template] of templates.entries()) {
            const day = await tx.planDay.create({
              data: {
                planWeekId: week.id,
                name: template.name,
                position: position + 1,
                weekday: template.weekday ?? null,
              },
            });
            if (start && template.weekday) {
              const date = plus(
                iso(start),
                (template.weekday - (start.getUTCDay() || 7) + 7) % 7,
              );
              await tx.scheduledActivity.create({
                data: {
                  athleteId,
                  planWeekId: week.id,
                  planDayId: day.id,
                  originalPlanDayId: day.id,
                  originalOn: date,
                  scheduledOn: date,
                  timeZone: input.timeZone,
                  title: day.name,
                },
              });
            }
          }
        }
        return { id: input.id };
      },
      { timeout: 30000 },
    );
  }
  private async scheduleNewDay(
    tx: Prisma.TransactionClient,
    athleteId: string,
    startsOn: Date | null,
    day: {
      id: string;
      planWeekId: string;
      name: string;
      weekday: number | null;
    },
    timeZone?: string,
  ) {
    if (!timeZone || !startsOn || !day.weekday) return;
    const scheduledOn = plus(
      iso(startsOn),
      (day.weekday - (startsOn.getUTCDay() || 7) + 7) % 7,
    );
    if (iso(scheduledOn) < localDate(timeZone)) return;
    await tx.scheduledActivity.create({
      data: {
        athleteId,
        planWeekId: day.planWeekId,
        planDayId: day.id,
        originalPlanDayId: day.id,
        originalOn: scheduledOn,
        scheduledOn,
        timeZone,
        title: day.name,
      },
    });
  }
  async newDay(athleteId: string, planId: string, input: NewRoutineDayDto) {
    if (input.timeZone) localDate(input.timeZone);
    return this.operation(
      athleteId,
      planId,
      input,
      'newDay',
      async (tx, plan) => {
        const week = await tx.planWeek.findFirst({
          where: { id: input.weekId, trainingPlanId: planId },
        });
        if (!week) throw new PlanningError('missing', 'Plan week not found.');
        const day = await tx.planDay.create({
          data: {
            planWeekId: week.id,
            name: input.name.trim(),
            position: input.position,
            weekday: input.weekday,
            isEditableOverride: plan.status === 'ACTIVE',
          },
        });
        await this.scheduleNewDay(
          tx,
          athleteId,
          week.startsOn,
          day,
          input.timeZone,
        );
        return { planId, dayIds: [day.id] };
      },
    );
  }
  async transition(
    athleteId: string,
    planId: string,
    input: PlanningVersionDto,
    status: 'ACTIVE' | 'ARCHIVED',
  ) {
    return this.operation(
      athleteId,
      planId,
      input,
      status,
      async (tx, plan) => {
        if (status === 'ACTIVE' && plan.status !== 'DRAFT')
          throw new PlanningError(
            'conflict',
            'Only a draft plan may be activated.',
          );
        await tx.trainingPlan.update({
          where: { id: planId },
          data: { status },
        });
        return { planId };
      },
    );
  }
  private async sourceDay(
    tx: Prisma.TransactionClient,
    athleteId: string,
    id: string,
  ) {
    const day = await tx.planDay.findFirst({
      where: { id, planWeek: { trainingPlan: { athleteId } } },
      include: {
        planWeek: true,
        exercises: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!day) throw new PlanningError('missing', 'Plan day not found.');
    return day;
  }
  private async copyExercises(
    tx: Prisma.TransactionClient,
    source: Awaited<ReturnType<PrismaFlexiblePlanningRepository['sourceDay']>>,
    target: { id: string; planWeekId: string },
    offset = 0,
  ) {
    const ids = [
      ...new Set(source.exercises.map((row) => row.exerciseId)),
    ].sort();
    if (ids.length) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM exercises WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`,
      );
      const available = await tx.exercise.count({
        where: {
          id: { in: ids },
          isActive: true,
          OR: [
            { origin: 'GLOBAL' },
            {
              origin: 'PERSONAL',
              owner: {
                athlete: {
                  id: (
                    await tx.trainingPlan.findUniqueOrThrow({
                      where: { id: source.planWeek.trainingPlanId },
                      select: { athleteId: true },
                    })
                  ).athleteId,
                },
              },
            },
          ],
        },
      });
      if (available !== ids.length)
        throw new PlanningError(
          'conflict',
          'A source exercise is inactive or unavailable.',
        );
    }
    if (offset + source.exercises.length > 1000)
      throw new PlanningError('invalid', 'Too many prescriptions.');
    for (const [index, row] of source.exercises.entries())
      await tx.planExercise.create({
        data: {
          planWeekId: target.planWeekId,
          planDayId: target.id,
          exerciseId: row.exerciseId,
          position: offset + index + 1,
          targetSets: row.targetSets,
          targetReps: row.targetReps,
          targetRepsMin: row.targetRepsMin,
          targetRepsMax: row.targetRepsMax,
          targetLoad: row.targetLoad,
          targetLoadUnit: row.targetLoadUnit,
          targetRpe: row.targetRpe,
          notes: row.notes,
        },
      });
  }
  async copy(athleteId: string, planId: string, input: CopyRoutineDto) {
    if (input.timeZone) localDate(input.timeZone);
    return this.operation(
      athleteId,
      planId,
      input,
      'copy',
      async (tx, plan) => {
        const source = await this.sourceDay(tx, athleteId, input.sourceDayId);
        if (source.planWeek.trainingPlanId !== planId)
          throw new PlanningError(
            'invalid',
            'Select a source day in this plan.',
          );
        const ids: string[] = [];
        if (input.mode === 'APPEND') {
          if (!input.targetDayId || input.weekIds)
            throw new PlanningError(
              'invalid',
              'Choose one destination day for appending.',
            );
          const target = await this.sourceDay(tx, athleteId, input.targetDayId);
          if (target.planWeek.trainingPlanId !== planId || target.retiredAt)
            throw new PlanningError('missing', 'Destination day not found.');
          await this.editable(
            tx,
            target.id,
            plan.status,
            target.isEditableOverride,
          );
          const position = Math.max(
            0,
            ...target.exercises.map((row) => row.position),
          );
          await this.copyExercises(tx, source, target, position);
          ids.push(target.id);
        } else {
          if (!input.weekIds?.length || input.targetDayId)
            throw new PlanningError(
              'invalid',
              'Choose destination weeks for new independent days.',
            );
          for (const weekId of input.weekIds) {
            const week = await tx.planWeek.findFirst({
              where: { id: weekId, trainingPlanId: planId },
            });
            if (!week)
              throw new PlanningError('missing', 'Destination week not found.');
            const last = await tx.planDay.aggregate({
              where: { planWeekId: weekId, retiredAt: null },
              _max: { position: true },
            });
            const position = (last._max.position ?? 0) + 1;
            if (position > 1000)
              throw new PlanningError('invalid', 'Day limit reached.');
            const target = await tx.planDay.create({
              data: {
                planWeekId: weekId,
                name: source.name,
                position,
                weekday: source.weekday,
                isEditableOverride: plan.status === 'ACTIVE',
              },
            });
            await this.copyExercises(tx, source, target);
            await this.scheduleNewDay(
              tx,
              athleteId,
              week.startsOn,
              target,
              input.timeZone,
            );
            ids.push(target.id);
          }
        }
        return { planId, dayIds: ids };
      },
    );
  }
  private async editable(
    tx: Prisma.TransactionClient,
    dayId: string,
    status: string,
    override: boolean,
  ) {
    if (status === 'ACTIVE' && !override)
      throw new PlanningError(
        'conflict',
        'Create an editable future copy first.',
      );
    const history = await tx.planDay.findFirst({
      where: {
        id: dayId,
        OR: [
          { workoutSessions: { some: {} } },
          {
            exercises: {
              some: {
                OR: [
                  { workoutExercises: { some: {} } },
                  { recommendations: { some: {} } },
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (history)
      throw new PlanningError(
        'conflict',
        'This programming has training history. Create a future copy.',
      );
  }
  async future(
    athleteId: string,
    planId: string,
    dayId: string,
    input: FutureRoutineDto,
    retire = false,
  ) {
    if (input.fromDate < localDate(input.timeZone))
      throw new PlanningError(
        'invalid',
        'Future programming cannot rewrite past dates.',
      );
    return this.operation(
      athleteId,
      planId,
      input,
      `${retire ? 'retire' : 'future'}:${dayId}`,
      async (tx, plan) => {
        const source = await this.sourceDay(tx, athleteId, dayId);
        if (source.planWeek.trainingPlanId !== planId || source.retiredAt)
          throw new PlanningError('missing', 'Current day not found.');
        const future = {
          planDayId: dayId,
          scheduledOn: { gte: new Date(input.fromDate) },
          workouts: { none: {} },
        };
        if (retire) {
          await tx.planDay.update({
            where: { id: dayId },
            data: {
              retiredAt: new Date(),
              retiredFromOn: new Date(input.fromDate),
            },
          });
          await tx.scheduledActivity.updateMany({
            where: future,
            data: { status: 'WITHDRAWN', version: { increment: 1 } },
          });
          return { planId, dayIds: [] };
        }
        if (
          await tx.scheduledActivity.count({
            where: {
              planDayId: dayId,
              scheduledOn: { gte: new Date(input.fromDate) },
              workouts: {
                some: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
              },
            },
          })
        )
          throw new PlanningError(
            'conflict',
            'Review the prepared or running session before changing its programming.',
          );
        await tx.planDay.update({
          where: { id: dayId },
          data: {
            retiredAt: new Date(),
            retiredFromOn: new Date(input.fromDate),
          },
        });
        const target = await tx.planDay.create({
          data: {
            planWeekId: source.planWeekId,
            name: source.name,
            position: source.position,
            weekday: source.weekday,
            isEditableOverride: plan.status === 'ACTIVE',
          },
        });
        await this.copyExercises(tx, source, target);
        await tx.scheduledActivity.updateMany({
          where: { ...future, status: { in: ['PLANNED', 'RESCHEDULED'] } },
          data: { planDayId: target.id, version: { increment: 1 } },
        });
        return { planId, dayIds: [target.id] };
      },
    );
  }
  async activities(athleteId: string, input: ActivityQueryDto) {
    localDate(input.timeZone);
    if (input.from > input.to || plus(input.from, 370) < new Date(input.to))
      throw new PlanningError('invalid', 'Choose a date range up to 370 days.');
    const activities = await this.prisma.scheduledActivity.findMany({
      where: {
        athleteId,
        timeZone: input.timeZone,
        ...(input.weekId
          ? { planWeekId: input.weekId }
          : {
              scheduledOn: {
                gte: new Date(input.from),
                lte: new Date(input.to),
              },
            }),
      },
      select: activitySelect,
      orderBy: [{ scheduledOn: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return activities.map((activity) => new ScheduledActivity(activity));
  }
  async createActivity(athleteId: string, input: CreateScheduledActivityDto) {
    localDate(input.timeZone);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM athletes WHERE id=${athleteId}::uuid FOR UPDATE`;
      const fingerprint = hash('activity', input);
      const existing = await tx.scheduledActivity.findUnique({
        where: { id: input.id },
      });
      if (existing) {
        if (
          existing.athleteId !== athleteId ||
          existing.creationRequestHash !== fingerprint
        )
          throw new PlanningError(
            'conflict',
            'Creation identifier already in use.',
          );
        return tx.scheduledActivity.findUniqueOrThrow({
          where: { id: input.id },
          select: activitySelect,
        });
      }
      if (input.planWeekId) {
        const week = await tx.planWeek.findFirst({
          where: { id: input.planWeekId, trainingPlan: { athleteId } },
          select: { trainingPlanId: true },
        });
        if (!week) throw new PlanningError('missing', 'Plan week not found.');
        const plan = await this.lock(tx, athleteId, week.trainingPlanId);
        if (!['DRAFT', 'ACTIVE'].includes(plan.status))
          throw new PlanningError('conflict', 'This plan is read-only.');
      }
      if (
        (input.status === 'REST' && input.planDayId) ||
        (input.status !== 'REST' && !input.planDayId)
      )
        throw new PlanningError(
          'invalid',
          'Rest and planned activities have different day associations.',
        );
      if (input.planDayId && !input.planWeekId)
        throw new PlanningError(
          'invalid',
          'Choose the week for the selected day.',
        );
      if (
        input.planDayId &&
        !(await tx.planDay.findFirst({
          where: {
            id: input.planDayId,
            planWeekId: input.planWeekId,
            retiredAt: null,
            planWeek: {
              trainingPlan: { athleteId, status: { in: ['DRAFT', 'ACTIVE'] } },
            },
          },
        }))
      )
        throw new PlanningError('missing', 'Plan day not found.');
      return tx.scheduledActivity.create({
        data: {
          id: input.id,
          athleteId,
          planWeekId: input.planWeekId,
          planDayId: input.planDayId,
          originalPlanDayId: input.planDayId,
          originalOn: new Date(input.scheduledOn),
          scheduledOn: new Date(input.scheduledOn),
          title: input.title.trim(),
          timeZone: input.timeZone,
          status: input.status,
          creationRequestHash: fingerprint,
        },
        select: activitySelect,
      });
    }).then((activity) => new ScheduledActivity(activity));
  }
  async updateActivity(
    athleteId: string,
    id: string,
    input: UpdateScheduledActivityDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scheduled_activities WHERE id=${id}::uuid AND athlete_id=${athleteId}::uuid FOR UPDATE`;
      const row = await tx.scheduledActivity.findFirst({
        where: { id, athleteId },
        include: {
          workouts: true,
          day: { select: { retiredAt: true, retiredFromOn: true } },
        },
      });
      if (!row)
        throw new PlanningError('missing', 'Scheduled activity not found.');
      if (row.version !== input.expectedVersion)
        throw new PlanningError(
          'conflict',
          'The activity changed. Reload before editing.',
        );
      if (
        row.workouts.some((workout) =>
          ['IN_PROGRESS', 'COMPLETED'].includes(workout.status),
        )
      )
        throw new PlanningError(
          'conflict',
          'This activity has execution history and cannot be rewritten.',
        );
      if (
        row.day?.retiredAt &&
        (!row.day.retiredFromOn ||
          new Date(input.scheduledOn ?? iso(row.scheduledOn)) >=
            row.day.retiredFromOn) &&
        (input.scheduledOn || input.status === 'PLANNED')
      )
        throw new PlanningError(
          'conflict',
          'This day is withdrawn on that date. Schedule its current copy.',
        );
      if (row.status === 'REST' && input.status)
        throw new PlanningError('invalid', 'A rest record is not a workout.');
      if (input.scheduledOn === undefined && input.status === undefined)
        throw new PlanningError('invalid', 'At least one change is required.');
      return tx.scheduledActivity.update({
        where: { id },
        data: {
          ...(input.scheduledOn
            ? {
                scheduledOn: new Date(input.scheduledOn),
                status: row.status === 'REST' ? 'REST' : 'RESCHEDULED',
              }
            : {}),
          ...(input.status ? { status: input.status } : {}),
          version: { increment: 1 },
        },
        select: activitySelect,
      });
    }).then((activity) => new ScheduledActivity(activity));
  }
}
