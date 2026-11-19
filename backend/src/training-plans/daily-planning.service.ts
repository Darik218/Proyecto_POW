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
import { PlanningError } from './daily-planning.policy';
import { PrismaDailyPlanningRepository } from './prisma-daily-planning.repository';
import type { PlanningCommand } from './prisma-daily-planning.repository';

@Injectable()
export class DailyPlanningService {
  constructor(
    @Inject(TRAINING_PLANS_REPOSITORY)
    private readonly plans: TrainingPlansRepository,
    private readonly repository: PrismaDailyPlanningRepository,
  ) {}
  private async athlete(identity: AuthenticatedIdentity) {
    const id = await this.plans.findAthleteId(identity.account.id);
    if (!id) throw new NotFoundException('Athlete profile not found.');
    return id;
  }
  private fail(error: unknown): never {
    if (error instanceof PlanningError) {
      if (error.kind === 'invalid')
        throw new BadRequestException(error.message);
      if (error.kind === 'missing') throw new NotFoundException(error.message);
      throw new ConflictException(error.message);
    }
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'P2002')
        throw new ConflictException(
          'This position or week number is already occupied.',
        );
      if (error.code === 'P2003')
        throw new ConflictException(
          'A historical reference prevents this change.',
        );
    }
    throw error;
  }
  async get(identity: AuthenticatedIdentity, planId: string) {
    try {
      return await this.repository.get(await this.athlete(identity), planId);
    } catch (error) {
      this.fail(error);
    }
  }
  async days(identity: AuthenticatedIdentity, planId: string, weekId: string) {
    const plan = await this.get(identity, planId);
    const week = plan.attributes.weeks.find((item) => item.id === weekId);
    if (!week) throw new NotFoundException('Plan week not found.');
    return week.days;
  }
  async pending(
    identity: AuthenticatedIdentity,
    planId: string,
    weekId: string,
  ) {
    const plan = await this.get(identity, planId);
    const week = plan.attributes.weeks.find((item) => item.id === weekId);
    if (!week) throw new NotFoundException('Plan week not found.');
    return week.pendingExercises;
  }
  async change(
    identity: AuthenticatedIdentity,
    planId: string,
    weekId: string,
    command: PlanningCommand,
  ) {
    if (
      (command.action === 'updateDay' || command.action === 'updateExercise') &&
      !Object.keys(command.input).some(
        (key) => key!=='expectedVersion' && command.input[key as keyof typeof command.input] !== undefined,
      )
    ) {
      throw new BadRequestException('At least one editable field is required.');
    }
    try {
      return await this.repository.change(
        await this.athlete(identity),
        planId,
        weekId,
        command,
      );
    } catch (error) {
      this.fail(error);
    }
  }
}
