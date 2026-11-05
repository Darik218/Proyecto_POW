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
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthRequest } from '../auth/guards/auth-request';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/create-exercise.dto';
import { ListExercisesDto } from './dto/list-exercises.dto';
import { ExercisesService } from './exercises.service';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';

const uuidV4 = new ParseUUIDPipe({ version: '4' });

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get('muscle-groups')
  muscleGroups() {
    return this.exercisesService.listMuscleGroups();
  }

  @Get('mine')
  @UseGuards(AccessTokenGuard)
  listMine(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListExercisesDto,
  ) {
    return this.exercisesService.listMine(identity, query);
  }

  @Get()
  listGlobal(@Query() query: ListExercisesDto) {
    return this.exercisesService.listGlobal(query);
  }

  @Get(':exerciseId')
  @UseGuards(OptionalAccessTokenGuard)
  getById(
    @Req() request: AuthRequest,
    @Param('exerciseId', uuidV4) exerciseId: string,
  ) {
    return this.exercisesService.getById(exerciseId, request.authIdentity);
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  create(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateExerciseDto,
  ) {
    return this.exercisesService.create(identity, body);
  }

  @Patch(':exerciseId')
  @UseGuards(AccessTokenGuard)
  update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('exerciseId', uuidV4) exerciseId: string,
    @Body() body: UpdateExerciseDto,
  ) {
    return this.exercisesService.update(identity, exerciseId, body);
  }

  @Delete(':exerciseId')
  @UseGuards(AccessTokenGuard)
  deactivate(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('exerciseId', uuidV4) exerciseId: string,
  ) {
    return this.exercisesService.deactivate(identity, exerciseId);
  }
}
