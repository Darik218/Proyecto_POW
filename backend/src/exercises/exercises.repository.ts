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

export type ExerciseGroupView = { key: string; name: string };
export type MuscleGroupView = ExerciseGroupView & { description: string | null };

export type ExerciseRecord = {
  id: string;
  name: string;
  description: string | null;
  equipment: string;
  equipmentType: ExerciseEquipmentType;
  machineType: ExerciseMachineType | null;
  resistanceType: ExerciseResistanceType | null;
  movementType: ExerciseMovementType | null;
  movementPattern: ExerciseMovementPattern | null;
  grip: ExerciseGrip | null;
  gripWidth: ExerciseGripWidth | null;
  bodyPosition: ExerciseBodyPosition | null;
  laterality: ExerciseLaterality | null;
  movementPlane: ExerciseMovementPlane | null;
  difficulty: ExerciseDifficulty | null;
  oneRmSuitability: OneRmSuitability;
  instructions: string | null;
  origin: ExerciseOrigin;
  isActive: boolean;
  ownerId: string | null;
  primaryMuscleGroup: ExerciseGroupView;
  secondaryMuscleGroups: ExerciseGroupView[];
  createdAt: Date;
  updatedAt: Date;
};

export type ExerciseView = Omit<ExerciseRecord, 'ownerId' | 'isActive'> & { isOwner: boolean };
export type ExercisePageResult = { items: ExerciseView[]; total: number; limit: number; offset: number };
export type ExerciseListRecords = { items: ExerciseRecord[]; total: number };

export type ExerciseWriteValues = {
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
  | { kind: 'created'; exercise: ExerciseRecord }
  | { kind: 'missing-muscle-group' }
  | { kind: 'duplicate-muscle-group' };
export type UpdateExerciseOutcome =
  | { kind: 'updated'; exercise: ExerciseRecord }
  | { kind: 'missing-muscle-group' }
  | { kind: 'duplicate-muscle-group' }
  | { kind: 'not-found' }
  | { kind: 'historical-reference' };

export interface ExercisesRepository {
  listMuscleGroups(): Promise<MuscleGroupView[]>;
  listGlobal(query: ExercisePage): Promise<ExerciseListRecords>;
  listMine(ownerId: string, query: ExercisePage): Promise<ExerciseListRecords>;
  findVisibleById(id: string, ownerId?: string): Promise<ExerciseRecord | null>;
  createPersonal(ownerId: string, values: ExerciseWriteValues): Promise<CreateExerciseOutcome>;
  updatePersonal(ownerId: string, id: string, values: ExerciseUpdateValues): Promise<UpdateExerciseOutcome>;
  deactivatePersonal(ownerId: string, id: string): Promise<boolean>;
}
