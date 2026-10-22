import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ExercisesService } from './exercises.service';
import type { ExercisesRepository, PublicExercise } from './exercises.repository';

describe('ExercisesService', () => {
  const activeExercise: PublicExercise = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Bench press',
    muscleGroup: 'Chest',
    equipment: 'Barbell',
    description: null,
  };
  const mocks = {
    findActive: jest.fn(),
    findActiveById: jest.fn(),
  };
  const repository: jest.Mocked<ExercisesRepository> = mocks;
  const service = new ExercisesService(repository);

  beforeEach(() => jest.clearAllMocks());

  it('forwards the validated page to the active catalog query', async () => {
    repository.findActive.mockResolvedValueOnce([activeExercise]);
    await expect(service.list({ limit: 10, offset: 20 })).resolves.toEqual([
      activeExercise,
    ]);
    expect(mocks.findActive).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  it('returns an active exercise or a consistent not-found error', async () => {
    repository.findActiveById.mockResolvedValueOnce(activeExercise);
    await expect(service.getById(activeExercise.id)).resolves.toEqual(activeExercise);
    repository.findActiveById.mockResolvedValueOnce(null);
    await expect(service.getById(activeExercise.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
