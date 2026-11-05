import { DailyPlanningController } from './daily-planning.controller';
import { DailyPlanningService } from './daily-planning.service';
import { PrismaDailyPlanningRepository } from './prisma-daily-planning.repository';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { PrismaTrainingPlansRepository } from './prisma-training-plans.repository';
import { TRAINING_PLANS_REPOSITORY } from './training-plans.repository';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingPlansController, DailyPlanningController],
  providers: [
    TrainingPlansService, DailyPlanningService, PrismaDailyPlanningRepository,
    { provide: TRAINING_PLANS_REPOSITORY, useClass: PrismaTrainingPlansRepository },
  ],
})
export class TrainingPlansModule {}
