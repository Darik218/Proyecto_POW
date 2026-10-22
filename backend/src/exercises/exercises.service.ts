import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EXERCISES_REPOSITORY } from './exercises.repository';
import type { ExercisesRepository, ExercisePage } from './exercises.repository';

@Injectable()
export class ExercisesService {
  constructor(
    @Inject(EXERCISES_REPOSITORY)
    private readonly repository: ExercisesRepository,
  ) {}

  list(page: ExercisePage) {
    return this.repository.findActive(page);
  }

  async getById(id: string) {
    const exercise = await this.repository.findActiveById(id);
    if (!exercise) throw new NotFoundException('Exercise not found.');
    return exercise;
  }
}
