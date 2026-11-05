import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AddWorkoutExerciseDto, CreateWorkoutSessionDto, EmptyWorkoutBodyPipe, ListWorkoutSessionsDto } from './dto/workout-session.dto';
import { WorkoutSessionsService } from './workout-sessions.service';

const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('workout-sessions')
@UseGuards(AccessTokenGuard)
export class WorkoutSessionsController {
  constructor(private readonly sessions: WorkoutSessionsService) {}
  @Get()
  list(@CurrentAuth() identity: AuthenticatedIdentity, @Query() query: ListWorkoutSessionsDto) { return this.sessions.list(identity, query); }
  @Post()
  create(@CurrentAuth() identity: AuthenticatedIdentity, @Body() body: CreateWorkoutSessionDto) { return this.sessions.create(identity, body); }
  @Get(':sessionId')
  get(@CurrentAuth() identity: AuthenticatedIdentity, @Param('sessionId', uuid) id: string) { return this.sessions.get(identity, id); }
  @Post(':sessionId/exercises')
  add(@CurrentAuth() identity: AuthenticatedIdentity, @Param('sessionId', uuid) id: string, @Body() body: AddWorkoutExerciseDto) { return this.sessions.addExercise(identity, id, body); }
  @Post(':sessionId/start')
  @HttpCode(200)
  start(@CurrentAuth() identity: AuthenticatedIdentity, @Param('sessionId', uuid) id: string, @Body(new EmptyWorkoutBodyPipe()) _body: unknown) { return this.sessions.start(identity, id); }
  @Post(':sessionId/complete')
  @HttpCode(200)
  complete(@CurrentAuth() identity: AuthenticatedIdentity, @Param('sessionId', uuid) id: string, @Body(new EmptyWorkoutBodyPipe()) _body: unknown) { return this.sessions.complete(identity, id); }
}
