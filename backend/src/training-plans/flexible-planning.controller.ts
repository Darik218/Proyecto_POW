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
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { FlexiblePlanningService } from './flexible-planning.service';
import {
  GenerateRoutineDto,
  PlanningVersionDto,
  NewRoutineDayDto,
  CopyRoutineDto,
  FutureRoutineDto,
  CreateScheduledActivityDto,
  UpdateScheduledActivityDto,
  ActivityQueryDto,
} from './dto/flexible-planning.dto';
const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('routine')
@UseGuards(AccessTokenGuard)
export class FlexiblePlanningController {
  constructor(private readonly service: FlexiblePlanningService) {}
  @Post('plans') generate(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Body() input: GenerateRoutineDto,
  ) {
    return this.service.run(i, (r, a) => r.generate(a, input));
  }
  @Post('plans/:planId/days') newDay(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: NewRoutineDayDto,
  ) {
    return this.service.run(i, (r, a) => r.newDay(a, p, input));
  }
  @Post('plans/:planId/copy') copy(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: CopyRoutineDto,
  ) {
    return this.service.run(i, (r, a) => r.copy(a, p, input));
  }
  @Post('plans/:planId/activate') activate(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: PlanningVersionDto,
  ) {
    return this.service.run(i, (r, a) => r.transition(a, p, input, 'ACTIVE'));
  }
  @Post('plans/:planId/archive') archive(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Body() input: PlanningVersionDto,
  ) {
    return this.service.run(i, (r, a) => r.transition(a, p, input, 'ARCHIVED'));
  }
  @Post('plans/:planId/days/:dayId/future-copy') future(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Param('dayId', uuid) d: string,
    @Body() input: FutureRoutineDto,
  ) {
    return this.service.run(i, (r, a) => r.future(a, p, d, input));
  }
  @Post('plans/:planId/days/:dayId/withdraw') withdraw(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('planId', uuid) p: string,
    @Param('dayId', uuid) d: string,
    @Body() input: FutureRoutineDto,
  ) {
    return this.service.run(i, (r, a) => r.future(a, p, d, input, true));
  }
  @Get('activities') activities(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Query() input: ActivityQueryDto,
  ) {
    return this.service.run(i, (r, a) => r.activities(a, input));
  }
  @Post('activities') activity(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Body() input: CreateScheduledActivityDto,
  ) {
    return this.service.run(i, (r, a) => r.createActivity(a, input));
  }
  @Patch('activities/:activityId') updateActivity(
    @CurrentAuth() i: AuthenticatedIdentity,
    @Param('activityId', uuid) id: string,
    @Body() input: UpdateScheduledActivityDto,
  ) {
    return this.service.run(i, (r, a) => r.updateActivity(a, id, input));
  }
}
