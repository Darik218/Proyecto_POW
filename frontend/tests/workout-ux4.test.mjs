import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createRenderer, createSSRApp, reactive } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { detail, exercise } from "./workout-sessions.fixtures.mjs";
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
  (await server.ssrLoadModule("/src/components/workouts/" + name + ".vue"))
    .default;
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
const id = "10000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000001";
async function render(Component, props) {
  const app = createSSRApp(Component, props);
  app.use(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => null } },
      {
        path: "/catalog",
        name: "exercise-catalog",
        component: { render: () => null },
      },
      {
        path: "/settings",
        name: "progression-settings",
        component: { render: () => null },
      },
    ],
  });
  app.use(router);
  await router.push("/");
  await router.isReady();
  return renderToString(app);
}
test("direct change uses the shared picker without an omission prerequisite or an authorization checkbox", async (t) => {
  const calls = [],
    replacementSource = {
      id,
      exerciseId: id,
      name: "Press original",
      hasResults: true,
    };
  const Component = await component("AddWorkoutExerciseForm");
  const state = mount(
    Component,
    {
      replacementSource,
      expectedVersion: 7,
      save: async (input) => calls.push(input),
    },
    t,
  );
  state.exerciseId = other;
  await state.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exerciseId, other);
  assert.equal(calls[0].expectedVersion, 7);
  assert.equal(calls[0].replacesWorkoutExerciseId, undefined);
  const html = await render(Component, {
    replacementSource,
    save: async () => {},
  });
  assert.match(html, /Cambiar Press original/);
  assert.match(html, /se conservan/i);
  assert.match(html, /Usar ejercicio seleccionado/);
  assert.doesNotMatch(html, /type="checkbox"/);
});
test("a partial original remains visible in the overview but the replacement becomes the current exercise", async (t) => {
  const source = {
    ...exercise,
    id,
    orderInSession: 1,
    isOmitted: false,
    sets: [
      {
        setNumber: 1,
        status: "COMPLETED",
        kind: "WORK",
        load: "45",
        loadUnit: "KG",
        repetitions: 10,
      },
    ],
  };
  const alternative = {
    ...exercise,
    id: other,
    orderInSession: 3,
    isOmitted: false,
    replacesWorkoutExerciseId: id,
    sets: [],
    exercise: { ...exercise.exercise, id: other, name: "Alternativa" },
  };
  const session = reactive({
    ...detail,
    status: "IN_PROGRESS",
    exercises: [
      source,
      {
        ...exercise,
        id: "30000000-0000-4000-8000-000000000001",
        orderInSession: 2,
        isOmitted: false,
        sets: [],
      },
      alternative,
    ],
  });
  const state = mount(
    await component("WorkoutLivePanel"),
    {
      session,
      busy: false,
      previousReferences: {},
      actions: { session: { value: session } },
    },
    t,
  );
  assert.deepEqual(
    state.usable.map((item) => item.id),
    [other, "30000000-0000-4000-8000-000000000001"],
  );
  assert.equal(state.active.id, other);
  assert.equal(source.sets[0].load, "45");
  const html = await render(await component("WorkoutLivePanel"), {
    session,
    busy: false,
    previousReferences: {},
    actions: { session: { value: session } },
  });
  assert.match(html, /Cambiar ejercicio/);
  assert.match(html, /45/);
  assert.match(html, /sustituid/i);
});
test("replacement form keeps a stable intention on an uncertain response and rejects selecting the same exercise", async (t) => {
  const ids = [];
  const state = mount(
    await component("AddWorkoutExerciseForm"),
    {
      replacementSource: {
        id,
        exerciseId: id,
        name: "Press",
        hasResults: false,
      },
      save: async (input) => {
        ids.push(input.id);
        throw new Error("network");
      },
    },
    t,
  );
  state.exerciseId = id;
  await state.submit();
  assert.equal(ids.length, 0);
  state.exerciseId = other;
  await state.submit();
  await state.submit();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});
