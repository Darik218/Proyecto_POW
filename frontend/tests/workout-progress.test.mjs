import assert from "node:assert/strict";
import { before, after, test } from "node:test";
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
const progressFixture = {
  period: "30",
  timeZone: "America/Bogota",
  from: "2026-10-19",
  to: "2026-11-17",
  selectedExerciseId: "10000000-0000-4000-8000-000000000001",
  exercises: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Press",
      resistanceType: "WEIGHT_STACK",
      oneRmSuitability: "NOT_SUITABLE",
    },
  ],
  completedSessions: 2,
  frequency: [
    { week: "2026-11-09", sessions: 1 },
    { week: "2026-11-16", sessions: 1 },
  ],
  series: [
    {
      kind: "RECORDED_LOAD_REPETITIONS",
      load: "60",
      unit: "KG",
      points: [
        {
          sessionId: "10000000-0000-4000-8000-000000000001",
          setId: "10000000-0000-4000-8000-000000000002",
          performedOn: "2026-11-10",
          setNumber: 1,
          repetitions: 8,
        },
        {
          sessionId: "10000000-0000-4000-8000-000000000003",
          setId: "10000000-0000-4000-8000-000000000004",
          performedOn: "2026-11-17",
          setNumber: 1,
          repetitions: 10,
        },
      ],
      bestRepetitions: 10,
      comparison: { state: "COMPARED", repetitionsDelta: 2 },
    },
  ],
  estimates: [],
  volume: {
    status: "UNAVAILABLE",
    message: "No sumamos volumen sin interpretación.",
  },
  duration: { status: "UNSUPPORTED", message: "No se registra duración." },
  metadata: {
    dateBasis: "PERFORMED_ON",
    weekStartsOn: "MONDAY",
    undatedSessions: 0,
    truncated: {
      sessions: false,
      exercises: false,
      tasks: false,
      sets: false,
      estimates: false,
    },
    limits: {
      sessions: 500,
      exercises: 200,
      tasks: 100,
      sets: 1000,
      estimates: 2000,
    },
    observedFrom: "2026-11-10",
    observedTo: "2026-11-17",
  },
};
test("progress exposes an explicit plan-day scope without mixing it into the general series", async () => {
  const { workoutProgressSchema } = await server.ssrLoadModule(
    "/src/schemas/workout-progress.schema.ts",
  );
  const scoped = workoutProgressSchema.parse({
    ...progressFixture,
    selectedPlanDayId: progressFixture.selectedExerciseId,
    planDays: [
      {
        id: progressFixture.selectedExerciseId,
        name: "Legs A",
        planName: "Mi PPL",
      },
    ],
  });
  assert.equal(scoped.selectedPlanDayId, progressFixture.selectedExerciseId);
  assert.equal(scoped.planDays[0].name, "Legs A");
});
test("progress preserves actual decimal load and accepts bodyweight repetitions without inventing duration", async () => {
  const { workoutProgressSchema } = await server.ssrLoadModule(
    "/src/schemas/workout-progress.schema.ts",
  );
  assert.equal(
    workoutProgressSchema.parse(progressFixture).series[0].load,
    "60",
  );
  const body = structuredClone(progressFixture);
  body.series[0].kind = "BODYWEIGHT_REPETITIONS";
  body.series[0].load = null;
  body.series[0].unit = null;
  assert.equal(workoutProgressSchema.parse(body).series[0].unit, null);
  const legacy = structuredClone(progressFixture);
  legacy.exercises[0].oneRmSuitability = "UNDETERMINED";
  legacy.exercises[0].resistanceType = null;
  assert.equal(workoutProgressSchema.safeParse(legacy).success, true);
  const invalid = structuredClone(progressFixture);
  invalid.series[0].load = 60;
  assert.equal(workoutProgressSchema.safeParse(invalid).success, false);
});
test("progress retains the owned plan and a real next calendar occurrence separately from past results", async () => {
  const { workoutProgressSchema } = await server.ssrLoadModule(
    "/src/schemas/workout-progress.schema.ts",
  );
  const id = progressFixture.selectedExerciseId;
  const parsed = workoutProgressSchema.parse({
    ...progressFixture,
    selectedPlanId: id,
    plans: [{ id, name: "PPL", status: "ACTIVE" }],
    nextSession: {
      activityId: id,
      planId: id,
      planWeekId: id,
      planDayId: id,
      performedOn: "2026-11-25",
      timeZone: "America/Bogota",
      title: "Legs A",
    },
  });
  assert.equal(parsed.selectedPlanId, id);
  assert.equal(parsed.nextSession.performedOn, "2026-11-25");
  assert.equal(parsed.completedSessions, 2);
});
test("chart renders only persisted observations with meaningful text and an accessible table", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("@vue/server-renderer");
  const { default: Chart } = await server.ssrLoadModule(
    "/src/components/progression/ProgressChart.vue",
  );
  const html = await renderToString(
    createSSRApp(Chart, {
      title: "Repeticiones registradas",
      unit: "repeticiones",
      testId: "progress-repetitions-chart",
      points: [
        { id: "set1", date: "2026-11-10", value: 8 },
        { id: "set2", date: "2026-11-17", value: 10 },
      ],
    }),
  );
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /No hay registros para esta gráfica/);
  assert.match(html, /<caption[^>]*>Repeticiones registradas<\/caption>/);
  assert.match(html, /2026-11-10/);
  assert.match(html, />8</);
  assert.equal((html.match(/<circle/g) || []).length, 2);
});

test("changing the period rejects late private results from the previous request", async (t) => {
  const { createRenderer, nextTick } = await import("vue");
  const { createPinia } = await import("pinia");
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  const { workoutProgressService } = await server.ssrLoadModule(
    "/src/services/workout-progress.service.ts",
  );
  const { default: Component } = await server.ssrLoadModule(
    "/src/components/progression/ProgressOverview.vue",
  );
  const pending = [],
    original = workoutProgressService.get;
  workoutProgressService.get = (period, exerciseId, signal) =>
    new Promise((resolve) => pending.push({ period, signal, resolve }));
  t.after(() => {
    workoutProgressService.get = original;
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
  const pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id: progressFixture.selectedExerciseId };
  auth.accessToken = "only-memory";
  auth.status = "authenticated";
  const app = renderer.createApp({ ...Component, render: () => null });
  app.use(pinia);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const instance = app.mount({}),
    state = instance.$.setupState;
  t.after(() => app.unmount());
  await nextTick();
  assert.equal(pending[0].period, "30");
  state.changePeriod("7");
  await nextTick();
  assert.equal(pending[1].period, "7");
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ ...progressFixture, period: "7" });
  await new Promise((r) => setImmediate(r));
  await nextTick();
  assert.equal(state.result.period, "7");
  pending[0].resolve(progressFixture);
  await new Promise((r) => setImmediate(r));
  await nextTick();
  assert.equal(state.result.period, "7");
  assert.equal(state.busy, false);
});

test("chart leaves same-day observations unconnected because their intraday order is unknown", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("@vue/server-renderer");
  const { default: Chart } = await server.ssrLoadModule(
    "/src/components/progression/ProgressChart.vue",
  );
  const html = await renderToString(
    createSSRApp(Chart, {
      title: "Repeticiones registradas",
      unit: "repeticiones",
      testId: "progress-repetitions-chart",
      points: [
        { id: "set1", date: "2026-11-10", value: 8 },
        { id: "set2", date: "2026-11-10", value: 10 },
      ],
    }),
  );
  assert.equal((html.match(/<circle/g) || []).length, 2);
  assert.doesNotMatch(html, /<polyline/);
  assert.match(html, /sin ordenar dentro del día/);
});

test("chart shows an empty message without an SVG only when no observations exist", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("@vue/server-renderer");
  const { default: Chart } = await server.ssrLoadModule(
    "/src/components/progression/ProgressChart.vue",
  );
  const html = await renderToString(
    createSSRApp(Chart, {
      title: "Repeticiones registradas",
      unit: "repeticiones",
      testId: "progress-repetitions-chart",
      points: [],
    }),
  );
  assert.match(html, /No hay registros para esta gráfica/);
  assert.doesNotMatch(html, /<svg|<circle|sin ordenar dentro del día/);
});

test("estimate charts keep calculation, eligibility and numeric-policy versions in separate trajectories", async (t) => {
  const { createRenderer, nextTick } = await import("vue");
  const { createPinia } = await import("pinia");
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  const { workoutProgressService } = await server.ssrLoadModule(
    "/src/services/workout-progress.service.ts",
  );
  const { default: Component } = await server.ssrLoadModule(
    "/src/components/progression/ProgressOverview.vue",
  );
  const { workoutProgressSchema } = await server.ssrLoadModule(
    "/src/schemas/workout-progress.schema.ts",
  );
  const first = {
    id: "10000000-0000-4000-8000-000000000011",
    sessionId: progressFixture.selectedExerciseId,
    setId: progressFixture.selectedExerciseId,
    performedOn: "2026-11-10",
    formula: "EPLEY",
    value: "76.000000",
    unit: "KG",
    algorithmVersion: "calculation-v1",
    eligibilityVersion: "eligibility-v1",
    numericPolicyKey: "a".repeat(64),
    warnings: [],
  };
  const estimates = [
    first,
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000012",
      performedOn: "2026-11-11",
      algorithmVersion: "calculation-v2",
    },
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000013",
      performedOn: "2026-11-12",
      eligibilityVersion: "eligibility-v2",
    },
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000014",
      performedOn: "2026-11-13",
      numericPolicyKey: "b".repeat(64),
    },
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000015",
      performedOn: "2026-11-14",
    },
  ];
  const original = workoutProgressService.get;
  workoutProgressService.get = async () => ({ ...progressFixture, estimates });
  t.after(() => {
    workoutProgressService.get = original;
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
  const pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id: progressFixture.selectedExerciseId };
  auth.accessToken = "only-memory";
  auth.status = "authenticated";
  const app = renderer.createApp({ ...Component, render: () => null });
  app.use(pinia);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const instance = app.mount({}),
    state = instance.$.setupState;
  t.after(() => app.unmount());
  await new Promise((r) => setImmediate(r));
  await nextTick();
  assert.equal(state.estimateGroups.length, 4);
  assert.deepEqual(
    state.estimateGroups
      .map((group) => group.points.map((point) => point.id))
      .sort((a, b) => a[0].localeCompare(b[0])),
    [
      [first.id, estimates[4].id],
      [estimates[1].id],
      [estimates[2].id],
      [estimates[3].id],
    ],
  );
  const parsed = workoutProgressSchema.parse({ ...progressFixture, estimates });
  assert.equal(parsed.estimates[1].algorithmVersion, "calculation-v2");
  assert.equal(parsed.estimates[2].eligibilityVersion, "eligibility-v2");
  assert.equal(parsed.estimates[3].numericPolicyKey, "b".repeat(64));
  const incomplete = structuredClone(first);
  delete incomplete.numericPolicyKey;
  assert.equal(
    workoutProgressSchema.safeParse({
      ...progressFixture,
      estimates: [incomplete],
    }).success,
    false,
  );
});
