import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { TRAINING_PLANS_REPOSITORY } from './training-plans.repository';
import type { TrainingPlansRepository } from './training-plans.repository';
import { WorkoutRepositoryError } from '../workout-sessions/workout-sessions.repository';
import { PlanningError } from './daily-planning.policy';
import { PrismaFlexiblePlanningRepository } from './prisma-flexible-planning.repository';
import type {
  GenerateRoutineDto,
  DuplicateRoutineDto,
  PlanningVersionDto,
  NewRoutineDayDto,
  CopyRoutineDto,
  FutureRoutineDto,
  CreateScheduledActivityDto,
  UpdateScheduledActivityDto,
  ActivityQueryDto,
} from './dto/flexible-planning.dto';
@Injectable()
export class FlexiblePlanningService {
  constructor(
    @Inject(TRAINING_PLANS_REPOSITORY)
    private readonly plans: TrainingPlansRepository,
    private readonly repository: PrismaFlexiblePlanningRepository,
  ) {}
  generate(identity: AuthenticatedIdentity, input: GenerateRoutineDto) {
    return this.execute(identity, (athleteId) =>
      this.repository.generate(athleteId, input),
    );
  }
  duplicate(
    identity: AuthenticatedIdentity,
    planId: string,
    input: DuplicateRoutineDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.duplicate(athleteId, planId, input),
    );
  }
  newDay(
    identity: AuthenticatedIdentity,
    planId: string,
    input: NewRoutineDayDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.newDay(athleteId, planId, input),
    );
  }
  copy(identity: AuthenticatedIdentity, planId: string, input: CopyRoutineDto) {
    return this.execute(identity, (athleteId) =>
      this.repository.copy(athleteId, planId, input),
    );
  }
  activate(
    identity: AuthenticatedIdentity,
    planId: string,
    input: PlanningVersionDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.transition(athleteId, planId, input, 'ACTIVE'),
    );
  }
  archive(
    identity: AuthenticatedIdentity,
    planId: string,
    input: PlanningVersionDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.transition(athleteId, planId, input, 'ARCHIVED'),
    );
  }
  future(
    identity: AuthenticatedIdentity,
    planId: string,
    dayId: string,
    input: FutureRoutineDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.future(athleteId, planId, dayId, input),
    );
  }
  withdraw(
    identity: AuthenticatedIdentity,
    planId: string,
    dayId: string,
    input: FutureRoutineDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.future(athleteId, planId, dayId, input, true),
    );
  }
  activities(identity: AuthenticatedIdentity, input: ActivityQueryDto) {
    return this.execute(identity, (athleteId) =>
      this.repository.activities(athleteId, input),
    );
  }
  createActivity(
    identity: AuthenticatedIdentity,
    input: CreateScheduledActivityDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.createActivity(athleteId, input),
    );
  }
  updateActivity(
    identity: AuthenticatedIdentity,
    id: string,
    input: UpdateScheduledActivityDto,
  ) {
    return this.execute(identity, (athleteId) =>
      this.repository.updateActivity(athleteId, id, input),
    );
  }
  private async execute<T>(
    identity: AuthenticatedIdentity,
    operation: (athleteId: string) => Promise<T>,
  ) {
    const athleteId = await this.plans.findAthleteId(identity.account.id);
    if (!athleteId) throw new NotFoundException('Athlete profile not found.');
    try {
      return await operation(athleteId);
    } catch (error) {
      if (
        error instanceof PlanningError ||
        error instanceof WorkoutRepositoryError
      ) {
        if (error.kind === 'missing')
          throw new NotFoundException(error.message);
        if (error.kind === 'invalid')
          throw new BadRequestException(error.message);
        throw new ConflictException(error.message);
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['P2002', 'P2003', 'P2034'].includes(String(error.code))
      )
        throw new ConflictException(
          'The programming changed or has historical references. Reload before retrying.',
        );
      throw error;
    }
  }
}
