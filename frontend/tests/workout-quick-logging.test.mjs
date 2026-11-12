import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
import { createRenderer } from "vue";
import { createServer } from "vite";

let server;
before(async () => {
  server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
});
after(async () => {
  await server?.close();
});
const component = async (name) =>
  (await server.ssrLoadModule(`/src/components/workouts/${name}.vue`)).default;
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
function mount(Component, props, t) {
  const app = renderer.createApp({ ...Component, render: () => null }, props);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const instance = app.mount({});
  t.after(() => app.unmount());
  return instance.$.setupState;
}
const workSet = {
  id: "10000000-0000-4000-8000-000000000001",
  setNumber: 1,
  kind: "WORK",
  status: "COMPLETED",
  load: "135.5",
  loadUnit: "LB",
  repetitions: 8,
  rpe: 7.5,
  version: 3,
  notes: null,
};

test("previous completed work values require explicit copying and confirmation; RPE stays a reference", async (t) => {
  const saved = [];
  const previousReference = { sessionLabel: "Push · 10 nov", sets: [workSet] };
  const state = mount(
    await component("WorkoutSetForm"),
    {
      previousReference,
      save: async (input) => {
        saved.push(input);
      },
    },
    t,
  );
  assert.equal(state.form.load, "");
  assert.equal(state.form.repetitions, "");
  state.copyReference("PREVIOUS");
  assert.equal(state.form.load, "135.5");
  assert.equal(state.form.loadUnit, "LB");
  assert.equal(state.form.repetitions, "8");
  assert.equal(state.form.rpe, "");
  await state.submit();
  assert.equal(saved.length, 0);
  assert.match(state.error, /Confirma/);
  state.confirmCopied = true;
  state.form.repetitions = "9";
  await state.submit();
  assert.equal(saved[0].repetitions, 9);
  assert.equal(saved[0].rpe, null);
  assert.equal(previousReference.sets[0].repetitions, 8);
});

test("copying rejects unknown units, non-work sets and invalid actual values", async (t) => {
  const Component = await component("WorkoutSetForm");
  for (const set of [
    { ...workSet, loadUnit: null },
    { ...workSet, kind: "WARMUP" },
    { ...workSet, status: "PENDING" },
    { ...workSet, repetitions: 0 },
    { ...workSet, load: "NaN" },
  ]) {
    const state = mount(
      Component,
      {
        previousReference: { sessionLabel: "Histórico", sets: [set] },
        save: async () => {},
      },
      t,
    );
    state.copyReference("PREVIOUS");
    assert.equal(state.form.load, "");
    assert.equal(state.form.repetitions, "");
  }
});

test("last-set reuse selects the last completed work set and clears confirmation for another source", async (t) => {
  const state = mount(
    await component("WorkoutSetForm"),
    {
      currentSets: [
        workSet,
        { ...workSet, setNumber: 3, load: "140", rpe: null },
        { ...workSet, setNumber: 4, kind: "WARMUP", load: "40" },
      ],
      previousReference: {
        sessionLabel: "Anterior",
        sets: [{ ...workSet, load: "130" }],
      },
      save: async () => {},
    },
    t,
  );
  state.copyReference("CURRENT");
  assert.equal(state.form.load, "140");
  state.confirmCopied = true;
  state.copyReference("PREVIOUS");
  assert.equal(state.form.load, "130");
  assert.equal(state.confirmCopied, false);
});

test("editing retains unknown-unit results until explicit correction and uses the existing record version", async (t) => {
  const initial = { ...workSet, loadUnit: null };
  const inputs = [];
  const state = mount(
    await component("WorkoutSetForm"),
    {
      initial,
      save: async (input) => {
        inputs.push(input);
      },
    },
    t,
  );
  assert.equal(state.form.loadUnit, "");
  await state.submit();
  assert.equal(inputs.length, 0);
  state.form.loadUnit = "LB";
  state.form.repetitions = "9";
  await state.submit();
  assert.equal(inputs[0].load, "135.5");
  assert.equal(inputs[0].loadUnit, "LB");
  assert.equal(initial.loadUnit, null);
  assert.equal(initial.repetitions, 8);
  const calls = [];
  const card = mount(
    await component("WorkoutExerciseCard"),
    {
      item: { id: workSet.id },
      status: "IN_PROGRESS",
      busy: false,
      index: 0,
      count: 1,
      actions: {
        recordSet: async (...args) => {
          calls.push(args);
        },
      },
    },
    t,
  );
  await card.saveSet(inputs[0], "creation-id", initial);
  assert.deepEqual(calls[0], [
    workSet.id,
    inputs[0],
    workSet.id,
    3,
    "creation-id",
  ]);
});
