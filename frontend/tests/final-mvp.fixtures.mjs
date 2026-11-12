/** Explicit demo capture built at fixture creation, never reconstructed for real history. */
export function demoExerciseSnapshot(exercise) {
  return {
    source: { kind: "FREE", id: null },
    exercise: {
      id: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment,
      muscleGroup: exercise.muscleGroup,
    },
    targets: {
      targetSets: 1,
      targetRepsMin: 5,
      targetRepsMax: 6,
      targetLoad: "80",
      targetLoadUnit: "KG",
      targetRpe: 8,
    },
    position: 1,
    notes: null,
  };
}
