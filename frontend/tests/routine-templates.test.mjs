import assert from "node:assert/strict";
import { test } from "node:test";
const id = "50000000-0000-4000-8000-000000000001";
const exercise = (group, equipmentType = "DUMBBELL", extra = {}) => ({
  id: crypto.randomUUID(),
  name: "Nombre sin pistas",
  primaryMuscleGroup: { key: group, name: group },
  equipmentType,
  difficulty: "BEGINNER",
  movementPattern:
    {
      pectorales: "HORIZONTAL_PUSH",
      dorsales: "VERTICAL_PULL",
      cuadriceps: "SQUAT",
      biceps: "ELBOW_FLEXION",
    }[group] ?? null,
  movementType: "COMPOUND",
  ...extra,
});

test("eight splits expand valid frequencies into reusable independent A/B/C session types", async () => {
  const { routineTemplates, templateSessions } =
    await import("../src/config/routine-templates.ts");
  assert.equal(routineTemplates.length, 8);
  for (const template of routineTemplates) {
    for (const frequency of template.frequencies)
      assert.equal(templateSessions(template.id, frequency).length, frequency);
    assert.throws(() => templateSessions(template.id, 0), /frecuencia/);
  }
  assert.deepEqual(
    templateSessions("upperlower", 4).map((v) => v.key),
    ["upper-a", "lower-a", "upper-b", "lower-b"],
  );
  assert.deepEqual(
    templateSessions("ppl", 6).map((v) => v.key),
    ["push-a", "pull-a", "legs-a", "push-b", "pull-b", "legs-b"],
  );
  assert.deepEqual(
    templateSessions("fullbody", 3).map((v) => v.key),
    ["full-a", "full-b", "full-c"],
  );
});

test("template generation uses catalog metadata and explicit equipment, never exercise names or invented IDs", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const chest = exercise("pectorales"),
    back = exercise("dorsales"),
    legs = exercise("cuadriceps");
  const misleading = exercise("biceps", "BARBELL", {
    name: "Full body sentadilla pecho",
  });
  const prefs = {
    experience: "BEGINNER",
    equipment: ["DUMBBELL"],
    goal: "GENERAL",
  };
  const { blocks, missing } = buildTemplateBlocks(
    "fullbody",
    1,
    [chest, back, legs, misleading],
    prefs,
  );
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].exercises.length >= 3);
  assert.equal(
    blocks[0].exercises.some((v) => v.exerciseId === misleading.id),
    false,
  );
  for (const value of blocks[0].exercises) {
    assert.ok([chest.id, back.id, legs.id].includes(value.exerciseId));
    assert.equal(value.targetSets, "2");
    assert.equal(value.targetRepsMin, "8");
    assert.equal(value.targetRepsMax, "12");
    assert.equal(value.targetLoad, "");
  }
  assert.ok(missing.length > 0);
  assert.throws(
    () =>
      buildTemplateBlocks("fullbody", 1, [chest], { ...prefs, equipment: [] }),
    /equipamiento/,
  );
  const empty = buildTemplateBlocks(
    "fullbody",
    1,
    [exercise("pectorales", "BARBELL")],
    prefs,
  );
  assert.equal(empty.blocks[0].exercises.length, 0);
  assert.ok(empty.missing.length > 0);
});

test("fixed schedules require explicit matching weekdays; flexible schedules serialize null without rest dates", async () => {
  const { createRoutineDraft, buildRoutineRequest, applyRoutineSchedule } =
    await import("../src/utils/routine-builder.ts");
  const draft = createRoutineDraft();
  draft.name = "Flexible";
  draft.blocks = [0, 1].map((n) => ({
    id: crypto.randomUUID(),
    name: `Día ${n + 1}`,
    exercises: [
      {
        exerciseId: id,
        name: "Real",
        targetSets: "2",
        targetRepsMin: "8",
        targetRepsMax: "12",
        targetLoad: "",
        targetLoadUnit: "",
      },
    ],
  }));
  applyRoutineSchedule(draft, "flexible", []);
  const flexible = buildRoutineRequest(draft, id, "UTC");
  assert.deepEqual(
    flexible.days.map((v) => v.weekday),
    [null, null],
  );
  assert.equal("restWeekdays" in flexible, false);
  assert.equal(flexible.startsOn, null);
  assert.throws(
    () => applyRoutineSchedule(draft, "fixed", [1]),
    /selecciona|días/i,
  );
  applyRoutineSchedule(draft, "fixed", [2, 5]);
  const fixed = buildRoutineRequest(draft, id, "UTC");
  assert.deepEqual(
    fixed.days.map((v) => v.weekday),
    [2, 5],
  );
  assert.deepEqual(fixed.restWeekdays, [1, 3, 4, 6, 7]);
});

const generatorPreferences = {
  experience: "INTERMEDIATE",
  equipment: ["DUMBBELL", "MACHINE", "CABLE", "BARBELL"],
  goal: "GENERAL",
};
const poolFor = (group, pattern, count = 12, extra = {}) =>
  Array.from({ length: count }, (_, n) =>
    exercise(group, "DUMBBELL", {
      id: `${group}-${n.toString().padStart(2, "0")}-${pattern}`,
      movementPattern: pattern,
      movementType: n % 3 === 2 ? "ISOLATION" : "COMPOUND",
      ...extra,
    }),
  );
const pushPool = () => [
  ...poolFor("pectorales", "HORIZONTAL_PUSH"),
  ...poolFor("deltoides", "VERTICAL_PUSH", 6),
  ...poolFor("deltoides", "SHOULDER_ABDUCTION", 6, {
    movementType: "ISOLATION",
  }),
  ...poolFor("triceps", "ELBOW_EXTENSION", 12, { movementType: "ISOLATION" }),
];

test("exercise counts produce the requested Push distribution and respect custom per-muscle counts", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = pushPool();
  for (const exerciseCount of [3, 4, 5, 6, 7, 8, 9]) {
    const result = buildTemplateBlocks("ppl", 3, catalog, {
      ...generatorPreferences,
      exerciseCount,
    });
    assert.equal(result.blocks[0].exercises.length, exerciseCount);
    assert.equal(
      new Set(result.blocks[0].exercises.map((v) => v.exerciseId)).size,
      exerciseCount,
    );
    if (exerciseCount === 7) {
      const groups = result.blocks[0].exercises.map(
        (v) =>
          catalog.find((item) => item.id === v.exerciseId).primaryMuscleGroup
            .key,
      );
      assert.deepEqual(groups, [
        "pectorales",
        "pectorales",
        "pectorales",
        "deltoides",
        "deltoides",
        "triceps",
        "triceps",
      ]);
    }
  }
  const custom = buildTemplateBlocks("ppl", 3, catalog, {
    ...generatorPreferences,
    exerciseCount: 7,
    muscleAllocations: { push: { pectorales: 2, deltoides: 3, triceps: 2 } },
  });
  assert.equal(
    custom.blocks[0].exercises.filter(
      (v) =>
        catalog.find((item) => item.id === v.exerciseId).primaryMuscleGroup
          .key === "deltoides",
    ).length,
    3,
  );
  assert.throws(
    () =>
      buildTemplateBlocks("ppl", 3, catalog, {
        ...generatorPreferences,
        exerciseCount: 7,
        muscleAllocations: { push: { pectorales: 1 } },
      }),
    /distribución|suma/i,
  );
  for (const exerciseCount of [0, 2.5, 21])
    assert.throws(
      () =>
        buildTemplateBlocks("ppl", 3, catalog, {
          ...generatorPreferences,
          exerciseCount,
        }),
      /ejercicios/i,
    );
});

test("metadata ranking covers complementary functions, ignores names and is stable across catalog order", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = pushPool();
  const build = (pool) =>
    buildTemplateBlocks("ppl", 3, pool, {
      ...generatorPreferences,
      exerciseCount: 7,
    }).blocks[0].exercises.map((v) => v.exerciseId);
  const selected = build(catalog);
  assert.deepEqual(build([...catalog].reverse()), selected);
  assert.deepEqual(
    build(
      catalog.map((item) => ({
        ...item,
        name: `Misleading ${item.id} sentadilla curl`,
      })),
    ),
    selected,
  );
  const chest = selected
    .slice(0, 3)
    .map((id) => catalog.find((v) => v.id === id));
  assert.ok(chest.some((v) => v.movementType === "COMPOUND"));
  assert.ok(chest.some((v) => v.movementType === "ISOLATION"));
  assert.deepEqual(
    selected
      .slice(3, 5)
      .map((id) => catalog.find((v) => v.id === id).movementPattern),
    ["VERTICAL_PUSH", "SHOULDER_ABDUCTION"],
  );
});

test("each repeated session family independently chooses same, partial or different variants", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const { blocks } = buildTemplateBlocks("ppl", 6, pushPool(), {
    ...generatorPreferences,
    exerciseCount: 7,
    familyStrategies: { push: "partial", pull: "same", legs: "different" },
  });
  const a = blocks[0].exercises.map((v) => v.exerciseId),
    b = blocks[3].exercises.map((v) => v.exerciseId);
  assert.equal(a[0], b[0]);
  assert.ok(a.some((id, index) => id !== b[index]));
  const same = buildTemplateBlocks("ppl", 6, pushPool(), {
    ...generatorPreferences,
    exerciseCount: 7,
    familyStrategies: { push: "same" },
  }).blocks;
  assert.deepEqual(same[0].exercises, same[3].exercises);
  assert.notEqual(same[0].id, same[3].id);
  same[3].exercises[0].targetLoad = "25";
  assert.equal(same[0].exercises[0].targetLoad, "");
  const different = buildTemplateBlocks("ppl", 6, pushPool(), {
    ...generatorPreferences,
    exerciseCount: 7,
    familyStrategies: { push: "different" },
  }).blocks;
  assert.equal(
    different[3].exercises.some((v) =>
      different[0].exercises.some((a) => a.exerciseId === v.exerciseId),
    ),
    false,
  );
});

test("insufficient compatible variety is reported without duplicated or invented catalog movements", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = [
    exercise("pectorales", "DUMBBELL", {
      id: "only-chest",
      movementPattern: "HORIZONTAL_PUSH",
      movementType: "COMPOUND",
    }),
  ];
  const result = buildTemplateBlocks("ppl", 6, catalog, {
    ...generatorPreferences,
    exerciseCount: 7,
    familyStrategies: { push: "different" },
  });
  assert.equal(result.blocks[0].exercises.length, 1);
  assert.ok(result.missing.some((v) => /Push A/.test(v) && /2/.test(v)));
  assert.ok(
    result.warnings.some(
      (v) => /Push B/.test(v) && /variedad|diferentes/i.test(v),
    ),
  );
});

test("independent day copy preserves ordering and every prescription without retaining mutable references", async () => {
  const { copyTemplateDay } = await import("../src/utils/routine-templates.ts");
  const source = {
    id: "day-a",
    name: "Push A",
    muscleGroups: ["pectorales"],
    exercises: [
      {
        exerciseId: "b",
        name: "B",
        targetSets: "4",
        targetRepsMin: "6",
        targetRepsMax: "10",
        targetLoad: "12.125",
        targetLoadUnit: "LB",
      },
      {
        exerciseId: "a",
        name: "A",
        targetSets: "2",
        targetRepsMin: "12",
        targetRepsMax: "15",
        targetLoad: "",
        targetLoadUnit: "",
      },
    ],
  };
  const target = { id: "day-b", name: "Push B", exercises: [] };
  copyTemplateDay(source, target);
  assert.equal(target.id, "day-b");
  assert.equal(target.name, "Push B");
  assert.deepEqual(target.exercises, source.exercises);
  target.exercises.reverse();
  target.exercises[1].targetSets = "9";
  target.muscleGroups.push("triceps");
  assert.equal(source.exercises[0].targetSets, "4");
  assert.deepEqual(
    source.exercises.map((v) => v.exerciseId),
    ["b", "a"],
  );
  assert.deepEqual(source.muscleGroups, ["pectorales"]);
});

test("relevant personal usage outranks editorial ties without replacing a complementary movement function", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = [
    exercise("pectorales", "DUMBBELL", {
      id: "a-editorial",
      movementPattern: "HORIZONTAL_PUSH",
      movementType: "COMPOUND",
      editorialRank: 0,
    }),
    exercise("pectorales", "DUMBBELL", {
      id: "z-used",
      movementPattern: "HORIZONTAL_PUSH",
      movementType: "COMPOUND",
      usageRank: 0,
    }),
    exercise("pectorales", "DUMBBELL", {
      id: "iso",
      movementPattern: "HORIZONTAL_PUSH",
      movementType: "ISOLATION",
    }),
    exercise("deltoides", "DUMBBELL", {
      id: "press",
      movementPattern: "VERTICAL_PUSH",
      movementType: "COMPOUND",
    }),
    exercise("deltoides", "DUMBBELL", {
      id: "lateral",
      movementPattern: "SHOULDER_ABDUCTION",
      movementType: "ISOLATION",
      usageRank: 0,
    }),
    ...poolFor("triceps", "ELBOW_EXTENSION", 2, { movementType: "ISOLATION" }),
  ];
  const result = buildTemplateBlocks("ppl", 3, catalog, {
    ...generatorPreferences,
    exerciseCount: 7,
  });
  assert.equal(result.blocks[0].exercises[0].exerciseId, "z-used");
  assert.deepEqual(
    result.blocks[0].exercises.slice(3, 5).map((v) => v.exerciseId),
    ["press", "lateral"],
  );
});

test("partial variants of full-body preserve a base and still offer different accessory slots", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = [
    ...poolFor("cuadriceps", "SQUAT"),
    ...poolFor("pectorales", "HORIZONTAL_PUSH"),
    ...poolFor("dorsales", "VERTICAL_PULL"),
    ...poolFor("isquiotibiales", "HIP_HINGE"),
    ...poolFor("deltoides", "VERTICAL_PUSH"),
  ];
  const { blocks } = buildTemplateBlocks("fullbody", 2, catalog, {
    ...generatorPreferences,
    exerciseCount: 5,
    familyStrategies: { full: "partial" },
  });
  assert.equal(
    blocks[0].exercises[0].exerciseId,
    blocks[1].exercises[0].exerciseId,
  );
  assert.ok(
    blocks[1].exercises.some(
      (v, i) => v.exerciseId !== blocks[0].exercises[i].exerciseId,
    ),
  );
});

test("same-muscle jumps, Olympic lifts and unknown movement metadata cannot fill a functional proposal", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const bad = [
    exercise("cuadriceps", "DUMBBELL", {
      movementPattern: "JUMP",
      movementType: "PLYOMETRIC",
    }),
    exercise("cuadriceps", "DUMBBELL", {
      movementPattern: "OLYMPIC_LIFT",
      movementType: "OLYMPIC",
    }),
    exercise("cuadriceps", "DUMBBELL", {
      movementPattern: null,
      movementType: null,
    }),
  ];
  const result = buildTemplateBlocks("fullbody", 1, bad, {
    ...generatorPreferences,
    exerciseCount: 3,
  });
  assert.equal(result.blocks[0].exercises.length, 0);
  assert.ok(result.missing.some((v) => /Cuádriceps/.test(v)));
});

test("Pull allocates posterior deltoid work through horizontal-pull isolation instead of shoulder presses", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = [
    ...poolFor("dorsales", "VERTICAL_PULL"),
    ...poolFor("espalda-alta", "HORIZONTAL_PULL"),
    ...poolFor("biceps", "ELBOW_FLEXION", 12, { movementType: "ISOLATION" }),
    exercise("deltoides", "DUMBBELL", {
      id: "rear",
      movementPattern: "HORIZONTAL_PULL",
      movementType: "ISOLATION",
    }),
    exercise("deltoides", "DUMBBELL", {
      id: "press",
      movementPattern: "VERTICAL_PUSH",
      movementType: "COMPOUND",
    }),
  ];
  const { blocks } = buildTemplateBlocks("ppl", 3, catalog, {
    ...generatorPreferences,
    exerciseCount: 7,
  });
  assert.ok(blocks[1].exercises.some((v) => v.exerciseId === "rear"));
  assert.equal(
    blocks[1].exercises.some((v) => v.exerciseId === "press"),
    false,
  );
});

test("independent variants rotate within the best functional score tier and preserve unique correct slots", async () => {
  const { buildTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const catalog = [
    exercise("deltoides", "DUMBBELL", {
      id: "press",
      movementPattern: "VERTICAL_PUSH",
      movementType: "COMPOUND",
    }),
    exercise("deltoides", "DUMBBELL", {
      id: "lateral",
      movementPattern: "SHOULDER_ABDUCTION",
      movementType: "ISOLATION",
    }),
  ];
  const { blocks } = buildTemplateBlocks("ppl", 6, catalog, {
    ...generatorPreferences,
    exerciseCount: 3,
    familyStrategies: { push: "independent" },
  });
  assert.deepEqual(
    blocks[3].exercises.map((v) => v.exerciseId),
    ["press"],
  );
});

test("preview summaries count edited direct sets by catalog primary muscle and report unknown groups explicitly", async () => {
  const { summarizeTemplateBlocks } =
    await import("../src/utils/routine-templates.ts");
  const blocks = [
    {
      id: "a",
      name: "A",
      exercises: [
        { exerciseId: "chest", targetSets: "4" },
        { exerciseId: "shoulder", targetSets: "2" },
      ],
    },
    {
      id: "b",
      name: "B",
      exercises: [
        { exerciseId: "chest", targetSets: "3" },
        { exerciseId: "personal", targetSets: "5" },
      ],
    },
  ];
  const summary = summarizeTemplateBlocks(blocks, [
    exercise("pectorales", "DUMBBELL", { id: "chest" }),
    exercise("deltoides", "DUMBBELL", { id: "shoulder" }),
  ]);
  assert.equal(summary.exerciseCount, 4);
  assert.equal(summary.setCount, 14);
  assert.deepEqual(summary.directSets, { pectorales: 7, deltoides: 2 });
  assert.equal(summary.unclassifiedSets, 5);
  blocks[0].exercises[0].targetSets = "6";
  assert.equal(summarizeTemplateBlocks(blocks, []).setCount, 16);
});
