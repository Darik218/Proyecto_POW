import { jest } from '@jest/globals';
import { sqltag, join, raw, empty } from '@prisma/client/runtime/client';
import { Exercise } from '../models/exercises/exercise.model';
import {
  exerciseAttributes,
  exerciseOwnerId,
} from '../../test/fixtures/exercise.fixture';
import type { PrismaExercisesRepository as Repository } from './prisma-exercises.repository';
import type { PrismaService } from '../database/prisma.service';
jest.unstable_mockModule('../database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.unstable_mockModule('../generated/prisma/client', () => ({
  Prisma: { sql: sqltag, join, raw, empty },
}));
let Constructor: typeof Repository;
beforeAll(async () => {
  const path = './prisma-exercises.repository';
  Constructor = (
    (await import(path)) as { PrismaExercisesRepository: typeof Repository }
  ).PrismaExercisesRepository;
});
const row = () => ({
  ...exerciseAttributes,
  aliases: [{ name: 'Bench press' }],
  secondaryMuscleGroups: [
    { muscleGroup: { key: 'triceps', name: 'Tríceps' } },
    { muscleGroup: { key: 'deltoides', name: 'Deltoides' } },
  ],
});
describe('Prisma exercise to domain mapping without a database', () => {
  it('maps selected persistence relations to an exercise model without changing identity or classification', async () => {
    const findFirst = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(row());
    const repository = new Constructor({
      exercise: { findFirst },
    } as unknown as PrismaService);
    const exercise = await repository.findVisibleById(
      exerciseAttributes.id,
      exerciseOwnerId,
    );
    expect(exercise).toBeInstanceOf(Exercise);
    expect(exercise!.attributes).toEqual({
      ...exerciseAttributes,
      secondaryMuscleGroups: [
        { key: 'deltoides', name: 'Deltoides' },
        { key: 'triceps', name: 'Tríceps' },
      ],
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: exerciseAttributes.id,
          isActive: true,
          OR: [
            { origin: 'GLOBAL' },
            { origin: 'PERSONAL', ownerId: exerciseOwnerId },
          ],
        },
      }),
    );
  });
  it('keeps anonymous reads global-only and absent records absent', async () => {
    const findFirst = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(null);
    const repository = new Constructor({
      exercise: { findFirst },
    } as unknown as PrismaService);
    expect(await repository.findVisibleById(exerciseAttributes.id)).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: exerciseAttributes.id,
          isActive: true,
          OR: [{ origin: 'GLOBAL' }],
        },
      }),
    );
  });
  it('maps the result of a personal creation into a model while persistence retains ownership responsibility', async () => {
    const create = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        ...row(),
        ownerId: exerciseOwnerId,
        origin: 'PERSONAL',
      });
    const transaction = {
      muscleGroup: {
        findMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue([{ id: 'group-id', key: 'pectorales' }]),
      },
      exercise: { create },
    };
    const repository = new Constructor({
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);
    const outcome = await repository.createPersonal(exerciseOwnerId, {
      name: 'Propio',
      primaryMuscleGroupKey: 'pectorales',
      equipment: 'Barra',
      equipmentType: 'BARBELL',
      aliases: ['Bench press'],
    });
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('Expected created model');
    expect(outcome.exercise).toBeInstanceOf(Exercise);
    expect(outcome.exercise.isOwnedBy(exerciseOwnerId)).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: 'PERSONAL',
          ownerId: exerciseOwnerId,
          catalogKey: null,
        }),
      }),
    );
  });
});
