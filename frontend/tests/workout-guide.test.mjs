import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createRenderer, nextTick } from "vue";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import {
  workoutGuideSchema,
  workoutGuideQuerySchema,
} from "../src/schemas/workout-guide.schema.ts";
import { summary, response } from "./workout-sessions.fixtures.mjs";
const id = "10000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000001";
const target = {
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetLoad: "42.125",
  targetLoadUnit: "LB",
  targetRpe: null,
};
const sample = (date = "2026-11-15") => ({
  schemaVersion: "workout-guide-v1",
  historyCutoffOn: date,
  executionAuthorized: false,
  status: "TRAINABLE",
  source: {
    kind: "ACTIVITY",
    id,
    activityId: id,
    planDayId: id,
    sessionId: null,
    trainingPlanId: id,
    planWeekId: id,
    performedOn: date,
    timeZone: "UTC",
    status: "PLANNED",
    title: "Mi entrenamiento",
  },
  exercises: [
    {
      id,
      exerciseId: id,
      name: "Press",
      position: 1,
      isOmitted: false,
      target,
      originalTarget: null,
      lastReference: null,
      guidance: {
        state: "FIRST_BASELINE",
        reasons: [],
        message: "Primera referencia",
      },
      proposal: null,
    },
  ],
});
test("guide contract keeps exact units/decimal, null effort and nonoperative authorization", () => {
  const guide = workoutGuideSchema.parse(sample());
  assert.equal(guide.exercises[0].target.targetLoad, "42.125");
  assert.equal(guide.exercises[0].target.targetRpe, null);
  assert.equal(
    workoutGuideSchema.safeParse({ ...sample(), executionAuthorized: true })
      .success,
    false,
  );
  assert.equal(
    workoutGuideQuerySchema.safeParse({ activityId: id, sessionId: id })
      .success,
    false,
  );
  assert.equal(
    workoutGuideQuerySchema.safeParse({ planDayId: id }).success,
    false,
  );
  assert.equal(
    workoutGuideQuerySchema.safeParse({
      planDayId: id,
      performedOn: "2026-11-15",
      timeZone: "UTC",
    }).success,
    true,
  );
});
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
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function setup(t, name, adapter) {
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  api.defaults.adapter = adapter;
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  const { useAuthStore } = await server.ssrLoadModule(
      "/src/stores/auth.store.ts",
    ),
    pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id, email: "private@example.test" };
  auth.accessToken = "in-memory-test";
  auth.status = "authenticated";
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: { render: () => null } },
      {
        path: "/workout/:sessionId",
        name: "workout-session-detail",
        component: { render: () => null },
      },
    ],
  });
  await router.push("/");
  await router.isReady();
  const Component = (
    await server.ssrLoadModule(`/src/components/workouts/${name}.vue`)
  ).default;
  const app = renderer.createApp(
    { ...Component, render: () => null },
    name === "DailyWorkoutGuide" ? { query: { activityId: id } } : {},
  );
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.use(pinia);
  app.use(router);
  const instance = app.mount({});
  t.after(() => app.unmount());
  await tick();
  await nextTick();
  return { state: instance.$.setupState, auth, router };
}
test("calendar selection is stable and double start uses one activity-bound intention", async (t) => {
  let writes = 0,
    finish;
  const starts = [];
  const { state } = await setup(t, "WeeklyTrainingCalendar", async (config) => {
    if (config.method === "post" && config.url === "/workout-sessions") {
      writes++;
      starts.push(JSON.parse(config.data));
      await new Promise((resolve) => {
        finish = resolve;
      });
      return response(config, {
        ...summary,
        id,
        status: "IN_PROGRESS",
        exercises: [],
      });
    }
    if (config.url === `/workout-sessions/${id}`)
      return response(config, {
        ...summary,
        id,
        status: "IN_PROGRESS",
        exercises: [],
      });
    if (config.url === "/routine/activities") return response(config, []);
    return response(config, { items: [], total: 0, offset: 0, limit: 100 });
  });
  const date = state.today,
    activity = {
      id,
      planWeekId: id,
      planDayId: id,
      originalPlanDayId: null,
      originalOn: date + "T00:00:00Z",
      scheduledOn: date + "T00:00:00Z",
      timeZone: "UTC",
      title: "Entrenamiento",
      status: "PLANNED",
      version: 0,
      workouts: [],
    };
  state.activities = [activity];
  state.select(date);
  state.loaded(sample(date));
  assert.equal(state.canBegin, true);
  state.select(date);
  assert.equal(state.canBegin, true, "same date must retain the loaded guide");
  state.choose(id);
  assert.equal(state.canBegin, true, "same activity must retain the guide");
  const first = state.begin();
  await tick();
  await state.begin();
  assert.equal(writes, 1);
  assert.equal(starts[0].scheduledActivityId, id);
  assert.equal(starts[0].planDayId, id);
  assert.equal(starts[0].timeZone, "UTC");
  assert.equal(starts[0].performedOn, date);
  state.select("2020-01-01");
  assert.equal(state.selected, date, "busy selection is blocked");
  finish();
  await first;
  assert.equal(state.busy, false);
});
test("old create response cannot start or navigate after the authentication boundary", async (t) => {
  let finish,
    writes = 0;
  const { state, auth, router } = await setup(
    t,
    "WeeklyTrainingCalendar",
    async (config) => {
      if (config.method === "post") {
        writes++;
        await new Promise((resolve) => {
          finish = resolve;
        });
        return response(config, {
          ...summary,
          id,
          status: "PLANNED",
          exercises: [],
        });
      }
      if (config.url === "/routine/activities") return response(config, []);
      return response(config, { items: [], total: 0, offset: 0, limit: 100 });
    },
  );
  const date = state.today;
  state.activities = [
    {
      id,
      scheduledOn: date + "T00:00:00Z",
      timeZone: "UTC",
      status: "PLANNED",
      version: 0,
      workouts: [],
      title: "Entrenamiento",
    },
  ];
  state.select(date);
  state.loaded(sample(date));
  const pending = state.begin();
  await tick();
  auth.clearSession();
  auth.user = { id: other };
  auth.accessToken = "other";
  auth.status = "authenticated";
  finish();
  await pending;
  assert.equal(writes, 1);
  assert.equal(router.currentRoute.value.name, "dashboard");
  assert.equal(state.guide, null);
});
test("guide clears private history when the user logs out, including a late read", async (t) => {
  let finish;
  const { state, auth } = await setup(
    t,
    "DailyWorkoutGuide",
    async (config) => {
      await new Promise((resolve) => {
        finish = resolve;
      });
      return response(config, sample());
    },
  );
  auth.clearSession();
  finish();
  await tick();
  await tick();
  assert.equal(state.guide, null);
  assert.equal(state.loading, false);
});

test("optional rest timer starts only with a user duration and can stop without writing", async (t) => {
  let writes = 0;
  const { state } = await setup(t, "RestTimer", async () => {
    writes++;
    throw Error("Unexpected HTTP");
  });
  state.start();
  assert.equal(state.running, false);
  state.seconds = "1";
  state.start();
  assert.equal(state.running, true);
  state.stop();
  assert.equal(state.running, false);
  assert.equal(writes, 0);
});

test("guide can display ambiguous legacy results without changing signs, units or status", () => {
  const value = sample();
  value.exercises[0].lastReference = {
    performedOn: "2026-01-01",
    gapDays: 1,
    sessions: [
      {
        sessionId: id,
        taskId: id,
        performedOn: "2026-01-01",
        timeZone: null,
        sets: [
          {
            setNumber: 1,
            load: "-1.000",
            loadUnit: null,
            repetitions: 0,
            rpe: null,
            status: null,
            kind: null,
            isCompleted: false,
          },
        ],
      },
    ],
  };
  const parsed = workoutGuideSchema.parse(value);
  assert.equal(
    parsed.exercises[0].lastReference.sessions[0].sets[0].load,
    "-1.000",
  );
  assert.equal(
    parsed.exercises[0].lastReference.sessions[0].sets[0].status,
    null,
  );
});
