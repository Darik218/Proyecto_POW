import { jest } from '@jest/globals';
import { PrismaWorkoutSessionsRepository } from './prisma-workout-sessions.repository';
import type { PrismaService } from '../database/prisma.service';
import { WorkoutRepositoryError } from './workout-sessions.repository';
import { insightFixture } from '../../test/fixtures/workout-insights.fixture';

const athleteId = '60000000-0000-4000-8000-000000000001';
const exerciseId = insightFixture().attributes.exercises[0].exercise.id;
function row(ownerId = athleteId) {
  const session = insightFixture().attributes;
  const item = session.exercises[0];
  return {
    ...session,
    _count: { exercises: 1 },
    exercises: [
      {
        ...item,
        originalSnapshot: null,
        planExercise: null,
        targetSets: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetLoad: null,
        targetLoadUnit: null,
        targetRpe: null,
        exercise: {
          ...item.exercise,
          primaryMuscleGroup: { name: 'Pecho' },
          origin: 'PERSONAL',
          oneRmSuitability: 'SUITABLE',
          owner: { athlete: { id: ownerId } },
        },
      },
    ],
  };
}
function repository(
  result: ReturnType<typeof row> | null = null,
  visible = true,
) {
  const findSession = jest
    .fn<(...args: unknown[]) => Promise<typeof result>>()
    .mockResolvedValue(result);
  const findExercise = jest
    .fn<(...args: unknown[]) => Promise<{ id: string } | null>>()
    .mockResolvedValue(visible ? { id: exerciseId } : null);
  const tx = {
    workoutSession: { findFirst: findSession },
    exercise: { findFirst: findExercise },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  return {
    service: new PrismaWorkoutSessionsRepository(
      prisma as unknown as PrismaService,
    ),
    findSession,
    findExercise,
  };
}
describe('Workout insight reference repository boundaries', () => {
  it('scopes reference reads to the authenticated athlete, completed actual work and strictly earlier training dates', async () => {
    const { service, findSession, findExercise } = repository();
    await expect(
      service.lastExerciseReference(athleteId, exerciseId, '2026-11-12'),
    ).resolves.toBeNull();
    expect(findExercise.mock.calls[0][0]).toMatchObject({
      where: {
        id: exerciseId,
        OR: [
          { origin: 'GLOBAL' },
          { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
        ],
      },
    });
    expect(findSession.mock.calls[0][0]).toMatchObject({
      where: {
        athleteId,
        status: 'COMPLETED',
        performedOn: { lt: new Date('2026-11-12') },
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
    });
  });
  it('hides a missing or foreign personal exercise before reading its workout history', async () => {
    const { service, findSession } = repository(null, false);
    await expect(
      service.lastExerciseReference(athleteId, exerciseId),
    ).rejects.toMatchObject({ kind: 'missing' });
    expect(findSession).not.toHaveBeenCalled();
  });
  it('retains raw Decimal results, suitability and original identity in the domain model', async () => {
    const { service } = repository(row());
    const result = await service.lastExerciseReference(athleteId, exerciseId);
    expect(result?.attributes.exercises[0]).toMatchObject({
      oneRmSuitability: 'SUITABLE',
      exercise: { id: exerciseId, name: 'Press' },
    });
    expect(result?.attributes.exercises[0].sets![0].load?.toString()).toBe(
      '60',
    );
  });
  it('rechecks origin ownership in the reference result and current session graph', async () => {
    const { service } = repository(row('foreign-athlete'));
    await expect(
      service.lastExerciseReference(athleteId, exerciseId),
    ).rejects.toBeInstanceOf(WorkoutRepositoryError);
    await expect(
      service.get(athleteId, insightFixture().attributes.id),
    ).rejects.toMatchObject({ kind: 'missing' });
  });
});
