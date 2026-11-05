import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AthletesModule } from '../athletes/athletes.module';
import { PrismaModule } from '../database/prisma.module';
import { WorkoutSessionsController } from './workout-sessions.controller';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WORKOUT_SESSIONS_REPOSITORY } from './workout-sessions.repository';
import { PrismaWorkoutSessionsRepository } from './prisma-workout-sessions.repository';

@Module({
  imports: [AuthModule, AthletesModule, PrismaModule], controllers: [WorkoutSessionsController],
  providers: [WorkoutSessionsService, { provide: WORKOUT_SESSIONS_REPOSITORY, useClass: PrismaWorkoutSessionsRepository }],
})
export class WorkoutSessionsModule {}
