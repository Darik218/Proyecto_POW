import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreateWorkoutSessionDto, AddWorkoutExerciseDto, ListWorkoutSessionsDto } from './dto/workout-session.dto';
import { WorkoutRepositoryError } from './workout-sessions.repository';
import type { WorkoutDetail, WorkoutSessionsRepository, WorkoutSummary } from './workout-sessions.repository';
import { requireInProgress, sessionTransition } from './workout-session.policy';

const summarySelect = {
  id: true, status: true, startedAt: true, finishedAt: true, notes: true, createdAt: true, updatedAt: true,
  trainingPlan: { select: { id: true, name: true } }, planWeek: { select: { id: true, weekNumber: true } },
  _count: { select: { exercises: true } },
} satisfies Prisma.WorkoutSessionSelect;
const detailSelect = {
  ...summarySelect,
  exercises: {
    orderBy: [{ orderInSession: 'asc' }, { id: 'asc' }],
    select: {
      id: true, orderInSession: true, notes: true,
      exercise: { select: { id: true, name: true, equipment: true, primaryMuscleGroup: { select: { name: true } }, origin: true, owner: { select: { athlete: { select: { id: true } } } } } },
      planExercise: { select: { id: true, targetSets: true, targetReps: true, targetRepsMin: true, targetRepsMax: true, targetLoadUnit: true, targetRpe: true, targetLoad: true, notes: true } },
    },
  },
} satisfies Prisma.WorkoutSessionSelect;
type SummaryRow = Prisma.WorkoutSessionGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.WorkoutSessionGetPayload<{ select: typeof detailSelect }>;
function summary(row: SummaryRow): WorkoutSummary { const { _count, ...fields } = row; return { ...fields, exerciseCount: _count.exercises }; }
function detail(row: DetailRow, athleteId: string): WorkoutDetail {
  return { ...summary(row), exercises: row.exercises.map(({ exercise, planExercise, ...fields }) => {
    const { primaryMuscleGroup, origin, owner, ...catalog } = exercise;
    if (origin === 'PERSONAL' && owner?.athlete?.id !== athleteId) {
      throw new WorkoutRepositoryError('missing', 'Workout session contains an unavailable private resource.');
    }
    return {
      ...fields, exercise: { ...catalog, muscleGroup: primaryMuscleGroup.name },
      prescription: planExercise ? { ...planExercise, targetRpe: planExercise.targetRpe === null ? null : Number(planExercise.targetRpe), targetLoad: planExercise.targetLoad === null ? null : Number(planExercise.targetLoad) } : null,
    };
  }) };
}

@Injectable()
export class PrismaWorkoutSessionsRepository implements WorkoutSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(athleteId: string, query: ListWorkoutSessionsDto) {
    const where: Prisma.WorkoutSessionWhereInput = { athleteId, ...(query.status ? { status: query.status } : {}), ...(query.trainingPlanId ? { trainingPlanId: query.trainingPlanId } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workoutSession.findMany({ where, select: summarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: query.offset }),
      this.prisma.workoutSession.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: rows.map(summary), total, limit: query.limit, offset: query.offset };
  }
  async get(athleteId: string, id: string): Promise<WorkoutDetail | null> {
    const row = await this.prisma.workoutSession.findFirst({ where: { id, athleteId }, select: detailSelect });
    return row ? detail(row, athleteId) : null;
  }
  private async read(tx: Prisma.TransactionClient, athleteId: string, id: string): Promise<WorkoutDetail> {
    const row = await tx.workoutSession.findFirst({ where: { id, athleteId }, select: detailSelect });
    if (!row) throw new WorkoutRepositoryError('missing', 'Workout session not found.');
    return detail(row, athleteId);
  }
  private async lockSession(tx: Prisma.TransactionClient, athleteId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workout_sessions WHERE id = ${id}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
    if (!rows.length) throw new WorkoutRepositoryError('missing', 'Workout session not found.');
  }
  private async visibleExercise(tx: Prisma.TransactionClient, athleteId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM exercises WHERE id = ${id}::uuid FOR SHARE`;
    return tx.exercise.findFirst({ where: { id, isActive: true, OR: [{ origin: 'GLOBAL' }, { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } }] }, select: { id: true } });
  }
  async create(athleteId: string, input: CreateWorkoutSessionDto): Promise<WorkoutDetail> {
    return this.prisma.$transaction(async tx => {
      // Serializes retries of one creation intent without limiting distinct sessions.
      await tx.$queryRaw`SELECT id FROM athletes WHERE id = ${athleteId}::uuid FOR UPDATE`;
      const existing = await tx.workoutSession.findUnique({ where: { id: input.id }, select: { athleteId: true, trainingPlanId: true, planWeekId: true, notes: true } });
      if (existing) {
        if (existing.athleteId !== athleteId || existing.trainingPlanId !== (input.trainingPlanId ?? null) || existing.planWeekId !== (input.planWeekId ?? null) || existing.notes !== (input.notes ?? null)) {
          throw new WorkoutRepositoryError('conflict', 'This creation identifier is already in use.');
        }
        return this.read(tx, athleteId, input.id);
      }
      let prescribed: Array<{ id: string; exerciseId: string; position: number; notes: string | null }> = [];
      if (input.trainingPlanId) {
        await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${input.trainingPlanId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
        const week = await tx.planWeek.findFirst({
          where: { id: input.planWeekId, trainingPlanId: input.trainingPlanId, trainingPlan: { athleteId } },
          select: { trainingPlan: { select: { status: true } }, planExercises: { select: { id: true, exerciseId: true, position: true, notes: true, planDay: { select: { position: true } } }, orderBy: { position: 'asc' } } },
        });
        if (!week) throw new WorkoutRepositoryError('missing', 'Training plan or week not found.');
        if (!['DRAFT', 'ACTIVE'].includes(week.trainingPlan.status)) throw new WorkoutRepositoryError('conflict', 'Only draft or active plans can start a session.');
        // R1 compatibility: keep the weekly import until R2 introduces day selection.
        prescribed = [...week.planExercises].sort((a, b) => (a.planDay?.position ?? 0) - (b.planDay?.position ?? 0) || a.position - b.position || a.id.localeCompare(b.id));
        for (const exerciseId of [...new Set(prescribed.map(item => item.exerciseId))].sort()) {
          if (!await this.visibleExercise(tx, athleteId, exerciseId)) throw new WorkoutRepositoryError('conflict', 'A prescribed exercise is inactive or unavailable.');
        }
      }
      await tx.workoutSession.create({ data: {
        id: input.id, athleteId, trainingPlanId: input.trainingPlanId ?? null, planWeekId: input.planWeekId ?? null,
        status: 'IN_PROGRESS', startedAt: new Date(), notes: input.notes ?? null,
        exercises: { create: prescribed.map((item, index) => ({ exerciseId: item.exerciseId, planExerciseId: item.id, orderInSession: index + 1, notes: item.notes })) },
      } });
      return this.read(tx, athleteId, input.id);
    });
  }
  async addExercise(athleteId: string, id: string, input: AddWorkoutExerciseDto): Promise<WorkoutDetail> {
    return this.prisma.$transaction(async tx => {
      await this.lockSession(tx, athleteId, id);
      const existing = await tx.workoutExercise.findUnique({ where: { id: input.id }, select: { sessionId: true, exerciseId: true, notes: true } });
      if (existing) {
        if (existing.sessionId !== id || existing.exerciseId !== input.exerciseId || existing.notes !== (input.notes ?? null)) throw new WorkoutRepositoryError('conflict', 'This exercise creation identifier is already in use.');
        return this.read(tx, athleteId, id);
      }
      const session = await tx.workoutSession.findUniqueOrThrow({ where: { id }, select: { status: true } });
      requireInProgress(session.status);
      if (!await this.visibleExercise(tx, athleteId, input.exerciseId)) throw new WorkoutRepositoryError('missing', 'Exercise not found or unavailable.');
      const last = await tx.workoutExercise.aggregate({ where: { sessionId: id }, _max: { orderInSession: true } });
      await tx.workoutExercise.create({ data: { id: input.id, sessionId: id, exerciseId: input.exerciseId, orderInSession: (last._max.orderInSession ?? 0) + 1, notes: input.notes ?? null } });
      return this.read(tx, athleteId, id);
    });
  }
  private async transition(athleteId: string, id: string, action: 'start' | 'complete'): Promise<WorkoutDetail> {
    return this.prisma.$transaction(async tx => {
      await this.lockSession(tx, athleteId, id);
      const session = await this.read(tx, athleteId, id);
      const update = sessionTransition(session, action, session.exerciseCount, new Date());
      if (update?.status === 'IN_PROGRESS') {
        if (session.trainingPlan) {
          await tx.$queryRaw`SELECT id FROM training_plans WHERE id = ${session.trainingPlan.id}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
          const source = await tx.trainingPlan.findFirst({ where: { id: session.trainingPlan.id, athleteId, status: { in: ['DRAFT', 'ACTIVE'] } }, select: { id: true } });
          if (!source) throw new WorkoutRepositoryError('conflict', 'The source plan is no longer available for starting a session.');
        }
        for (const exerciseId of [...new Set(session.exercises.map(item => item.exercise.id))].sort()) {
          if (!await this.visibleExercise(tx, athleteId, exerciseId)) throw new WorkoutRepositoryError('conflict', 'A session exercise is inactive or unavailable.');
        }
      }
      if (update) await tx.workoutSession.update({ where: { id }, data: update });
      return this.read(tx, athleteId, id);
    });
  }
  start(athleteId: string, id: string) { return this.transition(athleteId, id, 'start'); }
  complete(athleteId: string, id: string) { return this.transition(athleteId, id, 'complete'); }
}
