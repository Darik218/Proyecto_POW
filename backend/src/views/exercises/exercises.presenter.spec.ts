import { Exercise } from '../../models/exercises/exercise.model';
import { ExercisesPresenter } from './exercises.presenter';
import {
  exerciseAttributes,
  exerciseOwnerId,
} from '../../../test/fixtures/exercise.fixture';
const presenter = new ExercisesPresenter();
const publicFields = () => {
  const { ownerId: _owner, isActive: _active, ...fields } = exerciseAttributes;
  return { ...fields, isOwner: false };
};
describe('Exercises public JSON view', () => {
  it('preserves every public field, nullable values, dates and the paginated envelope', () => {
    const exercise = new Exercise(exerciseAttributes);
    expect(presenter.exercise(exercise)).toEqual(publicFields());
    expect(
      presenter.catalog({
        items: [exercise],
        total: 41,
        limit: 10,
        offset: 20,
      }),
    ).toEqual({ items: [publicFields()], total: 41, limit: 10, offset: 20 });
    expect(
      presenter.catalog({ items: [], total: 0, limit: 20, offset: 0 }),
    ).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });
  it('uses an allowlist at every public boundary, including nested muscle groups', () => {
    const fields = {
      ...exerciseAttributes,
      catalogKey: 'internal-key',
      searchName: 'internal-search',
      searchDescription: 'internal-description',
      featuredRank: 1,
      passwordHash: 'never-public',
      token: 'never-public',
      owner: { email: 'never-public' },
      primaryMuscleGroup: {
        ...exerciseAttributes.primaryMuscleGroup,
        id: 'internal-group',
        ownerId: exerciseOwnerId,
      },
      secondaryMuscleGroups: [
        { key: 'triceps', name: 'Tríceps', id: 'internal-secondary' },
      ],
    };
    const result = presenter.exercise(new Exercise(fields));
    expect(result).toEqual(publicFields());
    expect(JSON.stringify(result)).not.toContain('never-public');
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(publicFields()).sort(),
    );
  });
  it('computes isOwner without serializing ownership and does not mutate the model', () => {
    const attributes = {
      ...exerciseAttributes,
      origin: 'PERSONAL' as const,
      ownerId: exerciseOwnerId,
    };
    const model = new Exercise(attributes);
    expect(presenter.exercise(model, exerciseOwnerId).isOwner).toBe(true);
    expect(presenter.exercise(model, 'other').isOwner).toBe(false);
    expect(model.attributes.ownerId).toBe(exerciseOwnerId);
    expect(model.attributes.isActive).toBe(true);
    expect(attributes.ownerId).toBe(exerciseOwnerId);
  });
  it('preserves optional aliases, muscle-group arrays and deactivation acknowledgement', () => {
    const { aliases: _aliases, ...fields } = exerciseAttributes;
    expect(presenter.exercise(new Exercise(fields))).not.toHaveProperty(
      'aliases',
    );
    expect(
      presenter.muscleGroups([
        { key: 'pectorales', name: 'Pectorales', description: null },
      ]),
    ).toEqual([{ key: 'pectorales', name: 'Pectorales', description: null }]);
    expect(presenter.deactivated()).toEqual({ deactivated: true });
  });
});
