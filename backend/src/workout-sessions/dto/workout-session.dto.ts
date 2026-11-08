export { WorkoutVersionDto } from './workout-preparation.dto';
import {
  WorkoutTargetsDto,
  WorkoutVersionDto,
} from './workout-preparation.dto';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsDateString,
  Matches,
  MinLength,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { WorkoutStatus } from '../../generated/prisma/enums';

export class CreateWorkoutSessionDto {
  @ValidateIf((_o,v)=>v!==undefined) @IsUUID('4') scheduledActivityId?: string;
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  performedOn!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsIn(['LIVE', 'RETROSPECTIVE']) recordingMode: 'LIVE' | 'RETROSPECTIVE' =
    'LIVE';
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  planDayId?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  repeatFromId?: string;

  @IsUUID('4')
  id!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  trainingPlanId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  planWeekId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class AddWorkoutExerciseDto extends WorkoutTargetsDto {
  @IsInt() @Min(0) expectedVersion: number = 0;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  replacesWorkoutExerciseId?: string;
  @IsUUID('4')
  id!: string;

  @IsUUID('4')
  exerciseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class ListWorkoutSessionsDto {
  @IsOptional() @IsUUID('4') planWeekId?:string;
  @IsOptional() @IsUUID('4') planDayId?: string;
  @IsOptional() @IsUUID('4') scheduledActivityId?: string;
  @IsOptional() @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) @IsDateString({strict:true}) from?: string;
  @IsOptional() @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) @IsDateString({strict:true}) to?: string;
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

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(WorkoutStatus)
  status?: WorkoutStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  trainingPlanId?: string;
}

@Injectable()
export class EmptyWorkoutBodyPipe implements PipeTransform {
  transform(value: unknown): Record<string, never> {
    if (value === undefined) return {};
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    ) {
      throw new BadRequestException('This action does not accept body fields.');
    }
    return {};
  }
}

export class AssociateWorkoutDto extends WorkoutVersionDto {
  @IsUUID('4') trainingPlanId!: string;
  @IsUUID('4') planWeekId!: string;
  @IsUUID('4') planDayId!: string;
}
export class CompleteWorkoutDto extends WorkoutVersionDto {
  @IsOptional() @IsBoolean() confirmWithoutResults?: boolean;
}
export class WorkoutSuggestionsDto {
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  performedOn!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timeZone!: string;
}
