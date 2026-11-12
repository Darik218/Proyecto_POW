import type { Prisma } from '../generated/prisma/client';
import { protect } from './prisma-daily-planning.repository';
import { PlanningError } from './daily-planning.policy';
export async function applyExactPrescriptionLoad(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    athleteId: string;
    planId: string;
    weekId: string;
    dayId: string;
    prescriptionId: string;
    exerciseId: string;
    version: number;
    previousLoad: string;
    appliedLoad: string;
    unit: 'KG' | 'LB';
  }>,
) {
  const row = await tx.planExercise.findFirst({
    where: {
      id: input.prescriptionId,
      exerciseId: input.exerciseId,
      planWeekId: input.weekId,
      planDayId: input.dayId,
      planWeek: {
        trainingPlanId: input.planId,
        trainingPlan: {
          athleteId: input.athleteId,
          status: 'DRAFT',
          version: input.version,
        },
      },
    },
    select: {
      _count: { select: { workoutExercises: true, recommendations: true } },
      planDay: {
        select: {
          retiredAt: true,
          _count: { select: { workoutSessions: true } },
        },
      },
    },
  });
  if (
    !row ||
    !row.planDay ||
    row.planDay.retiredAt ||
    row.planDay._count.workoutSessions
  )
    throw new PlanningError(
      'conflict',
      'The authorized prescription is no longer editable.',
    );
  protect([row]);
  const updated = await tx.planExercise.updateMany({
    where: {
      id: input.prescriptionId,
      exerciseId: input.exerciseId,
      planWeekId: input.weekId,
      planDayId: input.dayId,
      targetLoad: input.previousLoad,
      targetLoadUnit: input.unit,
    },
    data: { targetLoad: input.appliedLoad },
  });
  if (updated.count !== 1)
    throw new PlanningError('conflict', 'The authorized baseline changed.');
  const version = await tx.trainingPlan.updateMany({
    where: {
      id: input.planId,
      athleteId: input.athleteId,
      status: 'DRAFT',
      version: input.version,
    },
    data: { version: { increment: 1 } },
  });
  if (version.count !== 1)
    throw new PlanningError('conflict', 'The plan version changed.');
}
