import {
  generateRoutineSchema,
  type GenerateRoutine,
} from "../schemas/routine.schema";
import { localTrainingDate } from "./dates";

export type RoutineStyle = "own" | "ppl" | "upperlower" | "fullbody" | "free";
export type RoutineExerciseDraft = {
  exerciseId: string;
  name: string;
  targetSets: string;
  targetRepsMin: string;
  targetRepsMax: string;
  targetLoad: string;
  targetLoadUnit: "" | "KG" | "LB";
};
export type RoutineBlock = {
  id: string;
  name: string;
  exercises: RoutineExerciseDraft[];
};
export type RoutineDraft = {
  style: RoutineStyle;
  name: string;
  durationWeeks: number;
  startsOn: string;
  blocks: RoutineBlock[];
  weekdays: string[];
};
export const routineStyles: {
  id: RoutineStyle;
  label: string;
  description: string;
}[] = [
  {
    id: "own",
    label: "Mi propia rutina",
    description: "Transcribe los bloques que ya entrenas.",
  },
  {
    id: "ppl",
    label: "Push · Pull · Legs",
    description: "Tres bloques que puedes repetir en la semana.",
  },
  {
    id: "upperlower",
    label: "Torso · Pierna",
    description: "Alterna dos bloques y elige tus descansos.",
  },
  {
    id: "fullbody",
    label: "Full body",
    description: "Un bloque de cuerpo completo, en los días que elijas.",
  },
  {
    id: "free",
    label: "Libre",
    description: "Empieza con un bloque y organiza la semana a tu manera.",
  },
];
export function createRoutineDraft(
  style: RoutineStyle = "own",
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = new Date(),
): RoutineDraft {
  const names =
    style === "ppl"
      ? ["PUSH", "PULL", "LEGS"]
      : style === "upperlower"
        ? ["Torso", "Pierna"]
        : style === "fullbody"
          ? ["Full body"]
          : ["Mi sesión"];
  const blocks = names.map((name) => ({
    id: crypto.randomUUID(),
    name,
    exercises: [],
  }));
  const pattern =
    style === "ppl"
      ? [0, 1, 2, 0, 1, 2, null]
      : style === "upperlower"
        ? [0, 1, null, 0, 1, null, null]
        : style === "fullbody"
          ? [0, null, 0, null, 0, null, null]
          : [0, null, null, null, null, null, null];
  return {
    style,
    name: "",
    durationWeeks: 4,
    startsOn: localTrainingDate(timeZone, now),
    blocks,
    weekdays: pattern.map((index) => (index === null ? "" : blocks[index]!.id)),
  };
}
export function selectRoutineExercise(
  block: RoutineBlock,
  exercise: { id: string; name: string },
): void {
  const index = block.exercises.findIndex(
    (value) => value.exerciseId === exercise.id,
  );
  if (index >= 0) block.exercises.splice(index, 1);
  else
    block.exercises.push({
      exerciseId: exercise.id,
      name: exercise.name,
      targetSets: "",
      targetRepsMin: "",
      targetRepsMax: "",
      targetLoad: "",
      targetLoadUnit: "",
    });
}
function integer(value: string, max: number, label: string) {
  if (!/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > max)
    throw new Error(`${label}: introduce un entero entre 1 y ${max}.`);
  return Number(value);
}
export function blockPrescriptions(block: RoutineBlock) {
  if (!block.name.trim()) throw new Error("Escribe el nombre de cada bloque.");
  if (!block.exercises.length)
    throw new Error(
      `${block.name}: selecciona al menos un ejercicio del catálogo.`,
    );
  return block.exercises.map((exercise, index) => {
    const context = `${block.name} · ${exercise.name}`;
    const targetSets = integer(exercise.targetSets, 1000, `${context}, series`);
    const targetRepsMin = integer(
      exercise.targetRepsMin,
      10000,
      `${context}, repeticiones mínimas`,
    );
    const targetRepsMax = integer(
      exercise.targetRepsMax,
      10000,
      `${context}, repeticiones máximas`,
    );
    if (targetRepsMin > targetRepsMax)
      throw new Error(
        `${context}: el mínimo de repeticiones debe ser menor o igual al máximo.`,
      );
    const targetLoad = exercise.targetLoad.trim().replace(",", ".") || null;
    if (targetLoad !== null && !exercise.targetLoadUnit)
      throw new Error(`${context}: selecciona la unidad de carga.`);
    if (targetLoad === null && exercise.targetLoadUnit)
      throw new Error(`${context}: escribe la carga o deja la unidad vacía.`);
    return {
      exerciseId: exercise.exerciseId,
      position: index + 1,
      targetSets,
      targetRepsMin,
      targetRepsMax,
      targetReps: targetRepsMin === targetRepsMax ? targetRepsMin : null,
      targetLoad,
      targetLoadUnit: exercise.targetLoadUnit || null,
    };
  });
}
export function buildRoutineRequest(
  draft: RoutineDraft,
  id: string,
  timeZone: string,
): GenerateRoutine {
  if (!draft.name.trim()) throw new Error("Escribe el nombre de tu plan.");
  if (!draft.startsOn)
    throw new Error(
      "Elige la fecha inicial para guardar tu semana y sus descansos.",
    );
  if (draft.weekdays.length !== 7)
    throw new Error("Revisa los siete días de la semana.");
  const days = draft.weekdays.flatMap((blockId, index) => {
    if (!blockId) return [];
    const block = draft.blocks.find((value) => value.id === blockId);
    if (!block)
      throw new Error(
        "Un bloque asignado ya no está disponible. Revisa la semana.",
      );
    return [
      {
        name: block.name,
        weekday: index + 1,
        exercises: blockPrescriptions(block),
      },
    ];
  });
  if (!days.length) throw new Error("Asigna al menos un día de entrenamiento.");
  const parsed = generateRoutineSchema.safeParse({
    id,
    name: draft.name,
    durationWeeks: draft.durationWeeks,
    startsOn: draft.startsOn || null,
    frequency: days.length,
    timeZone,
    days,
    restWeekdays: draft.weekdays.flatMap((value, index) =>
      value ? [] : [index + 1],
    ),
  });
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "Revisa los datos de tu rutina.",
    );
  return parsed.data;
}
