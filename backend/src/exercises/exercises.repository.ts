import type { Exercise, MuscleGroup } from '../models/exercises/exercise.model';
import type {
  ExerciseBodyPosition,
  ExerciseDifficulty,
  ExerciseEquipmentType,
  ExerciseGrip,
  ExerciseGripWidth,
  ExerciseLaterality,
  ExerciseMachineType,
  ExerciseMovementPattern,
  ExerciseMovementPlane,
  ExerciseMovementType,
  ExerciseResistanceType,
  ExerciseOrigin,
  OneRmSuitability,
} from '../generated/prisma/client';

export const EXERCISES_REPOSITORY = Symbol('EXERCISES_REPOSITORY');

export type ExerciseFilters = {
  origin?: ExerciseOrigin;
  selection?: 'ALL' | 'FEATURED' | 'RECENT';
  search?: string;
  primaryMuscleGroupKey?: string;
  secondaryMuscleGroupKey?: string;
  equipmentType?: ExerciseEquipmentType;
  machineType?: ExerciseMachineType;
  resistanceType?: ExerciseResistanceType;
  movementType?: ExerciseMovementType;
  movementPattern?: ExerciseMovementPattern;
  difficulty?: ExerciseDifficulty;
};

export type ExercisePage = ExerciseFilters & { limit: number; offset: number };

export type ExerciseListResult = { items: Exercise[]; total: number };

export type ExerciseWriteValues = {
  aliases?: string[];
  name: string;
  primaryMuscleGroupKey: string;
  secondaryMuscleGroupKeys?: string[];
  equipment: string;
  equipmentType: ExerciseEquipmentType;
  machineType?: ExerciseMachineType | null;
  resistanceType?: ExerciseResistanceType | null;
  movementType?: ExerciseMovementType | null;
  movementPattern?: ExerciseMovementPattern | null;
  grip?: ExerciseGrip | null;
  gripWidth?: ExerciseGripWidth | null;
  bodyPosition?: ExerciseBodyPosition | null;
  laterality?: ExerciseLaterality | null;
  movementPlane?: ExerciseMovementPlane | null;
  difficulty?: ExerciseDifficulty | null;
  oneRmSuitability?: OneRmSuitability;
  description?: string | null;
  instructions?: string | null;
};

export type ExerciseUpdateValues = Partial<ExerciseWriteValues>;

export type CreateExerciseOutcome =
  | { kind: 'created'; exercise: Exercise }
  | { kind: 'missing-muscle-group' }
  | { kind: 'duplicate-muscle-group' };
export type UpdateExerciseOutcome =
  | { kind: 'updated'; exercise: Exercise }
  | { kind: 'missing-muscle-group' }
  | { kind: 'duplicate-muscle-group' }
  | { kind: 'not-found' }
  | { kind: 'historical-reference' };

export interface ExercisesRepository {
  listMuscleGroups(): Promise<MuscleGroup[]>;
  listGlobal(query: ExercisePage): Promise<ExerciseListResult>;
  listVisible(
    ownerId: string,
    query: ExercisePage,
  ): Promise<ExerciseListResult>;
  listMine(ownerId: string, query: ExercisePage): Promise<ExerciseListResult>;
  findVisibleById(id: string, ownerId?: string): Promise<Exercise | null>;
  createPersonal(
    ownerId: string,
    values: ExerciseWriteValues,
  ): Promise<CreateExerciseOutcome>;
  updatePersonal(
    ownerId: string,
    id: string,
    values: ExerciseUpdateValues,
  ): Promise<UpdateExerciseOutcome>;
  deactivatePersonal(ownerId: string, id: string): Promise<boolean>;
}
