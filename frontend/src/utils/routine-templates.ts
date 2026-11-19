import type {
  TemplateCatalogExercise,
  TemplatePreferences,
} from "../types/routine-template";
export type { TemplatePreferences } from "../types/routine-template";
import {
  defaultMuscleAllocation,
  templateMuscleLabels,
  templateSessions,
  type RoutineTemplateId,
} from "../config/routine-templates";
import type { RoutineBlock, RoutineExerciseDraft } from "./routine-builder";

/** Copies the current reviewed prescription, preserving the destination's identity. */
export function copyTemplateDay(
  source: RoutineBlock,
  target: RoutineBlock,
): void {
  target.exercises = source.exercises.map((exercise) => ({ ...exercise }));
  target.muscleGroups = source.muscleGroups
    ? [...source.muscleGroups]
    : undefined;
}

const functions: Record<string, { pattern: string; type: string }[]> = {
  pectorales: [
    { pattern: "HORIZONTAL_PUSH", type: "COMPOUND" },
    { pattern: "HORIZONTAL_PUSH", type: "COMPOUND" },
    { pattern: "HORIZONTAL_PUSH", type: "ISOLATION" },
  ],
  dorsales: [
    { pattern: "VERTICAL_PULL", type: "COMPOUND" },
    { pattern: "HORIZONTAL_PULL", type: "COMPOUND" },
  ],
  "espalda-alta": [
    { pattern: "HORIZONTAL_PULL", type: "COMPOUND" },
    { pattern: "HORIZONTAL_PULL", type: "ISOLATION" },
  ],
  deltoides: [
    { pattern: "VERTICAL_PUSH", type: "COMPOUND" },
    { pattern: "SHOULDER_ABDUCTION", type: "ISOLATION" },
    { pattern: "SHOULDER_ROTATION", type: "ISOLATION" },
  ],
  biceps: [{ pattern: "ELBOW_FLEXION", type: "ISOLATION" }],
  triceps: [{ pattern: "ELBOW_EXTENSION", type: "ISOLATION" }],
  cuadriceps: [
    { pattern: "SQUAT", type: "COMPOUND" },
    { pattern: "KNEE_EXTENSION", type: "ISOLATION" },
    { pattern: "LUNGE", type: "COMPOUND" },
  ],
  isquiotibiales: [
    { pattern: "HIP_HINGE", type: "COMPOUND" },
    { pattern: "KNEE_FLEXION", type: "ISOLATION" },
  ],
  gluteos: [
    { pattern: "HIP_EXTENSION", type: "COMPOUND" },
    { pattern: "HIP_ABDUCTION", type: "ISOLATION" },
    { pattern: "LUNGE", type: "COMPOUND" },
  ],
  gemelos: [{ pattern: "CALF_RAISE", type: "ISOLATION" }],
};
function signature(exercise: TemplateCatalogExercise): string {
  return [
    exercise.movementPattern,
    exercise.movementType,
    exercise.equipmentType,
    exercise.machineType,
    exercise.bodyPosition,
    exercise.laterality,
    exercise.grip,
    exercise.gripWidth,
  ].join(":");
}
function prescription(
  exercise: TemplateCatalogExercise,
  preferences: TemplatePreferences,
): RoutineExerciseDraft {
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    targetSets: preferences.experience === "BEGINNER" ? "2" : "3",
    targetRepsMin: "8",
    targetRepsMax: "12",
    targetLoad: "",
    targetLoadUnit: "",
  };
}
export function summarizeTemplateBlocks(
  blocks: RoutineBlock[],
  catalog: TemplateCatalogExercise[],
) {
  const groups = new Map(
    catalog.map((exercise) => [exercise.id, exercise.primaryMuscleGroup.key]),
  );
  const directSets: Record<string, number> = {};
  let exerciseCount = 0,
    setCount = 0,
    unclassifiedSets = 0;
  for (const block of blocks)
    for (const exercise of block.exercises) {
      exerciseCount++;
      const sets = /^\d+$/.test(exercise.targetSets)
        ? Number(exercise.targetSets)
        : 0;
      setCount += sets;
      const group = groups.get(exercise.exerciseId);
      if (group) directSets[group] = (directSets[group] ?? 0) + sets;
      else unclassifiedSets += sets;
    }
  return { exerciseCount, setCount, directSets, unclassifiedSets };
}
export function buildTemplateBlocks(
  id: RoutineTemplateId,
  frequency: number,
  catalog: TemplateCatalogExercise[],
  preferences: TemplatePreferences,
) {
  if (!preferences.equipment.length)
    throw new Error("Selecciona tu equipamiento disponible.");
  const count = preferences.exerciseCount ?? 5;
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new Error("Elige entre 1 y 20 ejercicios por sesión.");
  if (
    preferences.durationMinutes !== undefined &&
    (!Number.isInteger(preferences.durationMinutes) ||
      preferences.durationMinutes < 10 ||
      preferences.durationMinutes > 240)
  )
    throw new Error(
      "La duración orientativa debe estar entre 10 y 240 minutos.",
    );
  const missing: string[] = [],
    warnings: string[] = [],
    blocks: RoutineBlock[] = [];
  const sessions = templateSessions(id, frequency);
  const firstByFamily = new Map<string, RoutineBlock>();
  const uniqueCatalog = [
    ...new Map(catalog.map((exercise) => [exercise.id, exercise])).values(),
  ];
  for (const session of sessions) {
    const allocation =
      preferences.muscleAllocations?.[session.family] ??
      defaultMuscleAllocation(session, count);
    if (
      session.muscleGroups.length &&
      (Object.keys(allocation).some(
        (key) => !session.muscleGroups.includes(key),
      ) ||
        Object.values(allocation).some(
          (value) => !Number.isInteger(value) || value < 0,
        ) ||
        Object.values(allocation).reduce((sum, value) => sum + value, 0) !==
          count)
    )
      throw new Error(
        `${session.name}: la distribución por músculo debe sumar ${count} ejercicios.`,
      );
    const block: RoutineBlock = {
      id: crypto.randomUUID(),
      name: session.name,
      muscleGroups: [...session.muscleGroups],
      exercises: [],
    };
    const first = firstByFamily.get(session.family);
    const strategy =
      preferences.familyStrategies?.[session.family] ?? "partial";
    if (first && strategy === "same") {
      copyTemplateDay(first, block);
      if (block.exercises.length < count)
        missing.push(
          `${session.name}: faltan ${count - block.exercises.length} ejercicios; revisa la distribución y el catálogo.`,
        );
    } else {
      const used = new Set<string>();
      const firstIds = new Set(
        first?.exercises.map((exercise) => exercise.exerciseId),
      );
      const selectedMetadata: TemplateCatalogExercise[] = [];
      let sourceIndex = 0;
      for (const group of session.muscleGroups) {
        const requested = allocation[group] ?? 0;
        let absent = 0;
        for (
          let localIndex = 0;
          localIndex < requested;
          localIndex++, sourceIndex++
        ) {
          const functionalSlots =
            group === "deltoides" && session.family === "pull"
              ? [{ pattern: "HORIZONTAL_PULL", type: "ISOLATION" }]
              : group === "deltoides" && session.family !== "push"
                ? [
                    ...functions.deltoides!,
                    { pattern: "HORIZONTAL_PULL", type: "ISOLATION" },
                  ]
                : (functions[group] ?? []);
          const target =
            functionalSlots[localIndex % Math.max(1, functionalSlots.length)];
          const pool = uniqueCatalog.filter(
            (exercise) =>
              !used.has(exercise.id) &&
              exercise.primaryMuscleGroup.key === group &&
              preferences.equipment.includes(exercise.equipmentType) &&
              (exercise.movementType === "COMPOUND" ||
                exercise.movementType === "ISOLATION") &&
              functionalSlots.some(
                (slot) => slot.pattern === exercise.movementPattern,
              ) &&
              !(
                group === "deltoides" &&
                session.family === "pull" &&
                exercise.movementType !== "ISOLATION"
              ) &&
              (preferences.experience !== "BEGINNER" ||
                exercise.difficulty === "BEGINNER"),
          );
          const baseExercise = first?.exercises[sourceIndex];
          // Keep early main slots; later slots remain available for partial variation even in full-body sessions.
          const anchor = localIndex === 0 && sourceIndex < Math.ceil(count / 2);
          const retained =
            first && strategy === "partial" && anchor
              ? pool.find(
                  (exercise) => exercise.id === baseExercise?.exerciseId,
                )
              : undefined;
          const varied =
            first &&
            (strategy === "different" || (strategy === "partial" && !anchor));
          const fresh = varied
            ? pool.filter((exercise) => !firstIds.has(exercise.id))
            : pool;
          const candidates = fresh.length ? fresh : pool;
          if (varied && !fresh.length && pool.length)
            warnings.push(
              `${session.name}: el catálogo compatible no tiene suficiente variedad para hacer todos los ejercicios diferentes.`,
            );
          const functionScore = (exercise: TemplateCatalogExercise) =>
            (exercise.movementPattern === target?.pattern ? 100 : 0) +
            (exercise.movementType === target?.type ? 35 : 0);
          const preferenceScore = (exercise: TemplateCatalogExercise) =>
            (exercise.usageRank === undefined
              ? 0
              : 20 + 1 / (exercise.usageRank + 1)) +
            (exercise.editorialRank === undefined
              ? 0
              : 2 / (exercise.editorialRank + 1)) -
            selectedMetadata.filter(
              (previous) => signature(previous) === signature(exercise),
            ).length *
              12;
          candidates.sort(
            (a, b) =>
              functionScore(b) - functionScore(a) ||
              preferenceScore(b) - preferenceScore(a) ||
              a.id.localeCompare(b.id),
          );
          const bestTier = candidates.filter(
            (exercise) =>
              functionScore(exercise) === functionScore(candidates[0]!),
          );
          const selected =
            retained ??
            bestTier[
              strategy === "independent" && session.variant > 0
                ? session.variant % Math.max(1, bestTier.length)
                : 0
            ];
          if (!selected) {
            absent++;
            continue;
          }
          used.add(selected.id);
          selectedMetadata.push(selected);
          block.exercises.push(prescription(selected, preferences));
          if (
            target &&
            (selected.movementPattern !== target.pattern ||
              selected.movementType !== target.type)
          )
            warnings.push(
              `${session.name}: no hay una opción disponible para ${target.pattern} (${target.type}); revisa la alternativa de ${templateMuscleLabels[group] ?? group}.`,
            );
        }
        if (absent)
          missing.push(
            `${session.name}: faltan ${absent} de ${requested} ejercicios para ${templateMuscleLabels[group] ?? group}.`,
          );
      }
    }
    if (!first) firstByFamily.set(session.family, block);
    blocks.push(block);
  }
  return { blocks, missing, warnings: [...new Set(warnings)] };
}
