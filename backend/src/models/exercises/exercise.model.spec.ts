import { Exercise } from './exercise.model';
import {
  exerciseAttributes,
  exerciseOwnerId,
} from '../../../test/fixtures/exercise.fixture';
describe('Exercise domain model', () => {
  it('represents variants, aliases, muscle relationships and ownership independently of HTTP', () => {
    const exercise = new Exercise({
      ...exerciseAttributes,
      origin: 'PERSONAL',
      ownerId: exerciseOwnerId,
    });
    expect(exercise.attributes.primaryMuscleGroup.key).toBe('pectorales');
    expect(exercise.attributes.aliases).toEqual(['Bench press']);
    expect(exercise.attributes.equipmentType).toBe('BARBELL');
    expect(exercise.isOwnedBy(exerciseOwnerId)).toBe(true);
    expect(exercise.isOwnedBy('another-user')).toBe(false);
    expect(exercise.isOwnedBy(undefined)).toBe(false);
    expect(exercise.isOwnedBy('')).toBe(false);
    expect(new Exercise(exerciseAttributes).isOwnedBy(exerciseOwnerId)).toBe(
      false,
    );
  });
  it('preserves the existing alias invariant without HTTP or persistence dependencies', () => {
    expect(Exercise.hasDistinctAliases(undefined)).toBe(true);
    expect(Exercise.hasDistinctAliases([])).toBe(true);
    expect(Exercise.hasDistinctAliases(['Bench press', 'Press banca'])).toBe(
      true,
    );
    expect(Exercise.hasDistinctAliases(['Bíceps', 'BICEPS'])).toBe(false);
    expect(Exercise.hasDistinctAliases(['   '])).toBe(false);
    expect(Exercise.hasDistinctAliases(['Press-banca', 'Press banca'])).toBe(
      false,
    );
  });
});
