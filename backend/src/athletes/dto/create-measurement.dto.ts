import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMeasurementDto {
  @Transform(({ value }) => (typeof value === 'number' ? value : Number(value)))
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(9999.999)
  bodyWeight!: number;

  @IsDateString({ strict: true })
  measuredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
