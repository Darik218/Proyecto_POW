import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createRenderer, nextTick } from "vue";
import { createPinia } from "pinia";
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
async function mounted(t) {
  const { useAuthStore } = await server.ssrLoadModule(
      "/src/stores/auth.store.ts",
    ),
    { trainingPlansService } = await server.ssrLoadModule(
      "/src/services/training-plans.service.ts",
    ),
    { routineService } = await server.ssrLoadModule(
      "/src/services/routine.service.ts",
    ),
    { default: Component } = await server.ssrLoadModule(
      "/src/components/training-plans/DuplicatePlanForm.vue",
    );
  const pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id: "account-a" };
  auth.accessToken = "in-memory";
  auth.status = "authenticated";
  const original = [trainingPlansService.getPlanning, routineService.duplicate],
    emitted = [];
  t.after(() => {
    [trainingPlansService.getPlanning, routineService.duplicate] = original;
  });
  trainingPlansService.getPlanning = async () => ({
    id: "source",
    name: "Rutina variada",
    version: 3,
  });
  const app = renderer.createApp(
    { ...Component, render: () => null },
    { planId: "source", onCreated: (id) => emitted.push(id) },
  );
  app.use(pinia);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const instance = app.mount({});
  t.after(() => app.unmount());
  await flush();
  return {
    state: instance.$.setupState,
    auth,
    routineService,
    trainingPlansService,
    emitted,
  };
}
test("lost copy response reuses the exact intention and source version instead of duplicating again", async (t) => {
  const f = await mounted(t),
    calls = [];
  f.routineService.duplicate = async (source, input) => {
    calls.push({ source, ...input });
    if (calls.length === 1) throw Error("timeout");
    return { id: input.id };
  };
  f.state.name = "Mi copia";
  await f.state.submit();
  assert.equal(f.state.uncertain, true);
  f.auth.accessToken = "renewed-same-session";
  f.auth.user = { ...f.auth.user };
  await flush();
  await f.state.submit();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].expectedVersion, 3);
  assert.equal(f.emitted.length, 1);
});
test("late copy completion cannot navigate or expose results after account logout", async (t) => {
  const f = await mounted(t);
  let finish;
  f.routineService.duplicate = () =>
    new Promise((r) => {
      finish = r;
    });
  const pending = f.state.submit();
  f.auth.clearSession();
  finish({ id: "private-old-copy" });
  await pending;
  await flush();
  assert.deepEqual(f.emitted, []);
  assert.equal(f.state.version, null);
  assert.equal(f.state.name, "");
});

test("a definite source-version rejection releases the old intent and requires a fresh verified source", async (t) => {
  const f = await mounted(t),
    calls = [];
  f.routineService.duplicate = async (source, input) => {
    calls.push({ ...input });
    if (calls.length === 1)
      throw {
        isAxiosError: true,
        response: {
          status: 409,
          data: { message: "The source plan changed." },
        },
      };
    return { id: input.id };
  };
  await f.state.submit();
  assert.equal(f.state.uncertain, false);
  assert.equal(f.state.version, null);
  f.trainingPlansService.getPlanning = async () => ({
    id: "source",
    name: "Nueva revisión",
    version: 4,
  });
  await f.state.load();
  await f.state.submit();
  assert.equal(calls[1].expectedVersion, 4);
  assert.notEqual(calls[0].id, calls[1].id);
});

test("parent continuation cannot select an old copy after an awaited reload crosses logout", async (t) => {
  const { createRouter, createMemoryHistory } = await import("vue-router");
  const { useAuthStore } = await server.ssrLoadModule(
      "/src/stores/auth.store.ts",
    ),
    { trainingPlansService } = await server.ssrLoadModule(
      "/src/services/training-plans.service.ts",
    ),
    { workoutSessionsService } = await server.ssrLoadModule(
      "/src/services/workout-sessions.service.ts",
    ),
    { default: Component } = await server.ssrLoadModule(
      "/src/views/RoutineView.vue",
    );
  const original = [trainingPlansService.list, workoutSessionsService.list];
  t.after(() => {
    [trainingPlansService.list, workoutSessionsService.list] = original;
  });
  trainingPlansService.list = async () => [];
  workoutSessionsService.list = async () => ({
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
  });
  const pinia = createPinia(),
    auth = useAuthStore(pinia);
  auth.user = { id: "account-a" };
  auth.accessToken = "in-memory";
  auth.status = "authenticated";
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/app", name: "home", component: { render: () => null } }],
  });
  await router.push("/app");
  await router.isReady();
  const app = renderer.createApp({ ...Component, render: () => null });
  app.use(pinia);
  app.use(router);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const instance = app.mount({});
  t.after(() => app.unmount());
  await flush();
  await flush();
  const state = instance.$.setupState;
  state.plan = { id: "source-to-copy" };
  state.toggleDuplicate();
  state.duplicateLocked = true;
  state.plan = null; // A source refresh must not discard the independent pending form.
  assert.equal(state.duplicateSourceId, "source-to-copy");
  assert.equal(state.duplicating, true);
  state.toggleDuplicate();
  assert.equal(state.duplicating, true);
  let done;
  trainingPlansService.list = () =>
    new Promise((r) => {
      done = r;
    });
  const pending = instance.$.setupState.created("old-account-copy");
  auth.clearSession();
  done([]);
  await pending;
  await flush();
  assert.equal(instance.$.setupState.chosenPlan, "");
});
