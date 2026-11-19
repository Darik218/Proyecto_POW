import { WorkoutSession } from './workout-session.model';
import {
  workoutAttributes,
  workoutExerciseAttributes,
} from '../../../test/fixtures/workout.fixture';

describe('Workout session domain', () => {
  it('retains distinct snapshots, adjusted Decimal objectives and real Decimal results', () => {
    const session = new WorkoutSession({
      ...workoutAttributes,
      exercises: [workoutExerciseAttributes],
    });
    const exercise = session.attributes.exercises[0]!;
    expect(exercise.original?.targets.targetLoad).toBe('80');
    expect(exercise.targets?.targetLoad?.toString()).toBe('77.125');
    expect(exercise.sets?.[0]!.load?.toString()).toBe('75.125');
    expect(session.attributes.startedAt).toBe(workoutAttributes.startedAt);
    expect(exercise.original).toBe(workoutExerciseAttributes.original);
  });
  it('retains historical counting without classifying null statuses as failures or counting objectives', () => {
    expect(
      WorkoutSession.resultCounts([
        {
          sets: [
            { status: null, isCompleted: false },
            { status: null, isCompleted: true },
            { status: 'PENDING', isCompleted: false },
            { status: 'SKIPPED', isCompleted: false },
            { status: 'COMPLETED', isCompleted: true },
            { status: 'FAILED', isCompleted: false },
            { status: 'INCOMPLETE', isCompleted: false },
          ],
        },
      ]),
    ).toEqual({ actualSetCount: 5, completedSetCount: 2 });
    expect(WorkoutSession.resultCounts([{ sets: [] }])).toEqual({
      actualSetCount: 0,
      completedSetCount: 0,
    });
  });
});
