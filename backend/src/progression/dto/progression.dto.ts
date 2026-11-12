import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
  IsArray,
  IsISO8601,
} from 'class-validator';
import type { RecommendationPolicy } from '../../models/progression/recommendation-draft.model';
import type { ManualAcceptance } from '../../models/progression/recommendation-review.model';
const hash = /^[a-f0-9]{64}$/;
class ContextDto {
  @IsUUID('4') workoutExerciseId: string;
  @IsIn([
    'EXTERNAL_TOTAL',
    'PER_HAND',
    'MACHINE_NOMINAL',
    'BODYWEIGHT',
    'ASSISTANCE',
    'NON_QUANTIFIABLE',
    'UNKNOWN',
  ])
  loadMeaning: 'EXTERNAL_TOTAL';
  @IsOptional() @IsString() @MaxLength(160) protocolKey: string | null;
  @IsOptional() @IsString() @MaxLength(160) equipmentKey: string | null;
  @IsIn(['OWNER_DECLARATION_FOR_ANALYSIS'])
  source: 'OWNER_DECLARATION_FOR_ANALYSIS';
}
class PairDto {
  @IsUUID('4') previousTaskId: string;
  @IsUUID('4') currentTaskId: string;
}
class HistoryDto {
  @IsUUID('4') exerciseId: string;
  @IsISO8601({ strict: true }) from: string;
  @IsISO8601({ strict: true }) to: string;
  @IsString() @MaxLength(100) timeZone: string;
  @IsInt() @Min(1) @Max(100) limit: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ContextDto)
  contexts: ContextDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PairDto)
  comparisons: PairDto[];
}
class PeriodDto {
  @IsISO8601({ strict: true }) start: string;
  @IsISO8601({ strict: true }) endExclusive: string;
  @IsISO8601({ strict: true }) cutoffOn: string;
  @IsString() @MaxLength(100) timeZone: string;
  @IsInt() @Min(1) @Max(7) weekStartsOn: number;
}
class DestinationDto {
  @IsIn(['PRESCRIPTION', 'WORKOUT_TASK']) kind: 'PRESCRIPTION';
  @IsOptional() @IsUUID('4') planId: string;
  @IsOptional() @IsUUID('4') weekId: string;
  @IsOptional() @IsUUID('4') dayId: string | null;
  @IsOptional() @IsUUID('4') prescriptionId: string;
  @IsOptional() @IsUUID('4') taskId: string;
}
export class RecommendationCommandDto {
  @IsObject() @ValidateNested() @Type(() => HistoryDto) history: HistoryDto;
  @IsObject() @ValidateNested() @Type(() => PeriodDto) period: PeriodDto;
  @IsObject()
  @ValidateNested()
  @Type(() => DestinationDto)
  destination: DestinationDto;
  @IsOptional() @IsInt() @Min(0) expectedPlanVersion: number;
  @IsOptional() @IsObject() policy: RecommendationPolicy;
}
class DependenciesDto {
  @Matches(hash) configuration: string;
  @Matches(hash) period: string;
  @Matches(hash) destination: string;
  @Matches(hash) evidence: string;
}
export class SaveRecommendationDto {
  @ValidateNested()
  @Type(() => RecommendationCommandDto)
  @IsObject()
  command: RecommendationCommandDto;
  @Matches(hash) expectedSemanticKey: string;
  @ValidateNested()
  @Type(() => DependenciesDto)
  @IsObject()
  expectedDependencyKeys: DependenciesDto;
}
export class InspectRecommendationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RecommendationCommandDto)
  @IsObject()
  command?: RecommendationCommandDto;
}
class AcceptanceDto implements ManualAcceptance {
  @IsIn(['manual-proposal-acceptance-v1'])
  schemaVersion: 'manual-proposal-acceptance-v1';
  @IsIn(['THIS_PROPOSAL_ONLY']) scope: 'THIS_PROPOSAL_ONLY';
  @Matches(hash) authorizationKey: string;
  @Matches(hash) policyKey: string;
  @IsBoolean() @IsIn([true]) acceptPolicy: true;
  @IsBoolean() @IsIn([true]) acceptEvidence: true;
}
export class ReviewRecommendationDto extends InspectRecommendationDto {
  @IsUUID('4') intentId: string;
  @IsIn(['APPROVE', 'REJECT']) action: 'APPROVE' | 'REJECT';
  @IsIn(['PENDING']) expectedStatus: 'PENDING';
  @IsOptional() @IsInt() @Min(0) expectedVersion: number | null;
  @IsOptional() @Matches(hash) expectedSemanticKey: string | null;
  @IsOptional() @Matches(hash) expectedCycleKey: string | null;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DependenciesDto)
  expectedDependencyKeys: DependenciesDto | null;
  @IsOptional() @IsString() @MaxLength(2000) justification?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AcceptanceDto)
  acceptance?: AcceptanceDto;
}
export class ApplicationReadinessDto extends InspectRecommendationDto {
  @IsUUID('4') activityId: string;
  @IsUUID('4') intentId: string;
}
class ApplyDestinationDto {
  @IsUUID('4') planId: string;
  @IsUUID('4') weekId: string;
  @IsUUID('4') dayId: string;
  @IsUUID('4') prescriptionId: string;
}
export class ApplyRecommendationDto extends SaveRecommendationDto {
  @IsUUID('4') recommendationId: string;
  @IsUUID('4') intentId: string;
  @IsUUID('4') reviewId: string;
  @IsInt() @Min(1) expectedReviewVersion: number;
  @Matches(hash) expectedCycleKey: string;
  @IsObject()
  @ValidateNested()
  @Type(() => ApplyDestinationDto)
  destination: ApplyDestinationDto;
  @IsInt() @Min(0) expectedPlanVersion: number;
  @IsUUID('4') activityId: string;
  @IsInt() @Min(0) expectedActivityVersion: number;
  @IsISO8601({ strict: true }) expectedScheduledOn: string;
  @IsString() @MaxLength(100) timeZone: string;
  @IsString() @MaxLength(256) previousLoad: string;
  @IsString() @MaxLength(256) appliedLoad: string;
  @IsIn(['KG', 'LB']) loadUnit: 'KG' | 'LB';
}
export class ListRecommendationsDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsUUID('4') exerciseId?: string;
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'BLOCKED', 'EXPIRED'])
  status?: string;
  @IsOptional() @Matches(hash) semanticKey?: string;
}
