import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
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
  OneRmSuitability,
} from '../../generated/prisma/client';

const muscleGroupKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateExerciseDto {
  @ValidateIf((_o,v)=>v!==undefined) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({each:true}) @Length(2,160,{each:true}) aliases?: string[];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Matches(muscleGroupKeyPattern)
  primaryMuscleGroupKey!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(muscleGroupKeyPattern, { each: true })
  secondaryMuscleGroupKeys?: string[];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  equipment!: string;

  @IsEnum(ExerciseEquipmentType)
  equipmentType!: ExerciseEquipmentType;

  @IsOptional()
  @IsEnum(ExerciseMachineType)
  machineType?: ExerciseMachineType | null;

  @IsOptional()
  @IsEnum(ExerciseResistanceType)
  resistanceType?: ExerciseResistanceType | null;

  @IsOptional()
  @IsEnum(ExerciseMovementType)
  movementType?: ExerciseMovementType | null;

  @IsOptional()
  @IsEnum(ExerciseMovementPattern)
  movementPattern?: ExerciseMovementPattern | null;

  @IsOptional()
  @IsEnum(ExerciseGrip)
  grip?: ExerciseGrip | null;

  @IsOptional()
  @IsEnum(ExerciseGripWidth)
  gripWidth?: ExerciseGripWidth | null;

  @IsOptional()
  @IsEnum(ExerciseBodyPosition)
  bodyPosition?: ExerciseBodyPosition | null;

  @IsOptional()
  @IsEnum(ExerciseLaterality)
  laterality?: ExerciseLaterality | null;

  @IsOptional()
  @IsEnum(ExerciseMovementPlane)
  movementPlane?: ExerciseMovementPlane | null;

  @IsOptional()
  @IsEnum(ExerciseDifficulty)
  difficulty?: ExerciseDifficulty | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(OneRmSuitability)
  oneRmSuitability?: OneRmSuitability;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;
}

export class UpdateExerciseDto {
  @ValidateIf((_o,v)=>v!==undefined) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({each:true}) @Length(2,160,{each:true}) aliases?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 160)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(muscleGroupKeyPattern)
  primaryMuscleGroupKey?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(muscleGroupKeyPattern, { each: true })
  secondaryMuscleGroupKeys?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  equipment?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ExerciseEquipmentType)
  equipmentType?: ExerciseEquipmentType;

  @IsOptional()
  @IsEnum(ExerciseMachineType)
  machineType?: ExerciseMachineType | null;

  @IsOptional()
  @IsEnum(ExerciseResistanceType)
  resistanceType?: ExerciseResistanceType | null;

  @IsOptional()
  @IsEnum(ExerciseMovementType)
  movementType?: ExerciseMovementType | null;

  @IsOptional()
  @IsEnum(ExerciseMovementPattern)
  movementPattern?: ExerciseMovementPattern | null;

  @IsOptional()
  @IsEnum(ExerciseGrip)
  grip?: ExerciseGrip | null;

  @IsOptional()
  @IsEnum(ExerciseGripWidth)
  gripWidth?: ExerciseGripWidth | null;

  @IsOptional()
  @IsEnum(ExerciseBodyPosition)
  bodyPosition?: ExerciseBodyPosition | null;

  @IsOptional()
  @IsEnum(ExerciseLaterality)
  laterality?: ExerciseLaterality | null;

  @IsOptional()
  @IsEnum(ExerciseMovementPlane)
  movementPlane?: ExerciseMovementPlane | null;

  @IsOptional()
  @IsEnum(ExerciseDifficulty)
  difficulty?: ExerciseDifficulty | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(OneRmSuitability)
  oneRmSuitability?: OneRmSuitability;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;
}
