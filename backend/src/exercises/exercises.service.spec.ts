import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { ExercisesService } from './exercises.service';
import type { ExercisesRepository } from './exercises.repository';
import { Exercise } from '../models/exercises/exercise.model';
import type { ExerciseAttributes } from '../models/exercises/exercise.model';
import { ExercisesPresenter } from '../views/exercises/exercises.presenter';
const presenter = new ExercisesPresenter();

describe('ExercisesService', () => {
  const exercise: ExerciseAttributes = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Press de banca con barra',
    description: 'Empuje horizontal.',
    equipment: 'Barra olímpica y banco',
    equipmentType: 'BARBELL',
    machineType: null,
    resistanceType: 'FREE_WEIGHT',
    movementType: 'COMPOUND',
    movementPattern: 'HORIZONTAL_PUSH',
    grip: 'PRONATED',
    gripWidth: 'SHOULDER_WIDTH',
    bodyPosition: 'SUPINE',
    laterality: 'BILATERAL',
    movementPlane: 'TRANSVERSE',
    difficulty: 'BEGINNER',
    oneRmSuitability: 'SUITABLE',
    instructions: 'Controla el descenso.',
    origin: 'GLOBAL',
    isActive: true,
    ownerId: null,
    primaryMuscleGroup: { key: 'pectorales', name: 'Pectorales' },
    secondaryMuscleGroups: [{ key: 'triceps', name: 'Tríceps' }],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const repository = {
    listMuscleGroups: jest.fn<ExercisesRepository['listMuscleGroups']>(),
    listGlobal: jest.fn<ExercisesRepository['listGlobal']>(),
    listVisible: jest.fn<ExercisesRepository['listVisible']>(),
    listMine: jest.fn<ExercisesRepository['listMine']>(),
    findVisibleById: jest.fn<ExercisesRepository['findVisibleById']>(),
    createPersonal: jest.fn<ExercisesRepository['createPersonal']>(),
    updatePersonal: jest.fn<ExercisesRepository['updatePersonal']>(),
    deactivatePersonal: jest.fn<ExercisesRepository['deactivatePersonal']>(),
  } satisfies jest.Mocked<ExercisesRepository>;
  const service = new ExercisesService(repository);
  const identity = {
    account: {
      id: '30000000-0000-4000-8000-000000000001',
      email: 'exercise-owner@example.test',
      status: 'ACTIVE' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    sessionId: '40000000-0000-4000-8000-000000000001',
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns stable paginated public fields and excludes owner identity', async () => {
    repository.listGlobal.mockResolvedValue({
      items: [new Exercise(exercise)],
      total: 27,
    });
    await expect(
      service
        .listGlobal({ limit: 10, offset: 20 })
        .then((result) => presenter.catalog(result)),
    ).resolves.toEqual({
      items: [
        {
          ...exercise,
          isOwner: false,
          ownerId: undefined,
          isActive: undefined,
        },
      ].map(({ ownerId: _ownerId, isActive: _isActive, ...rest }) => rest),
      total: 27,
      limit: 10,
      offset: 20,
    });
    expect(repository.listGlobal).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
    });
  });

  it('keeps global and user lists isolated and marks only owned records', async () => {
    const personal = {
      ...exercise,
      origin: 'PERSONAL' as const,
      ownerId: identity.account.id,
    };
    repository.listMine.mockResolvedValue({
      items: [new Exercise(personal)],
      total: 1,
    });
    await expect(
      service
        .listMine(identity, { limit: 20, offset: 0 })
        .then((result) => presenter.catalog(result, identity.account.id)),
    ).resolves.toMatchObject({
      items: [{ isOwner: true, origin: 'PERSONAL' }],
      total: 1,
    });
    expect(repository.listMine).toHaveBeenCalledWith(identity.account.id, {
      limit: 20,
      offset: 0,
    });
  });

  it('returns only visible details and maps absent records to not found', async () => {
    repository.findVisibleById.mockResolvedValueOnce(new Exercise(exercise));
    await expect(
      service.getById(exercise.id).then((result) => presenter.exercise(result)),
    ).resolves.toMatchObject({ id: exercise.id, isOwner: false });
    repository.findVisibleById.mockResolvedValueOnce(null);
    await expect(service.getById(exercise.id, identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid group sets and refuses edits that would affect history', async () => {
    repository.createPersonal.mockResolvedValueOnce({
      kind: 'missing-muscle-group',
    });
    await expect(
      service.create(identity, {
        name: 'Ejercicio propio',
        primaryMuscleGroupKey: 'missing',
        equipment: 'Barra',
        equipmentType: 'BARBELL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    repository.updatePersonal.mockResolvedValueOnce({
      kind: 'historical-reference',
    });
    await expect(
      service.update(identity, exercise.id, { name: 'Cambio' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects empty updates and deactivates rather than deleting', async () => {
    await expect(
      service.update(identity, exercise.id, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    repository.deactivatePersonal.mockResolvedValueOnce(true);
    await expect(
      service
        .deactivate(identity, exercise.id)
        .then(() => presenter.deactivated()),
    ).resolves.toEqual({ deactivated: true });
  });
});
