import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  IsDefined,
  IsObject,
  IsOptional,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ValidateIf,
  Matches,
  Equals,
} from 'class-validator';
import type { RecommendationPolicy } from '../../models/progression/recommendation-draft.model';
class SettingScopeDto {
  @IsDefined() @ValidateIf((_, v) => v !== null) @IsUUID('4') exerciseId!:
    string | null;
  @IsDefined() @ValidateIf((_, v) => v !== null) @IsUUID('4') trainingPlanId!:
    string | null;
}
export class SettingParametersDto {
  @IsInt() @Min(1) @Max(2147483647) minSuccessfulSessions!: number;
  @IsString() @MaxLength(256) targetRpeMin!: string;
  @IsString() @MaxLength(256) targetRpeMax!: string;
  @IsDefined()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(256)
  incrementPercent!: string | null;
  @IsDefined()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(256)
  incrementAbsolute!: string | null;
  @IsString() @MaxLength(256) maxIncrementPercent!: string;
  @IsDefined()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(256)
  maxLoad!: string | null;
}
export class SettingCreateDto {
  @IsUUID('4') intentId!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => SettingScopeDto)
  scope!: SettingScopeDto;
  @IsDefined()
  @ValidateNested()
  @Type(() => SettingParametersDto)
  parameters!: SettingParametersDto;
}
export class SettingImpactDto {
  @Matches(/^[0-9a-f]{64}$/) expectedRevision!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => SettingParametersDto)
  parameters!: SettingParametersDto;
}
export class SettingReplaceDto extends SettingImpactDto {
  @IsUUID('4') intentId!: string;
  @Equals(true) confirmImpact!: true;
}
export class SettingContextDto {
  @IsUUID('4') exerciseId!: string;
  @IsDefined() @ValidateIf((_, v) => v !== null) @IsUUID('4') trainingPlanId!:
    string | null;
  @IsOptional() @IsObject() policy?: RecommendationPolicy;
}
export class SettingListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
