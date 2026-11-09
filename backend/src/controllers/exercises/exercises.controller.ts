import { ExercisesPresenter } from '../../views/exercises/exercises.presenter';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import type { AuthRequest } from '../../auth/guards/auth-request';
import {
  CreateExerciseDto,
  UpdateExerciseDto,
} from '../../exercises/dto/create-exercise.dto';
import { ListExercisesDto } from '../../exercises/dto/list-exercises.dto';
import { ExercisesService } from '../../exercises/exercises.service';
import { OptionalAccessTokenGuard } from '../../exercises/optional-access-token.guard';

const uuidV4 = new ParseUUIDPipe({ version: '4' });

@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly presenter: ExercisesPresenter,
  ) {}

  @Get('muscle-groups')
  async muscleGroups() {
    return this.presenter.muscleGroups(
      await this.exercisesService.listMuscleGroups(),
    );
  }

  @Get('visible')
  @UseGuards(AccessTokenGuard)
  async listVisible(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListExercisesDto,
  ) {
    return this.presenter.catalog(
      await this.exercisesService.listVisible(identity, query),
      identity.account.id,
    );
  }

  @Get('mine')
  @UseGuards(AccessTokenGuard)
  async listMine(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListExercisesDto,
  ) {
    return this.presenter.catalog(
      await this.exercisesService.listMine(identity, query),
      identity.account.id,
    );
  }

  @Get()
  async listGlobal(@Query() query: ListExercisesDto) {
    return this.presenter.catalog(
      await this.exercisesService.listGlobal(query),
    );
  }

  @Get(':exerciseId')
  @UseGuards(OptionalAccessTokenGuard)
  async getById(
    @Req() request: AuthRequest,
    @Param('exerciseId', uuidV4) exerciseId: string,
  ) {
    return this.presenter.exercise(
      await this.exercisesService.getById(exerciseId, request.authIdentity),
      request.authIdentity?.account.id,
    );
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  async create(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateExerciseDto,
  ) {
    return this.presenter.exercise(
      await this.exercisesService.create(identity, body),
      identity.account.id,
    );
  }

  @Patch(':exerciseId')
  @UseGuards(AccessTokenGuard)
  async update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('exerciseId', uuidV4) exerciseId: string,
    @Body() body: UpdateExerciseDto,
  ) {
    return this.presenter.exercise(
      await this.exercisesService.update(identity, exerciseId, body),
      identity.account.id,
    );
  }

  @Delete(':exerciseId')
  @UseGuards(AccessTokenGuard)
  async deactivate(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('exerciseId', uuidV4) exerciseId: string,
  ) {
    await this.exercisesService.deactivate(identity, exerciseId);
    return this.presenter.deactivated();
  }
}
