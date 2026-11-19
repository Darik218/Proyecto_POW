import { WorkoutProgressService } from './workout-progress.service';
import { WorkoutProgressPresenter } from '../views/workout-sessions/workout-progress.presenter';
import { WORKOUT_PROGRESS_REPOSITORY } from './workout-progress.repository';
import { PrismaWorkoutProgressRepository } from './prisma-workout-progress.repository';
import { WorkoutInsightsPresenter } from '../views/workout-sessions/workout-insights.presenter';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AthletesModule } from '../athletes/athletes.module';
import { PrismaModule } from '../database/prisma.module';
import { WorkoutSessionsController } from '../controllers/workout-sessions/workout-sessions.controller';
import { WorkoutSessionsPresenter } from '../views/workout-sessions/workout-sessions.presenter';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WORKOUT_SESSIONS_REPOSITORY } from './workout-sessions.repository';
import { PrismaWorkoutSessionsRepository } from './prisma-workout-sessions.repository';

@Module({
  imports: [AuthModule, AthletesModule, PrismaModule],
  controllers: [WorkoutSessionsController],
  providers: [
    WorkoutSessionsService,
    WorkoutProgressService,
    WorkoutProgressPresenter,
    {
      provide: WORKOUT_PROGRESS_REPOSITORY,
      useClass: PrismaWorkoutProgressRepository,
    },
    WorkoutSessionsPresenter,
    WorkoutInsightsPresenter,
    {
      provide: WORKOUT_SESSIONS_REPOSITORY,
      useClass: PrismaWorkoutSessionsRepository,
    },
  ],
})
export class WorkoutSessionsModule {}
