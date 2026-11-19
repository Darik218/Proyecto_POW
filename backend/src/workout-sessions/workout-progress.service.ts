import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import {
  describeProgress,
  progressWindow,
} from '../domain/workout-sessions/workout-progress.policy';
import {
  WORKOUT_PROGRESS_REPOSITORY,
  WorkoutProgressError,
} from './workout-progress.repository';
import type { WorkoutProgressRepository } from './workout-progress.repository';
import type { WorkoutProgressQueryDto } from './dto/workout-progress.dto';
@Injectable()
export class WorkoutProgressService {
  constructor(
    @Inject(WORKOUT_PROGRESS_REPOSITORY)
    private readonly repository: WorkoutProgressRepository,
  ) {}
  async read(identity: AuthenticatedIdentity, query: WorkoutProgressQueryDto) {
    try {
      const window = progressWindow(
        query.period ?? '30',
        new Date(),
        query.timeZone ?? 'UTC',
      );
      return describeProgress(
        await this.repository.read(
          identity.account.id,
          identity.sessionId,
          window,
          query.exerciseId,
          query.planDayId,
          query.planId,
        ),
        window,
      );
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException('Provide a valid IANA time zone.');
      if (error instanceof WorkoutProgressError) {
        if (error.code === 'AUTHENTICATION_REQUIRED')
          throw new UnauthorizedException();
        throw new NotFoundException('Exercise not found.');
      }
      throw error;
    }
  }
}
