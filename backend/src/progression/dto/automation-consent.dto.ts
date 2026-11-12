import { Type } from 'class-transformer';
import {
  IsIn,
  Equals,
  Matches,
  Length,
  IsDefined,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
} from 'class-validator';
import type { ConsentContract } from '../../models/progression/automation-consent.model';
import type { RecommendationPolicy } from '../../models/progression/recommendation-draft.model';
class LimitsDto {
  @IsIn(['KG', 'LB']) unit: 'KG' | 'LB';
  @IsIn(['EXTERNAL_TOTAL']) loadMeaning: 'EXTERNAL_TOTAL';
  @IsString() @MaxLength(256) maximumAbsoluteIncrement: string;
  @IsString() @MaxLength(256) maximumPercentIncrement: string;
  @IsString() @MaxLength(256) maximumLoad: string;
  @IsInt() @Min(1) @Max(2147483647) maximumApplicationsPerWeek: number;
  @IsInt() @Min(1) @Max(7) weekStartsOn: number;
}
class SelectorDto {
  @IsIn(['EXACT_PRESCRIPTION_ALLOWLIST']) kind: 'EXACT_PRESCRIPTION_ALLOWLIST';
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  prescriptionIds: string[];
  @IsIn([true]) futureOnly: true;
  @IsIn(['DRAFT']) planState: 'DRAFT';
  @IsIn(['READ_CURRENT_AND_CAS']) versionPolicy: 'READ_CURRENT_AND_CAS';
}
class ValidityDto {
  @IsISO8601({ strict: true }) startsAt: string;
  @IsISO8601({ strict: true }) endsAt: string;
  @IsString() @MaxLength(100) timeZone: string;
}
class ProvenanceDto {
  @IsIn(['INTERNAL_CONFIGURATION_REQUEST'])
  source: 'INTERNAL_CONFIGURATION_REQUEST';
  @IsString() @MaxLength(160) reference: string;
}
export class ConsentContractDto implements ConsentContract {
  @IsIn(['automation-consent-contract-v1'])
  schemaVersion: 'automation-consent-contract-v1';
  @IsUUID('4') exerciseId: string;
  @IsOptional() @IsUUID('4') trainingPlanId: string | null;
  @IsObject() policy: RecommendationPolicy;
  @IsInt() @Min(1) @Max(3660) historyWindowDays: number;
  @IsObject() @ValidateNested() @Type(() => LimitsDto) limits: LimitsDto;
  @IsObject() @ValidateNested() @Type(() => SelectorDto) selector: SelectorDto;
  @IsObject() @ValidateNested() @Type(() => ValidityDto) validity: ValidityDto;
  @IsString() @MaxLength(160) termsVersion: string;
  @IsObject()
  @ValidateNested()
  @Type(() => ProvenanceDto)
  provenance: ProvenanceDto;
}
export class ConsentPreviewDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentContractDto)
  contract: ConsentContractDto;
}
export class ConsentCreateDto extends ConsentPreviewDto {
  @IsUUID('4') intentId: string;
}
export class ConsentReviseDto extends ConsentCreateDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion: number;
}
export class ConsentRevokeDto {
  @IsUUID('4') intentId: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion: number;
  @IsIn(['OWNER_REQUEST']) reason: 'OWNER_REQUEST';
}
export class ConsentListDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional()
  @IsIn(['PENDING_CONFIRMATION', 'ACCEPTED_INACTIVE', 'REVOKED'])
  state?: 'PENDING_CONFIRMATION' | 'ACCEPTED_INACTIVE' | 'REVOKED';
}
export class ConsentCandidateDto {
  @IsUUID('4') exerciseId: string;
  @IsOptional() @IsUUID('4') trainingPlanId?: string;
  @IsIn(['KG', 'LB']) unit: 'KG' | 'LB';
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 100;
}

export class ConsentAcceptanceChallengeDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
export class ConsentAcknowledgmentsDto {
  @Equals(true) policy!: true;
  @Equals(true) limits!: true;
  @Equals(true) destinations!: true;
  @Equals(true) validity!: true;
  @Equals(true) revocation!: true;
}
export class ConsentAcceptDto extends ConsentAcceptanceChallengeDto {
  @IsUUID('4') intentId!: string;
  @IsUUID('4') challengeId!: string;
  @Equals('PENDING_CONFIRMATION') expectedState!: 'PENDING_CONFIRMATION';
  @Matches(/^[0-9a-f]{64}$/) contractKey!: string;
  @Matches(/^[0-9a-f]{64}$/) conditionsKey!: string;
  @Matches(/^[0-9a-f]{64}$/) contextKey!: string;
  @IsString() @Length(1, 160) termsVersion!: string;
  @Equals('recurring-consent-presentation-v1')
  presentationVersion!: 'recurring-consent-presentation-v1';
  @Equals(true) conditionsPresented!: true;
  @ValidateNested()
  @Type(() => ConsentAcknowledgmentsDto)
  @IsDefined()
  acknowledgments!: ConsentAcknowledgmentsDto;
}
