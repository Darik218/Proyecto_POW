import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { DailyPlanningService } from './daily-planning.service';
import {
  PlanningRevisionDto,
  CopyPlanDayDto,
  CopyPlanWeekDto,
  CreateDailyPrescriptionDto,
  CreatePlanDayDto,
  DailyPrescriptionDto,
  DistributePrescriptionDto,
  ReorderPlanningDto,
  UpdatePlanDayDto,
} from './dto/daily-planning.dto';
class PlanParams {
  @IsUUID('4') planId!: string;
}
class WeekParams extends PlanParams {
  @IsUUID('4') weekId!: string;
}
class DayParams extends WeekParams {
  @IsUUID('4') dayId!: string;
}
class ExerciseParams extends DayParams {
  @IsUUID('4') prescriptionId!: string;
}
class PendingParams extends WeekParams {
  @IsUUID('4') prescriptionId!: string;
}

@Controller('training-plans')
@UseGuards(AccessTokenGuard)
export class DailyPlanningController {
  constructor(private readonly service: DailyPlanningService) {}
  @Get(':planId/planning')
  planning(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: PlanParams,
  ) {
    return this.service.get(identity, params.planId);
  }
  @Get(':planId/weeks/:weekId/days')
  days(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
  ) {
    return this.service.days(identity, params.planId, params.weekId);
  }
  @Get(':planId/weeks/:weekId/pending-exercises')
  pending(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
  ) {
    return this.service.pending(identity, params.planId, params.weekId);
  }
  @Post(':planId/weeks/:weekId/days')
  createDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: CreatePlanDayDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'createDay',
      input,
    });
  }
  @Patch(':planId/weeks/:weekId/days/order')
  reorderDays(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: ReorderPlanningDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'reorderDays',
      input,
    });
  }
  @Patch(':planId/weeks/:weekId/days/:dayId')
  updateDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: UpdatePlanDayDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'updateDay',
      dayId: params.dayId,
      input,
    });
  }
  @Post(':planId/weeks/:weekId/days/:dayId/copy')
  copyDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: CopyPlanDayDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'copyDay',
      dayId: params.dayId,
      input,
    });
  }
  @Post(':planId/weeks/:weekId/copy')
  copyWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: CopyPlanWeekDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'copyWeek',
      input,
    });
  }
  @Post(':planId/weeks/:weekId/days/:dayId/exercises')
  createExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: CreateDailyPrescriptionDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'createExercise',
      dayId: params.dayId,
      input,
    });
  }
  @Patch(':planId/weeks/:weekId/days/:dayId/exercises/order')
  reorderExercises(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: ReorderPlanningDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'reorderExercises',
      dayId: params.dayId,
      input,
    });
  }
  @Patch(':planId/weeks/:weekId/days/:dayId/exercises/:prescriptionId')
  updateExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: ExerciseParams,
    @Body() input: DailyPrescriptionDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'updateExercise',
      dayId: params.dayId,
      prescriptionId: params.prescriptionId,
      input,
    });
  }
  @Delete(':planId/weeks/:weekId/days/:dayId/exercises/:prescriptionId')
  removeExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: ExerciseParams,
    @Body() input:PlanningRevisionDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'removeExercise',
      input,
      dayId: params.dayId,
      prescriptionId: params.prescriptionId,
    });
  }
  @Post(':planId/weeks/:weekId/pending-exercises/:prescriptionId/distribute')
  distribute(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: PendingParams,
    @Body() input: DistributePrescriptionDto,
  ) {
    return this.service.change(identity, params.planId, params.weekId, {
      action: 'distribute',
      prescriptionId: params.prescriptionId,
      input,
    });
  }
}
