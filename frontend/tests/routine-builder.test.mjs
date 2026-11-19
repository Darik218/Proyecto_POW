import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRoutineSchema } from "../src/services/routine.service.ts";
const id = "50000000-0000-4000-8000-000000000001";
const prescription = {
  exerciseId: id,
  position: 1,
  targetSets: 3,
  targetReps: 8,
  targetRepsMin: 8,
  targetRepsMax: 8,
  targetLoad: "12.125",
  targetLoadUnit: "LB",
};
const request = {
  id,
  name: "PPL",
  durationWeeks: 4,
  frequency: 1,
  startsOn: "2026-11-12",
  timeZone: "America/Bogota",
  days: [{ name: "PUSH", weekday: 1, exercises: [prescription] }],
  restWeekdays: [2, 3, 4, 5, 6, 7],
};
test("routine generation accepts explicit catalog prescriptions, exact decimal units and voluntary rest days", () => {
  assert.equal(generateRoutineSchema.safeParse(request).success, true);
  const parsed = generateRoutineSchema.parse(request);
  assert.equal(parsed.days[0].exercises[0].targetLoad, "12.125");
  assert.equal(parsed.days[0].exercises[0].targetLoadUnit, "LB");
});
test("routine generation rejects missing units, repeated catalog selections and rest/training overlap", () => {
  for (const exercises of [
    [{ ...prescription, targetLoadUnit: null }],
    [prescription, { ...prescription, position: 2 }],
  ]) {
    assert.equal(
      generateRoutineSchema.safeParse({
        ...request,
        days: [{ ...request.days[0], exercises }],
      }).success,
      false,
    );
  }
  assert.equal(
    generateRoutineSchema.safeParse({ ...request, restWeekdays: [1] }).success,
    false,
  );
  assert.equal(
    generateRoutineSchema.safeParse({ ...request, restWeekdays: [7, 7] })
      .success,
    false,
  );
  assert.equal(
    generateRoutineSchema.safeParse({
      ...request,
      days: [
        {
          ...request.days[0],
          exercises: [{ ...prescription, targetLoad: 12.125 }],
        },
      ],
    }).success,
    false,
  );
});

test("PPL configures three blocks once then expands six independent weekdays without guessed targets", async () => {
  const { createRoutineDraft, buildRoutineRequest, selectRoutineExercise } =
    await import("../src/utils/routine-builder.ts");
  const draft = createRoutineDraft("ppl");
  draft.name = "Mi PPL";
  draft.durationWeeks = 4;
  assert.deepEqual(
    draft.blocks.map((block) => block.name),
    ["PUSH", "PULL", "LEGS"],
  );
  for (const block of draft.blocks) {
    selectRoutineExercise(block, { id, name: "Elegido" });
    assert.equal(block.exercises[0].targetSets, "");
    assert.equal(block.exercises[0].targetLoad, "");
    Object.assign(block.exercises[0], {
      targetSets: "3",
      targetRepsMin: "8",
      targetRepsMax: "12",
    });
  }
  draft.blocks[0].exercises[0].targetLoad = "12,125";
  draft.blocks[0].exercises[0].targetLoadUnit = "LB";
  const output = buildRoutineRequest(draft, id, "America/Bogota");
  assert.equal(output.frequency, 6);
  assert.equal(output.durationWeeks, 4);
  assert.deepEqual(
    output.days.map((day) => day.weekday),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(output.restWeekdays, [7]);
  assert.equal(output.days[0].exercises[0].targetLoad, "12.125");
  assert.equal(output.days[0].exercises[0].targetLoadUnit, "LB");
  assert.equal(output.days[1].exercises[0].targetLoad, null);
  output.days[0].exercises[0].targetSets = 6;
  assert.equal(output.days[3].exercises[0].targetSets, 3);
  assert.equal(draft.blocks[0].exercises[0].targetSets, "3");
});
test("catalog selection toggles explicitly and incomplete targets cannot create a routine", async () => {
  const { createRoutineDraft, buildRoutineRequest, selectRoutineExercise } =
    await import("../src/utils/routine-builder.ts");
  const draft = createRoutineDraft("fullbody");
  draft.name = "Mía";
  const block = draft.blocks[0];
  selectRoutineExercise(block, { id, name: "Elegido" });
  selectRoutineExercise(block, { id, name: "Elegido" });
  assert.equal(block.exercises.length, 0);
  assert.throws(() => buildRoutineRequest(draft, id, "UTC"), /ejercicio/);
  selectRoutineExercise(block, { id, name: "Elegido" });
  assert.throws(
    () => buildRoutineRequest(draft, id, "UTC"),
    /series|repeticiones/,
  );
  Object.assign(block.exercises[0], {
    targetSets: "3",
    targetRepsMin: "8",
    targetRepsMax: "8",
    targetLoad: "10",
  });
  assert.throws(() => buildRoutineRequest(draft, id, "UTC"), /unidad/);
  block.exercises[0].targetLoadUnit = "KG";
  assert.equal(
    buildRoutineRequest(draft, id, "UTC").days[0].exercises[0].targetReps,
    8,
  );
});

test("wizard shows local today as an editable start date and never fills a missing date at submission", async () => {
  const { createRoutineDraft, buildRoutineRequest, selectRoutineExercise } =
    await import("../src/utils/routine-builder.ts");
  const draft = createRoutineDraft(
    "fullbody",
    "America/Bogota",
    new Date("2026-11-13T02:00:00Z"),
  );
  assert.equal(draft.startsOn, "2026-11-12");
  draft.name = "Plan fechado";
  selectRoutineExercise(draft.blocks[0], { id, name: "Elegido" });
  Object.assign(draft.blocks[0].exercises[0], {
    targetSets: "3",
    targetRepsMin: "8",
    targetRepsMax: "8",
  });
  assert.equal(
    buildRoutineRequest(draft, id, "America/Bogota").startsOn,
    "2026-11-12",
  );
  draft.startsOn = "";
  assert.throws(
    () => buildRoutineRequest(draft, id, "America/Bogota"),
    /fecha inicial/,
  );
  draft.weekdays = Array(7).fill(draft.blocks[0].id);
  assert.throws(
    () => buildRoutineRequest(draft, id, "America/Bogota"),
    /fecha inicial/,
  );
  assert.equal(draft.startsOn, "");
});

test("rest weekdays require a date while legacy flexible plans remain valid", () => {
  assert.equal(
    generateRoutineSchema.safeParse({ ...request, startsOn: null }).success,
    false,
  );
  const { restWeekdays, ...legacy } = request;
  assert.equal(
    generateRoutineSchema.safeParse({ ...legacy, startsOn: null }).success,
    true,
  );
});
