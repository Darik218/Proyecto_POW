import type {
  Exercise,
  MuscleGroup,
  MuscleGroupIdentity,
} from '../../models/exercises/exercise.model';

// JSON view only. Authorization is resolved by the service/repository before presentation.
export class ExercisesPresenter {
  private muscleGroup(group: MuscleGroupIdentity) {
    return { key: group.key, name: group.name };
  }

  exercise(exercise: Exercise, viewerId?: string) {
    const fields = exercise.attributes;
    return {
      id: fields.id,
      ...(fields.aliases === undefined ? {} : { aliases: [...fields.aliases] }),
      name: fields.name,
      description: fields.description,
      equipment: fields.equipment,
      equipmentType: fields.equipmentType,
      machineType: fields.machineType,
      resistanceType: fields.resistanceType,
      movementType: fields.movementType,
      movementPattern: fields.movementPattern,
      grip: fields.grip,
      gripWidth: fields.gripWidth,
      bodyPosition: fields.bodyPosition,
      laterality: fields.laterality,
      movementPlane: fields.movementPlane,
      difficulty: fields.difficulty,
      oneRmSuitability: fields.oneRmSuitability,
      instructions: fields.instructions,
      origin: fields.origin,
      primaryMuscleGroup: this.muscleGroup(fields.primaryMuscleGroup),
      secondaryMuscleGroups: fields.secondaryMuscleGroups.map((group) =>
        this.muscleGroup(group),
      ),
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
      isOwner: exercise.isOwnedBy(viewerId),
    };
  }

  catalog(
    page: { items: Exercise[]; total: number; limit: number; offset: number },
    viewerId?: string,
  ) {
    return {
      items: page.items.map((exercise) => this.exercise(exercise, viewerId)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  muscleGroups(groups: MuscleGroup[]) {
    return groups.map((group) => ({
      ...this.muscleGroup(group),
      description: group.description,
    }));
  }

  deactivated(): { deactivated: true } {
    return { deactivated: true };
  }
}
export type ExerciseView = ReturnType<ExercisesPresenter['exercise']>;
export type ExercisePageResult = ReturnType<ExercisesPresenter['catalog']>;
