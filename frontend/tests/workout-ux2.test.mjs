import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createRenderer, createSSRApp, reactive, h, ref, nextTick } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
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
  app.use(createPinia());
  const instance = app.mount({});
  t.after(() => app.unmount());
  return instance.$.setupState;
}
test("normal completion needs no checkbox and sends no progression authorization", async (t) => {
  const calls = [];
  const state = mount(
    await component("CompleteWorkoutForm"),
    { hasResults: true, save: async (flag) => calls.push(flag) },
    t,
  );
  await state.submit();
  assert.deepEqual(calls, [false]);
  assert.equal(state.error, "");
  const html = await renderToString(
    createSSRApp(await component("CompleteWorkoutForm"), {
      hasResults: true,
      save: async () => {},
    }),
  );
  assert.doesNotMatch(html, /type="checkbox"|Confirmo que deseo/);
});
test("inline series starts from a calculated editable draft and recording the edited values is the explicit action", async (t) => {
  const calls = [];
  const state = mount(
    await component("WorkoutSetForm"),
    {
      inline: true,
      draft: {
        load: "42.500000",
        unit: "KG",
        repetitions: 8,
        origin: "CALCULATED",
      },
      save: async (input, id) => calls.push({ input, id }),
    },
    t,
  );
  assert.equal(state.form.load, "42.5");
  assert.equal(state.form.repetitions, "8");
  assert.equal(state.form.rpe, "");
  assert.equal(state.form.rir, "");
  state.form.load = "45";
  state.form.repetitions = "9";
  await state.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.load, "45");
  assert.equal(calls[0].input.repetitions, 9);
  assert.equal(calls[0].input.rir, null);
  assert.equal(calls[0].input.rpe, null);
  assert.equal("autoApplyAuthorized" in calls[0].input, false);
});
test("the next series retains the user actual choice over a new proposal, without copying subjective effort", async (t) => {
  const current = {
    setNumber: 1,
    load: "40",
    loadUnit: "LB",
    repetitions: 7,
    rpe: 9,
    status: "COMPLETED",
    kind: "WORK",
  };
  const state = mount(
    await component("WorkoutSetForm"),
    {
      inline: true,
      nextNumber: 2,
      currentSets: [current],
      draft: {
        load: "42.500000",
        unit: "KG",
        repetitions: 8,
        origin: "CALCULATED",
      },
      save: async () => {},
    },
    t,
  );
  assert.equal(state.form.load, "40");
  assert.equal(state.form.loadUnit, "LB");
  assert.equal(state.form.repetitions, "7");
  assert.equal(state.form.rpe, "");
  assert.equal(state.form.rir, "");
});
test("using prior recorded values no longer requires an additional copied-result checkbox", async (t) => {
  const calls = [];
  const state = mount(
    await component("WorkoutSetForm"),
    {
      previousReference: {
        sessionLabel: "Anterior",
        sets: [
          {
            setNumber: 1,
            load: "40",
            loadUnit: "KG",
            repetitions: 8,
            rpe: null,
            status: "COMPLETED",
            kind: "WORK",
          },
        ],
      },
      save: async (input) => calls.push(input),
    },
    t,
  );
  state.copyReference("PREVIOUS");
  await state.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].load, "40");
});
test("live session shows one editable series form and keeps the other exercises compact", async () => {
  const { detail, exercise } = await import("./workout-sessions.fixtures.mjs");
  const item = {
    ...exercise,
    isOmitted: false,
    sets: [],
    targets: {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 8,
      targetLoad: "40",
      targetLoadUnit: "KG",
      targetRpe: null,
    },
  };
  const session = {
    ...detail,
    exercises: [
      item,
      {
        ...item,
        id: "40000000-0000-4000-8000-000000000001",
        orderInSession: 2,
        exercise: { ...exercise.exercise, name: "Segundo" },
      },
    ],
  };
  const Component = await component("WorkoutLivePanel");
  const app = createSSRApp(Component, {
    session,
    busy: false,
    actions: { session: { value: session } },
    previousReferences: {},
  });
  app.use(createPinia());
  const html = await renderToString(app);
  assert.equal((html.match(/<form[^>]*quick-set-form/g) || []).length, 1);
  assert.match(html, /Registrar serie/);
  assert.match(html, /Ejercicio 1 de 2/);
  assert.doesNotMatch(html, /Confirmo que deseo finalizar/);
});
test("logging the last target series keeps the current exercise until the athlete explicitly advances", async (t) => {
  const { detail, exercise } = await import("./workout-sessions.fixtures.mjs");
  const first = {
    ...exercise,
    isOmitted: false,
    sets: [],
    targets: {
      targetSets: 1,
      targetRepsMin: 8,
      targetRepsMax: 8,
      targetLoad: "40",
      targetLoadUnit: "KG",
      targetRpe: null,
    },
  };
  const source = reactive({
    ...detail,
    exercises: [
      first,
      {
        ...first,
        id: "40000000-0000-4000-8000-000000000001",
        orderInSession: 2,
        sets: [],
      },
    ],
  });
  const state = mount(
    await component("WorkoutLivePanel"),
    {
      session: source,
      busy: false,
      actions: { session: { value: source } },
      previousReferences: {},
    },
    t,
  );
  const initial = state.active.id;
  source.exercises[0].sets.push({
    setNumber: 1,
    kind: "WORK",
    status: "COMPLETED",
  });
  assert.equal(state.active.id, initial);
  state.advance();
  assert.equal(state.active.id, source.exercises[1].id);
});
test("an invalidated automatic draft clears its old load and repetitions without deleting human edits", async (t) => {
  const draft = reactive({
    load: "42.5",
    unit: "KG",
    repetitions: 8,
    origin: "CALCULATED",
  });
  const state = mount(
    await component("WorkoutSetForm"),
    { inline: true, draft, save: async () => {} },
    t,
  );
  assert.equal(state.form.load, "42.5");
  draft.load = null;
  draft.repetitions = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.form.load, "");
  assert.equal(state.form.repetitions, "");
  assert.equal(state.form.loadUnit, "");
  draft.load = "50";
  draft.repetitions = 8;
  await new Promise((resolve) => setImmediate(resolve));
  state.draftEdited = true;
  state.form.load = "45";
  draft.load = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.form.load, "45");
});

test("configured rest restarts after a saved series with numeric input from Vue v-model", async (t) => {
  const Component = await component("RestTimer"),
    trigger = ref(0),
    target = ref();
  const app = renderer.createApp({
    setup() {
      return () => h(Component, { autoStart: trigger.value, ref: target });
    },
  });
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.mount({});
  t.after(() => app.unmount());
  const state = target.value.$.setupState;
  state.seconds = 45;
  trigger.value = 1;
  await nextTick();
  assert.equal(state.running, true);
  assert.equal(state.left, 45);
  state.stop();
});
