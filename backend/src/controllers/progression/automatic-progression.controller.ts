import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseFilters,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AutomaticProgressionService } from '../../progression/automatic-progression.service';
import { AutomaticProgressionPresenter } from '../../views/progression/automatic-progression.presenter';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
import {
  OperationalActivationDto,
  OperationalRevocationDto,
  OperationalIntentDto,
  OperationalPageDto,
} from '../../progression/dto/automatic-progression.dto';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('progression/automatic')
@UseGuards(AccessTokenGuard)
@UseFilters(ProgressionHttpFilter)
@UseInterceptors(ProgressionPrivateResponse)
export class AutomaticProgressionController {
  constructor(
    private readonly service: AutomaticProgressionService,
    private readonly presenter: AutomaticProgressionPresenter,
  ) {}
  @Get('consents/:id') async status(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return this.presenter.status(await this.service.status(a, id));
  }
  @Post('consents/:id/activations') @UseGuards(AuthOriginGuard) async activate(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: OperationalActivationDto,
  ) {
    return this.presenter.command(await this.service.activate(a, id, b));
  }
  @Post('consents/:id/revocations') @UseGuards(AuthOriginGuard) async revoke(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: OperationalRevocationDto,
  ) {
    return this.presenter.command(await this.service.revoke(a, id, b));
  }
  @Post('consents/:id/process') @UseGuards(AuthOriginGuard) async process(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: OperationalIntentDto,
  ) {
    return this.presenter.command(
      await this.service.process(a, id, b.intentId),
    );
  }
  @Get('operations/:id') async operation(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return this.presenter.command(await this.service.operation(a, id));
  }
  @Get('consents/:id/history') async history(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Query() q: OperationalPageDto,
  ) {
    const r = await this.service.history(a, id, q.page, q.limit);
    return { ...r, items: r.items.map((v) => this.presenter.run(v)) };
  }
  @Get('recommendations/:id/receipt') async receipt(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    const r = await this.service.receipt(a, id);
    return { consentId: r.consentId, run: this.presenter.run(r.run) };
  }
}
