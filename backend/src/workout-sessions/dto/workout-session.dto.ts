import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { WorkoutStatus } from '../../generated/prisma/enums';

export class CreateWorkoutSessionDto {
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

export class AddWorkoutExerciseDto {
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
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) {
      throw new BadRequestException('This action does not accept body fields.');
    }
    return {};
  }
}
