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
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CreatePlanExerciseDto } from './dto/create-plan-exercise.dto';
import { CreatePlanWeekDto } from './dto/create-plan-week.dto';
import { CreateTrainingPlanDto } from './dto/create-training-plan.dto';
import { UpdatePlanExerciseDto } from './dto/update-plan-exercise.dto';
import { UpdatePlanWeekDto } from './dto/update-plan-week.dto';
import { UpdateTrainingPlanDto } from './dto/update-training-plan.dto';
import { TrainingPlansService } from './training-plans.service';

const uuidV4 = new ParseUUIDPipe({ version: '4' });

@Controller('training-plans')
@UseGuards(AccessTokenGuard)
export class TrainingPlansController {
  constructor(private readonly trainingPlansService: TrainingPlansService) {}

  @Post()
  create(@CurrentAuth() identity: AuthenticatedIdentity, @Body() body: CreateTrainingPlanDto) {
    return this.trainingPlansService.create(identity, body);
  }

  @Get()
  list(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.trainingPlansService.list(identity);
  }

  @Get(':planId')
  get(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
  ) {
    return this.trainingPlansService.get(identity, planId);
  }

  @Patch(':planId')
  update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Body() body: UpdateTrainingPlanDto,
  ) {
    return this.trainingPlansService.update(identity, planId, body);
  }

  @Post(':planId/weeks')
  createWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Body() body: CreatePlanWeekDto,
  ) {
    return this.trainingPlansService.createWeek(identity, planId, body);
  }

  @Patch(':planId/weeks/:weekId')
  updateWeek(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Body() body: UpdatePlanWeekDto,
  ) {
    return this.trainingPlansService.updateWeek(identity, planId, weekId, body);
  }

  @Get(':planId/weeks/:weekId/exercises')
  listWeekExercises(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
  ) {
    return this.trainingPlansService.listWeekExercises(identity, planId, weekId);
  }

  @Post(':planId/weeks/:weekId/exercises')
  createWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Body() body: CreatePlanExerciseDto,
  ) {
    return this.trainingPlansService.createWeekExercise(identity, planId, weekId, body);
  }

  @Get(':planId/weeks/:weekId/exercises/:prescriptionId')
  getWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
  ) {
    return this.trainingPlansService.getWeekExercise(identity, planId, weekId, prescriptionId);
  }

  @Patch(':planId/weeks/:weekId/exercises/:prescriptionId')
  updateWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
    @Body() body: UpdatePlanExerciseDto,
  ) {
    return this.trainingPlansService.updateWeekExercise(identity, planId, weekId, prescriptionId, body);
  }

  @Delete(':planId/weeks/:weekId/exercises/:prescriptionId')
  removeWeekExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('planId', uuidV4) planId: string,
    @Param('weekId', uuidV4) weekId: string,
    @Param('prescriptionId', uuidV4) prescriptionId: string,
  ) {
    return this.trainingPlansService.removeWeekExercise(identity, planId, weekId, prescriptionId);
  }
}
