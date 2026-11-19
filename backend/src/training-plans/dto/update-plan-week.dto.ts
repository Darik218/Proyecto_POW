import { Transform } from 'class-transformer';
import {
  IsDateString,
  Matches,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdatePlanWeekDto {
  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(520)
  weekNumber?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  objective?: string | null;
  @IsOptional()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn?: string | null;
}
