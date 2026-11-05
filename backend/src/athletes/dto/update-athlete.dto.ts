import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { MeasurementUnit } from '../../generated/prisma/client';

export class UpdateAthleteDto {
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : value))
  @IsDateString({ strict: true })
  birthDate?: string | null;

  @IsOptional()
  @IsEnum(MeasurementUnit)
  preferredUnit?: MeasurementUnit;
}
