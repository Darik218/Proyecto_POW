import assert from "node:assert/strict";
import test from "node:test";

test("per-series preparation retains its exact work-slot target after recording a prior edited set", async () => {
  const { initialSetDraft } = await import("../src/utils/workout-set-draft.ts");
  const record = {
    setNumber: 1,
    kind: "WORK",
    status: "COMPLETED",
    load: "62.500",
    loadUnit: "KG",
    repetitions: 7,
    rpe: null,
  };
  const draft = {
    origin: "CALCULATED",
    prepared: true,
    load: "60.000",
    unit: "KG",
    repetitions: null,
    repsBySet: [12, 11, 10],
  };
  const input = initialSetDraft(
    [
      { ...record, kind: "WARMUP" },
      { ...record, setNumber: 2 },
    ],
    undefined,
    draft,
    3,
  );
  assert.deepEqual(input, {
    load: "60",
    loadUnit: "KG",
    repetitions: "11",
    origin: "CALCULATED",
  });
});

test("a planned load without a unit does not enter the editable recording draft", async () => {
  const { initialSetDraft } = await import("../src/utils/workout-set-draft.ts");
  const input = initialSetDraft(
    [],
    undefined,
    {
      origin: "PLAN_TARGET",
      prepared: true,
      load: "60",
      unit: null,
      repetitions: 8,
    },
    1,
  );
  assert.deepEqual(input, {
    load: "",
    loadUnit: "",
    repetitions: "8",
    origin: "PLAN_TARGET",
  });
});
