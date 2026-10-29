import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { exercises, muscleGroups } from './exercise-catalog.seed';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be configured before seeding.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const muscleGroupIds = new Map<string, string>();
    for (const group of muscleGroups) {
      const byName = await prisma.muscleGroup.findUnique({ where: { name: group.name }, select: { id: true, key: true } });
      const saved = byName
        ? await prisma.muscleGroup.update({
            where: { id: byName.id },
            data: { key: group.key, description: group.description },
            select: { id: true },
          })
        : await prisma.muscleGroup.upsert({
            where: { key: group.key },
            update: { name: group.name, description: group.description },
            create: group,
            select: { id: true },
          });
      muscleGroupIds.set(group.key, saved.id);
    }

    for (const exercise of exercises) {
      const primaryId = muscleGroupIds.get(exercise.primaryMuscleGroupKey);
      const secondaryIds = exercise.secondaryMuscleGroupKeys.map((key) => muscleGroupIds.get(key));
      if (!primaryId || secondaryIds.some((id) => !id)) {
        throw new Error(`Catalog exercise ${exercise.catalogKey} refers to an unknown muscle group.`);
      }

      const data = {
        origin: 'GLOBAL' as const,
        ownerId: null,
        name: exercise.name,
        description: exercise.description,
        instructions: exercise.instructions,
        equipment: exercise.equipment,
        equipmentType: exercise.equipmentType,
        machineType: exercise.machineType,
        resistanceType: exercise.resistanceType,
        movementType: exercise.movementType,
        movementPattern: exercise.movementPattern,
        grip: exercise.grip,
        gripWidth: exercise.gripWidth,
        bodyPosition: exercise.bodyPosition,
        laterality: exercise.laterality,
        movementPlane: exercise.movementPlane,
        difficulty: exercise.difficulty,
        oneRmSuitability: exercise.oneRmSuitability,
        primaryMuscleGroupId: primaryId,
      };
      const secondaryGroups = {
          deleteMany: {},
          create: secondaryIds.map((muscleGroupId) => ({
            muscleGroup: { connect: { id: muscleGroupId! } },
          })),
      };

      await prisma.exercise.upsert({
        where: { catalogKey: exercise.catalogKey },
        update: { ...data, secondaryMuscleGroups: secondaryGroups },
        create: {
          ...data,
          catalogKey: exercise.catalogKey,
          isActive: true,
          secondaryMuscleGroups: {
            create: secondaryIds.map((muscleGroupId) => ({
              muscleGroup: { connect: { id: muscleGroupId! } },
            })),
          },
        },
      });
    }

    const seededCount = await prisma.exercise.count({
      where: { origin: 'GLOBAL', catalogKey: { in: exercises.map(({ catalogKey }) => catalogKey) } },
    });
    if (seededCount !== exercises.length) {
      throw new Error(`Seed verification expected ${exercises.length} catalog entries, found ${seededCount}.`);
    }
    console.log(`Exercise catalog seed complete: ${seededCount} stable global entries.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Exercise catalog seed failed.', error);
  process.exitCode = 1;
});
