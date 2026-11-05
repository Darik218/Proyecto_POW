import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AthletesService } from '../athletes/athletes.service';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { WORKOUT_SESSIONS_REPOSITORY, WorkoutRepositoryError } from './workout-sessions.repository';
import type { WorkoutSessionsRepository } from './workout-sessions.repository';
import type { AddWorkoutExerciseDto, CreateWorkoutSessionDto, ListWorkoutSessionsDto } from './dto/workout-session.dto';

@Injectable()
export class WorkoutSessionsService {
  constructor(
    @Inject(WORKOUT_SESSIONS_REPOSITORY) private readonly repository: WorkoutSessionsRepository,
    private readonly athletes: AthletesService,
  ) {}
  private async run<T>(identity: AuthenticatedIdentity, operation: (athleteId: string) => Promise<T>): Promise<T> {
    const profile = await this.athletes.getMyProfile(identity);
    try { return await operation(profile.id); }
    catch (error) {
      if (error instanceof WorkoutRepositoryError) {
        if (error.kind === 'missing') throw new NotFoundException(error.message);
        throw new ConflictException(error.message);
      }
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2003'].includes(String(error.code))) {
        throw new ConflictException('A referenced resource changed or the creation identifier is already in use.');
      }
      throw error;
    }
  }
  list(identity: AuthenticatedIdentity, query: ListWorkoutSessionsDto) { return this.run(identity, athleteId => this.repository.list(athleteId, query)); }
  async get(identity: AuthenticatedIdentity, id: string) {
    const result = await this.run(identity, athleteId => this.repository.get(athleteId, id));
    if (!result) throw new NotFoundException('Workout session not found.');
    return result;
  }
  create(identity: AuthenticatedIdentity, input: CreateWorkoutSessionDto) {
    if ((input.trainingPlanId === undefined) !== (input.planWeekId === undefined)) throw new BadRequestException('Training plan and week must be provided together.');
    return this.run(identity, athleteId => this.repository.create(athleteId, input));
  }
  addExercise(identity: AuthenticatedIdentity, id: string, input: AddWorkoutExerciseDto) { return this.run(identity, athleteId => this.repository.addExercise(athleteId, id, input)); }
  start(identity: AuthenticatedIdentity, id: string) { return this.run(identity, athleteId => this.repository.start(athleteId, id)); }
  complete(identity: AuthenticatedIdentity, id: string) { return this.run(identity, athleteId => this.repository.complete(athleteId, id)); }
}
