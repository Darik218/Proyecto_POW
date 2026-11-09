import { Exercise } from '../models/exercises/exercise.model';
import type {MuscleGroup} from '../models/exercises/exercise.model';
import { exerciseSearchQuery } from './exercise-search.query';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  ExerciseListResult,
  ExercisePage,
  ExerciseUpdateValues,
  CreateExerciseOutcome,
  UpdateExerciseOutcome,
  ExerciseWriteValues,
  ExercisesRepository,
} from './exercises.repository';

const EXERCISE_SELECT = {
  id: true,
  aliases:{select:{name:true},orderBy:{normalizedName:'asc'}},
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

function toModel(exercise: SelectedExercise): Exercise {
  const { secondaryMuscleGroups, aliases, ...fields } = exercise;
  return new Exercise({
    ...fields,
    aliases:aliases.map(alias=>alias.name),
    secondaryMuscleGroups: secondaryMuscleGroups
      .map(({ muscleGroup }) => muscleGroup)
      .sort((left, right) => left.key.localeCompare(right.key)),
  });
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

  listMuscleGroups(): Promise<MuscleGroup[]> {
    return this.prisma.muscleGroup.findMany({
      orderBy: [{ name: 'asc' }, { key: 'asc' }],
      select: { key: true, name: true, description: true },
    });
  }

  async listGlobal(query: ExercisePage): Promise<ExerciseListResult> {
    return this.ranked(query,'GLOBAL');
  }

  async listMine(ownerId: string, query: ExercisePage): Promise<ExerciseListResult> {
    return this.ranked(query,'PERSONAL',ownerId);
  }

  async findVisibleById(id: string, ownerId?: string): Promise<Exercise | null> {
    const visibility: Prisma.ExerciseWhereInput[] = [{ origin: 'GLOBAL' }];
    if (ownerId) visibility.push({ origin: 'PERSONAL', ownerId });
    const exercise = await this.prisma.exercise.findFirst({
      where: { id, isActive: true, OR: visibility },
      select: EXERCISE_SELECT,
    });
    return exercise ? toModel(exercise) : null;
  }

  async createPersonal(ownerId: string, values: ExerciseWriteValues): Promise<CreateExerciseOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const groups = await this.resolveGroups(tx, values.primaryMuscleGroupKey, values.secondaryMuscleGroupKeys ?? []);
      if (groups.kind !== 'valid') return groups;
      const exercise = await tx.exercise.create({
        data: {
          origin: 'PERSONAL',
          ownerId,
          aliases:{create:(values.aliases??[]).map(name=>({name}))},
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
      return { kind: 'created', exercise: toModel(exercise) };
    });
  }

  async updatePersonal(ownerId: string, id: string, values: ExerciseUpdateValues): Promise<UpdateExerciseOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize the history check with sessions taking references to this exercise.
      await tx.$queryRaw`SELECT id FROM exercises WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE`;
      const existing = await tx.exercise.findFirst({
        where: { id, ownerId, origin: 'PERSONAL', isActive: true },
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
      if(values.aliases!==undefined)data.aliases={deleteMany:{},create:values.aliases.map(name=>({name}))};
      if (primaryId) data.primaryMuscleGroup = { connect: { id: primaryId } };
      if (secondaryIds) {
        data.secondaryMuscleGroups = {
          deleteMany: {},
          create: secondaryIds.map((muscleGroupId) => ({ muscleGroup: { connect: { id: muscleGroupId } } })),
        };
      }
      const exercise = await tx.exercise.update({ where: { id }, data, select: EXERCISE_SELECT });
      return { kind: 'updated', exercise: toModel(exercise) };
    });
  }

  async deactivatePersonal(ownerId: string, id: string): Promise<boolean> {
    const result = await this.prisma.exercise.updateMany({
      where: { id, ownerId, origin: 'PERSONAL', isActive: true },
      data: { isActive: false },
    });
    return result.count === 1;
  }

  async listVisible(ownerId:string,query:ExercisePage){return this.ranked(query,'VISIBLE',ownerId);}
  private async ranked(query:ExercisePage,scope:'GLOBAL'|'PERSONAL'|'VISIBLE',ownerId?:string):Promise<ExerciseListResult>{
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET LOCAL pg_trgm.word_similarity_threshold=0.45`;
      const normalized=query.search?await tx.$queryRaw<{term:string}[]>`SELECT pulso_search_normalize(${query.search}) AS term`:[];
      const sql=exerciseSearchQuery(query,scope,ownerId,normalized[0]?.term);
      const rows=await tx.$queryRaw<{id:string}[]>(sql.ids);
      const counts=await tx.$queryRaw<{total:number}[]>(sql.count);
      const records=rows.length?await tx.exercise.findMany({where:{id:{in:rows.map(row=>row.id)}},select:EXERCISE_SELECT}):[];
      const byId=new Map(records.map(row=>[row.id,row]));
      return{items:rows.map(row=>toModel(byId.get(row.id)!)),total:counts[0]?.total??0};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
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
