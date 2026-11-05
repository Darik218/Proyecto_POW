import { Injectable } from '@nestjs/common';
import {
  ExerciseOrigin,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  ExerciseFilters,
  ExerciseListRecords,
  MuscleGroupView,
  ExercisePage,
  ExerciseRecord,
  ExerciseUpdateValues,
  CreateExerciseOutcome,
  UpdateExerciseOutcome,
  ExerciseWriteValues,
  ExercisesRepository,
} from './exercises.repository';

const EXERCISE_SELECT = {
  id: true,
  name: true,
  description: true,
  equipment: true,
  equipmentType: true,
  machineType: true,
  resistanceType: true,
  movementType: true,
  movementPattern: true,
  grip: true,
  gripWidth: true,
  bodyPosition: true,
  laterality: true,
  movementPlane: true,
  difficulty: true,
  oneRmSuitability: true,
  instructions: true,
  origin: true,
  isActive: true,
  ownerId: true,
  primaryMuscleGroup: { select: { key: true, name: true } },
  secondaryMuscleGroups: {
    select: { muscleGroup: { select: { key: true, name: true } } },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExerciseSelect;

type SelectedExercise = Prisma.ExerciseGetPayload<{ select: typeof EXERCISE_SELECT }>;

function toRecord(exercise: SelectedExercise): ExerciseRecord {
  const { secondaryMuscleGroups, ...fields } = exercise;
  return {
    ...fields,
    secondaryMuscleGroups: secondaryMuscleGroups
      .map(({ muscleGroup }) => muscleGroup)
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function filterWhere(filters: ExerciseFilters): Prisma.ExerciseWhereInput {
  const conditions: Prisma.ExerciseWhereInput[] = [];
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.primaryMuscleGroupKey) {
    conditions.push({ primaryMuscleGroup: { key: filters.primaryMuscleGroupKey } });
  }
  if (filters.secondaryMuscleGroupKey) {
    conditions.push({
      secondaryMuscleGroups: {
        some: { muscleGroup: { key: filters.secondaryMuscleGroupKey } },
      },
    });
  }
  if (filters.equipmentType) conditions.push({ equipmentType: filters.equipmentType });
  if (filters.machineType) conditions.push({ machineType: filters.machineType });
  if (filters.resistanceType) conditions.push({ resistanceType: filters.resistanceType });
  if (filters.movementType) conditions.push({ movementType: filters.movementType });
  if (filters.movementPattern) conditions.push({ movementPattern: filters.movementPattern });
  if (filters.difficulty) conditions.push({ difficulty: filters.difficulty });
  return conditions.length ? { AND: conditions } : {};
}

const HISTORY_RELATIONS: Prisma.ExerciseWhereInput[] = [
  { planExercises: { some: {} } },
  { workoutExercises: { some: {} } },
  { estimates: { some: {} } },
  { settings: { some: {} } },
  { recommendations: { some: {} } },
];

@Injectable()
export class PrismaExercisesRepository implements ExercisesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMuscleGroups(): Promise<MuscleGroupView[]> {
    return this.prisma.muscleGroup.findMany({
      orderBy: [{ name: 'asc' }, { key: 'asc' }],
      select: { key: true, name: true, description: true },
    });
  }

  async listGlobal(query: ExercisePage): Promise<ExerciseListRecords> {
    return this.list({ origin: ExerciseOrigin.GLOBAL, isActive: true }, query);
  }

  async listMine(ownerId: string, query: ExercisePage): Promise<ExerciseListRecords> {
    return this.list({ origin: ExerciseOrigin.PERSONAL, ownerId, isActive: true }, query);
  }

  async findVisibleById(id: string, ownerId?: string): Promise<ExerciseRecord | null> {
    const visibility: Prisma.ExerciseWhereInput[] = [{ origin: ExerciseOrigin.GLOBAL }];
    if (ownerId) visibility.push({ origin: ExerciseOrigin.PERSONAL, ownerId });
    const exercise = await this.prisma.exercise.findFirst({
      where: { id, isActive: true, OR: visibility },
      select: EXERCISE_SELECT,
    });
    return exercise ? toRecord(exercise) : null;
  }

  async createPersonal(ownerId: string, values: ExerciseWriteValues): Promise<CreateExerciseOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const groups = await this.resolveGroups(tx, values.primaryMuscleGroupKey, values.secondaryMuscleGroupKeys ?? []);
      if (groups.kind !== 'valid') return groups;
      const exercise = await tx.exercise.create({
        data: {
          origin: ExerciseOrigin.PERSONAL,
          ownerId,
          catalogKey: null,
          name: values.name,
          equipment: values.equipment,
          equipmentType: values.equipmentType,
          primaryMuscleGroupId: groups.primaryId,
          secondaryMuscleGroups: {
            create: groups.secondaryIds.map((muscleGroupId) => ({ muscleGroup: { connect: { id: muscleGroupId } } })),
          },
          machineType: values.machineType ?? null,
          resistanceType: values.resistanceType ?? null,
          movementType: values.movementType ?? null,
          movementPattern: values.movementPattern ?? null,
          grip: values.grip ?? null,
          gripWidth: values.gripWidth ?? null,
          bodyPosition: values.bodyPosition ?? null,
          laterality: values.laterality ?? null,
          movementPlane: values.movementPlane ?? null,
          difficulty: values.difficulty ?? null,
          oneRmSuitability: values.oneRmSuitability ?? 'UNDETERMINED',
          description: values.description ?? null,
          instructions: values.instructions ?? null,
        },
        select: EXERCISE_SELECT,
      });
      return { kind: 'created', exercise: toRecord(exercise) };
    });
  }

  async updatePersonal(ownerId: string, id: string, values: ExerciseUpdateValues): Promise<UpdateExerciseOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.exercise.findFirst({
        where: { id, ownerId, origin: ExerciseOrigin.PERSONAL, isActive: true },
        select: { id: true },
      });
      if (!existing) return { kind: 'not-found' };

      const historical = await tx.exercise.findFirst({
        where: { id, OR: HISTORY_RELATIONS },
        select: { id: true },
      });
      if (historical) return { kind: 'historical-reference' };

      let primaryId: string | undefined;
      let secondaryIds: string[] | undefined;
      if (values.primaryMuscleGroupKey !== undefined || values.secondaryMuscleGroupKeys !== undefined) {
        const primaryKey = values.primaryMuscleGroupKey ?? (await tx.exercise.findUniqueOrThrow({
          where: { id }, select: { primaryMuscleGroup: { select: { key: true } } },
        })).primaryMuscleGroup.key;
        const secondaryKeys = values.secondaryMuscleGroupKeys ?? (await tx.exercise.findUniqueOrThrow({
          where: { id }, select: { secondaryMuscleGroups: { select: { muscleGroup: { select: { key: true } } } } },
        })).secondaryMuscleGroups.map(({ muscleGroup }) => muscleGroup.key);
        const groups = await this.resolveGroups(tx, primaryKey, secondaryKeys);
        if (groups.kind !== 'valid') return groups;
        primaryId = groups.primaryId;
        secondaryIds = groups.secondaryIds;
      }

      const data: Prisma.ExerciseUpdateInput = {};
      for (const field of [
        'name', 'equipment', 'equipmentType', 'machineType', 'resistanceType',
        'movementType', 'movementPattern', 'grip', 'gripWidth', 'bodyPosition',
        'laterality', 'movementPlane', 'difficulty', 'oneRmSuitability',
        'description', 'instructions',
      ] as const) {
        if (values[field] !== undefined) Object.assign(data, { [field]: values[field] });
      }
      if (primaryId) data.primaryMuscleGroup = { connect: { id: primaryId } };
      if (secondaryIds) {
        data.secondaryMuscleGroups = {
          deleteMany: {},
          create: secondaryIds.map((muscleGroupId) => ({ muscleGroup: { connect: { id: muscleGroupId } } })),
        };
      }
      const exercise = await tx.exercise.update({ where: { id }, data, select: EXERCISE_SELECT });
      return { kind: 'updated', exercise: toRecord(exercise) };
    });
  }

  async deactivatePersonal(ownerId: string, id: string): Promise<boolean> {
    const result = await this.prisma.exercise.updateMany({
      where: { id, ownerId, origin: ExerciseOrigin.PERSONAL, isActive: true },
      data: { isActive: false },
    });
    return result.count === 1;
  }

  private async list(where: Prisma.ExerciseWhereInput, query: ExercisePage): Promise<ExerciseListRecords> {
    const filters = filterWhere(query);
    const whereWithFilters = { AND: [where, filters] };
    const [exercises, total] = await Promise.all([
      this.prisma.exercise.findMany({
        where: whereWithFilters,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: query.offset,
        take: query.limit,
        select: EXERCISE_SELECT,
      }),
      this.prisma.exercise.count({ where: whereWithFilters }),
    ]);
    return { items: exercises.map(toRecord), total };
  }

  private async resolveGroups(
    tx: Prisma.TransactionClient,
    primaryKey: string,
    secondaryKeys: string[],
  ): Promise<{ kind: 'valid'; primaryId: string; secondaryIds: string[] } | { kind: 'missing-muscle-group' | 'duplicate-muscle-group' }> {
    if (secondaryKeys.includes(primaryKey) || new Set(secondaryKeys).size !== secondaryKeys.length) {
      return { kind: 'duplicate-muscle-group' };
    }
    const keys = [primaryKey, ...secondaryKeys];
    const groups = await tx.muscleGroup.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    if (groups.length !== keys.length) return { kind: 'missing-muscle-group' };
    const idsByKey = new Map(groups.map(({ id, key }) => [key, id]));
    return {
      kind: 'valid',
      primaryId: idsByKey.get(primaryKey)!,
      secondaryIds: secondaryKeys.map((key) => idsByKey.get(key)!),
    };
  }
}
