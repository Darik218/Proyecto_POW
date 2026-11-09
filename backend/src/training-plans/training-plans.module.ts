import { FlexiblePlanningController } from '../controllers/training-plans/flexible-planning.controller';
import { FlexiblePlanningPresenter } from '../views/training-plans/flexible-planning.presenter';
import { FlexiblePlanningService } from './flexible-planning.service';
import { PrismaFlexiblePlanningRepository } from './prisma-flexible-planning.repository';
import { DailyPlanningController } from '../controllers/training-plans/daily-planning.controller';
import { DailyPlanningPresenter } from '../views/training-plans/daily-planning.presenter';
import { DailyPlanningService } from './daily-planning.service';
import { PrismaDailyPlanningRepository } from './prisma-daily-planning.repository';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { PrismaTrainingPlansRepository } from './prisma-training-plans.repository';
import { TRAINING_PLANS_REPOSITORY } from './training-plans.repository';
import { TrainingPlansController } from '../controllers/training-plans/training-plans.controller';
import { TrainingPlansPresenter } from '../views/training-plans/training-plans.presenter';
import { TrainingPlansService } from './training-plans.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FlexiblePlanningController, TrainingPlansController, DailyPlanningController],
  providers: [FlexiblePlanningService, FlexiblePlanningPresenter, PrismaFlexiblePlanningRepository,
    TrainingPlansService, TrainingPlansPresenter, DailyPlanningPresenter, DailyPlanningService, PrismaDailyPlanningRepository,
    { provide: TRAINING_PLANS_REPOSITORY, useClass: PrismaTrainingPlansRepository },
  ],
})
export class TrainingPlansModule {}
