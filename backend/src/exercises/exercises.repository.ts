export const EXERCISES_REPOSITORY = Symbol('EXERCISES_REPOSITORY');

export type PublicExercise = {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  description: string | null;
};

export type ExercisePage = { limit: number; offset: number };

export interface ExercisesRepository {
  findActive(page: ExercisePage): Promise<PublicExercise[]>;
  findActiveById(id: string): Promise<PublicExercise | null>;
}
