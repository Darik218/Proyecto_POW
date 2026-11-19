import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createRenderer, nextTick, createSSRApp } from "vue";
import { createPinia } from "pinia";
import { renderToString } from "@vue/server-renderer";
let vite;
before(async () => {
  vite = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
});
after(async () => {
  await vite?.close();
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
const flush = async () => {
  await nextTick();
  await new Promise((r) => setImmediate(r));
  await nextTick();
};
async function mounted(t) {
  const { useAuthStore } = await vite.ssrLoadModule(
      "/src/stores/auth.store.ts",
    ),
    { useDashboard } = await vite.ssrLoadModule(
      "/src/composables/useDashboard.ts",
    ),
    { workoutSessionsService } = await vite.ssrLoadModule(
      "/src/services/workout-sessions.service.ts",
    ),
    { trainingPlansService } = await vite.ssrLoadModule(
      "/src/services/training-plans.service.ts",
    ),
    { progressionService } = await vite.ssrLoadModule(
      "/src/services/progression.service.ts",
    );
  const pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id: "account-a" };
  auth.status = "authenticated";
  auth.accessToken = "memory-only";
  const original = [
    workoutSessionsService.list,
    trainingPlansService.list,
    progressionService.list,
  ];
  t.after(() => {
    [
      workoutSessionsService.list,
      trainingPlansService.list,
      progressionService.list,
    ] = original;
  });
  return {
    auth,
    pinia,
    useDashboard,
    workoutSessionsService,
    trainingPlansService,
    progressionService,
  };
}
function mount(f, t) {
  let state;
  const app = renderer.createApp({
    setup() {
      state = f.useDashboard();
      return () => null;
    },
  });
  app.use(f.pinia);
  app.mount({});
  t.after(() => app.unmount());
  return state;
}
test("dashboard uses server totals and labels its five-row sample rather than counting a page as all history", async (t) => {
  const f = await mounted(t);
  f.workoutSessionsService.list = async (q) =>
    q.status
      ? { items: [], total: 81 }
      : { items: [{ id: "one", status: "COMPLETED" }], total: 123 };
  f.trainingPlansService.list = async () => [
    { status: "ACTIVE" },
    { status: "DRAFT" },
  ];
  f.progressionService.list = async () => ({ items: [], total: 14 });
  const s = mount(f, t);
  await flush();
  assert.equal(s.total.value, 123);
  assert.equal(s.completed.value, 81);
  assert.equal(s.pending.value, 14);
  assert.equal(s.activePlans.value, 1);
  assert.equal(s.recent.value.length, 1);
  assert.equal(s.errors.value.length, 0);
});
test("dashboard preserves unknown results as unavailable, without fake zeros or fake sessions", async (t) => {
  const f = await mounted(t);
  f.workoutSessionsService.list = async () => {
    throw Error("offline");
  };
  f.trainingPlansService.list = async () => {
    throw Error("offline");
  };
  f.progressionService.list = async () => {
    throw Error("offline");
  };
  const s = mount(f, t);
  await flush();
  assert.equal(s.total.value, null);
  assert.equal(s.completed.value, null);
  assert.equal(s.pending.value, null);
  assert.equal(s.activePlans.value, null);
  assert.deepEqual(s.recent.value, []);
  assert.equal(s.errors.value.length, 4);
  assert.equal(s.loading.value, false);
});
test("a delayed dashboard from the previous identity cannot populate the new account", async (t) => {
  const f = await mounted(t),
    queues = [];
  f.workoutSessionsService.list = () => new Promise((r) => queues.push(r));
  f.trainingPlansService.list = async () => [];
  f.progressionService.list = async () => ({ items: [], total: 0 });
  const s = mount(f, t);
  await flush();
  assert.equal(queues.length, 2);
  f.auth.user = { id: "account-b" };
  await flush();
  assert.equal(queues.length, 4);
  queues[0]({ items: [{ id: "private-a" }], total: 900 });
  queues[1]({ items: [], total: 900 });
  await flush();
  assert.equal(s.total.value, null);
  assert.deepEqual(s.recent.value, []);
  queues[2]({ items: [], total: 0 });
  queues[3]({ items: [], total: 0 });
  await flush();
  assert.equal(s.total.value, 0);
  assert.equal(s.completed.value, 0);
  assert.deepEqual(s.recent.value, []);
});
test("status badges keep accepted-inactive and pending visibly distinct from execution", async () => {
  const { default: Badge } = await vite.ssrLoadModule(
    "/src/components/ui/StatusBadge.vue",
  );
  for (const status of [
    "PENDING_CONFIRMATION",
    "ACCEPTED_INACTIVE",
    "REVOKED",
    "APPLIED",
  ]) {
    const html = await renderToString(createSSRApp(Badge, { status }));
    assert.match(html, new RegExp(status));
    assert.doesNotMatch(html, /role="button"|<input|checked/);
  }
});
test("navigation distinguishes settings and automation while the existing routine route remains its own destination", async () => {
  const { navigation, navigationSection } = await vite.ssrLoadModule(
    "/src/config/navigation.ts",
  );
  assert.equal(navigationSection("home"), "routine");
  assert.equal(navigationSection("dashboard"), "dashboard");
  assert.equal(navigationSection("progression-setting-edit"), "settings");
  assert.equal(navigationSection("automation-detail"), "automation");
  assert.equal(navigationSection("progression-detail"), "progression");
  assert.equal(navigation.filter((n) => n.name === "home").length, 1);
});

test("the academic demo captures the complete existing workout contract at creation", async () => {
  const { demoExerciseSnapshot } = await import("./final-mvp.fixtures.mjs"),
    { detail, exercise } = await import("./workout-sessions.fixtures.mjs"),
    { workoutSchema } = await vite.ssrLoadModule(
      "/src/services/workout-sessions.service.ts",
    );
  const original = demoExerciseSnapshot(exercise.exercise),
    payload = { ...detail, exercises: [{ ...exercise, original }] };
  assert.equal(workoutSchema.safeParse(payload).success, true);
  assert.deepEqual(original.source, { kind: "FREE", id: null });
  assert.equal(original.targets.targetRpe, 8);
  assert.equal(original.targets.targetLoad, "80");
  assert.equal(original.exercise.name, exercise.exercise.name);
});
test("a partial demo capture is rejected rather than counting an error page as a valid workout", async () => {
  const { detail, exercise } = await import("./workout-sessions.fixtures.mjs"),
    { workoutSchema } = await vite.ssrLoadModule(
      "/src/services/workout-sessions.service.ts",
    );
  const payload = {
    ...detail,
    exercises: [
      {
        ...exercise,
        original: {
          exercise: { id: exercise.exercise.id },
          targets: {
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: 6,
            targetLoad: "80",
            targetLoadUnit: "KG",
            targetRpe: "8",
          },
        },
      },
    ],
  };
  assert.equal(workoutSchema.safeParse(payload).success, false);
});
