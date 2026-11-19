import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRenderer } from "vue";
import { createPinia } from "pinia";
import { createServer } from "vite";
import { resolve } from "node:path";
let server;
before(async () => {
  server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
});
after(async () => server?.close());
const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
});
async function mount(t, props = {}) {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/GeneratePlanForm.vue",
    )
  ).default;
  const app = renderer.createApp({ ...Component, render: () => null }, props);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.use(createPinia());
  const state = app.mount({}).$.setupState;
  t.after(() => app.unmount());
  return state;
}
test("guided availability rejects unchosen fixed weekdays and never invents equipment", async (t) => {
  const state = await mount(t, { entryMode: "recommended" });
  assert.equal(state.guided, true);
  state.frequency = 4;
  await state.next();
  assert.equal(state.step, 1);
  assert.match(state.error, /días/);
  state.selectedWeekdays = [1, 2, 4, 5];
  await state.next();
  assert.equal(state.step, 2);
  await state.next();
  assert.equal(state.step, 2);
  assert.match(state.error, /objetivo|experiencia|equipamiento/);
});

test("returning from guided review keeps edited sessions and name when only the calendar changes", async (t) => {
  const state = await mount(t, { entryMode: "library" });
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  let requests = 0;
  api.defaults.adapter = async (config) => {
    requests++;
    return {
      config,
      data: { items: [], total: 0, limit: 100, offset: 0 },
      status: 200,
      statusText: "OK",
      headers: {},
    };
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  state.scheduleMode = "flexible";
  await state.next();
  Object.assign(state.preferences, {
    goal: "GENERAL",
    experience: "BEGINNER",
    equipment: ["DUMBBELL"],
  });
  await state.next();
  assert.equal(state.step, 3);
  const catalogRequests = requests;
  assert.ok(catalogRequests > 0);
  state.form.name = "Mi borrador personalizado";
  const first = state.form.blocks[0];
  first.name = "Sesión editada";
  await state.goTo(2);
  await state.goTo(1);
  state.scheduleMode = "fixed";
  state.selectedWeekdays = [1, 3, 5];
  await state.next();
  await state.next();
  assert.equal(state.step, 3);
  assert.equal(state.form.name, "Mi borrador personalizado");
  assert.equal(state.form.blocks[0].id, first.id);
  assert.equal(state.form.blocks[0].name, "Sesión editada");
  assert.equal(state.form.weekdays[0], first.id);
  assert.equal(requests, catalogRequests);
});
test("uncertain creation freezes its reviewed payload and UUID until resolved", async (t) => {
  const state = await mount(t);
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data));
    throw new Error("Lost response");
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  state.form.name = "Reviewed";
  state.form.blocks[0].exercises.push({
    exerciseId: "50000000-0000-4000-8000-000000000001",
    name: "Real",
    targetSets: "2",
    targetRepsMin: "8",
    targetRepsMax: "12",
    targetLoad: "",
    targetLoadUnit: "",
  });
  await state.save();
  assert.equal(state.uncertain, true);
  state.form.name = "Changed behind the pending intent";
  await state.save();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test("a catalog proposal cannot continue querying or restore preferences after its account session ends", async (t) => {
  const state = await mount(t, { entryMode: "recommended" });
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const pending = [],
    calls = [];
  api.defaults.adapter = (config) => {
    calls.push(config);
    return new Promise((resolve) => {
      pending.push(() =>
        resolve({
          config,
          data: { items: [], total: 0, limit: 100, offset: 0 },
          status: 200,
          statusText: "OK",
          headers: {},
        }),
      );
    });
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  state.scheduleMode = "flexible";
  await state.next();
  Object.assign(state.preferences, {
    goal: "GENERAL",
    experience: "BEGINNER",
    equipment: ["DUMBBELL"],
  });
  const proposal = state.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 5);
  state.auth.clearSession();
  for (const finish of [...pending]) finish();
  await new Promise((resolve) => setImmediate(resolve));
  // A new account must not inherit the second phase of another account's catalog request.
  assert.equal(calls.length, 5);
  await proposal;
  assert.equal(state.step, 1);
  assert.equal(state.form.name, "");
  assert.deepEqual(state.preferences.equipment, []);
});

test("a definitive validation rejection releases the draft for corrections with a fresh creation intent", async (t) => {
  const state = await mount(t);
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const { AxiosError } = await import("axios");
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data));
    if (calls.length === 1)
      throw new AxiosError(
        "Validation rejected",
        "ERR_BAD_REQUEST",
        config,
        undefined,
        {
          status: 400,
          data: { message: "Revisa el ejercicio" },
          headers: {},
          statusText: "Bad Request",
          config,
        },
      );
    return {
      config,
      data: { id: calls.at(-1).id },
      status: 201,
      statusText: "Created",
      headers: {},
    };
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  state.form.name = "Rejected";
  state.form.blocks[0].exercises.push({
    exerciseId: "50000000-0000-4000-8000-000000000001",
    name: "Real",
    targetSets: "2",
    targetRepsMin: "8",
    targetRepsMax: "12",
    targetLoad: "",
    targetLoadUnit: "",
  });
  await state.save();
  assert.equal(state.uncertain, false);
  state.form.name = "Corrected";
  await state.save();
  assert.equal(calls[1].name, "Corrected");
  assert.notEqual(calls[0].id, calls[1].id);
});

test("the shared selector queries the actual day muscle metadata and preserves recent/frequent/editorial meanings", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/ExercisePicker.vue",
    )
  ).default;
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(config);
    return {
      config,
      data: config.url.endsWith("muscle-groups")
        ? [{ key: "pectorales", name: "Pectorales", description: null }]
        : { items: [], total: 0, limit: 20, offset: 0 },
      status: 200,
      statusText: "OK",
      headers: {},
    };
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  const app = renderer.createApp(
    { ...Component, render: () => null },
    { modelValue: "", contextMuscleGroups: ["pectorales"] },
  );
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.use(createPinia());
  const state = app.mount({}).$.setupState;
  t.after(() => app.unmount());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.group, "pectorales");
  const first = calls.find((config) => config.url === "/exercises/visible");
  assert.equal(first.params.primaryMuscleGroupKey, "pectorales");
  assert.equal(first.params.selection, "FEATURED");
  state.selection = "FREQUENT";
  await state.request();
  assert.equal(calls.at(-1).url, "/exercises/visible");
  assert.equal(calls.at(-1).params.selection, "FREQUENT");
  assert.equal(calls.at(-1).params.primaryMuscleGroupKey, "pectorales");
  state.selection = "RECENT";
  await state.request();
  assert.equal(calls.at(-1).params.selection, "RECENT");
  assert.equal(calls.at(-1).params.primaryMuscleGroupKey, "pectorales");
});

test("generator count changes rebuild each family's editable distribution and validate its sum before querying", async (t) => {
  const state = await mount(t, { entryMode: "library" });
  state.frequency = 6;
  state.templateId = "ppl";
  state.exerciseCount = 7;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    { ...state.preferences.muscleAllocations.push },
    { pectorales: 3, deltoides: 2, triceps: 2 },
  );
  state.preferences.familyStrategies.push = "same";
  state.preferences.familyStrategies.pull = "different";
  assert.equal(state.preferences.familyStrategies.push, "same");
  assert.equal(state.preferences.familyStrategies.pull, "different");
  state.scheduleMode = "flexible";
  await state.next();
  Object.assign(state.preferences, {
    goal: "GENERAL",
    experience: "INTERMEDIATE",
    equipment: ["DUMBBELL"],
  });
  state.preferences.muscleAllocations.push.pectorales = 2;
  await state.next();
  assert.equal(state.step, 2);
  assert.match(state.error, /distribución|sumar/);
  state.auth.clearSession();
  assert.equal(state.exerciseCount, 5);
  assert.equal(state.preferences.durationMinutes, 45);
  assert.deepEqual(state.preferences.familyStrategies, {});
});

test("generator exhausts catalog pages before choosing functions beyond the first 100 results", async (t) => {
  const state = await mount(t, { entryMode: "library" });
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const calls = [];
  const fixture = (n) => ({
    id: `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Catálogo ${n}`,
    description: null,
    equipment: "Mancuernas",
    equipmentType: "DUMBBELL",
    machineType: null,
    resistanceType: "FREE_WEIGHT",
    movementType: n === 101 ? "ISOLATION" : "COMPOUND",
    movementPattern: "HORIZONTAL_PUSH",
    grip: null,
    gripWidth: null,
    bodyPosition: null,
    laterality: null,
    movementPlane: null,
    difficulty: "BEGINNER",
    oneRmSuitability: "UNDETERMINED",
    instructions: null,
    origin: "GLOBAL",
    isOwner: false,
    primaryMuscleGroup: { key: "pectorales", name: "Pecho" },
    secondaryMuscleGroups: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  api.defaults.adapter = async (config) => {
    calls.push(config.params);
    const isChest = config.params.primaryMuscleGroupKey === "pectorales",
      offset = config.params.offset ?? 0;
    const items =
      !isChest || config.params.selection !== "ALL"
        ? []
        : offset === 0
          ? Array.from({ length: 100 }, (_, n) => fixture(n + 1))
          : [fixture(101)];
    return {
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      data: {
        items,
        total: isChest && config.params.selection === "ALL" ? 101 : 0,
        limit: 100,
        offset,
      },
    };
  };
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  state.frequency = 3;
  state.templateId = "ppl";
  state.exerciseCount = 7;
  state.scheduleMode = "flexible";
  await state.next();
  Object.assign(state.preferences, {
    goal: "GENERAL",
    experience: "BEGINNER",
    equipment: ["DUMBBELL"],
  });
  await state.next();
  assert.equal(state.step, 3, state.error);
  assert.ok(
    calls.some(
      (query) =>
        query.primaryMuscleGroupKey === "pectorales" &&
        query.selection === "FREQUENT",
    ),
  );
  assert.ok(
    calls.some(
      (query) =>
        query.primaryMuscleGroupKey === "pectorales" &&
        query.selection === "ALL" &&
        query.offset === 100,
    ),
  );
  assert.ok(
    state.form.blocks[0].exercises.some((exercise) =>
      exercise.exerciseId.endsWith("000000000101"),
    ),
  );
});

test("preview day copy keeps independently editable targets and order", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/RoutineBuilder.vue",
    )
  ).default;
  const source = {
    id: "a",
    name: "Push A",
    muscleGroups: ["pectorales"],
    exercises: [
      {
        exerciseId: "x",
        name: "Press",
        targetSets: "4",
        targetRepsMin: "6",
        targetRepsMax: "8",
        targetLoad: "12.125",
        targetLoadUnit: "LB",
      },
      {
        exerciseId: "y",
        name: "Apertura",
        targetSets: "2",
        targetRepsMin: "12",
        targetRepsMax: "15",
        targetLoad: "",
        targetLoadUnit: "",
      },
    ],
  };
  const target = { id: "b", name: "Push B", exercises: [] };
  const app = renderer.createApp(
    { ...Component, render: () => null },
    { blocks: [source, target] },
  );
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const state = app.mount({}).$.setupState;
  t.after(() => app.unmount());
  state.activeId = "b";
  state.copySourceId = "a";
  state.copyDay();
  assert.deepEqual(target.exercises, source.exercises);
  state.move(0, 1);
  target.exercises[1].targetLoad = "30";
  assert.deepEqual(
    source.exercises.map((exercise) => exercise.exerciseId),
    ["x", "y"],
  );
  assert.equal(source.exercises[0].targetLoad, "12.125");
  assert.equal(target.name, "Push B");
});

test("preview exercise and set totals follow actual editable prescriptions rather than initial requested counts", async (t) => {
  const state = await mount(t, { entryMode: "library" });
  state.form.blocks = [
    {
      id: "a",
      name: "Push A",
      exercises: [{ exerciseId: "one", targetSets: "3" }],
    },
    {
      id: "b",
      name: "Push B",
      exercises: [
        { exerciseId: "two", targetSets: "4" },
        { exerciseId: "three", targetSets: "2" },
      ],
    },
  ];
  assert.equal(state.proposalSummary.exerciseCount, 3);
  assert.equal(state.proposalSummary.setCount, 9);
  state.form.blocks[1].exercises[0].targetSets = "5";
  assert.equal(state.proposalSummary.setCount, 10);
});

test("session reset removes customized muscle allocations even when template and default count stay unchanged", async (t) => {
  const state = await mount(t, { entryMode: "recommended" });
  state.preferences.muscleAllocations.full.cuadriceps = 4;
  state.preferences.muscleAllocations.full.pectorales = 0;
  state.auth.clearSession();
  assert.deepEqual(
    { ...state.preferences.muscleAllocations.full },
    {
      cuadriceps: 1,
      pectorales: 1,
      dorsales: 1,
      isquiotibiales: 1,
      deltoides: 1,
    },
  );
});
