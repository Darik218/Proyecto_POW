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
@Injectable()
export class FlexiblePlanningService {
  constructor(
    @Inject(TRAINING_PLANS_REPOSITORY)
    private readonly plans: TrainingPlansRepository,
    private readonly repository: PrismaFlexiblePlanningRepository,
  ) {}
  async run<T>(
    identity: AuthenticatedIdentity,
    operation: (
      repository: PrismaFlexiblePlanningRepository,
      athleteId: string,
    ) => Promise<T>,
  ) {
    const athleteId = await this.plans.findAthleteId(identity.account.id);
    if (!athleteId) throw new NotFoundException('Athlete profile not found.');
    try {
      return await operation(this.repository, athleteId);
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
