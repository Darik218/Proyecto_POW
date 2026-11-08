import {
  UpdateWorkoutDto,
  UpdateWorkoutExerciseDto,
  ReorderWorkoutDto,
  ImportWorkoutDayDto,
  SaveWorkoutDayDto,
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
} from './dto/workout-preparation.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import {
  AddWorkoutExerciseDto,
  CreateWorkoutSessionDto,
  ListWorkoutSessionsDto,
  AssociateWorkoutDto,
  CompleteWorkoutDto,
  WorkoutSuggestionsDto,
  WorkoutVersionDto,
} from './dto/workout-session.dto';
import { WorkoutSessionsService } from './workout-sessions.service';

const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('workout-sessions')
@UseGuards(AccessTokenGuard)
export class WorkoutSessionsController {
  constructor(private readonly sessions: WorkoutSessionsService) {}
  @Get()
  list(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListWorkoutSessionsDto,
  ) {
    return this.sessions.list(identity, query);
  }
  @Post()
  create(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateWorkoutSessionDto,
  ) {
    return this.sessions.create(identity, body);
  }
  @Get('suggestions')
  suggestions(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: WorkoutSuggestionsDto,
  ) {
    return this.sessions.suggestions(identity, query);
  }
  @Patch(':sessionId/association')
  associate(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: AssociateWorkoutDto,
  ) {
    return this.sessions.associate(identity, id, body);
  }
  @Get(':sessionId')
  get(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
  ) {
    return this.sessions.get(identity, id);
  }
  @Patch(':sessionId')
  update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: UpdateWorkoutDto,
  ) {
    return this.sessions.prepare(identity, id, {
      action: 'update',
      input: body,
    });
  }
  @Patch(':sessionId/exercises/order')
  order(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: ReorderWorkoutDto,
  ) {
    return this.sessions.prepare(identity, id, {
      action: 'order',
      input: body,
    });
  }
  @Patch(':sessionId/exercises/:exerciseId')
  updateExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Body() body: UpdateWorkoutExerciseDto,
  ) {
    return this.sessions.prepare(identity, id, {
      action: 'exercise',
      exerciseId,
      input: body,
    });
  }
  @Post(':sessionId/import-day')
  importDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: ImportWorkoutDayDto,
  ) {
    return this.sessions.prepare(identity, id, {
      action: 'import',
      input: body,
    });
  }
  @Post(':sessionId/save-as-plan-day')
  saveDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: SaveWorkoutDayDto,
  ) {
    return this.sessions.saveDay(identity, id, body);
  }
  @Post(':sessionId/exercises')
  add(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: AddWorkoutExerciseDto,
  ) {
    return this.sessions.addExercise(identity, id, body);
  }
  @Post(':sessionId/exercises/:exerciseId/sets')
  createSet(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Body() body: CreateWorkoutSetDto,
  ) {
    return this.sessions.recordSet(identity, id, exerciseId, body);
  }
  @Patch(':sessionId/exercises/:exerciseId/sets/:setId')
  updateSet(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Param('setId', uuid) setId: string,
    @Body() body: UpdateWorkoutSetDto,
  ) {
    return this.sessions.recordSet(identity, id, exerciseId, body, setId);
  }
  @Post(':sessionId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: WorkoutVersionDto,
  ) {
    return this.sessions.cancel(identity, id, body.expectedVersion);
  }
  @Post(':sessionId/start')
  @HttpCode(200)
  start(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: WorkoutVersionDto,
  ) {
    return this.sessions.start(identity, id, body.expectedVersion);
  }
  @Post(':sessionId/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: CompleteWorkoutDto,
  ) {
    return this.sessions.complete(
      identity,
      id,
      body.expectedVersion,
      body.confirmWithoutResults,
    );
  }
}
