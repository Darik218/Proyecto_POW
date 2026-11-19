import {
  actualValuesToCopy,
  lastCompletedWorkSet,
  type WorkoutSetReference,
  type PreviousWorkoutReference,
} from "./workout-set-reference";
export type WorkoutSetDraft = {
  load: string | null;
  unit: "KG" | "LB" | null;
  repetitions: number | null;
  origin: string;
  reason?: string;
  prepared?: boolean;
};
/** Lossless formatting only. Never round official values to fit the recording contract. */
export function recordableLoad(value: string | null) {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "");
  const text = integer!.replace(/^0+(?=\d)/, "") + (digits ? "." + digits : "");
  return /^\d{1,5}(?:\.\d{1,3})?$/.test(text) ? text : null;
}
export function initialSetDraft(
  current: readonly WorkoutSetReference[] | undefined,
  previous: PreviousWorkoutReference | undefined,
  draft: WorkoutSetDraft | undefined,
  setNumber: number,
) {
  const today = actualValuesToCopy(lastCompletedWorkSet(current));
  if (today) return { ...today, origin: "CURRENT_RESULTS" };
  const load = recordableLoad(draft?.load ?? null);
  if (draft?.prepared) {
    const repetitions =
      Number.isSafeInteger(draft.repetitions) &&
      draft.repetitions! > 0 &&
      draft.repetitions! <= 10000
        ? String(draft.repetitions)
        : "";
    if (load !== null || repetitions)
      return {
        load: load ?? "",
        loadUnit: load !== null ? (draft.unit ?? "") : "",
        repetitions,
        origin: draft.origin,
      };
    return null;
  }
  if (
    draft?.origin !== "PLAN_TARGET" &&
    load !== null &&
    draft?.unit &&
    Number.isSafeInteger(draft.repetitions) &&
    draft.repetitions! > 0 &&
    draft.repetitions! <= 10000
  )
    return {
      load,
      loadUnit: draft.unit,
      repetitions: String(draft.repetitions),
      origin: draft.origin,
    };
  const prior =
    previous?.sets.find(
      (s) =>
        s.setNumber === setNumber &&
        s.status === "COMPLETED" &&
        s.kind === "WORK",
    ) ?? lastCompletedWorkSet(previous?.sets);
  const values = actualValuesToCopy(prior);
  if (values) return { ...values, origin: "HISTORICAL_REFERENCE" };
  return load !== null &&
    draft?.unit &&
    Number.isSafeInteger(draft.repetitions) &&
    draft.repetitions! > 0
    ? {
        load,
        loadUnit: draft.unit,
        repetitions: String(draft.repetitions),
        origin: draft.origin,
      }
    : null;
}
