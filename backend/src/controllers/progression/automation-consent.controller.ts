import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  ParseUUIDPipe,
  UseGuards,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AutomationConsentService } from '../../progression/automation-consent.service';
import { AutomationConsentPresenter } from '../../views/progression/automation-consent.presenter';
import {
  ConsentListDto,
  ConsentAcceptDto,
  ConsentAcceptanceChallengeDto,
  ConsentCandidateDto,
  ConsentCreateDto,
  ConsentPreviewDto,
  ConsentReviseDto,
  ConsentRevokeDto,
} from '../../progression/dto/automation-consent.dto';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('progression/automation-consents')
@UseGuards(AccessTokenGuard)
@UseFilters(ProgressionHttpFilter)
@UseInterceptors(ProgressionPrivateResponse)
export class AutomationConsentController {
  constructor(
    private readonly consents: AutomationConsentService,
    private readonly presenter: AutomationConsentPresenter,
  ) {}
  @Get() async list(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Query() q: ConsentListDto,
  ) {
    return this.presenter.list(
      await this.consents.listMyAutomationConsents(a, q),
    );
  }
  @Get('candidates') async candidates(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Query() q: ConsentCandidateDto,
  ) {
    return this.presenter.candidates(
      await this.consents.candidatesForMyConsent(a, q),
    );
  }
  @Get('operations/:intentId') async operation(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('intentId', uuid) id: string,
  ) {
    return this.presenter.receipt(
      await this.consents.getMyConsentOperation(a, id),
    );
  }
  @Post('preview') @HttpCode(200) @UseGuards(AuthOriginGuard) async preview(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Body() b: ConsentPreviewDto,
  ) {
    return this.presenter.preview(
      await this.consents.previewMyAutomationConsent(a, b.contract),
    );
  }
  @Post() @UseGuards(AuthOriginGuard) async create(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Body() b: ConsentCreateDto,
  ) {
    return this.presenter.receipt(
      await this.consents.requestMyAutomationConsent(a, {
        intentId: b.intentId,
        contract: b.contract,
      }),
    );
  }
  @Post(':id/acceptance-challenges')
  @UseGuards(AuthOriginGuard)
  async challenge(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: ConsentAcceptanceChallengeDto,
  ) {
    return this.presenter.challenge(
      await this.consents.challengeMyAutomationConsent(
        a,
        id,
        b.expectedVersion,
      ),
    );
  }
  @Post(':id/acceptances') @UseGuards(AuthOriginGuard) async accept(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: ConsentAcceptDto,
  ) {
    return this.presenter.receipt(
      await this.consents.acceptMyAutomationConsent(a, {
        consentId: id,
        intentId: b.intentId,
        challengeId: b.challengeId,
        expectedVersion: b.expectedVersion,
        expectedState: b.expectedState,
        contractKey: b.contractKey,
        conditionsKey: b.conditionsKey,
        contextKey: b.contextKey,
        termsVersion: b.termsVersion,
        presentationVersion: b.presentationVersion,
        conditionsPresented: b.conditionsPresented,
        acknowledgments: b.acknowledgments,
      }),
    );
  }
  @Get(':id') async inspect(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return this.presenter.inspection(
      await this.consents.inspectMyAutomationConsent(a, id),
    );
  }
  @Get(':id/events') async events(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return {
      items: (await this.consents.inspectMyAutomationConsent(a, id)).events.map(
        (e) => this.presenter.receipt(e),
      ),
    };
  }
  @Post(':id/revisions') @UseGuards(AuthOriginGuard) async revise(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: ConsentReviseDto,
  ) {
    return this.presenter.receipt(
      await this.consents.reviseMyAutomationConsent(a, {
        consentId: id,
        intentId: b.intentId,
        expectedVersion: b.expectedVersion,
        contract: b.contract,
      }),
    );
  }
  @Post(':id/revocations') @UseGuards(AuthOriginGuard) async revoke(
    @CurrentAuth() a: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() b: ConsentRevokeDto,
  ) {
    return this.presenter.receipt(
      await this.consents.revokeMyAutomationConsent(a, {
        consentId: id,
        intentId: b.intentId,
        expectedVersion: b.expectedVersion,
        reason: b.reason,
      }),
    );
  }
}
