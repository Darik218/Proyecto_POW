import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRenderer, nextTick } from "vue";
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
const flush = async () => {
  await nextTick();
  await new Promise((r) => setImmediate(r));
  await nextTick();
};
const id = "10000000-0000-4000-8000-000000000001";
for (const name of [
  "workouts/NextWorkoutPanel",
  "workouts/WorkoutInsightsPanel",
  "progression/ProgressOverview",
])
  test(
    name +
      " clears private results on logout and does not restart unauthorized requests",
    async (t) => {
      const { useAuthStore } = await server.ssrLoadModule(
          "/src/stores/auth.store.ts",
        ),
        pinia = createPinia(),
        auth = useAuthStore(pinia);
      auth.user = { id };
      auth.accessToken = "only-memory";
      auth.status = "authenticated";
      const { workoutSessionsService } = await server.ssrLoadModule(
          "/src/services/workout-sessions.service.ts",
        ),
        { workoutInsightsService } = await server.ssrLoadModule(
          "/src/services/workout-insights.service.ts",
        );
      const original = [
          workoutSessionsService.list,
          workoutSessionsService.suggestions,
          workoutInsightsService.get,
        ],
        pending = [];
      workoutSessionsService.list = () =>
        new Promise((r) =>
          pending.push(() => r({ items: [{ id: "private-old" }], total: 1 })),
        );
      workoutSessionsService.suggestions = () =>
        new Promise((r) =>
          pending.push(() => r({ candidates: [{ name: "private-old" }] })),
        );
      workoutInsightsService.get = () =>
        new Promise((r) =>
          pending.push(() =>
            r({
              sessionId: id,
              status: "COMPLETED",
              exercises: [{ name: "private-old" }],
            }),
          ),
        );
      t.after(() => {
        [
          workoutSessionsService.list,
          workoutSessionsService.suggestions,
          workoutInsightsService.get,
        ] = original;
      });
      const { default: Component } = await server.ssrLoadModule(
        "/src/components/" + name + ".vue",
      );
      const app = renderer.createApp(
        { ...Component, render: () => null },
        { sessionId: id },
      );
      app.use(pinia);
      app.provide(Symbol.for("v-scx"), { modules: new Set() });
      const instance = app.mount({}),
        state = instance.$.setupState;
      t.after(() => app.unmount());
      await flush();
      const calls = pending.length;
      assert.ok(calls > 0);
      auth.clearSession();
      await flush();
      assert.equal(
        pending.length,
        calls,
        "logout must not send another authenticated read",
      );
      for (const done of pending) done();
      await flush();
      if (name.endsWith("NextWorkoutPanel")) {
        assert.equal(state.ongoing, null);
        assert.deepEqual(state.suggestions, []);
      } else if (name.endsWith("WorkoutInsightsPanel"))
        assert.equal(state.result, null);
      else assert.deepEqual(state.sessions, []);
    },
  );
test("insights contract preserves decimal strings and separates descriptive from official evidence", async () => {
  const { workoutInsightsSchema } = await server.ssrLoadModule(
    "/src/schemas/workout-insights.schema.ts",
  );
  const eligibility = {
    policyVersion: "v1",
    status: "ELIGIBLE_WITH_WARNINGS",
    mathematicallyUsable: true,
    descriptiveEligible: true,
    officialEvidence: "NOT_ASSESSED",
    reasons: [],
    warnings: ["EFFORT_UNVERIFIED"],
  };
  const data = {
    sessionId: id,
    status: "COMPLETED",
    exercises: [
      {
        workoutExerciseId: id,
        exerciseId: id,
        name: "Press",
        actualSets: [],
        reference: null,
        loadMeaning: "EXTERNAL_TOTAL",
        loadMeaningSource: "REQUEST_DECLARATION",
        orientation: {
          action: "REPEAT_REFERENCE",
          message: "Repite la referencia",
        },
        oneRm: [
          {
            setId: id,
            eligibility,
            calculation: {
              ok: true,
              policyVersion: "v1",
              load: {
                originalLoad: "60",
                originalUnit: "KG",
                loadKg: "60.000000",
              },
              repetitions: 8,
              estimates: [
                {
                  formula: "BRZYCKI",
                  estimatedOneRm: "74.482759",
                  unit: "KG",
                  warnings: [],
                },
              ],
              warnings: ["EFFORT_UNVERIFIED"],
            },
          },
        ],
      },
    ],
  };
  assert.equal(
    workoutInsightsSchema.parse(data).exercises[0].oneRm[0].calculation
      .estimates[0].estimatedOneRm,
    "74.482759",
  );
  const invalid = structuredClone(data);
  invalid.exercises[0].oneRm[0].calculation.estimates[0].estimatedOneRm = 74.482759;
  assert.equal(workoutInsightsSchema.safeParse(invalid).success, false);
  const official = structuredClone(data);
  official.exercises[0].oneRm[0].eligibility.officialEvidence = "APPROVED";
  assert.equal(workoutInsightsSchema.safeParse(official).success, false);
});

test("LIVE references use the explicit training date; undated legacy sessions never borrow later history", async (t) => {
  const { createRouter, createMemoryHistory } = await import("vue-router");
  const { detail, exercise } = await import("./workout-sessions.fixtures.mjs");
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  const { workoutSessionsService } = await server.ssrLoadModule(
    "/src/services/workout-sessions.service.ts",
  );
  const { workoutInsightsService } = await server.ssrLoadModule(
    "/src/services/workout-insights.service.ts",
  );
  const { default: Component } = await server.ssrLoadModule(
    "/src/views/WorkoutSessionDetailView.vue",
  );
  const oldGet = workoutSessionsService.get,
    oldReference = workoutInsightsService.reference;
  t.after(() => {
    workoutSessionsService.get = oldGet;
    workoutInsightsService.reference = oldReference;
  });
  for (const date of ["2026-11-01T00:00:00.000Z", null]) {
    const calls = [];
    workoutSessionsService.get = async () => ({
      ...detail,
      exercises: [exercise],
      status: "IN_PROGRESS",
      recordingMode: "LIVE",
      performedOn: date,
    });
    workoutInsightsService.reference = async (exerciseId, before) => {
      calls.push({ exerciseId, before });
      return { exerciseId, reference: null };
    };
    const pinia = createPinia(),
      auth = useAuthStore(pinia);
    auth.user = { id };
    auth.accessToken = "only-memory";
    auth.status = "authenticated";
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/app/workouts/:sessionId",
          name: "workout-session-detail",
          component: { render: () => null },
        },
      ],
    });
    await router.push("/app/workouts/" + id);
    await router.isReady();
    const app = renderer.createApp({ ...Component, render: () => null });
    app.use(pinia);
    app.use(router);
    app.provide(Symbol.for("v-scx"), { modules: new Set() });
    const instance = app.mount({});
    await flush();
    await flush();
    if (date) {
      assert.ok(calls.length);
      assert.equal(calls[0].before, "2026-11-01");
    } else {
      assert.equal(calls.length, 0);
      assert.match(instance.$.setupState.referenceError, /fecha/);
    }
    app.unmount();
  }
});
