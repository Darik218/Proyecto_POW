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
  ExercisePageResult,
  ExerciseRecord,
  ExerciseUpdateValues,
  ExerciseView,
  ExerciseWriteValues,
  ExercisesRepository,
} from './exercises.repository';

@Injectable()
export class ExercisesService {
  constructor(
    @Inject(EXERCISES_REPOSITORY)
    private readonly repository: ExercisesRepository,
  ) {}

  async listGlobal(query: ExercisePage): Promise<ExercisePageResult> {
    const result = await this.repository.listGlobal(query);
    return this.toPage(result.items.map((exercise) => this.toView(exercise, undefined)), query, result.total);
  }

  async listMine(identity: AuthenticatedIdentity, query: ExercisePage): Promise<ExercisePageResult> {
    const result = await this.repository.listMine(identity.account.id, query);
    return this.toPage(result.items.map((exercise) => this.toView(exercise, identity.account.id)), query, result.total);
  }

  async getById(id: string, identity?: AuthenticatedIdentity): Promise<ExerciseView> {
    const exercise = await this.repository.findVisibleById(id, identity?.account.id);
    if (!exercise) throw new NotFoundException('Exercise not found or unavailable.');
    return this.toView(exercise, identity?.account.id);
  }

  async create(identity: AuthenticatedIdentity, input: ExerciseWriteValues): Promise<ExerciseView> {
    const outcome = await this.repository.createPersonal(identity.account.id, input);
    if (outcome.kind === 'missing-muscle-group') {
      throw new BadRequestException('One or more muscle group keys are invalid.');
    }
    if (outcome.kind === 'duplicate-muscle-group') {
      throw new BadRequestException('The primary muscle group cannot also be secondary.');
    }
    return this.toView(outcome.exercise, identity.account.id);
  }

  async update(identity: AuthenticatedIdentity, id: string, input: ExerciseUpdateValues): Promise<ExerciseView> {
    if (!Object.keys(input).length) {
      throw new BadRequestException('At least one editable field is required.');
    }
    const outcome = await this.repository.updatePersonal(identity.account.id, id, input);
    if (outcome.kind === 'not-found') throw new NotFoundException('Personal exercise not found.');
    if (outcome.kind === 'historical-reference') {
      throw new ConflictException('An exercise referenced by plans or training history cannot be edited.');
    }
    if (outcome.kind === 'missing-muscle-group') {
      throw new BadRequestException('One or more muscle group keys are invalid.');
    }
    if (outcome.kind === 'duplicate-muscle-group') {
      throw new BadRequestException('The primary muscle group cannot also be secondary.');
    }
    return this.toView(outcome.exercise, identity.account.id);
  }

  async deactivate(identity: AuthenticatedIdentity, id: string): Promise<{ deactivated: true }> {
    const changed = await this.repository.deactivatePersonal(identity.account.id, id);
    if (!changed) throw new NotFoundException('Personal exercise not found.');
    return { deactivated: true };
  }

  listMuscleGroups() {
    return this.repository.listMuscleGroups();
  }

  private toPage(items: ExerciseView[], query: ExercisePage, total: number): ExercisePageResult {
    return { items, total, limit: query.limit, offset: query.offset };
  }

  private toView(exercise: ExerciseRecord, viewerId: string | undefined): ExerciseView {
    const { ownerId, isActive: _isActive, ...fields } = exercise;
    return { ...fields, isOwner: Boolean(viewerId && ownerId === viewerId) };
  }
}
