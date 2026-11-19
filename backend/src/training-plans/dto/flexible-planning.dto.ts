import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
  IsDateString,
} from 'class-validator';
export class RoutineExerciseTemplateDto {
  @IsUUID('4') exerciseId!: string;
  @IsInt() @Min(1) @Max(1000) position!: number;
  @IsInt() @Min(1) @Max(1000) targetSets!: number;
  @IsInt() @Min(1) @Max(10000) targetRepsMin!: number;
  @IsInt() @Min(1) @Max(10000) targetRepsMax!: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) targetReps?: number | null;
  @IsOptional() @IsString() @Matches(/^\d{1,5}(\.\d{1,3})?$/) targetLoad?:
    string | null;
  @IsOptional() @IsIn(['KG', 'LB']) targetLoadUnit?: 'KG' | 'LB' | null;
}
export class RoutineDayTemplateDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RoutineExerciseTemplateDto)
  exercises?: RoutineExerciseTemplateDto[];
  @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number | null;
}
export class GenerateRoutineDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  restWeekdays?: number[];
  @IsUUID('4') id!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
  @IsInt() @Min(1) @Max(52) durationWeeks!: number;
  @IsInt() @Min(1) @Max(7) frequency!: number;
  @IsOptional()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn?: string | null;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => RoutineDayTemplateDto)
  days?: RoutineDayTemplateDto[];
}
export class PlanningVersionDto {
  @IsUUID('4') id!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}
export class DuplicateRoutineDto extends PlanningVersionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
}
export class NewRoutineDayDto extends PlanningVersionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) timeZone?: string;
  @IsUUID('4') weekId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
  @IsInt() @Min(1) @Max(1000) position!: number;
  @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number | null;
}
export class CopyRoutineDto extends PlanningVersionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) timeZone?: string;
  @IsUUID('4') sourceDayId!: string;
  @IsIn(['NEW_DAY', 'APPEND']) mode!: 'NEW_DAY' | 'APPEND';
  @IsOptional() @IsUUID('4') targetDayId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(52)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  weekIds?: string[];
}
export class FutureRoutineDto extends PlanningVersionDto {
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  fromDate!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
}
export class CreateScheduledActivityDto {
  @IsUUID('4') id!: string;
  @IsOptional() @IsUUID('4') planWeekId?: string;
  @IsOptional() @IsUUID('4') planDayId?: string;
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  scheduledOn!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
  @IsIn(['PLANNED', 'REST']) status!: 'PLANNED' | 'REST';
}
export class UpdateScheduledActivityDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  scheduledOn?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['PLANNED', 'OMITTED', 'WITHDRAWN'])
  status?: 'PLANNED' | 'OMITTED' | 'WITHDRAWN';
}
export class ActivityQueryDto {
  @IsOptional() @IsUUID('4') weekId?: string;
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string;
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
}
