import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  UseGuards,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthOriginGuard } from '../../auth/guards/auth-origin.guard';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { RecommendationService } from '../../progression/recommendation.service';
import { ProgressionPresenter } from '../../views/progression/progression.presenter';
import { ProgressionRequestError } from '../../models/progression/progression-http.model';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from '../../progression/progression-http.boundary';
import {
  RecommendationCommandDto,
  SaveRecommendationDto,
  ListRecommendationsDto,
  InspectRecommendationDto,
  ReviewRecommendationDto,
  ApplyRecommendationDto,
  ApplicationReadinessDto,
} from '../../progression/dto/progression.dto';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('progression')
@UseGuards(AccessTokenGuard)
@UseFilters(ProgressionHttpFilter)
@UseInterceptors(ProgressionPrivateResponse)
export class ProgressionController {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly presenter: ProgressionPresenter,
  ) {}
  @Post('context')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async context(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: RecommendationCommandDto,
  ) {
    return this.presenter.context(
      await this.recommendations.contextForMyExercise(identity, body),
    );
  }
  @Post('preview')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async preview(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: RecommendationCommandDto,
  ) {
    return this.presenter.preview(
      await this.recommendations.proposeMyExercise(identity, body),
    );
  }
  @Post('recommendations')
  @UseGuards(AuthOriginGuard)
  async save(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: SaveRecommendationDto,
  ) {
    return this.presenter.proposal(
      await this.recommendations.saveMyProposal(identity, body, true),
    );
  }
  @Get('recommendations')
  async list(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListRecommendationsDto,
  ) {
    return this.presenter.list(
      await this.recommendations.listMyRecommendations(identity, query),
    );
  }
  @Get('recommendations/:id')
  async get(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    const p = await this.recommendations.getMyProposal(identity, id);
    if (!p) throw new ProgressionRequestError('RESOURCE_NOT_FOUND');
    return this.presenter.proposal(p);
  }
  @Get('recommendations/:id/request')
  async recipe(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    return this.presenter.recipe(
      await this.recommendations.getMyRevalidationRequest(identity, id),
    );
  }
  private async command(
    identity: AuthenticatedIdentity,
    id: string,
    body: InspectRecommendationDto,
  ) {
    return (
      body.command ??
      (await this.recommendations.getMyRevalidationRequest(identity, id))
        ?.command
    );
  }
  @Post('recommendations/:id/inspection')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async inspect(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() body: InspectRecommendationDto,
  ) {
    return this.presenter.inspection(
      await this.recommendations.inspectMyProposal(
        identity,
        id,
        await this.command(identity, id, body),
      ),
    );
  }
  @Post('recommendations/:id/validity')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async validity(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() body: InspectRecommendationDto,
  ) {
    const command = await this.command(identity, id, body);
    if (!command)
      throw new ProgressionRequestError('REVALIDATION_PARAMETERS_REQUIRED');
    return this.recommendations.checkMyProposal(identity, id, command);
  }
  @Post('recommendations/:id/reviews')
  @UseGuards(AuthOriginGuard)
  async review(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() body: ReviewRecommendationDto,
  ) {
    const command = await this.command(identity, id, body);
    if (body.action === 'APPROVE' && !command)
      throw new ProgressionRequestError('REVALIDATION_PARAMETERS_REQUIRED');
    return this.presenter.review(
      await this.recommendations.reviewMyProposal(identity, {
        intentId: body.intentId,
        action: body.action,
        expectedStatus: body.expectedStatus,
        expectedVersion: body.expectedVersion,
        expectedSemanticKey: body.expectedSemanticKey,
        expectedCycleKey: body.expectedCycleKey,
        expectedDependencyKeys: body.expectedDependencyKeys,
        justification: body.justification,
        acceptance: body.acceptance,
        recommendationId: id,
        command,
      }),
    );
  }
  @Post('recommendations/:id/application-readiness')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async readiness(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() body: ApplicationReadinessDto,
  ) {
    const command = await this.command(identity, id, body);
    if (!command)
      throw new ProgressionRequestError('REVALIDATION_PARAMETERS_REQUIRED');
    return this.presenter.readiness(
      await this.recommendations.inspectMyApplication(identity, id, {
        command,
        activityId: body.activityId,
        intentId: body.intentId,
      }),
    );
  }
  @Post('recommendations/:id/application')
  @UseGuards(AuthOriginGuard)
  async apply(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
    @Body() body: ApplyRecommendationDto,
  ) {
    if (body.recommendationId !== id)
      throw new ProgressionRequestError('ROUTE_RESOURCE_MISMATCH');
    return this.presenter.application(
      await this.recommendations.applyMyApprovedRecommendation(identity, body),
    );
  }
  @Get('recommendations/:id/application')
  async application(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('id', uuid) id: string,
  ) {
    const r = await this.recommendations.getMyApplicationReceipt(identity, id);
    if (!r) throw new ProgressionRequestError('RESOURCE_NOT_FOUND');
    return this.presenter.application(r);
  }
}
