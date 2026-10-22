import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class CreatePlanWeekDto {
  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(520)
  weekNumber!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  objective?: string;
}
