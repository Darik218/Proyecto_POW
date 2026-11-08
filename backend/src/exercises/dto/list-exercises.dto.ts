import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ExerciseOrigin,
  ExerciseDifficulty,
  ExerciseEquipmentType,
  ExerciseMachineType,
  ExerciseMovementPattern,
  ExerciseMovementType,
  ExerciseResistanceType,
} from '../../generated/prisma/client';

const muscleGroupKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ListExercisesDto {
  @IsOptional() @IsEnum(ExerciseOrigin) origin?:ExerciseOrigin;
  @IsOptional() @IsIn(['ALL','FEATURED','RECENT']) selection?: 'ALL'|'FEATURED'|'RECENT';
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @Matches(muscleGroupKeyPattern)
  primaryMuscleGroupKey?: string;

  @IsOptional()
  @IsString()
  @Matches(muscleGroupKeyPattern)
  secondaryMuscleGroupKey?: string;

  @IsOptional()
  @IsEnum(ExerciseEquipmentType)
  equipmentType?: ExerciseEquipmentType;

  @IsOptional()
  @IsEnum(ExerciseMachineType)
  machineType?: ExerciseMachineType;

  @IsOptional()
  @IsEnum(ExerciseResistanceType)
  resistanceType?: ExerciseResistanceType;

  @IsOptional()
  @IsEnum(ExerciseMovementType)
  movementType?: ExerciseMovementType;

  @IsOptional()
  @IsEnum(ExerciseMovementPattern)
  movementPattern?: ExerciseMovementPattern;

  @IsOptional()
  @IsEnum(ExerciseDifficulty)
  difficulty?: ExerciseDifficulty;
}
