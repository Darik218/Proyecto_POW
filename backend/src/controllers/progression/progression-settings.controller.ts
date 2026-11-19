import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  UseFilters,
  UseInterceptors,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { ProgressionSettingsService } from '../../progression/progression-settings.service';
import { ProgressionSettingsPresenter } from '../../views/progression/progression-settings.presenter';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
import {
  SettingListDto,
  SettingContextDto,
  SettingCreateDto,
  SettingReplaceDto,
  SettingImpactDto,
} from '../../progression/dto/progression-settings.dto';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('progression/settings')
@UseGuards(AccessTokenGuard)
@UseFilters(ProgressionHttpFilter)
@UseInterceptors(ProgressionPrivateResponse)
export class ProgressionSettingsController {
  constructor(
    private readonly settings: ProgressionSettingsService,
    private readonly presenter: ProgressionSettingsPresenter,
  ) {}
  @Get() async list(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Query() q: SettingListDto,
  ) {
    return this.presenter.list(await this.settings.list(a, q));
  }
  @Get('operations/:intentId') async operation(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('intentId', uuid) id: string,
  ) {
    return this.presenter.receipt(await this.settings.operation(a, id));
  }
  @Post('effective') @HttpCode(200) @UseGuards(AuthOriginGuard) async effective(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Body() b: SettingContextDto,
  ) {
    return this.presenter.resolution(await this.settings.effective(a, b));
  }
  @Post() @UseGuards(AuthOriginGuard) async create(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Body() b: SettingCreateDto,
  ) {
    return this.presenter.receipt(
      await this.settings.create(a, {
        intentId: b.intentId,
        scope: b.scope,
        parameters: b.parameters,
      }),
    );
  }
  @Get(':id') async get(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return this.presenter.record(await this.settings.get(a, id));
  }
  @Post(':id/impact') @HttpCode(200) @UseGuards(AuthOriginGuard) async impact(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: SettingImpactDto,
  ) {
    return this.presenter.impact(
      await this.settings.impact(a, id, b.expectedRevision, b.parameters),
    );
  }
  @Put(':id') @UseGuards(AuthOriginGuard) async replace(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: SettingReplaceDto,
  ) {
    return this.presenter.receipt(
      await this.settings.replace(a, id, {
        intentId: b.intentId,
        expectedRevision: b.expectedRevision,
        parameters: b.parameters,
        confirmImpact: b.confirmImpact,
      }),
    );
  }
}
