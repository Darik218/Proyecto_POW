import { Type } from 'class-transformer';
import { IsUUID, IsInt, Min, Max, Matches, Equals } from 'class-validator';
import { OPERATIONAL_TERMS } from '../../models/progression/automatic-progression.model';
export class OperationalIntentDto {
  @IsUUID('4') intentId!: string;
}
export class OperationalActivationDto extends OperationalIntentDto {
  @IsInt() @Min(1) expectedConsentVersion!: number;
  @Matches(/^[a-f0-9]{64}$/) expectedContractKey!: string;
  @IsUUID('4') acceptanceEventId!: string;
  @Equals(OPERATIONAL_TERMS) activationTermsVersion!: typeof OPERATIONAL_TERMS;
  @Matches(/^[a-f0-9]{64}$/) conditionsKey!: string;
  @Equals(true) confirmActivation!: true;
}
export class OperationalRevocationDto extends OperationalIntentDto {
  @IsUUID('4') grantId!: string;
  @IsInt() @Min(1) expectedGrantVersion!: number;
  @Equals(true) confirmRevocation!: true;
}
export class OperationalPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
