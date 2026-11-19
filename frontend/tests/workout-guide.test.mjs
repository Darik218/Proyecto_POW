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
  workoutRepetitionPreviewInputSchema,
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
async function setup(t, name, adapter, props = {}) {
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
    name === "DailyWorkoutGuide"
      ? { query: { activityId: id }, ...props }
      : props,
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
test("guide provenance stays contextual and the active draft follows the guide's selected session instead of unrelated newer history", async (t) => {
  const value = sample();
  value.exercises[0].lastReference = {
    performedOn: "2026-11-14",
    gapDays: 1,
    scope: "SAME_PLAN_DAY",
    sessions: [
      {
        sessionId: other,
        sessionStatus: "IN_PROGRESS",
        taskId: other,
        performedOn: "2026-11-14",
        timeZone: "UTC",
        trainingPlanId: id,
        planDayId: id,
        planExerciseId: id,
        sets: [
          {
            setNumber: 1,
            load: "40.000",
            loadUnit: "KG",
            repetitions: 8,
            rpe: null,
            status: "COMPLETED",
            kind: "WORK",
            isCompleted: true,
          },
        ],
      },
    ],
  };
  const parsed = workoutGuideSchema.parse(value);
  assert.equal(parsed.exercises[0].lastReference.scope, "SAME_PLAN_DAY");
  assert.equal(parsed.exercises[0].lastReference.sessions[0].planDayId, id);
  assert.equal(
    parsed.exercises[0].lastReference.sessions[0].sessionStatus,
    "IN_PROGRESS",
  );
  const { state } = await setup(
    t,
    "WorkoutLivePanel",
    async (config) => response(config, value),
    {
      session: {
        ...summary,
        id,
        status: "IN_PROGRESS",
        exercises: [
          {
            id,
            exercise: { id, name: "Legs" },
            targets: target,
            orderInSession: 1,
            sets: [],
            isOmitted: false,
          },
        ],
      },
      busy: false,
      actions: {},
      previousReferences: {
        [id]: {
          sessionLabel: "Unrelated newer session",
          sets: [
            {
              setNumber: 1,
              load: "99.000",
              loadUnit: "KG",
              repetitions: 5,
              rpe: null,
              status: "COMPLETED",
              kind: "WORK",
            },
          ],
        },
      },
    },
  );
  assert.equal(state.previousSet.load, "40.000");
  assert.equal(state.activeReference.sets[0].repetitions, 8);
  assert.equal(state.activeReference.sets[0].rpe, null);
});
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

const preparation = (stage = "PLAN_WITH_REFERENCE") => ({
  stage,
  plan: target,
  before: null,
  draft:
    stage === "REVIEW_REQUIRED"
      ? null
      : {
          origin: "PLAN_TARGET",
          load: "42.125",
          unit: "LB",
          reps: 8,
          sets: 3,
          executionAuthorized: false,
        },
  why: ["PLAN_TARGET_AVAILABLE"],
  blockers:
    stage === "REVIEW_REQUIRED"
      ? [{ category: "temporal", code: "STALE_REFERENCE" }]
      : [],
  executionAuthorized: false,
});
const progressive = {
  contextKey: "a".repeat(64),
  comparisonKey: "b".repeat(64),
  ready: true,
  reasons: [],
  minimumSessions: 1,
  minimumSource: "PLAN_BOUND_INITIAL_POLICY",
  baselineSource: "PRESCRIPTION",
  tasks: [],
  policyContract: "session-repetition-preview-v2",
  executionAuthorized: false,
};
test("PROG7 preserves server preparation and the versioned progressive contract without permitting execution", () => {
  const value = sample();
  Object.assign(value.exercises[0], {
    preparation: preparation(),
    progressiveContext: progressive,
  });
  const parsed = workoutGuideSchema.parse(value).exercises[0];
  assert.equal(parsed.preparation?.draft.reps, 8);
  assert.equal(
    parsed.progressiveContext?.policyContract,
    "session-repetition-preview-v2",
  );
  assert.equal(
    workoutRepetitionPreviewInputSchema.safeParse({
      source: { activityId: id },
      exerciseId: id,
      contextKey: progressive.contextKey,
      declaration: {
        sameVariant: true,
        sameEquipment: true,
        sameLoadConvention: true,
      },
      policyContract: "session-repetition-preview-v2",
    }).success,
    true,
  );
  value.exercises[0].preparation.executionAuthorized = true;
  assert.equal(workoutGuideSchema.safeParse(value).success, false);
});
const liveProps = () => ({
  session: {
    ...summary,
    id,
    status: "IN_PROGRESS",
    exercises: [
      {
        id,
        exercise: { id, name: "Press" },
        targets: target,
        orderInSession: 1,
        sets: [],
        isOmitted: false,
      },
    ],
  },
  busy: false,
  actions: {},
  previousReferences: {},
});
test("PROG7 live draft follows the server preparation rather than the plan maximum", async (t) => {
  const value = sample();
  value.exercises[0].preparation = preparation();
  const { state } = await setup(
    t,
    "WorkoutLivePanel",
    async (config) => response(config, value),
    liveProps(),
  );
  assert.equal(state.draft?.repetitions, 8);
  assert.equal(state.draft?.load, "42.125");
  assert.equal(state.draft?.origin, "PLAN_TARGET");
});
test("PROG7 review blocks automatic reuse of an old reference while preserving manual recording", async (t) => {
  const value = sample();
  value.exercises[0].preparation = preparation("REVIEW_REQUIRED");
  value.exercises[0].lastReference = {
    performedOn: "2026-01-01",
    gapDays: 318,
    sessions: [
      {
        sessionId: other,
        taskId: other,
        performedOn: "2026-01-01",
        timeZone: "UTC",
        sessionStatus: "COMPLETED",
        sets: [
          {
            setNumber: 1,
            load: "40",
            loadUnit: "KG",
            repetitions: 8,
            rpe: null,
            status: "COMPLETED",
            kind: "WORK",
            isCompleted: true,
          },
        ],
      },
    ],
  };
  const { state } = await setup(
    t,
    "WorkoutLivePanel",
    async (config) => response(config, value),
    liveProps(),
  );
  assert.equal(state.draft?.origin, "PLAN_TARGET");
  assert.equal(state.draft?.load, "42.125");
  assert.equal(state.draft?.repetitions, 8);
  assert.equal(state.activeReference, undefined);
});
test("PROG7 comparison confirmation uses v2 and records only the returned verified pair", async (t) => {
  const requests = [];
  const value = sample();
  value.exercises[0].progressiveContext = progressive;
  const { state } = await setup(
    t,
    "WorkoutRepetitionGuide",
    async (config) => {
      requests.push(JSON.parse(config.data));
      return response(config, value);
    },
    { query: { activityId: id }, exerciseId: id, context: progressive },
  );
  assert.equal(requests.length, 0, "an unconfirmed pair never auto-calculates");
  await state.calculate();
  assert.equal(requests[0].policyContract, "session-repetition-preview-v2");
  assert.deepEqual(requests[0].declaration, {
    sameVariant: true,
    sameEquipment: true,
    sameLoadConvention: true,
  });
});

async function renderGuideCard(exercise) {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("vue/server-renderer");
  const Component = (
    await server.ssrLoadModule(
      "/src/components/workouts/WorkoutPreparationSummary.vue",
    )
  ).default;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => null } },
      {
        path: "/workout/:sessionId",
        name: "workout-session-detail",
        component: { render: () => null },
      },
      {
        path: "/settings",
        name: "progression-settings",
        component: { render: () => null },
      },
    ],
  });
  const app = createSSRApp(Component, { exercise });
  app.use(router);
  await router.push("/");
  return renderToString(app);
}

test("PROG7 preparation presents a practical plan draft and translates the actual review blocker", async () => {
  const exercise = { ...sample().exercises[0], preparation: preparation() };
  let html = await renderGuideCard(exercise);
  for (const label of [
    "Objetivo del plan",
    "Para esta sesión",
    "Ver explicación",
    "42,125 lb",
    "borrador editable",
  ])
    assert.ok(html.includes(label), label);
  assert.ok(
    !html.includes("Propuesta calculada"),
    "plan/history must not be portrayed as calculated progress",
  );
  exercise.preparation = {
    ...preparation("REVIEW_REQUIRED"),
    why: ["PARTIAL_SESSION_REFERENCE"],
    blockers: [{ category: "evidence", code: "PARTIAL_SESSION_REFERENCE" }],
  };
  html = await renderGuideCard(exercise);
  assert.ok(html.includes("sesión parcial"));
  assert.ok(html.includes("Guíate por el objetivo del plan"));
});

test("PROG7 a plan without a prescribed load still prepares repetitions without inventing a load", async () => {
  const { initialSetDraft } = await import("../src/utils/workout-set-draft.ts");
  const draft = initialSetDraft(
    [],
    undefined,
    {
      load: null,
      unit: null,
      repetitions: 8,
      origin: "PLAN_TARGET",
      prepared: true,
    },
    1,
  );
  assert.equal(draft?.repetitions, "8");
  assert.equal(draft?.load, "");
  assert.equal(draft?.loadUnit, "");
});

test("PROG7 preparation keeps contextual history provenance and the original objective accessible", async () => {
  const exercise = {
    ...sample().exercises[0],
    originalTarget: target,
    preparation: preparation(),
  };
  exercise.preparation.before = {
    performedOn: "2026-11-14",
    gapDays: 1,
    scope: "FREE_SESSION",
    sessions: [],
  };
  const html = await renderGuideCard(exercise);
  assert.ok(html.includes("Referencia de entrenamiento libre"));
  assert.ok(html.includes("Objetivo original conservado"));
});

test("PROG7 load math failure remains a separate diagnostic while repetition preparation stays usable", async () => {
  const value = sample();
  value.exercises[0].preparation = {
    ...preparation("REPETITION_READY"),
    diagnostics: {
      repetition: { ready: true, reasons: [] },
      load: {
        ready: false,
        reasons: [{ category: "math", code: "GRID_HAS_NO_POSITIVE_INCREMENT" }],
      },
    },
  };
  value.exercises[0].progressiveContext = progressive;
  const exercise = workoutGuideSchema.parse(value).exercises[0];
  assert.equal(
    exercise.preparation?.diagnostics?.load.reasons[0].code,
    "GRID_HAS_NO_POSITIVE_INCREMENT",
  );
  assert.equal(exercise.preparation.stage, "REPETITION_READY");
  assert.equal(exercise.progressiveContext.ready, true);
  assert.equal(exercise.preparation.draft.reps, 8);
  const html = await renderGuideCard(exercise);
  assert.ok(html.includes("Ver explicación"));
  assert.ok(!html.includes("GRID_HAS_NO_POSITIVE_INCREMENT"));
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.ok(html.includes("salto de peso disponible"));
  assert.ok(html.includes('data-stage="REPETITION_READY"'));
  assert.ok(html.includes("borrador editable"));
});

test("hotfix shows uneven sets and an ordered suggestion without leaking reason codes", async () => {
  const exercise = {
    ...sample().exercises[0],
    preparation: {
      ...preparation("REPETITION_DRAFT"),
      plan: { ...target, targetRepsMax: 12, targetLoad: null },
      before: {
        performedOn: "2026-11-14",
        gapDays: 1,
        scope: "SAME_PLAN_DAY",
        sessions: [
          {
            taskId: other,
            sessionId: other,
            sessionStatus: "COMPLETED",
            sets: [5, 12, 11, 9].map((repetitions, index) => ({
              setNumber: index + 1,
              load: index === 0 ? "20.000" : "60.000",
              loadUnit: "KG",
              repetitions,
              status: "COMPLETED",
              kind: index === 0 ? "WARMUP" : "WORK",
              isCompleted: true,
            })),
          },
        ],
      },
      draft: {
        origin: "CALCULATED",
        load: "60.000",
        unit: "KG",
        reps: null,
        repsBySet: [12, 11, 10],
        sets: 3,
      },
      why: ["REPETITION_TARGET_ADVANCE", "EXAMPLE_INTERNAL_FUTURE_CODE"],
    },
  };
  const html = await renderGuideCard(exercise);
  assert.match(html, /60 kg · 12 \/ 11 \/ 9/);
  assert.match(html, /60 kg × 12 \/ 11 \/ 10/);
  assert.match(html, /Propuesta calculada/);
  assert.doesNotMatch(html, /20 kg|60\.000|EXAMPLE_INTERNAL_FUTURE_CODE/);
  assert.equal((html.match(/<details/g) ?? []).length, 1);
});

test("PROG7 review with unordered history never claims there are no prior records", async () => {
  const exercise = {
    ...sample().exercises[0],
    preparation: {
      ...preparation("REVIEW_REQUIRED"),
      before: null,
      why: ["SAME_DAY_NOT_ORDERED"],
      blockers: [{ category: "temporal", code: "SAME_DAY_NOT_ORDERED" }],
    },
  };
  const html = await renderGuideCard(exercise);
  assert.ok(!html.includes("primera referencia"));
  assert.ok(!html.includes("Sin resultados anteriores"));
  assert.ok(
    html.includes("No se supone qué sesión ocurrió primero en la misma fecha"),
  );
});

test("hotfix first exercise shows the plan and weight choice without warnings or disclosures", async () => {
  const exercise = {
    ...sample().exercises[0],
    preparation: {
      ...preparation("PLAN_ONLY"),
      plan: { ...target, targetLoad: null, targetLoadUnit: null },
      blockers: [
        { category: "evidence", code: "NO_ELIGIBLE_HISTORY" },
        { category: "configuration", code: "SETTING_REQUIRED" },
      ],
    },
  };
  const html = await renderGuideCard(exercise);
  assert.match(html, /3 × 8–10 repeticiones · peso a elegir/);
  assert.match(html, /Registra lo que hagas/);
  assert.doesNotMatch(
    html,
    /<details|NO_ELIGIBLE_HISTORY|SETTING_REQUIRED|Anterior|Para esta sesión/,
  );
});
