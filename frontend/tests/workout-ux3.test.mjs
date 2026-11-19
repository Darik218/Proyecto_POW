import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createRenderer, reactive, nextTick } from "vue";
import { createPinia } from "pinia";
import { response } from "./workout-sessions.fixtures.mjs";
import {
  workoutRepetitionPreviewInputSchema,
  workoutGuidePreviewInputSchema,
  workoutGuideSchema,
} from "../src/schemas/workout-guide.schema.ts";
const id = "10000000-0000-4000-8000-000000000001";
const context = {
  contextKey: "a".repeat(64),
  ready: true,
  reasons: [],
  minimumSessions: 1,
  minimumSource: "PLAN_BOUND_INITIAL_POLICY",
  tasks: [{ id, sessionId: id, performedOn: "2026-11-15", timeZone: "UTC" }],
  policyContract: "session-repetition-preview-v1",
  executionAuthorized: false,
};
const input = {
  source: { sessionId: id },
  exerciseId: id,
  contextKey: context.contextKey,
  declaration: {
    sameVariant: true,
    sameEquipment: true,
    sameLoadConvention: true,
  },
  policyContract: context.policyContract,
};
const guide = () => ({
  schemaVersion: "workout-guide-v1",
  status: "TRAINABLE",
  historyCutoffOn: "2026-11-16",
  executionAuthorized: false,
  source: {
    kind: "SESSION",
    id,
    activityId: null,
    planDayId: id,
    sessionId: id,
    trainingPlanId: id,
    planWeekId: id,
    performedOn: "2026-11-16",
    timeZone: "UTC",
    status: "IN_PROGRESS",
    title: "Push",
  },
  exercises: [
    {
      id,
      exerciseId: id,
      name: "Press",
      position: 1,
      isOmitted: false,
      target: {
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetLoad: "40",
        targetLoadUnit: "KG",
        targetRpe: null,
      },
      originalTarget: null,
      lastReference: null,
      proposal: null,
      guidance: {
        state: "REFERENCE_AVAILABLE",
        reasons: [],
        message: "Registro anterior",
      },
      repetitionContext: context,
      guidanceSuggested: {
        origin: "CALCULATED",
        action: "MAINTAIN",
        load: "40",
        unit: "KG",
        reps: 9,
        sets: 3,
        reason:
          "Objetivos cumplidos; prueba una repetición más dentro del rango del plan.",
        reasons: ["REPETITION_TARGET_ADVANCE"],
        policyVersion: context.policyContract,
        executionAuthorized: false,
      },
    },
  ],
});
test("repetition preview needs explicit context but no RPE, grid or advanced setting", () => {
  assert.deepEqual(workoutRepetitionPreviewInputSchema.parse(input), input);
  for (const invalid of [
    {
      ...input,
      declaration: { ...input.declaration, sameLoadConvention: false },
    },
    { ...input, declaration: { sameVariant: true } },
    { ...input, declaration: { sameVariant: true, sameEquipment: false } },
    { ...input, gridStep: "2.5" },
    { ...input, policyContract: "session-readiness-preview-v1" },
  ])
    assert.equal(
      workoutRepetitionPreviewInputSchema.safeParse(invalid).success,
      false,
    );
  const result = workoutGuideSchema.parse(guide());
  assert.equal(
    result.exercises[0].repetitionContext.minimumSource,
    "PLAN_BOUND_INITIAL_POLICY",
  );
  assert.equal(result.exercises[0].guidanceSuggested.reps, 9);
  assert.equal(result.executionAuthorized, false);
});
test("load compliance is a separate explicit method that still requires real increments and physical grid", () => {
  const loadInput = {
    ...input,
    declaration: {
      sameVariant: true,
      sameEquipment: true,
      externalTotal: true,
    },
    gridStep: "2.5",
    incrementMode: "ABSOLUTE",
    policyContract: "session-load-compliance-preview-v1",
  };
  assert.equal(
    workoutGuidePreviewInputSchema.safeParse(loadInput).success,
    true,
  );
  assert.equal(
    workoutGuidePreviewInputSchema.safeParse({
      ...loadInput,
      policyContract: "session-readiness-preview-v1",
    }).success,
    true,
  );
  const { gridStep, ...unknownGrid } = loadInput;
  assert.equal(
    workoutGuidePreviewInputSchema.safeParse(unknownGrid).success,
    false,
  );
  assert.equal(
    workoutRepetitionPreviewInputSchema.safeParse(loadInput).success,
    false,
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
const tick = () => new Promise((accept) => setImmediate(accept));
async function mount(t, adapter) {
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  api.defaults.adapter = adapter;
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  const pinia = createPinia();
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  const auth = useAuthStore(pinia);
  auth.user = { id, email: "private@example.test" };
  auth.accessToken = "in-memory-test";
  auth.status = "authenticated";
  const Component = (
    await server.ssrLoadModule(
      "/src/components/workouts/WorkoutRepetitionGuide.vue",
    )
  ).default;
  const props = reactive({
    query: { sessionId: id },
    exerciseId: id,
    context: { ...context },
  });
  const events = [];
  const app = renderer.createApp(
    { ...Component, render: () => null },
    { ...props, onCalculated: (value) => events.push(value) },
  );
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.use(pinia);
  const instance = app.mount({});
  t.after(() => app.unmount());
  await tick();
  return { state: instance.$.setupState, events, auth, props };
}
test("preview is voluntary, single flight and sends only same-task declarations", async (t) => {
  let finish;
  const calls = [];
  const { state, events } = await mount(t, async (config) => {
    calls.push(config);
    await new Promise((accept) => {
      finish = accept;
    });
    return response(config, guide());
  });
  assert.equal(calls.length, 0, "mount must not submit a declaration");
  const pending = state.calculate();
  await tick();
  await state.calculate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/progression/workout-guide/repetition-preview");
  assert.deepEqual(JSON.parse(calls[0].data), input);
  finish();
  await pending;
  assert.equal(events.length, 1);
  assert.equal(events[0].exercises[0].guidanceSuggested.reps, 9);
});
test("a late calculation is discarded after account or session changes", async (t) => {
  let finish;
  const { state, events, auth } = await mount(t, async (config) => {
    await new Promise((accept) => {
      finish = accept;
    });
    return response(config, guide());
  });
  const pending = state.calculate();
  await tick();
  auth.clearSession();
  await nextTick();
  finish();
  await pending;
  assert.equal(events.length, 0);
});
test("a changed comparison context invalidates an in-flight result", async (t) => {
  let finish;
  const { state, events, props } = await mount(t, async (config) => {
    await new Promise((accept) => {
      finish = accept;
    });
    return response(config, guide());
  });
  const pending = state.calculate();
  await tick();
  props.context.contextKey = "b".repeat(64);
  await nextTick();
  finish();
  await pending;
  assert.equal(events.length, 0);
});
