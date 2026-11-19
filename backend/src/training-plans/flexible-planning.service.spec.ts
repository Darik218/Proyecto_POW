import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaFlexiblePlanningRepository } from './prisma-flexible-planning.repository';
import type { FlexiblePlanningService as ServiceType } from './flexible-planning.service';
import type { TrainingPlansRepository } from './training-plans.repository';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { PlanningError } from './daily-planning.policy';
import { WorkoutRepositoryError } from '../workout-sessions/workout-sessions.repository';

// Replace only the persistence implementation: unit tests exercise the real service.
jest.unstable_mockModule('./prisma-flexible-planning.repository', () => ({
  PrismaFlexiblePlanningRepository: class {},
}));
let Service: typeof ServiceType;
beforeAll(async () => {
  const path = './flexible-planning.service';
  Service = (
    (await import(path)) as { FlexiblePlanningService: typeof ServiceType }
  ).FlexiblePlanningService;
});

const identity: AuthenticatedIdentity = {
  sessionId: 'session',
  account: {
    id: 'account',
    email: 'test@example.test',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};
function harness() {
  const findAthleteId = jest
    .fn<TrainingPlansRepository['findAthleteId']>()
    .mockResolvedValue('athlete');
  const generate = jest
    .fn<PrismaFlexiblePlanningRepository['generate']>()
    .mockResolvedValue({ id: 'plan' });
  const transition = jest
    .fn<PrismaFlexiblePlanningRepository['transition']>()
    .mockResolvedValue({ planId: 'plan' });
  const duplicate = jest
    .fn<PrismaFlexiblePlanningRepository['duplicate']>()
    .mockResolvedValue({ id: 'new-plan' });
  const repository = {
    generate,
    transition,
    duplicate,
  } as unknown as PrismaFlexiblePlanningRepository;
  return {
    service: new Service(
      { findAthleteId } as unknown as TrainingPlansRepository,
      repository,
    ),
    findAthleteId,
    generate,
    transition,
    duplicate,
  };
}
const input = {
  id: 'operation',
  name: 'Rutina',
  durationWeeks: 2,
  frequency: 1,
  timeZone: 'UTC',
};
describe('Flexible planning application use cases', () => {
  it('resolves the authenticated athlete and delegates creation without exposing the repository', async () => {
    const { service, findAthleteId, generate } = harness();
    await expect(service.generate(identity, input)).resolves.toEqual({
      id: 'plan',
    });
    expect(findAthleteId).toHaveBeenCalledWith('account');
    expect(generate).toHaveBeenCalledWith('athlete', input);
  });
  it('rejects a missing profile before invoking persistence', async () => {
    const { service, findAthleteId, generate } = harness();
    findAthleteId.mockResolvedValue(null);
    await expect(service.generate(identity, input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(['activate', 'archive'] as const)(
    'keeps the %s transition fixed inside the service',
    async (method) => {
      const { service, transition } = harness();
      const command = { id: 'operation', expectedVersion: 3 };
      await service[method](identity, 'plan', command);
      expect(transition).toHaveBeenCalledWith(
        'athlete',
        'plan',
        command,
        method === 'activate' ? 'ACTIVE' : 'ARCHIVED',
      );
    },
  );
  it.each([
    [new PlanningError('missing', 'Missing'), NotFoundException],
    [new PlanningError('invalid', 'Invalid'), BadRequestException],
    [new PlanningError('conflict', 'Conflict'), ConflictException],
    [new WorkoutRepositoryError('missing', 'Missing'), NotFoundException],
    [{ code: 'P2002' }, ConflictException],
    [{ code: 'P2003' }, ConflictException],
    [{ code: 'P2034' }, ConflictException],
  ])('preserves existing error translation for %p', async (error, expected) => {
    const { service, generate } = harness();
    generate.mockRejectedValue(error);
    await expect(service.generate(identity, input)).rejects.toBeInstanceOf(
      expected,
    );
  });
  it('preserves unexpected errors without concealing them', async () => {
    const { service, generate } = harness();
    const error = new Error('Storage unavailable');
    generate.mockRejectedValue(error);
    await expect(service.generate(identity, input)).rejects.toBe(error);
  });
});

describe('Whole routine duplication service', () => {
  it('derives ownership from the authenticated account and delegates the exact source version', async () => {
    const { service, findAthleteId, duplicate } = harness();
    const command = { id: 'new-plan', expectedVersion: 4, name: 'Mi copia' };
    await expect(
      service.duplicate(identity, 'source-plan', command),
    ).resolves.toEqual({ id: 'new-plan' });
    expect(findAthleteId).toHaveBeenCalledWith(identity.account.id);
    expect(duplicate).toHaveBeenCalledWith('athlete', 'source-plan', command);
  });
  it('rejects missing profiles without duplication', async () => {
    const { service, findAthleteId, duplicate } = harness();
    findAthleteId.mockResolvedValue(null);
    await expect(
      service.duplicate(identity, 'source', {
        id: 'new',
        expectedVersion: 1,
        name: 'Copia',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(duplicate).not.toHaveBeenCalled();
  });
  it.each([
    [new PlanningError('missing', 'Private source'), NotFoundException],
    [new PlanningError('conflict', 'Changed source'), ConflictException],
    [{ code: 'P2002' }, ConflictException],
  ])('preserves HTTP error semantics for %p', async (error, expected) => {
    const { service, duplicate } = harness();
    duplicate.mockRejectedValue(error);
    await expect(
      service.duplicate(identity, 'source', {
        id: 'new',
        expectedVersion: 1,
        name: 'Copia',
      }),
    ).rejects.toBeInstanceOf(expected);
  });
});
