import type { PrismaClient } from '../src/generated/prisma/client';
import { exercises, muscleGroups } from './exercise-catalog.seed';
import { exerciseAliases, featuredExerciseKeys } from './exercise-aliases.seed';
export async function seedCatalog(prisma: PrismaClient, entries = exercises) {
  return prisma.$transaction(
    async (tx) => {
      // Serialize concurrent seed executions. Existing exercise metadata and private records are preserved.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72813011)`;
      const groupIds = new Map<string, string>();
      for (const group of muscleGroups) {
        const existing = await tx.muscleGroup.findFirst({
          where: { OR: [{ key: group.key }, { name: group.name }] },
          select: { id: true },
        });
        const saved =
          existing ??
          (await tx.muscleGroup.create({ data: group, select: { id: true } }));
        groupIds.set(group.key, saved.id);
      }
      let inserted = 0;
      for (const row of entries) {
        const {
          primaryMuscleGroupKey,
          secondaryMuscleGroupKeys,
          aliases: _aliases,
          featuredRank: _rank,
          ...metadata
        } = row;
        const primaryId = groupIds.get(primaryMuscleGroupKey);
        if (
          !primaryId ||
          secondaryMuscleGroupKeys.some((key) => !groupIds.has(key))
        )
          throw new Error('Unknown seeded muscle group.');
        let saved = await tx.exercise.findUnique({
          where: { catalogKey: row.catalogKey },
          select: { id: true, origin: true },
        });
        if (saved?.origin === 'PERSONAL')
          throw new Error(
            'A global catalog key belongs to a private record; manual review is required.',
          );
        if (!saved) {
          const candidates = await tx.exercise.findMany({
            where: {
              origin: 'GLOBAL',
              catalogKey: null,
              name: row.name,
              equipmentType: row.equipmentType,
              equipment: row.equipment,
              machineType: row.machineType,
              resistanceType: row.resistanceType,
              movementType: row.movementType,
              movementPattern: row.movementPattern,
              primaryMuscleGroupId: primaryId,
              laterality: row.laterality,
              gripWidth: row.gripWidth,
              grip: row.grip,
              bodyPosition: row.bodyPosition,
            },
            select: { id: true },
            take: 2,
          });
          if (candidates.length > 1)
            throw new Error(
              'Ambiguous legacy catalog identity; manual review is required.',
            );
          const legacy = candidates[0];
          saved = legacy
            ? await tx.exercise.update({
                where: { id: legacy.id },
                data: { catalogKey: row.catalogKey },
                select: { id: true, origin: true },
              })
            : await tx.exercise.create({
                data: {
                  ...metadata,
                  origin: 'GLOBAL',
                  ownerId: null,
                  primaryMuscleGroupId: primaryId,
                  secondaryMuscleGroups: {
                    create: secondaryMuscleGroupKeys.map((key) => ({
                      muscleGroupId: groupIds.get(key)!,
                    })),
                  },
                },
                select: { id: true, origin: true },
              });
          if (!legacy) inserted++;
        }
        const featured = featuredExerciseKeys.indexOf(row.catalogKey);
        if (featured >= 0)
          await tx.exercise.updateMany({
            where: {
              id: saved.id,
              OR: [
                { featuredRank: null },
                { featuredRank: { not: featured + 1 } },
              ],
            },
            data: { featuredRank: featured + 1 },
          });
        const aliases = [
          ...(row.aliases ?? []),
          ...(exerciseAliases[row.catalogKey] ?? []),
        ];
        if (aliases.length)
          await tx.exerciseAlias.createMany({
            data: aliases.map((name) => ({ exerciseId: saved!.id, name })),
            skipDuplicates: true,
          });
      }
      const count = await tx.exercise.count({
        where: {
          origin: 'GLOBAL',
          catalogKey: { in: entries.map((e) => e.catalogKey) },
        },
      });
      if (count !== entries.length)
        throw new Error('Seed catalog verification failed.');
      const aliases = await tx.exerciseAlias.count({
        where: {
          exercise: {
            origin: 'GLOBAL',
            catalogKey: { in: entries.map((e) => e.catalogKey) },
          },
        },
      });
      return { inserted, count, aliases };
    },
    { timeout: 120000 },
  );
}
