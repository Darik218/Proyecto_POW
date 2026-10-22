import { NotFoundException, BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { MeasurementUnit } from '../generated/prisma/client';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import type { AthletesRepository } from './athletes.repository';
import { AthletesService } from './athletes.service';

const identity: AuthenticatedIdentity = {
  account: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'athlete@example.com',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  sessionId: '10000000-0000-4000-8000-000000000001',
};

describe('AthletesService', () => {
  const profile = {
    id: '20000000-0000-4000-8000-000000000001',
    birthDate: null,
    preferredUnit: 'KG' as MeasurementUnit,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mocks = {
    findProfileByUserId: jest.fn(),
    updateProfile: jest.fn(),
    findMeasurements: jest.fn(),
    createMeasurement: jest.fn(),
  };
  const repository = {
    ...mocks,
  } as unknown as jest.Mocked<AthletesRepository>;
  const service = new AthletesService(repository);

  beforeEach(() => jest.clearAllMocks());

  it('looks up profile by the authenticated owner and returns 404 if missing', async () => {
    repository.findProfileByUserId.mockResolvedValueOnce(profile);
    await expect(service.getMyProfile(identity)).resolves.toEqual(profile);
    expect(mocks.findProfileByUserId).toHaveBeenCalledWith(identity.account.id);

    repository.findProfileByUserId.mockResolvedValueOnce(null);
    await expect(service.getMyProfile(identity)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only supplied fields and rejects empty updates', async () => {
    repository.updateProfile.mockResolvedValueOnce(profile);
    await service.updateMyProfile(identity, { preferredUnit: 'LB' as MeasurementUnit });
    expect(mocks.updateProfile).toHaveBeenCalledWith(identity.account.id, {
      preferredUnit: 'LB',
    });
    await expect(service.updateMyProfile(identity, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('derives measurement ownership from the loaded profile', async () => {
    repository.findProfileByUserId.mockResolvedValueOnce(profile);
    repository.createMeasurement.mockResolvedValueOnce({
      id: '30000000-0000-4000-8000-000000000001',
      bodyWeight: 72.5,
      measuredAt: new Date('2026-01-01T00:00:00.000Z'),
      notes: null,
    });
    await service.addMyMeasurement(identity, {
      bodyWeight: 72.5,
      measuredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mocks.createMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({ athleteId: profile.id, bodyWeight: 72.5 }),
    );
  });
});
