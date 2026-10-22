import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { ExercisesController } from './exercises.controller';
import { EXERCISES_REPOSITORY } from './exercises.repository';
import { ExercisesService } from './exercises.service';
import { PrismaExercisesRepository } from './prisma-exercises.repository';

@Module({
  imports: [PrismaModule],
  controllers: [ExercisesController],
  providers: [
    ExercisesService,
    { provide: EXERCISES_REPOSITORY, useClass: PrismaExercisesRepository },
  ],
})
export class ExercisesModule {}
