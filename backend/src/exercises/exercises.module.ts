import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { ExercisesController } from './exercises.controller';
import { EXERCISES_REPOSITORY } from './exercises.repository';
import { ExercisesService } from './exercises.service';
import { PrismaExercisesRepository } from './prisma-exercises.repository';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ExercisesController],
  providers: [
    ExercisesService,
    OptionalAccessTokenGuard,
    { provide: EXERCISES_REPOSITORY, useClass: PrismaExercisesRepository },
  ],
})
export class ExercisesModule {}
