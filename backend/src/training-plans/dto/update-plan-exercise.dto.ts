import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePlanExerciseDto {
  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  position?: number;

  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  targetSets?: number;

  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  targetReps?: number;

  @Transform(({ value }) => (value === null ? null : typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  targetRpe?: number | null;

  @Transform(({ value }) => (value === null ? null : typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(99999.999)
  targetLoad?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
