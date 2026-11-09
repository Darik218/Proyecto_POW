import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { MeasurementUnit } from '../../generated/prisma/client';

export class UpdateAthleteDto {
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : value))
  @IsDateString({ strict: true })
  birthDate?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(MeasurementUnit)
  preferredUnit?: MeasurementUnit;
}
