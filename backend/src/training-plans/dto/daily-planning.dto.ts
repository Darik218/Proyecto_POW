import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class PlanningRevisionDto { @ValidateIf((_o,v)=>v!==undefined) @IsInt() @Min(0) expectedVersion?:number; }
export class UpdatePlanDayDto extends PlanningRevisionDto {
  @ValidateIf((_o, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;
}
export class CreatePlanDayDto extends PlanningRevisionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;

  @IsInt()
  @Min(1)
  @Max(1000)
  position!: number;
}
export class CopyPlanDayDto extends PlanningRevisionDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  position!: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
}
export class CopyPlanWeekDto extends PlanningRevisionDto {
  @IsInt()
  @Min(1)
  @Max(520)
  weekNumber!: number;
}
export class ReorderPlanningDto extends PlanningRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
class PrescriptionTargetsDto extends PlanningRevisionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  targetReps?: number | null;
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(10000)
  targetRepsMin?: number;
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(10000)
  targetRepsMax?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  targetRpe?: number | null;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(99999.999)
  targetLoad?: number | null;
  @IsOptional()
  @IsIn(['KG', 'LB'])
  targetLoadUnit?: 'KG' | 'LB' | null;
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
export class DailyPrescriptionDto extends PrescriptionTargetsDto {
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  position?: number;
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  targetSets?: number;
}
export class CreateDailyPrescriptionDto extends PrescriptionTargetsDto {
  @IsUUID('4') exerciseId!: string;
  @IsInt() @Min(1) @Max(1000) position!: number;
  @IsInt() @Min(1) @Max(1000) targetSets!: number;
}
export class DistributePrescriptionDto extends PlanningRevisionDto {
  @IsUUID('4') dayId!: string;
  @IsInt() @Min(1) @Max(1000) position!: number;
  @IsBoolean() copy!: boolean;
}
