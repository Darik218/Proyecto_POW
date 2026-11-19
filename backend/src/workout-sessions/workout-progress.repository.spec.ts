import { jest } from '@jest/globals';
import { PrismaWorkoutProgressRepository } from './prisma-workout-progress.repository';
import type { PrismaService } from '../database/prisma.service';
const athleteId = '60000000-0000-4000-8000-000000000001';
function repo(active = true, visible = true) {
  const tx = {
    trainingPlan: { findFirst: async () => null, findMany: async () => [] },
    scheduledActivity: { findFirst: async () => null },
    planDay: { findFirst: async () => null, findMany: async () => [] },
    $executeRaw: jest
      .fn<(...args: unknown[]) => Promise<number>>()
      .mockResolvedValue(0),
    $queryRaw: jest
      .fn<(...args: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValue(active ? [{ athleteId }] : []),
    workoutSession: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValue([{ id: 's', performedOn: new Date('2026-11-17') }]),
      count: jest
        .fn<(...args: unknown[]) => Promise<number>>()
        .mockResolvedValue(0),
    },
    exercise: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValue([]),
      findFirst: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(
          visible
            ? {
                id: 'e',
                name: 'Press',
                resistanceType: 'WEIGHT_STACK',
                oneRmSuitability: 'NOT_SUITABLE',
                isActive: true,
              }
            : null,
        ),
    },
    workoutExercise: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    setRecord: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    oneRmEstimate: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  return {
    tx,
    repository: new PrismaWorkoutProgressRepository(
      prisma as unknown as PrismaService,
    ),
  };
}
describe('Completed progress read boundaries', () => {
  it('rejects a foreign plan before reading any workout history or scheduled preparations', async () => {
    const { repository, tx } = repo();
    (tx as Record<string, unknown>).trainingPlan = {
      findFirst: async () => null,
    };
    await expect(
      repository.read(
        'user',
        'session',
        { period: 'all', from: null, to: '2026-11-18' },
        undefined,
        undefined,
        'foreign-plan',
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(tx.workoutSession.findMany).not.toHaveBeenCalled();
  });
  it('rejects a plan day that does not belong to the authenticated athlete', async () => {
    const { repository, tx } = repo();
    (tx as Record<string, unknown>).planDay = { findFirst: async () => null };
    await expect(
      repository.read(
        'user',
        'session',
        { period: 'all', from: null, to: '2026-11-17' },
        undefined,
        'foreign-day',
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(tx.setRecord.findMany).not.toHaveBeenCalled();
  });
  it('rejects expired/revoked actors before any result read', async () => {
    const { repository, tx } = repo(false);
    await expect(
      repository.read('user', 'session', {
        period: '30',
        from: '2026-10-19',
        to: '2026-11-17',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(tx.workoutSession.findMany).not.toHaveBeenCalled();
  });
  it('reads a bounded completed date window scoped to the actor and keeps frequency independent of selected exercise', async () => {
    const { repository, tx } = repo();
    const result = await repository.read(
      'user',
      'session',
      { period: '7', from: '2026-11-11', to: '2026-11-17' },
      'e',
    );
    expect(result.sessions).toEqual([{ id: 's', performedOn: '2026-11-17' }]);
    expect(tx.workoutSession.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        athleteId,
        status: 'COMPLETED',
        performedOn: {
          gte: new Date('2026-11-11'),
          lte: new Date('2026-11-17'),
        },
      },
      take: 501,
    });
    expect(tx.workoutExercise.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        exerciseId: 'e',
        isOmitted: false,
        session: { athleteId, status: 'COMPLETED' },
      },
      take: 101,
    });
  });
  it('hides foreign exercise IDs before reading their work sets', async () => {
    const { repository, tx } = repo(true, false);
    await expect(
      repository.read(
        'user',
        'session',
        { period: 'all', from: null, to: '2026-11-17' },
        'foreign',
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(tx.setRecord.findMany).not.toHaveBeenCalled();
    expect(tx.exercise.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'foreign',
        OR: [
          { origin: 'GLOBAL' },
          { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
        ],
      },
    });
  });
});
