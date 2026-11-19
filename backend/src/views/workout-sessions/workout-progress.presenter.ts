import type { describeProgress } from '../../domain/workout-sessions/workout-progress.policy';
export class WorkoutProgressPresenter {
  present(value: ReturnType<typeof describeProgress>) {
    return value;
  }
}
