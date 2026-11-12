import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
import { createRenderer, createSSRApp, nextTick } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import { createServer } from "vite";
import { api } from "../src/services/api.ts";
import {
  routineService,
  generateRoutineSchema,
  activityLabel,
} from "../src/services/routine.service.ts";
import { requestIntent } from "../src/composables/requestIntent.ts";
import { plan, week, day, response } from "./training-plans.fixtures.mjs";
let server;
before(async () => {
  server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
    plugins: [
      {
        name: "memory-router",
        enforce: "pre",
        transform(code, id) {
          if (id.endsWith("/src/router/index.ts"))
            return code.replaceAll("createWebHistory", "createMemoryHistory");
        },
      },
    ],
  });
});
after(async () => {
  await server?.close();
  api.defaults.adapter = undefined;
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
function mount(Component, props, t, router) {
  const app = renderer.createApp({ ...Component, render: () => null }, props);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.use(createPinia());
  if (router) app.use(router);
  const instance = app.mount({});
  t.after(() => app.unmount());
  return instance.$.setupState;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const id = "50000000-0000-4000-8000-000000000001";
const input = {
  id,
  name: "Rutina",
  durationWeeks: 8,
  frequency: 3,
  timeZone: "America/Bogota",
  days: [
    { name: "Push", weekday: 1 },
    { name: "Pull", weekday: null },
    { name: "Piernas", weekday: 5 },
  ],
};
test("validates fixed, flexible and mixed plan creation without assuming a start date", () => {
  assert.equal(generateRoutineSchema.parse(input).startsOn, undefined);
  assert.equal(
    generateRoutineSchema.safeParse({ ...input, frequency: 2 }).success,
    false,
  );
  assert.equal(
    generateRoutineSchema.safeParse({ ...input, athleteId: id }).success,
    false,
  );
  assert.equal(
    generateRoutineSchema.safeParse({ ...input, durationWeeks: 0 }).success,
    false,
  );
});
test("routine service uses shared HTTP, validates contracts and keeps calendar distinct from workouts", async () => {
  const requests = [];
  api.defaults.adapter = async (config) => {
    requests.push(config);
    return response(config, config.url === "/routine/plans" ? { id } : []);
  };
  assert.deepEqual(await routineService.generate(input), { id });
  assert.equal(requests[0].url, "/routine/plans");
  assert.equal("athleteId" in JSON.parse(requests[0].data), false);
  assert.deepEqual(
    await routineService.activities({
      weekId: week.id,
      from: "2027-01-01",
      to: "2027-01-07",
      timeZone: "UTC",
    }),
    [],
  );
  api.defaults.adapter = async (config) => response(config, {});
  await assert.rejects(
    routineService.activities({
      from: "2027-01-01",
      to: "2027-01-07",
      timeZone: "UTC",
    }),
  );
});
test("calendar labels do not infer a skipped or completed training without execution evidence", () => {
  const activity = { status: "PLANNED", workouts: [] };
  assert.equal(activityLabel(activity), "Programado · sin registro");
  assert.equal(
    activityLabel({ ...activity, status: "REST" }),
    "Descanso voluntario",
  );
  assert.equal(
    activityLabel({ ...activity, status: "OMITTED" }),
    "Omitido voluntariamente",
  );
  assert.equal(
    activityLabel({ ...activity, workouts: [{ status: "COMPLETED" }] }),
    "Completado",
  );
});
test("uncertain planning retries retain operation identity even when version is reloaded", () => {
  const intent = requestIntent();
  const first = intent.id({ dayId: day.id, expectedVersion: 1 });
  assert.equal(intent.id({ expectedVersion: 2, dayId: day.id }), first);
  assert.notEqual(intent.id({ dayId: plan.id }), first);
  intent.confirmed({ dayId: day.id });
  assert.notEqual(intent.id({ dayId: day.id }), first);
});
test("plan wizard validates, settles errors, reuses creation IDs and prevents duplicate submissions", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/GeneratePlanForm.vue",
    )
  ).default;
  const { api: client } = await server.ssrLoadModule("/src/services/api.ts");
  const calls = [];
  let finish;
  client.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data));
    if (calls.length === 1) throw new Error("Uncertain network");
    return new Promise((resolve) => {
      finish = () => resolve(response(config, { id: calls[0].id }));
    });
  };
  t.after(() => {
    client.defaults.adapter = undefined;
  });
  const state = mount(Component, {}, t);
  await state.save();
  assert.match(state.error, /nombre/);
  assert.equal(calls.length, 0);
  state.form.name = "Mi plan";
  state.form.blocks[0].exercises.push({
    exerciseId: id,
    name: "Elegido",
    targetSets: "3",
    targetRepsMin: "8",
    targetRepsMax: "12",
    targetLoad: "",
    targetLoadUnit: "",
  });
  await state.save();
  assert.equal(state.busy, false);
  assert.notEqual(state.error, "");
  const retry = state.save();
  await tick();
  await state.save();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, calls[1].id);
  finish();
  await retry;
  assert.equal(state.busy, false);
  assert.equal(calls[0].days[0].exercises[0].targetLoad, null);
  assert.equal(calls[0].days[0].exercises[0].targetLoadUnit, null);
  assert.equal(calls[0].durationWeeks, 4);
});
test("hub displays a single selected week and keeps execution and advanced operations contextual", async () => {
  const { router } = await server.ssrLoadModule("/src/router/index.ts");
  for (const path of [
    "/app",
    "/app/history",
    `/app/routine/${plan.id}/weeks/${week.id}/days/${day.id}`,
  ])
    assert.equal(router.resolve(path).meta.requiresAuth, true);
  const Component = (await server.ssrLoadModule("/src/views/RoutineView.vue"))
    .default;
  const memory = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/app", name: "home", component: Component },
      {
        path: "/app/workouts",
        name: "workout-sessions",
        component: { render: () => null },
      },
      {
        path: "/app/training-plans",
        name: "training-plans",
        component: { render: () => null },
      },
    ],
  });
  await memory.push("/app");
  const app = createSSRApp(Component);
  app.use(createPinia());
  app.use(memory);
  const html = await renderToString(app);
  assert.match(html, /Mi rutina/);
  assert.match(html, /Entrenar sin plan/);
  assert.match(html, /Cargando tu rutina/);
  assert.doesNotMatch(html, /Progreso|Estadísticas/);
});
test("shared picker selects a newly created private exercise without leaving the prescription", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/ExercisePicker.vue",
    )
  ).default;
  const { api: client } = await server.ssrLoadModule("/src/services/api.ts");
  client.defaults.adapter = async (config) =>
    response(
      config,
      config.url.endsWith("muscle-groups")
        ? []
        : { items: [], limit: 20, offset: 0, total: 0 },
    );
  t.after(() => {
    client.defaults.adapter = undefined;
  });
  const state = mount(Component, { modelValue: "" }, t);
  await tick();
  await state.created({ id, name: "Privado" });
  assert.equal(state.selectedName, "Privado");
  assert.equal(state.selectedScope, "mine");
  assert.equal(state.creating, false);
  assert.equal(state.errorMessage, "");
});

test("day starts only its own prescriptions, retains an uncertain intent and prevents duplicate starts", async (t) => {
  const Component = (
    await server.ssrLoadModule("/src/views/RoutineDayView.vue")
  ).default;
  const { api: client } = await server.ssrLoadModule("/src/services/api.ts");
  const { detail: workout } = await import("./workout-sessions.fixtures.mjs");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/day/:planId/:weekId/:dayId",
        name: "routine-day",
        component: Component,
      },
      {
        path: "/session/:sessionId",
        name: "workout-session-detail",
        component: { render: () => null },
      },
    ],
  });
  await router.push(`/day/${plan.id}/${week.id}/${day.id}`);
  const calls = [];
  let created, finish;
  client.defaults.adapter = async (config) => {
    if (config.url.endsWith("/planning"))
      return response(config, {
        ...plan,
        version: 0,
        weeks: [{ ...week, days: [day], pendingExercises: [] }],
      });
    if (config.url === "/routine/activities") return response(config, []);
    if (config.url === "/workout-sessions" && config.method === "get")
      return response(config, { items: [], total: 0, limit: 20, offset: 0 });
    if (config.url === "/workout-sessions" && config.method === "post") {
      const input = JSON.parse(config.data);
      calls.push(input);
      created = {
        ...workout,
        id: input.id,
        status: "PLANNED",
        version: 0,
        startedAt: null,
      };
      if (calls.length === 1) throw new Error("Uncertain network");
      return new Promise((resolve) => {
        finish = () => resolve(response(config, created));
      });
    }
    if (config.url.endsWith("/start"))
      return response(config, {
        ...created,
        status: "IN_PROGRESS",
        version: 1,
        startedAt: "2026-11-07T12:00:00.000Z",
      });
    return response(config, created);
  };
  t.after(() => {
    client.defaults.adapter = undefined;
  });
  const state = mount(Component, {}, t, router);
  await tick();
  await nextTick();
  await state.begin();
  assert.equal(state.busy, false);
  assert.notEqual(state.failure, "");
  const retry = state.begin();
  await tick();
  await state.begin();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, calls[1].id);
  assert.equal(calls[0].planDayId, day.id);
  assert.equal(calls[0].planWeekId, week.id);
  finish();
  await retry;
  assert.equal(router.currentRoute.value.name, "workout-session-detail");
  assert.equal(router.currentRoute.value.params.sessionId, created.id);
});

test("an undated plan can be renamed without inventing a start date", async (t) => {
  const Component = (
    await server.ssrLoadModule("/src/components/training-plans/PlanForm.vue")
  ).default;
  let saved;
  const state = mount(
    Component,
    {
      initial: { ...plan, startsOn: null },
      save: async (input) => {
        saved = input;
      },
    },
    t,
  );
  state.form.name = "Plan flexible actualizado";
  await state.submit();
  assert.equal(state.error, "");
  assert.equal(saved.name, "Plan flexible actualizado");
  assert.equal("startsOn" in saved, false);
});

test("routine wizard discards an old session draft and ignores its late creation response", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/GeneratePlanForm.vue",
    )
  ).default;
  const { api: client } = await server.ssrLoadModule("/src/services/api.ts");
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  let finish;
  const created = [];
  client.defaults.adapter = async (config) =>
    new Promise((resolve) => {
      finish = () => resolve(response(config, { id }));
    });
  t.after(() => {
    client.defaults.adapter = undefined;
  });
  const state = mount(
    Component,
    { onCreated: (value) => created.push(value) },
    t,
  );
  state.form.name = "Privado";
  state.form.blocks[0].exercises.push({
    exerciseId: id,
    name: "Elegido",
    targetSets: "3",
    targetRepsMin: "8",
    targetRepsMax: "8",
    targetLoad: "20.125",
    targetLoadUnit: "LB",
  });
  const pending = state.save();
  await tick();
  useAuthStore().clearSession();
  await nextTick();
  assert.equal(state.form.name, "");
  assert.equal(state.form.blocks[0].exercises.length, 0);
  finish();
  await pending;
  assert.deepEqual(created, []);
  assert.equal(state.busy, false);
});

test("routine block selects a newly created private exercise inline and cancellation preserves its draft", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/training-plans/RoutineBuilder.vue",
    )
  ).default;
  const { api: client } = await server.ssrLoadModule("/src/services/api.ts");
  const calls = [];
  client.defaults.adapter = async (config) => {
    calls.push(config.url);
    return response(
      config,
      config.url.endsWith("muscle-groups")
        ? []
        : { items: [], total: 0, limit: 20, offset: 0 },
    );
  };
  t.after(() => {
    client.defaults.adapter = undefined;
  });
  const original = {
    exerciseId: plan.id,
    name: "Existente",
    targetSets: "4",
    targetRepsMin: "6",
    targetRepsMax: "8",
    targetLoad: "42.125",
    targetLoadUnit: "KG",
  };
  const blocks = [
    { id: week.id, name: "PUSH", exercises: [original] },
    { id: plan.id, name: "PULL", exercises: [] },
  ];
  const state = mount(Component, { blocks }, t);
  await tick();
  state.creating = true;
  state.cancelPrivateExercise();
  assert.equal(state.creating, false);
  assert.deepEqual(blocks[0].exercises, [original]);
  state.creating = true;
  await state.created({ id, name: "Ejercicio privado nuevo" });
  assert.equal(state.creating, false);
  assert.equal(blocks[0].exercises.length, 2);
  assert.equal(blocks[0].exercises[1].exerciseId, id);
  assert.equal(blocks[0].exercises[1].targetLoad, "");
  assert.equal(blocks[0].exercises[1].targetSets, "");
  assert.deepEqual(blocks[0].exercises[0], original);
  assert.deepEqual(blocks[1].exercises, []);
  await state.created({ id, name: "Ejercicio privado nuevo" });
  assert.equal(blocks[0].exercises.length, 2);
  assert.ok(calls.filter((url) => url === "/exercises/visible").length >= 2);
});
