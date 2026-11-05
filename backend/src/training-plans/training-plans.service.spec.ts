import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import type { TrainingPlansRepository } from './training-plans.repository';
import { TrainingPlansService } from './training-plans.service';

describe('TrainingPlansService', () => {
  const now = new Date('2026-10-22T00:00:00.000Z');
  const identity: AuthenticatedIdentity = {
    account: {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'athlete@example.com',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    sessionId: '20000000-0000-4000-8000-000000000001',
  };
  const mocks = {
    findAthleteId: jest.fn<TrainingPlansRepository['findAthleteId']>(),
    list: jest.fn<TrainingPlansRepository['list']>(),
    findById: jest.fn<TrainingPlansRepository['findById']>(),
    create: jest.fn<TrainingPlansRepository['create']>(),
    update: jest.fn<TrainingPlansRepository['update']>(),
    findPlanStatus: jest.fn<TrainingPlansRepository['findPlanStatus']>(),
    createWeek: jest.fn<TrainingPlansRepository['createWeek']>(),
    updateWeek: jest.fn<TrainingPlansRepository['updateWeek']>(),
    createPrescription: jest.fn<TrainingPlansRepository['createPrescription']>(),
    updatePrescription: jest.fn<TrainingPlansRepository['updatePrescription']>(),
    removePrescription: jest.fn<TrainingPlansRepository['removePrescription']>(),
  };
  const repository = mocks as jest.Mocked<TrainingPlansRepository>;
  let service: TrainingPlansService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrainingPlansService(repository);
  });

  it('derives plan ownership from the authenticated user profile', async () => {
    mocks.findAthleteId.mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    mocks.list.mockResolvedValueOnce([]);
    await expect(service.list(identity)).resolves.toEqual([]);
    expect(mocks.findAthleteId).toHaveBeenCalledWith(identity.account.id);
    expect(mocks.list).toHaveBeenCalledWith('30000000-0000-4000-8000-000000000001');
  });

  it('rejects missing athlete profiles and invalid plan date ranges', async () => {
    mocks.findAthleteId.mockResolvedValueOnce(null);
    await expect(service.list(identity)).rejects.toBeInstanceOf(NotFoundException);

    mocks.findAthleteId.mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    await expect(
      service.create(identity, {
        name: 'Plan',
        startsOn: '2026-11-02',
        endsOn: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('requires a nonempty editable payload and protects non-draft plans', async () => {
    await expect(service.update(identity, '40000000-0000-4000-8000-000000000001', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.findAthleteId).not.toHaveBeenCalled();

    mocks.findAthleteId.mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    mocks.findById.mockResolvedValueOnce({
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Plan',
      startsOn: now,
      endsOn: null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      weeks: [],
    });
    await expect(
      service.update(identity, '40000000-0000-4000-8000-000000000001', { name: 'Updated' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects attempts to edit a plan not owned by the authenticated athlete', async () => {
    mocks.findAthleteId.mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    mocks.findById.mockResolvedValueOnce(null);
    await expect(
      service.update(identity, '40000000-0000-4000-8000-000000000002', { name: 'Updated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects plan edits when the repository reports linked training history', async () => {
    mocks.findAthleteId.mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    mocks.findById.mockResolvedValueOnce({
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Plan',
      startsOn: now,
      endsOn: null,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
      weeks: [],
    });
    mocks.update.mockResolvedValueOnce('historical');
    await expect(
      service.update(identity, '40000000-0000-4000-8000-000000000001', { name: 'Updated' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
