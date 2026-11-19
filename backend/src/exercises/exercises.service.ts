import { Exercise } from '../models/exercises/exercise.model';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { EXERCISES_REPOSITORY } from './exercises.repository';
import type {
  ExercisePage,
  ExerciseListResult,
  ExerciseUpdateValues,
  ExerciseWriteValues,
  ExercisesRepository,
} from './exercises.repository';

export type ExerciseCatalogResult = ExerciseListResult & {
  limit: number;
  offset: number;
};

@Injectable()
export class ExercisesService {
  constructor(
    @Inject(EXERCISES_REPOSITORY)
    private readonly repository: ExercisesRepository,
  ) {}

  async listGlobal(query: ExercisePage): Promise<ExerciseCatalogResult> {
    const result = await this.repository.listGlobal(query);
    return { ...result, limit: query.limit, offset: query.offset };
  }

  async listVisible(
    identity: AuthenticatedIdentity,
    query: ExercisePage,
  ): Promise<ExerciseCatalogResult> {
    const result = await this.repository.listVisible(
      identity.account.id,
      query,
    );
    return { ...result, limit: query.limit, offset: query.offset };
  }

  async listMine(
    identity: AuthenticatedIdentity,
    query: ExercisePage,
  ): Promise<ExerciseCatalogResult> {
    const result = await this.repository.listMine(identity.account.id, query);
    return { ...result, limit: query.limit, offset: query.offset };
  }

  async getById(
    id: string,
    identity?: AuthenticatedIdentity,
  ): Promise<Exercise> {
    const exercise = await this.repository.findVisibleById(
      id,
      identity?.account.id,
    );
    if (!exercise)
      throw new NotFoundException('Exercise not found or unavailable.');
    return exercise;
  }

  async create(
    identity: AuthenticatedIdentity,
    input: ExerciseWriteValues,
  ): Promise<Exercise> {
    if (!Exercise.hasDistinctAliases(input.aliases))
      throw new BadRequestException(
        'Aliases must have distinct normalized names.',
      );
    const outcome = await this.repository
      .createPersonal(identity.account.id, input)
      .catch((error) => this.aliasFailure(error));
    if (outcome.kind === 'missing-muscle-group') {
      throw new BadRequestException(
        'One or more muscle group keys are invalid.',
      );
    }
    if (outcome.kind === 'duplicate-muscle-group') {
      throw new BadRequestException(
        'The primary muscle group cannot also be secondary.',
      );
    }
    return outcome.exercise;
  }

  async update(
    identity: AuthenticatedIdentity,
    id: string,
    input: ExerciseUpdateValues,
  ): Promise<Exercise> {
    if (!Object.keys(input).length) {
      throw new BadRequestException('At least one editable field is required.');
    }
    if (!Exercise.hasDistinctAliases(input.aliases))
      throw new BadRequestException(
        'Aliases must have distinct normalized names.',
      );
    const outcome = await this.repository
      .updatePersonal(identity.account.id, id, input)
      .catch((error) => this.aliasFailure(error));
    if (outcome.kind === 'not-found')
      throw new NotFoundException('Personal exercise not found.');
    if (outcome.kind === 'historical-reference') {
      throw new ConflictException(
        'An exercise referenced by plans or training history cannot be edited.',
      );
    }
    if (outcome.kind === 'missing-muscle-group') {
      throw new BadRequestException(
        'One or more muscle group keys are invalid.',
      );
    }
    if (outcome.kind === 'duplicate-muscle-group') {
      throw new BadRequestException(
        'The primary muscle group cannot also be secondary.',
      );
    }
    return outcome.exercise;
  }

  async deactivate(identity: AuthenticatedIdentity, id: string): Promise<void> {
    const changed = await this.repository.deactivatePersonal(
      identity.account.id,
      id,
    );
    if (!changed) throw new NotFoundException('Personal exercise not found.');
  }

  private aliasFailure(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    )
      throw new BadRequestException(
        'Aliases must have distinct normalized names.',
      );
    throw error;
  }

  listMuscleGroups() {
    return this.repository.listMuscleGroups();
  }
}
