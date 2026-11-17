import { Injectable } from '@nestjs/common';
import type { WorkoutGuideService } from '../../progression/workout-guide.service';
@Injectable()
export class WorkoutGuidePresenter {
  present(guide: Awaited<ReturnType<WorkoutGuideService['forMyWorkout']>>) {
    return guide;
  }
}
