import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
export class WorkoutVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class WorkoutTargetsDto {
  @IsOptional() @IsInt() @Min(1) @Max(1000) targetSets?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) targetRepsMin?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) targetRepsMax?: number | null;
  @IsOptional() @Matches(/^\d{1,5}(\.\d{1,3})?$/) targetLoad?: string | null;
  @IsOptional() @IsIn(['KG', 'LB']) targetLoadUnit?: 'KG' | 'LB' | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(10) targetRpe?:
    number | null;
}
export class UpdateWorkoutExerciseDto extends WorkoutTargetsDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @ValidateIf((_o, value) => value !== undefined)
  @IsBoolean()
  isOmitted?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}
export class ReorderWorkoutDto extends WorkoutVersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
export class UpdateWorkoutDto extends WorkoutVersionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_o, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @ValidateIf((_o, value) => value !== undefined)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  performedOn?: string;
  @ValidateIf((_o, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timeZone?: string;
  @ValidateIf((_o, value) => value !== undefined)
  @IsIn(['LIVE', 'RETROSPECTIVE'])
  recordingMode?: 'LIVE' | 'RETROSPECTIVE';
}
export class ImportWorkoutDayDto extends WorkoutVersionDto {
  @IsUUID('4') id!: string;
  @IsUUID('4') planDayId!: string;
}
export class SaveWorkoutDayDto {
  @IsUUID('4') id!: string;
  @IsUUID('4') trainingPlanId!: string;
  @IsUUID('4') planWeekId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
  @IsInt() @Min(1) @Max(1000) position!: number;
  @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number | null;
}

export class WorkoutSetInputDto {
  @IsInt() @Min(1) @Max(1000) setNumber!: number;
  @IsIn(['PENDING', 'COMPLETED', 'INCOMPLETE', 'FAILED', 'SKIPPED']) status!:
    'PENDING' | 'COMPLETED' | 'INCOMPLETE' | 'FAILED' | 'SKIPPED';
  @IsIn(['WARMUP', 'WORK']) kind!: 'WARMUP' | 'WORK';
  @IsOptional() @Matches(/^\d{1,5}(\.\d{1,3})?$/) load?: string | null;
  @IsOptional() @IsIn(['KG', 'LB']) loadUnit?: 'KG' | 'LB' | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) repetitions?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(10) rpe?:
    number | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsInt() @Min(0) expectedVersion!: number;
}
export class CreateWorkoutSetDto extends WorkoutSetInputDto {
  @IsUUID('4') id!: string;
}
export class UpdateWorkoutSetDto extends WorkoutSetInputDto {
  @IsInt() @Min(0) expectedSetVersion!: number;
}
