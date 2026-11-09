import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { CreatePlanExerciseDto } from '../../training-plans/dto/create-plan-exercise.dto';
import { CreatePlanWeekDto } from '../../training-plans/dto/create-plan-week.dto';
import { CreateTrainingPlanDto } from '../../training-plans/dto/create-training-plan.dto';
import { UpdatePlanExerciseDto } from '../../training-plans/dto/update-plan-exercise.dto';
import { UpdatePlanWeekDto } from '../../training-plans/dto/update-plan-week.dto';
import { UpdateTrainingPlanDto } from '../../training-plans/dto/update-training-plan.dto';
import { TrainingPlansService } from '../../training-plans/training-plans.service';
import { TrainingPlansPresenter } from '../../views/training-plans/training-plans.presenter';

const uuidV4 = new ParseUUIDPipe({ version: '4' });

@Controller('training-plans')
@UseGuards(AccessTokenGuard)
export class TrainingPlansController {
  constructor(
    private readonly trainingPlansService: TrainingPlansService,
    private readonly presenter: TrainingPlansPresenter,
  ) {}

  @Post()
  async create(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateTrainingPlanDto,
  ) {
    return this.presenter.summary(
      await this.trainingPlansService.create(identity, body),
    );
  }

  @Get()
  async list(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.presenter.list(await this.trainingPlansService.list(identity));
  }

  @Get(':planId')
  async get(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
  ) {
    return this.presenter.detail(
      await this.trainingPlansService.get(identity, planId),
    );
  }

  @Patch(':planId')
  async update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Body() body: UpdateTrainingPlanDto,
  ) {
    return this.presenter.summary(
      await this.trainingPlansService.update(identity, planId, body),
    );
  }

  @Post(':planId/weeks')
  async createWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Body() body: CreatePlanWeekDto,
  ) {
    return this.presenter.week(
      await this.trainingPlansService.createWeek(identity, planId, body),
    );
  }

  @Patch(':planId/weeks/:weekId')
  async updateWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Body() body: UpdatePlanWeekDto,
  ) {
    return this.presenter.week(
      await this.trainingPlansService.updateWeek(
        identity,
        planId,
        weekId,
        body,
      ),
    );
  }

  @Get(':planId/weeks/:weekId/exercises')
  async listWeekExercises(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
  ) {
    return this.presenter.prescriptions(
      await this.trainingPlansService.listWeekExercises(
        identity,
        planId,
        weekId,
      ),
    );
  }

  @Post(':planId/weeks/:weekId/exercises')
  async createWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Body() body: CreatePlanExerciseDto,
  ) {
    return this.presenter.prescription(
      await this.trainingPlansService.createWeekExercise(
        identity,
        planId,
        weekId,
        body,
      ),
    );
  }

  @Get(':planId/weeks/:weekId/exercises/:prescriptionId')
  async getWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
  ) {
    return this.presenter.prescription(
      await this.trainingPlansService.getWeekExercise(
        identity,
        planId,
        weekId,
        prescriptionId,
      ),
    );
  }

  @Patch(':planId/weeks/:weekId/exercises/:prescriptionId')
  async updateWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
    @Body() body: UpdatePlanExerciseDto,
  ) {
    return this.presenter.prescription(
      await this.trainingPlansService.updateWeekExercise(
        identity,
        planId,
        weekId,
        prescriptionId,
        body,
      ),
    );
  }

  @Delete(':planId/weeks/:weekId/exercises/:prescriptionId')
  async removeWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
  ) {
    await this.trainingPlansService.removeWeekExercise(
      identity,
      planId,
      weekId,
      prescriptionId,
    );
    return this.presenter.deleted();
  }
}
