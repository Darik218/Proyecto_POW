import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AthletesService } from '../athletes/athletes.service';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import type { PreparationCommand } from './prisma-workout-sessions.repository';
import type {
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
  SaveWorkoutDayDto,
} from './dto/workout-preparation.dto';
import { localDate } from './workout-calendar.policy';
import {
  WORKOUT_SESSIONS_REPOSITORY,
  WorkoutRepositoryError,
} from './workout-sessions.repository';
import type { WorkoutSessionsRepository } from './workout-sessions.repository';
import type {
  AddWorkoutExerciseDto,
  CreateWorkoutSessionDto,
  ListWorkoutSessionsDto,
  AssociateWorkoutDto,
  WorkoutSuggestionsDto,
} from './dto/workout-session.dto';

@Injectable()
export class WorkoutSessionsService {
  constructor(
    @Inject(WORKOUT_SESSIONS_REPOSITORY)
    private readonly repository: WorkoutSessionsRepository,
    private readonly athletes: AthletesService,
  ) {}
  private async run<T>(
    identity: AuthenticatedIdentity,
    operation: (athleteId: string) => Promise<T>,
  ): Promise<T> {
    const profile = await this.athletes.getMyProfile(identity);
    try {
      return await operation(profile.id);
    } catch (error) {
      if (error instanceof WorkoutRepositoryError) {
        if (error.kind === 'invalid')
          throw new BadRequestException(error.message);
        if (error.kind === 'missing')
          throw new NotFoundException(error.message);
        throw new ConflictException(error.message);
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['P2002', 'P2003'].includes(String(error.code))
      ) {
        throw new ConflictException(
          'A referenced resource changed or the creation identifier is already in use.',
        );
      }
      throw error;
    }
  }
  list(identity: AuthenticatedIdentity, query: ListWorkoutSessionsDto) {
    if(query.from&&query.to&&query.from>query.to)throw new BadRequestException('The end date must be on or after the start date.');
    return this.run(identity, (athleteId) =>
      this.repository.list(athleteId, query),
    );
  }
  async get(identity: AuthenticatedIdentity, id: string) {
    const result = await this.run(identity, (athleteId) =>
      this.repository.get(athleteId, id),
    );
    if (!result) throw new NotFoundException('Workout session not found.');
    return result;
  }
  create(identity: AuthenticatedIdentity, input: CreateWorkoutSessionDto) {
    if (
      input.repeatFromId &&
      (input.repeatFromId === input.id ||
        input.trainingPlanId ||
        input.planWeekId ||
        input.planDayId)
    )
      throw new BadRequestException(
        'Repeat a previous session as an independent new session.',
      );
    const count = [
      input.trainingPlanId,
      input.planWeekId,
      input.planDayId,
    ].filter(Boolean).length;
    if (count !== 0 && count !== 3)
      throw new BadRequestException(
        'Training plan, week and day must be provided together.',
      );
    return this.run(identity, (athleteId) => {
      const today = localDate(input.timeZone);
      if (input.recordingMode === 'RETROSPECTIVE' && input.performedOn > today)
        throw new WorkoutRepositoryError(
          'invalid',
          'A retrospective training date cannot be in the future.',
        );
      return this.repository.create(athleteId, input);
    });
  }
  addExercise(
    identity: AuthenticatedIdentity,
    id: string,
    input: AddWorkoutExerciseDto,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.addExercise(athleteId, id, input),
    );
  }
  start(identity: AuthenticatedIdentity, id: string, expectedVersion: number) {
    return this.run(identity, (athleteId) =>
      this.repository.start(athleteId, id, expectedVersion),
    );
  }
  complete(
    identity: AuthenticatedIdentity,
    id: string,
    expectedVersion: number,
    confirmWithoutResults = false,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.complete(
        athleteId,
        id,
        expectedVersion,
        confirmWithoutResults,
      ),
    );
  }
  associate(
    identity: AuthenticatedIdentity,
    id: string,
    input: AssociateWorkoutDto,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.associate(athleteId, id, input),
    );
  }
  recordSet(
    identity: AuthenticatedIdentity,
    id: string,
    exerciseId: string,
    input: CreateWorkoutSetDto | UpdateWorkoutSetDto,
    setId?: string,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.recordSet(athleteId, id, exerciseId, input, setId),
    );
  }
  cancel(identity: AuthenticatedIdentity, id: string, expectedVersion: number) {
    return this.run(identity, (athleteId) =>
      this.repository.cancel(athleteId, id, expectedVersion),
    );
  }
  prepare(
    identity: AuthenticatedIdentity,
    id: string,
    command: PreparationCommand,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.prepare(athleteId, id, command),
    );
  }
  saveDay(
    identity: AuthenticatedIdentity,
    id: string,
    input: SaveWorkoutDayDto,
  ) {
    return this.run(identity, (athleteId) =>
      this.repository.saveDay(athleteId, id, input),
    );
  }
  suggestions(identity: AuthenticatedIdentity, input: WorkoutSuggestionsDto) {
    return this.run(identity, (athleteId) =>
      this.repository.suggestions(athleteId, input),
    );
  }
}
