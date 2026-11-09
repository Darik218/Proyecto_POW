import {
  UpdateWorkoutDto,
  UpdateWorkoutExerciseDto,
  ReorderWorkoutDto,
  ImportWorkoutDayDto,
  SaveWorkoutDayDto,
  CreateWorkoutSetDto,
  UpdateWorkoutSetDto,
} from '../../workout-sessions/dto/workout-preparation.dto';
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
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import {
  AddWorkoutExerciseDto,
  CreateWorkoutSessionDto,
  ListWorkoutSessionsDto,
  AssociateWorkoutDto,
  CompleteWorkoutDto,
  WorkoutSuggestionsDto,
  WorkoutVersionDto,
} from '../../workout-sessions/dto/workout-session.dto';
import { WorkoutSessionsService } from '../../workout-sessions/workout-sessions.service';
import { WorkoutSessionsPresenter } from '../../views/workout-sessions/workout-sessions.presenter';

const uuid = new ParseUUIDPipe({ version: '4' });
@Controller('workout-sessions')
@UseGuards(AccessTokenGuard)
export class WorkoutSessionsController {
  constructor(
    private readonly sessions: WorkoutSessionsService,
    private readonly presenter: WorkoutSessionsPresenter,
  ) {}
  @Get()
  async list(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: ListWorkoutSessionsDto,
  ) {
    return this.presenter.page(await this.sessions.list(identity, query));
  }
  @Post()
  async create(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateWorkoutSessionDto,
  ) {
    return this.presenter.detail(await this.sessions.create(identity, body));
  }
  @Get('suggestions')
  async suggestions(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Query() query: WorkoutSuggestionsDto,
  ) {
    return this.presenter.suggestions(
      await this.sessions.suggestions(identity, query),
    );
  }
  @Patch(':sessionId/association')
  async associate(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: AssociateWorkoutDto,
  ) {
    return this.presenter.detail(
      await this.sessions.associate(identity, id, body),
    );
  }
  @Get(':sessionId')
  async get(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
  ) {
    return this.presenter.detail(await this.sessions.get(identity, id));
  }
  @Patch(':sessionId')
  async update(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: UpdateWorkoutDto,
  ) {
    return this.presenter.detail(
      await this.sessions.prepare(identity, id, {
        action: 'update',
        input: body,
      }),
    );
  }
  @Patch(':sessionId/exercises/order')
  async order(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: ReorderWorkoutDto,
  ) {
    return this.presenter.detail(
      await this.sessions.prepare(identity, id, {
        action: 'order',
        input: body,
      }),
    );
  }
  @Patch(':sessionId/exercises/:exerciseId')
  async updateExercise(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Body() body: UpdateWorkoutExerciseDto,
  ) {
    return this.presenter.detail(
      await this.sessions.prepare(identity, id, {
        action: 'exercise',
        exerciseId,
        input: body,
      }),
    );
  }
  @Post(':sessionId/import-day')
  async importDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: ImportWorkoutDayDto,
  ) {
    return this.presenter.detail(
      await this.sessions.prepare(identity, id, {
        action: 'import',
        input: body,
      }),
    );
  }
  @Post(':sessionId/save-as-plan-day')
  async saveDay(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: SaveWorkoutDayDto,
  ) {
    return this.presenter.savedDay(
      await this.sessions.saveDay(identity, id, body),
    );
  }
  @Post(':sessionId/exercises')
  async add(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: AddWorkoutExerciseDto,
  ) {
    return this.presenter.detail(
      await this.sessions.addExercise(identity, id, body),
    );
  }
  @Post(':sessionId/exercises/:exerciseId/sets')
  async createSet(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Body() body: CreateWorkoutSetDto,
  ) {
    return this.presenter.detail(
      await this.sessions.recordSet(identity, id, exerciseId, body),
    );
  }
  @Patch(':sessionId/exercises/:exerciseId/sets/:setId')
  async updateSet(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Param('exerciseId', uuid) exerciseId: string,
    @Param('setId', uuid) setId: string,
    @Body() body: UpdateWorkoutSetDto,
  ) {
    return this.presenter.detail(
      await this.sessions.recordSet(identity, id, exerciseId, body, setId),
    );
  }
  @Post(':sessionId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: WorkoutVersionDto,
  ) {
    return this.presenter.detail(
      await this.sessions.cancel(identity, id, body.expectedVersion),
    );
  }
  @Post(':sessionId/start')
  @HttpCode(200)
  async start(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: WorkoutVersionDto,
  ) {
    return this.presenter.detail(
      await this.sessions.start(identity, id, body.expectedVersion),
    );
  }
  @Post(':sessionId/complete')
  @HttpCode(200)
  async complete(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Param('sessionId', uuid) id: string,
    @Body() body: CompleteWorkoutDto,
  ) {
    return this.presenter.detail(
      await this.sessions.complete(
        identity,
        id,
        body.expectedVersion,
        body.confirmWithoutResults,
      ),
    );
  }
}
