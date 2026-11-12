import { IsDateString, IsUUID, Matches, ValidateIf } from 'class-validator';

export class WorkoutInsightsQueryDto {
  // A declaration for this read and this workout exercise only; never persisted.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  externalTotalExerciseId?: string;
}
export class WorkoutExerciseReferenceQueryDto {
  @IsUUID('4')
  exerciseId!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  before?: string;
}
