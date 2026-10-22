import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  NewPlan,
  NewPrescription,
  NewWeek,
  PlanDetail,
  PlanSummary,
  PlanUpdate,
  PrescriptionUpdate,
  TrainingPlansRepository,
  WeekUpdate,
} from './training-plans.repository';

const planSelect = {
  id: true,
  name: true,
  startsOn: true,
  endsOn: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const detailSelect = {
  ...planSelect,
  weeks: {
    orderBy: { weekNumber: 'asc' as const },
    select: {
      id: true,
      weekNumber: true,
      objective: true,
      planExercises: {
        orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
        select: {
          id: true,
          position: true,
          targetSets: true,
          targetReps: true,
          targetRpe: true,
          targetLoad: true,
          notes: true,
          exercise: {
            select: { id: true, name: true, muscleGroup: true, equipment: true, description: true },
          },
        },
      },
    },
  },
} satisfies Prisma.TrainingPlanSelect;

@Injectable()
export class PrismaTrainingPlansRepository implements TrainingPlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAthleteId(userId: string): Promise<string | null> {
    const athlete = await this.prisma.athlete.findUnique({
      where: { userId },
      select: { id: true },
    });
    return athlete?.id ?? null;
  }

  list(athleteId: string): Promise<PlanSummary[]> {
    return this.prisma.trainingPlan.findMany({
      where: { athleteId },
      orderBy: [{ startsOn: 'desc' }, { id: 'desc' }],
      select: planSelect,
    });
  }

  async findById(athleteId: string, planId: string): Promise<PlanDetail | null> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { id: planId, athleteId },
      select: detailSelect,
    });
    if (!plan) return null;
    return {
      ...plan,
      weeks: plan.weeks.map(({ planExercises, ...week }) => ({
        ...week,
        exercises: planExercises.map((exercise) => ({
          ...exercise,
          targetRpe: exercise.targetRpe === null ? null : Number(exercise.targetRpe),
          targetLoad: exercise.targetLoad === null ? null : Number(exercise.targetLoad),
        })),
      })),
    };
  }

  create(athleteId: string, input: NewPlan): Promise<PlanSummary> {
    return this.prisma.trainingPlan.create({
      data: { athleteId, ...input },
      select: planSelect,
    });
  }

  async update(athleteId: string, planId: string, input: PlanUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.trainingPlan.findFirst({
        where: { id: planId, athleteId, status: 'DRAFT' },
        select: {
          id: true,
          workoutSessions: { select: { id: true }, take: 1 },
          weeks: {
            select: {
              recommendations: { select: { id: true }, take: 1 },
              planExercises: {
                where: { OR: [{ workoutExercises: { some: {} } }, { recommendations: { some: {} } }] },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!plan) return null;
      if (
        plan.workoutSessions.length ||
        plan.weeks.some((week) => week.recommendations.length || week.planExercises.length)
      ) return 'historical' as const;
      return tx.trainingPlan.update({ where: { id: plan.id }, data: input, select: planSelect });
    });
  }

  async createWeek(athleteId: string, planId: string, input: NewWeek) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.trainingPlan.findFirst({
        where: { id: planId, athleteId, status: 'DRAFT' },
        select: { id: true },
      });
      if (!plan) return null;
      return tx.planWeek.create({
        data: { trainingPlanId: plan.id, ...input },
        select: { id: true, weekNumber: true, objective: true },
      });
    });
  }

  async updateWeek(athleteId: string, planId: string, weekId: string, input: WeekUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.planWeek.findFirst({
        where: { id: weekId, trainingPlanId: planId, trainingPlan: { athleteId, status: 'DRAFT' } },
        select: {
          id: true,
          workoutSessions: { select: { id: true }, take: 1 },
          recommendations: { select: { id: true }, take: 1 },
          planExercises: {
            where: { OR: [{ workoutExercises: { some: {} } }, { recommendations: { some: {} } }] },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!week) return null;
      if (week.workoutSessions.length || week.recommendations.length || week.planExercises.length) return 'historical' as const;
      return tx.planWeek.update({
        where: { id: week.id },
        data: input,
        select: { id: true, weekNumber: true, objective: true },
      });
    });
  }

  async createPrescription(athleteId: string, planId: string, weekId: string, input: NewPrescription) {
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.planWeek.findFirst({
        where: { id: weekId, trainingPlanId: planId, trainingPlan: { athleteId, status: 'DRAFT' } },
        select: { id: true },
      });
      if (!week) return null;
      const exercise = await tx.exercise.findFirst({
        where: { id: input.exerciseId, isActive: true },
        select: { id: true, name: true, muscleGroup: true, equipment: true, description: true },
      });
      if (!exercise) return null;
      const { exerciseId, ...values } = input;
      const created = await tx.planExercise.create({
        data: { planWeekId: week.id, exerciseId, ...values },
        select: { id: true, position: true, targetSets: true, targetReps: true, targetRpe: true, targetLoad: true, notes: true },
      });
      return {
        ...created,
        targetRpe: created.targetRpe === null ? null : Number(created.targetRpe),
        targetLoad: created.targetLoad === null ? null : Number(created.targetLoad),
        exercise,
      };
    });
  }

  async updatePrescription(athleteId: string, planId: string, weekId: string, prescriptionId: string, input: PrescriptionUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const prescription = await tx.planExercise.findFirst({
        where: { id: prescriptionId, planWeekId: weekId, planWeek: { trainingPlanId: planId, trainingPlan: { athleteId, status: 'DRAFT' } } },
        select: {
          id: true,
          workoutExercises: { select: { id: true }, take: 1 },
          recommendations: { select: { id: true }, take: 1 },
        },
      });
      if (!prescription) return null;
      if (prescription.workoutExercises.length || prescription.recommendations.length) return 'historical' as const;
      const updated = await tx.planExercise.update({
        where: { id: prescription.id },
        data: input,
        select: { id: true, position: true, targetSets: true, targetReps: true, targetRpe: true, targetLoad: true, notes: true, exercise: { select: { id: true, name: true, muscleGroup: true, equipment: true, description: true } } },
      });
      return { ...updated, targetRpe: updated.targetRpe === null ? null : Number(updated.targetRpe), targetLoad: updated.targetLoad === null ? null : Number(updated.targetLoad) };
    });
  }

  async removePrescription(athleteId: string, planId: string, weekId: string, prescriptionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const prescription = await tx.planExercise.findFirst({
        where: { id: prescriptionId, planWeekId: weekId, planWeek: { trainingPlanId: planId, trainingPlan: { athleteId, status: 'DRAFT' } } },
        select: { id: true },
      });
      if (!prescription) return 'missing' as const;
      const historical = await tx.planExercise.findFirst({
        where: { id: prescription.id, OR: [{ workoutExercises: { some: {} } }, { recommendations: { some: {} } }] },
        select: { id: true },
      });
      if (historical) return 'historical' as const;
      await tx.planExercise.delete({ where: { id: prescription.id } });
      return 'removed' as const;
    });
  }
}
