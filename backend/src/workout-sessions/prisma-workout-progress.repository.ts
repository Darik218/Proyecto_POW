import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  ProgressRead,
  ProgressWindow,
} from '../models/workout-sessions/workout-progress.model';
import { PROGRESS_LIMITS as limits } from '../models/workout-sessions/workout-progress.model';
import type { PerformanceHistory } from '../models/progression/performance-analysis.model';
import type { EvidenceValue } from '../models/progression/one-rm-estimate.model';
import { WorkoutProgressError } from './workout-progress.repository';
import type { WorkoutProgressRepository } from './workout-progress.repository';
const exerciseSelect = {
  id: true,
  name: true,
  resistanceType: true,
  oneRmSuitability: true,
  isActive: true,
} satisfies Prisma.ExerciseSelect;
@Injectable()
export class PrismaWorkoutProgressRepository implements WorkoutProgressRepository {
  constructor(private readonly prisma: PrismaService) {}
  async read(
    userId: string,
    sessionId: string,
    window: ProgressWindow,
    exerciseId?: string,
    planDayId?: string,
    planId?: string,
  ): Promise<ProgressRead> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const actors = await tx.$queryRaw<
          { athleteId: string }[]
        >`SELECT a.id AS "athleteId" FROM athletes a JOIN users u ON u.id=a.user_id JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=${userId}::uuid AND s.id=${sessionId}::uuid AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()`;
        const athleteId = actors[0]?.athleteId;
        if (!athleteId)
          throw new WorkoutProgressError('AUTHENTICATION_REQUIRED');
        const planSelect = {
          id: true,
          name: true,
          status: true,
        } satisfies Prisma.TrainingPlanSelect;
        const ownedPlan = planId
          ? await tx.trainingPlan.findFirst({
              where: { id: planId, athleteId },
              select: planSelect,
            })
          : null;
        if (planId && !ownedPlan)
          throw new WorkoutProgressError('SOURCE_NOT_FOUND');
        const plans = await tx.trainingPlan.findMany({
          where: { athleteId },
          select: planSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 100,
        });
        if (ownedPlan && !plans.some((plan) => plan.id === ownedPlan.id))
          plans.push(ownedPlan);
        const sessionWhere: Prisma.WorkoutSessionWhereInput = {
          athleteId,
          status: 'COMPLETED',
          performedOn: {
            not: null,
            lte: new Date(window.to),
            ...(window.from ? { gte: new Date(window.from) } : {}),
          },
        };
        const daySelect = {
          id: true,
          name: true,
          planWeek: {
            select: {
              id: true,
              weekNumber: true,
              trainingPlan: { select: { id: true, name: true } },
            },
          },
        } satisfies Prisma.PlanDaySelect;
        const ownedDay = planDayId
          ? await tx.planDay.findFirst({
              where: {
                id: planDayId,
                planWeek: {
                  ...(planId ? { trainingPlanId: planId } : {}),
                  trainingPlan: { athleteId },
                },
              },
              select: daySelect,
            })
          : null;
        if (planDayId && !ownedDay)
          throw new WorkoutProgressError('SOURCE_NOT_FOUND');
        const selectedPlanId =
          planId ?? ownedDay?.planWeek.trainingPlan.id ?? null;
        if (selectedPlanId) sessionWhere.trainingPlanId = selectedPlanId;
        const dayRows = await tx.planDay.findMany({
          where: {
            planWeek: {
              ...(selectedPlanId ? { trainingPlanId: selectedPlanId } : {}),
              trainingPlan: { athleteId },
            },
            ...(!selectedPlanId
              ? { workoutSessions: { some: sessionWhere } }
              : {}),
          },
          select: daySelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: limits.sessions,
        });
        if (ownedDay && !dayRows.some((day) => day.id === ownedDay.id))
          dayRows.push(ownedDay);
        if (planDayId) sessionWhere.planDayId = planDayId;
        const visible: Prisma.ExerciseWhereInput = {
          OR: [
            { origin: 'GLOBAL' },
            { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
          ],
        };
        const requested = exerciseId
          ? await tx.exercise.findFirst({
              where: { id: exerciseId, ...visible },
              select: exerciseSelect,
            })
          : null;
        if (exerciseId && !requested)
          throw new WorkoutProgressError('SOURCE_NOT_FOUND');
        const sessionRows = await tx.workoutSession.findMany({
          where: sessionWhere,
          orderBy: [{ performedOn: 'desc' }, { id: 'desc' }],
          take: limits.sessions + 1,
          select: { id: true, performedOn: true },
        });
        const undatedSessions = await tx.workoutSession.count({
          where: {
            athleteId,
            status: 'COMPLETED',
            performedOn: null,
            ...(planDayId ? { planDayId } : {}),
            ...(selectedPlanId ? { trainingPlanId: selectedPlanId } : {}),
          },
        });
        const options = await tx.exercise.findMany({
          where: {
            AND: [
              visible,
              {
                OR: [
                  {
                    workoutExercises: {
                      some: {
                        isOmitted: false,
                        session: sessionWhere,
                        sets: {
                          some: {
                            status: 'COMPLETED',
                            kind: 'WORK',
                            isCompleted: true,
                          },
                        },
                      },
                    },
                  },
                  ...(selectedPlanId || planDayId
                    ? [
                        {
                          planExercises: {
                            some: {
                              ...(planDayId ? { planDayId } : {}),
                              planWeek: {
                                ...(selectedPlanId
                                  ? { trainingPlanId: selectedPlanId }
                                  : {}),
                                trainingPlan: { athleteId },
                              },
                            },
                          },
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: limits.exercises + 1,
          select: exerciseSelect,
        });
        const selected = requested ?? options[0] ?? null;
        // Only real, still-unexecuted calendar occurrences prepare the next session.
        // Never invent dates from a plan title, weekday, or another plan's history.
        const nextWhere = {
          athleteId,
          status: { in: ['PLANNED', 'RESCHEDULED'] },
          scheduledOn: { gte: new Date(window.to) },
          ...(planDayId ? { planDayId } : {}),
          day: {
            retiredAt: null,
            retiredFromOn: null,
            planWeek: {
              ...(selectedPlanId ? { trainingPlanId: selectedPlanId } : {}),
              trainingPlan: { athleteId, status: 'ACTIVE' },
            },
            ...(selected
              ? { exercises: { some: { exerciseId: selected.id } } }
              : {}),
          },
          workouts: {
            none: { status: { in: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] } },
          },
        } satisfies Prisma.ScheduledActivityWhereInput;
        const nextSelect = {
          id: true,
          planDayId: true,
          planWeekId: true,
          scheduledOn: true,
          timeZone: true,
          title: true,
          day: { select: { planWeek: { select: { trainingPlanId: true } } } },
        } satisfies Prisma.ScheduledActivitySelect;
        let next = await tx.scheduledActivity.findFirst({
          where: nextWhere,
          select: nextSelect,
          orderBy: [{ scheduledOn: 'asc' }, { id: 'asc' }],
        });
        if (!next && planDayId && selected) {
          // A later week/day has its own identity. Link the next real occurrence
          // of the selected exercise without mixing its results into this graph.
          const { planDayId: _exactDay, ...samePlanExercise } = nextWhere;
          next = await tx.scheduledActivity.findFirst({
            where: samePlanExercise,
            select: nextSelect,
            orderBy: [{ scheduledOn: 'asc' }, { id: 'asc' }],
          });
        }
        const exercises = options.slice(0, limits.exercises);
        if (selected && !exercises.some((e) => e.id === selected.id))
          exercises.push(selected);
        let history: PerformanceHistory | null = null;
        if (selected) {
          const tasks = await tx.workoutExercise.findMany({
            where: {
              exerciseId: selected.id,
              isOmitted: false,
              session: sessionWhere,
              exercise: visible,
            },
            orderBy: [
              { session: { performedOn: 'desc' } },
              { sessionId: 'desc' },
              { orderInSession: 'desc' },
              { id: 'desc' },
            ],
            take: limits.tasks + 1,
            select: {
              id: true,
              exerciseId: true,
              orderInSession: true,
              isOmitted: true,
              originalSnapshot: true,
              _count: { select: { sets: true } },
              session: {
                select: {
                  id: true,
                  athleteId: true,
                  version: true,
                  status: true,
                  performedOn: true,
                  timeZone: true,
                },
              },
            },
          });
          const selectedTasks = tasks.slice(0, limits.tasks).filter((t) => {
            const original = t.originalSnapshot as {
              exercise?: { id?: unknown };
            } | null;
            return (
              !original?.exercise?.id || original.exercise.id === selected.id
            );
          });
          const sets = await tx.setRecord.findMany({
            where: {
              workoutExerciseId: { in: selectedTasks.map((t) => t.id) },
              status: 'COMPLETED',
              kind: 'WORK',
              isCompleted: true,
              workoutExercise: {
                exerciseId: selected.id,
                isOmitted: false,
                session: sessionWhere,
                exercise: visible,
              },
            },
            orderBy: [
              { workoutExerciseId: 'asc' },
              { setNumber: 'asc' },
              { id: 'asc' },
            ],
            take: limits.sets + 1,
            select: {
              id: true,
              workoutExerciseId: true,
              setNumber: true,
              version: true,
              status: true,
              kind: true,
              isCompleted: true,
              load: true,
              loadUnit: true,
              loadKg: true,
              repetitions: true,
              rpe: true,
              recordedAt: true,
            },
          });
          const selectedSets = sets.slice(0, limits.sets);
          const estimates = await tx.oneRmEstimate.findMany({
            where: {
              athleteId,
              exerciseId: selected.id,
              sourceSetId: { in: selectedSets.map((s) => s.id) },
            },
            orderBy: { id: 'asc' },
            take: limits.estimates + 1,
          });
          history = {
            athleteId,
            userId,
            exerciseId: selected.id,
            exerciseIsActive: selected.isActive,
            tasks: selectedTasks.map((t) => ({
              id: t.id,
              athleteId: t.session.athleteId,
              exerciseId: t.exerciseId,
              sessionId: t.session.id,
              sessionVersion: t.session.version,
              sessionStatus: t.session.status,
              orderInSession: t.orderInSession,
              isOmitted: t.isOmitted,
              performedOn:
                t.session.performedOn?.toISOString().slice(0, 10) ?? null,
              timeZone: t.session.timeZone,
              availableSets: t._count.sets,
              originalTargets: null,
              adjustedTargets: {
                targetSets: null,
                targetRepsMin: null,
                targetRepsMax: null,
                targetLoad: null,
                targetLoadUnit: null,
                targetRpe: null,
              },
            })),
            sets: selectedSets.map((s) => ({
              ...s,
              load: s.load?.toString() ?? null,
              loadKg: s.loadKg?.toString() ?? null,
              rpe: s.rpe?.toString() ?? null,
              recordedAt: s.recordedAt.toISOString(),
            })),
            estimates: estimates.slice(0, limits.estimates).map((e) => ({
              id: e.id,
              athleteId: e.athleteId,
              exerciseId: e.exerciseId,
              sourceSetId: e.sourceSetId,
              sourceSetVersion: e.sourceSetVersion,
              formula: e.formula,
              algorithmVersion: e.algorithmVersion,
              eligibilityVersion: e.eligibilityVersion,
              estimateKind: e.estimateKind,
              inputLoad: e.inputLoad.toString(),
              inputLoadUnit: e.inputLoadUnit,
              inputLoadKg: e.inputLoadKg?.toString() ?? null,
              inputReps: e.inputReps,
              result: e.estimatedOneRm.toString(),
              resultUnit: e.resultUnit,
              calculationKey: e.calculationKey,
              calculatedAt: e.calculatedAt.toISOString(),
              snapshot: e.snapshot as EvidenceValue,
            })),
            truncated: {
              tasks: tasks.length > limits.tasks,
              sets: sets.length > limits.sets,
              estimates: estimates.length > limits.estimates,
            },
          };
        }
        return {
          plans,
          selectedPlanId,
          nextSession:
            next?.day && next.planDayId && next.planWeekId
              ? {
                  activityId: next.id,
                  planId: next.day.planWeek.trainingPlanId,
                  planWeekId: next.planWeekId,
                  planDayId: next.planDayId,
                  performedOn: next.scheduledOn.toISOString().slice(0, 10),
                  timeZone: next.timeZone,
                  title: next.title,
                }
              : null,
          selectedPlanDayId: planDayId ?? null,
          planDays: dayRows.map((day) => ({
            id: day.id,
            name: day.name,
            planName: day.planWeek.trainingPlan.name,
            planId: day.planWeek.trainingPlan.id,
            weekId: day.planWeek.id,
            weekNumber: day.planWeek.weekNumber,
          })),
          sessions: sessionRows.slice(0, limits.sessions).map((s) => ({
            id: s.id,
            performedOn: s.performedOn!.toISOString().slice(0, 10),
          })),
          exercises: exercises.map((e) => ({
            id: e.id,
            name: e.name,
            resistanceType: e.resistanceType,
            oneRmSuitability: e.oneRmSuitability,
          })),
          selectedExerciseId: selected?.id ?? null,
          undatedSessions,
          history,
          truncated: {
            sessions: sessionRows.length > limits.sessions,
            exercises: options.length > limits.exercises,
            tasks: history?.truncated.tasks ?? false,
            sets: history?.truncated.sets ?? false,
            estimates: history?.truncated.estimates ?? false,
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
