import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListExercisesDto } from './dto/list-exercises.dto';
import { ExercisesService } from './exercises.service';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  list(@Query() query: ListExercisesDto) {
    return this.exercisesService.list({ limit: query.limit, offset: query.offset });
  }

  @Get(':exerciseId')
  getById(@Param('exerciseId', new ParseUUIDPipe({ version: '4' })) exerciseId: string) {
    return this.exercisesService.getById(exerciseId);
  }
}
