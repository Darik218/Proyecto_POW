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
} from '../../generated/prisma/client';

// Domain projection: exercise variants, aliases and resolved muscle relationships.
// Storage-only IDs/search columns and public response flags do not belong to this representation.
export type MuscleGroupIdentity = { key: string; name: string };
export type MuscleGroup = MuscleGroupIdentity & { description: string | null };
export type ExerciseAttributes = {
  aliases?: string[];
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
  primaryMuscleGroup: MuscleGroupIdentity;
  secondaryMuscleGroups: MuscleGroupIdentity[];
  createdAt: Date;
  updatedAt: Date;
};

export class Exercise {
  constructor(readonly attributes: Readonly<ExerciseAttributes>) {}

  isOwnedBy(viewerId: string | undefined): boolean {
    return Boolean(viewerId && this.attributes.ownerId === viewerId);
  }

  static hasDistinctAliases(aliases: string[] | undefined): boolean {
    if (!aliases) return true;
    const normalized = aliases.map((value) =>
      value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    );
    return (
      !normalized.some((value) => !value) &&
      new Set(normalized).size === normalized.length
    );
  }
}
