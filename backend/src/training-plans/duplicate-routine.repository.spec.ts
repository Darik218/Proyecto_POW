import { jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaFlexiblePlanningRepository } from './prisma-flexible-planning.repository';
import type { PrismaService } from '../database/prisma.service';

const sourceId = '10000000-0000-4000-8000-000000000001';
const targetId = '20000000-0000-4000-8000-000000000001';
const athleteId = '30000000-0000-4000-8000-000000000001';
const command = {
  id: targetId,
  expectedVersion: 4,
  name: 'Rutina independiente',
};
const prescription = (exerciseId: string, position: number) => ({
  id: 'old-prescription',
  exerciseId,
  position,
  targetSets: 3,
  targetReps: null,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetLoad: new Decimal('60.125'),
  targetLoadUnit: 'LB',
  targetRpe: new Decimal('8.5'),
  notes: 'Objetivo original',
});
function harness() {
  const rows = [
    {
      id: 'old-week-1',
      weekNumber: 1,
      objective: 'Volumen',
      startsOn: new Date(),
      days: [
        {
          id: 'old-day-1',
          name: 'Push',
          position: 2,
          weekday: 1,
          isEditableOverride: true,
          sourceWorkoutSessionId: 'history',
          exercises: [prescription('z-exercise', 5)],
        },
      ],
      planExercises: [
        {
          ...prescription('a-exercise', 2),
          targetLoadUnit: null,
          targetReps: 8,
          targetRepsMin: null,
          targetRepsMax: null,
        },
      ],
    },
    {
      id: 'old-week-2',
      weekNumber: 3,
      objective: null,
      startsOn: new Date(),
      days: [
        {
          id: 'old-day-2',
          name: 'Legs diferente',
          position: 7,
          weekday: null,
          exercises: [
            {
              ...prescription('a-exercise', 9),
              targetLoad: null,
              targetLoadUnit: null,
              targetRpe: null,
              notes: null,
            },
          ],
        },
      ],
      planExercises: [],
    },
  ];
  const source = { id: sourceId, athleteId, version: 4, status: 'ACTIVE' };
  const findSource = jest
    .fn<(...args: unknown[]) => Promise<typeof source | null>>()
    .mockResolvedValue(source);
  const findPrevious = jest
    .fn<
      (...args: unknown[]) => Promise<{
        id: string;
        athleteId: string;
        creationRequestHash: string;
      } | null>
    >()
    .mockResolvedValue(null);
  const createPlan = jest
    .fn<(query: { data: Record<string, unknown> }) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: targetId });
  const createWeek = jest.fn(
    async (query: { data: Record<string, unknown> }) => ({
      id: `new-week-${String(query.data.weekNumber)}`,
    }),
  );
  let dayCount = 0;
  const createDay = jest.fn(
    async (_query: { data: Record<string, unknown> }) => ({
      id: `new-day-${++dayCount}`,
    }),
  );
  const createPrescription = jest.fn(
    async (_query: { data: Record<string, unknown> }) => ({
      id: 'new-prescription',
    }),
  );
  const findWeeks = jest
    .fn<(...args: unknown[]) => Promise<typeof rows>>()
    .mockResolvedValue(rows);
  const findExercise = jest
    .fn<(...args: unknown[]) => Promise<{ id: string } | null>>()
    .mockResolvedValue({ id: 'visible' });
  const lock = jest
    .fn<(...args: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const update = jest.fn();
  const tx = {
    $queryRaw: lock,
    trainingPlan: {
      findFirst: findSource,
      findUnique: findPrevious,
      create: createPlan,
      update,
    },
    planWeek: { findMany: findWeeks, create: createWeek },
    planDay: { create: createDay },
    planExercise: { create: createPrescription },
    exercise: { findFirst: findExercise },
  };
  const prisma = {
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  return {
    repository: new PrismaFlexiblePlanningRepository(
      prisma as unknown as PrismaService,
    ),
    source,
    rows,
    findSource,
    findPrevious,
    createPlan,
    createWeek,
    createDay,
    createPrescription,
    findWeeks,
    findExercise,
    lock,
    update,
  };
}
describe('Whole routine duplication repository', () => {
  it('copies heterogeneous weeks, active days and pending prescriptions with exact fields and independent IDs', async () => {
    const h = harness();
    await expect(
      h.repository.duplicate(athleteId, sourceId, command),
    ).resolves.toEqual({ id: targetId });
    expect(h.createPlan.mock.calls[0][0].data).toEqual({
      id: targetId,
      athleteId,
      name: command.name,
      status: 'DRAFT',
      creationRequestHash: expect.any(String),
    });
    expect(h.createWeek.mock.calls.map(([q]) => q.data)).toEqual([
      { trainingPlanId: targetId, weekNumber: 1, objective: 'Volumen' },
      { trainingPlanId: targetId, weekNumber: 3, objective: null },
    ]);
    expect(h.createDay.mock.calls.map(([q]) => q.data)).toEqual([
      { planWeekId: 'new-week-1', name: 'Push', position: 2, weekday: 1 },
      {
        planWeekId: 'new-week-3',
        name: 'Legs diferente',
        position: 7,
        weekday: null,
      },
    ]);
    const copies = h.createPrescription.mock.calls.map(([q]) => q.data);
    expect(copies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planWeekId: 'new-week-1',
          planDayId: 'new-day-1',
          exerciseId: 'z-exercise',
          position: 5,
          targetSets: 3,
          targetReps: null,
          targetRepsMin: 6,
          targetRepsMax: 8,
          targetLoadUnit: 'LB',
          notes: 'Objetivo original',
        }),
        expect.objectContaining({
          planWeekId: 'new-week-1',
          planDayId: null,
          exerciseId: 'a-exercise',
          position: 2,
          targetReps: 8,
          targetRepsMin: null,
          targetRepsMax: null,
          targetLoadUnit: null,
        }),
        expect.objectContaining({
          planWeekId: 'new-week-3',
          planDayId: 'new-day-2',
          position: 9,
          targetLoad: null,
          targetRpe: null,
          notes: null,
        }),
      ]),
    );
    const work = copies.find((r) => r.exerciseId === 'z-exercise')!;
    expect(work.targetLoad).toBe(h.rows[0].days[0].exercises[0].targetLoad);
    expect(work.targetRpe).toBe(h.rows[0].days[0].exercises[0].targetRpe);
    expect(copies.every((row) => !('id' in row))).toBe(true);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.findWeeks.mock.calls[0][0]).toMatchObject({
      where: { trainingPlanId: sourceId },
      include: {
        days: { where: { retiredAt: null } },
        planExercises: { where: { planDayId: null } },
      },
    });
  });
  it('locks the athlete then owned source and validates sorted active catalog visibility before any creation', async () => {
    const h = harness();
    await h.repository.duplicate(athleteId, sourceId, command);
    expect(h.lock.mock.calls.map((call) => call.slice(1))).toEqual([
      [athleteId],
      [sourceId, athleteId],
      ['a-exercise'],
      ['z-exercise'],
    ]);
    expect(h.findSource.mock.calls[0][0]).toMatchObject({
      where: { id: sourceId, athleteId },
    });
    expect(h.findExercise.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'a-exercise',
        isActive: true,
        OR: [
          { origin: 'GLOBAL' },
          { origin: 'PERSONAL', owner: { athlete: { id: athleteId } } },
        ],
      },
    });
  });
  it('returns an identical retry even after source changes without revalidating the catalog', async () => {
    const h = harness();
    await h.repository.duplicate(athleteId, sourceId, command);
    const fingerprint = h.createPlan.mock.calls[0][0].data
      .creationRequestHash as string;
    h.findPrevious.mockResolvedValue({
      id: targetId,
      athleteId,
      creationRequestHash: fingerprint,
    });
    h.source.version = 8;
    h.findExercise.mockResolvedValue(null);
    await expect(
      h.repository.duplicate(athleteId, sourceId, command),
    ).resolves.toEqual({ id: targetId });
    expect(h.createPlan).toHaveBeenCalledTimes(1);
    expect(h.findWeeks).toHaveBeenCalledTimes(1);
  });
  it.each(['name', 'expectedVersion', 'owner', 'source'] as const)(
    'rejects changed %s for an already used destination identifier',
    async (change) => {
      const h = harness();
      await h.repository.duplicate(athleteId, sourceId, command);
      h.findPrevious.mockResolvedValue({
        id: targetId,
        athleteId: change === 'owner' ? 'foreign' : athleteId,
        creationRequestHash: h.createPlan.mock.calls[0][0].data
          .creationRequestHash as string,
      });
      await expect(
        h.repository.duplicate(
          athleteId,
          change === 'source' ? targetId : sourceId,
          {
            ...command,
            ...(change === 'name'
              ? { name: 'Otra' }
              : change === 'expectedVersion'
                ? { expectedVersion: 5 }
                : {}),
          },
        ),
      ).rejects.toMatchObject({ kind: 'conflict' });
      expect(h.createPlan).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects a stale source before writing or catalog reads', async () => {
    const h = harness();
    h.source.version = 5;
    await expect(
      h.repository.duplicate(athleteId, sourceId, command),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(h.createPlan).not.toHaveBeenCalled();
    expect(h.findExercise).not.toHaveBeenCalled();
  });
  it('hides foreign sources and unavailable catalog exercises without partial creation', async () => {
    const missing = harness();
    missing.findSource.mockResolvedValue(null);
    await expect(
      missing.repository.duplicate(athleteId, sourceId, command),
    ).rejects.toMatchObject({ kind: 'missing' });
    expect(missing.createPlan).not.toHaveBeenCalled();
    const unavailable = harness();
    unavailable.findExercise.mockResolvedValue(null);
    await expect(
      unavailable.repository.duplicate(athleteId, sourceId, command),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(unavailable.createPlan).not.toHaveBeenCalled();
  });
});
