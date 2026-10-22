import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { ExercisePage, ExercisesRepository, PublicExercise } from './exercises.repository';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  muscleGroup: true,
  equipment: true,
  description: true,
} as const;

@Injectable()
export class PrismaExercisesRepository implements ExercisesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(page: ExercisePage): Promise<PublicExercise[]> {
    return this.prisma.exercise.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: page.offset,
      take: page.limit,
      select: PUBLIC_FIELDS,
    });
  }

  findActiveById(id: string): Promise<PublicExercise | null> {
    return this.prisma.exercise.findFirst({
      where: { id, isActive: true },
      select: PUBLIC_FIELDS,
    });
  }
}
