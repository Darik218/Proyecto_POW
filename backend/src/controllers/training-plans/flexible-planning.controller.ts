import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { FlexiblePlanningService } from '../../training-plans/flexible-planning.service';
import { FlexiblePlanningPresenter } from '../../views/training-plans/flexible-planning.presenter';
import {
  GenerateRoutineDto,
  DuplicateRoutineDto,
  PlanningVersionDto,
  NewRoutineDayDto,
  CopyRoutineDto,
  FutureRoutineDto,
  CreateScheduledActivityDto,
  UpdateScheduledActivityDto,
  ActivityQueryDto,
} from '../../training-plans/dto/flexible-planning.dto';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('routine')
@UseGuards(AccessTokenGuard)
export class FlexiblePlanningController {
  constructor(
    private readonly service: FlexiblePlanningService,
    private readonly presenter: FlexiblePlanningPresenter,
  ) {}
  @Post('plans') async generate(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Body() input: GenerateRoutineDto,
  ) {
    return this.presenter.created(await this.service.generate(i, input));
  }
  @Post('plans/:planId/duplicate') async duplicate(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuid) planId: string,
    @Body() input: DuplicateRoutineDto,
  ) {
    return this.presenter.created(
      await this.service.duplicate(identity, planId, input),
    );
  }
  @Post('plans/:planId/days') async newDay(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: NewRoutineDayDto,
  ) {
    return this.presenter.changed(await this.service.newDay(i, p, input));
  }
  @Post('plans/:planId/copy') async copy(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: CopyRoutineDto,
  ) {
    return this.presenter.changed(await this.service.copy(i, p, input));
  }
  @Post('plans/:planId/activate') async activate(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: PlanningVersionDto,
  ) {
    return this.presenter.changed(await this.service.activate(i, p, input));
  }
  @Post('plans/:planId/archive') async archive(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: PlanningVersionDto,
  ) {
    return this.presenter.changed(await this.service.archive(i, p, input));
  }
  @Post('plans/:planId/days/:dayId/future-copy') async future(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Param('dayId', uuid) d: string,
    @Body() input: FutureRoutineDto,
  ) {
    return this.presenter.changed(await this.service.future(i, p, d, input));
  }
  @Post('plans/:planId/days/:dayId/withdraw') async withdraw(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Param('dayId', uuid) d: string,
    @Body() input: FutureRoutineDto,
  ) {
    return this.presenter.changed(await this.service.withdraw(i, p, d, input));
  }
  @Get('activities') async activities(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Query() input: ActivityQueryDto,
  ) {
    return this.presenter.activities(await this.service.activities(i, input));
  }
  @Post('activities') async activity(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Body() input: CreateScheduledActivityDto,
  ) {
    return this.presenter.activity(await this.service.createActivity(i, input));
  }
  @Patch('activities/:activityId') async updateActivity(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('activityId', uuid) id: string,
    @Body() input: UpdateScheduledActivityDto,
  ) {
    return this.presenter.activity(
      await this.service.updateActivity(i, id, input),
    );
  }
}
