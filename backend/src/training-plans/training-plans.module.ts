import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { PrismaTrainingPlansRepository } from './prisma-training-plans.repository';
import { TRAINING_PLANS_REPOSITORY } from './training-plans.repository';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingPlansController],
  providers: [
    TrainingPlansService,
    { provide: TRAINING_PLANS_REPOSITORY, useClass: PrismaTrainingPlansRepository },
  ],
})
export class TrainingPlansModule {}
