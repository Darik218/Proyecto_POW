import type { z } from "zod";
import type { referenceSetSchema } from "../schemas/workout-insights.schema";
type SetRecord = z.infer<typeof referenceSetSchema>;

export type WorkoutSetReference = Pick<
  SetRecord,
  "setNumber" | "status" | "kind" | "load" | "loadUnit" | "repetitions" | "rpe"
>;

export type PreviousWorkoutReference = {
  sessionLabel: string;
  sets: readonly WorkoutSetReference[];
};

/** Only explicitly classified work is reusable; legacy completion flags are insufficient. */
export function lastCompletedWorkSet(
  sets: readonly WorkoutSetReference[] = [],
): WorkoutSetReference | undefined {
  return sets.reduce<WorkoutSetReference | undefined>(
    (last, set) =>
      set.status === "COMPLETED" &&
      set.kind === "WORK" &&
      (!last || set.setNumber >= last.setNumber)
        ? set
        : last,
    undefined,
  );
}

/** Copy the original load and unit as a pair, without converting or borrowing RPE. */
export function actualValuesToCopy(set?: WorkoutSetReference) {
  if (
    !set ||
    set.kind !== "WORK" ||
    set.status !== "COMPLETED" ||
    set.load == null ||
    !/^\d{1,5}(\.\d{1,3})?$/.test(set.load) ||
    !["KG", "LB"].includes(set.loadUnit ?? "") ||
    !Number.isInteger(set.repetitions) ||
    set.repetitions! <= 0 ||
    set.repetitions! > 10000
  )
    return null;
  return {
    load: set.load,
    loadUnit: set.loadUnit!,
    repetitions: String(set.repetitions),
  };
}
