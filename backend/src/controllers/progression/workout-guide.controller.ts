import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  Query,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { WorkoutGuideService } from '../../progression/workout-guide.service';
import { WorkoutGuidePresenter } from '../../views/progression/workout-guide.presenter';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  IsIn,
  IsObject,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
class WorkoutGuideQueryDto {
  @IsOptional() @IsUUID('4') activityId?: string;
  @IsOptional() @IsUUID('4') planDayId?: string;
  @IsOptional() @IsUUID('4') sessionId?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  performedOn?: string;
  @IsOptional() @IsString() @MaxLength(100) timeZone?: string;
}
class PreviewDeclarationDto {
  @IsBoolean() @IsIn([true]) sameVariant: true;
  @IsBoolean() @IsIn([true]) sameEquipment: true;
  @IsBoolean() @IsIn([true]) externalTotal: true;
}
class WorkoutGuidePreviewDto {
  @IsObject()
  @ValidateNested()
  @Type(() => WorkoutGuideQueryDto)
  source: WorkoutGuideQueryDto;
  @IsUUID('4') exerciseId: string;
  @Matches(/^[a-f0-9]{64}$/) contextKey: string;
  @IsString()
  @MaxLength(32)
  @Matches(/^(?:[1-9]\d*(?:\.\d+)?|0\.(?=\d*[1-9])\d+)$/)
  gridStep: string;
  @IsIn(['ABSOLUTE', 'PERCENT']) incrementMode: 'ABSOLUTE' | 'PERCENT';
  @IsObject()
  @ValidateNested()
  @Type(() => PreviewDeclarationDto)
  declaration: PreviewDeclarationDto;
  @IsIn(['session-readiness-preview-v1', 'session-load-compliance-preview-v1'])
  policyContract:
    'session-readiness-preview-v1' | 'session-load-compliance-preview-v1';
}
class RepetitionDeclarationDto {
  @IsBoolean() @IsIn([true]) sameVariant: true;
  @IsBoolean() @IsIn([true]) sameEquipment: true;
  @IsBoolean() @IsIn([true]) sameLoadConvention: true;
}
class WorkoutGuideRepetitionPreviewDto {
  @IsObject()
  @ValidateNested()
  @Type(() => WorkoutGuideQueryDto)
  source: WorkoutGuideQueryDto;
  @IsUUID('4') exerciseId: string;
  @Matches(/^[a-f0-9]{64}$/) contextKey: string;
  @IsObject()
  @ValidateNested()
  @Type(() => RepetitionDeclarationDto)
  declaration: RepetitionDeclarationDto;
  @IsIn(['session-repetition-preview-v1', 'session-repetition-preview-v2'])
  policyContract:
    'session-repetition-preview-v1' | 'session-repetition-preview-v2';
}
@Controller('progression')
@UseGuards(AccessTokenGuard)
@UseFilters(ProgressionHttpFilter)
@UseInterceptors(ProgressionPrivateResponse)
export class WorkoutGuideController {
  constructor(
    private readonly guide: WorkoutGuideService,
    private readonly presenter: WorkoutGuidePresenter,
  ) {}
  @Get('workout-guide')
  async read(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: WorkoutGuideQueryDto,
  ) {
    return this.presenter.present(
      await this.guide.forMyWorkout(identity, query),
    );
  }
  @Post('workout-guide/preview')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async preview(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() input: WorkoutGuidePreviewDto,
  ) {
    return this.presenter.present(
      await this.guide.forMyWorkout(identity, input.source, input),
    );
  }
  @Post('workout-guide/repetition-preview')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async repetitionPreview(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() input: WorkoutGuideRepetitionPreviewDto,
  ) {
    return this.presenter.present(
      await this.guide.forMyWorkout(identity, input.source, input),
    );
  }
}
