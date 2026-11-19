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
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { DailyPlanningService } from '../../training-plans/daily-planning.service';
import { DailyPlanningPresenter } from '../../views/training-plans/daily-planning.presenter';
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
} from '../../training-plans/dto/daily-planning.dto';
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
  constructor(
    private readonly service: DailyPlanningService,
    private readonly presenter: DailyPlanningPresenter,
  ) {}
  @Get(':planId/planning')
  async planning(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: PlanParams,
  ) {
    return this.presenter.planning(
      await this.service.get(identity, params.planId),
    );
  }
  @Get(':planId/weeks/:weekId/days')
  async days(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
  ) {
    return this.presenter.days(
      await this.service.days(identity, params.planId, params.weekId),
    );
  }
  @Get(':planId/weeks/:weekId/pending-exercises')
  async pending(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
  ) {
    return this.presenter.prescriptions(
      await this.service.pending(identity, params.planId, params.weekId),
    );
  }
  @Post(':planId/weeks/:weekId/days')
  async createDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: CreatePlanDayDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'createDay',
        input,
      }),
    );
  }
  @Patch(':planId/weeks/:weekId/days/order')
  async reorderDays(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: ReorderPlanningDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'reorderDays',
        input,
      }),
    );
  }
  @Patch(':planId/weeks/:weekId/days/:dayId')
  async updateDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: UpdatePlanDayDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'updateDay',
        dayId: params.dayId,
        input,
      }),
    );
  }
  @Post(':planId/weeks/:weekId/days/:dayId/copy')
  async copyDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: CopyPlanDayDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'copyDay',
        dayId: params.dayId,
        input,
      }),
    );
  }
  @Post(':planId/weeks/:weekId/copy')
  async copyWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: WeekParams,
    @Body() input: CopyPlanWeekDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'copyWeek',
        input,
      }),
    );
  }
  @Post(':planId/weeks/:weekId/days/:dayId/exercises')
  async createExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: CreateDailyPrescriptionDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'createExercise',
        dayId: params.dayId,
        input,
      }),
    );
  }
  @Patch(':planId/weeks/:weekId/days/:dayId/exercises/order')
  async reorderExercises(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: DayParams,
    @Body() input: ReorderPlanningDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'reorderExercises',
        dayId: params.dayId,
        input,
      }),
    );
  }
  @Patch(':planId/weeks/:weekId/days/:dayId/exercises/:prescriptionId')
  async updateExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: ExerciseParams,
    @Body() input: DailyPrescriptionDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'updateExercise',
        dayId: params.dayId,
        prescriptionId: params.prescriptionId,
        input,
      }),
    );
  }
  @Delete(':planId/weeks/:weekId/days/:dayId/exercises/:prescriptionId')
  async removeExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: ExerciseParams,
    @Body() input: PlanningRevisionDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'removeExercise',
        input,
        dayId: params.dayId,
        prescriptionId: params.prescriptionId,
      }),
    );
  }
  @Post(':planId/weeks/:weekId/pending-exercises/:prescriptionId/distribute')
  async distribute(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param() params: PendingParams,
    @Body() input: DistributePrescriptionDto,
  ) {
    return this.presenter.planning(
      await this.service.change(identity, params.planId, params.weekId, {
        action: 'distribute',
        prescriptionId: params.prescriptionId,
        input,
      }),
    );
  }
}
