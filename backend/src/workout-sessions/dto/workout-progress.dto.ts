import {
  IsIn,
  IsUUID,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { ProgressPeriod } from '../../models/workout-sessions/workout-progress.model';
export class WorkoutProgressQueryDto {
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsUUID('4')
  planId?: string;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsUUID('4')
  planDayId?: string;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsIn(['7', '30', '90', 'all'])
  period?: ProgressPeriod;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timeZone?: string;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsUUID('4')
  exerciseId?: string;
}
