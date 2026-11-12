import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createPinia } from "pinia";
import { createRenderer, createSSRApp, nextTick } from "vue";
import { renderToString } from "@vue/server-renderer";
import { consentFixture, cid } from "./automation-consent.fixtures.mjs";
let server;
before(async () => {
  server = await createServer({
    configFile: resolve("vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    logLevel: "error",
  });
});
after(() => server?.close());
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
const inspection = () => ({
  id: cid(9),
  version: 1,
  state: "ACCEPTED_INACTIVE",
  effectiveState: "ACCEPTED_INACTIVE",
  acceptance: { recordedEventId: cid(8) },
  snapshot: consentFixture(),
});
const status = () => ({
  consentId: cid(9),
  consentVersion: 1,
  acceptanceEventId: cid(8),
  effectiveState: "INACTIVE",
  executionAuthorized: false,
  reasons: [],
  activationTermsVersion: "saved-recommendations-activation-v1",
  grant: null,
});
test("operational confirmation begins false and resets on refreshed state, consent version and session", async (t) => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/automation/OperationalProgression.vue",
    )
  ).default;
  const { useOperationalProgressionStore } = await server.ssrLoadModule(
    "/src/stores/operational-progression.store.ts",
  );
  const { useAuthStore } = await server.ssrLoadModule(
    "/src/stores/auth.store.ts",
  );
  const pinia = createPinia(),
    store = useOperationalProgressionStore(pinia),
    auth = useAuthStore(pinia);
  store.open = async () => {};
  store.status = status();
  const app = renderer.createApp(
    { ...Component, render: () => null },
    { consent: inspection() },
  );
  app.use(pinia);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  const vm = app.mount({});
  t.after(() => app.unmount());
  const state = vm.$.setupState;
  assert.equal(state.activation, false);
  state.activation = true;
  store.status = { ...status() };
  await nextTick();
  assert.equal(state.activation, false);
  state.activation = true;
  auth.user = { id: cid(77) };
  await nextTick();
  assert.equal(state.activation, false);
  state.revocation = true;
  auth.accessToken = "changed";
  await nextTick();
  assert.equal(state.revocation, false);
});
test("rendered operational interface disables activation until explicitly checked and labels actual processing", async () => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/automation/OperationalProgression.vue",
    )
  ).default;
  const { useOperationalProgressionStore } = await server.ssrLoadModule(
    "/src/stores/operational-progression.store.ts",
  );
  const pinia = createPinia(),
    store = useOperationalProgressionStore(pinia);
  store.open = async () => {};
  store.status = status();
  const app = createSSRApp(Component, { consent: inspection() });
  app.use(pinia);
  app.component("RouterLink", { template: "<a><slot /></a>" });
  const html = await renderToString(app);
  assert.match(html, /data-testid="confirmOperationalActivation"/);
  assert.match(html, /data-testid="activateOperationalGrant" disabled/);
  assert.match(html, /data-testid="processAutomaticRecommendations" disabled/);
  assert.match(html, /Procesar recomendaciones guardadas ahora/);
  assert.match(html, /Condiciones exactas que autorizas/);
});
test("modified route components compile into real browser modules", async () => {
  for (const path of [
    "views/ProgressionDetailView",
    "views/AutomationConsentDetailView",
    "components/automation/OperationalProgression",
  ])
    assert.ok(
      (await server.transformRequest("/src/" + path + ".vue")).code.includes(
        "export default",
      ),
    );
});
test("automatic application queries automatic receipt and never loads or renders manual application flow", async (t) => {
  const { routeLocationKey } = await import("vue-router");
  const Component = (
    await server.ssrLoadModule("/src/views/ProgressionDetailView.vue")
  ).default;
  const { useProgressionStore } = await server.ssrLoadModule(
    "/src/stores/progression.store.ts",
  );
  const { operationalProgressionService } = await server.ssrLoadModule(
    "/src/services/operational-progression.service.ts",
  );
  const pinia = createPinia(),
    store = useProgressionStore(pinia);
  let manual = 0,
    automatic = 0;
  store.open = async (id) => {
    store.proposal = { id, status: "APPLIED" };
    store.inspection = {};
  };
  store.loadReceipt = async () => {
    manual++;
  };
  const original = operationalProgressionService.application;
  t.after(() => {
    operationalProgressionService.application = original;
  });
  operationalProgressionService.application = async (id) => {
    automatic++;
    assert.equal(id, cid(5));
    return {
      consentId: cid(9),
      run: { result: "APPLIED", appliedLoad: "15.000001" },
    };
  };
  const app = renderer.createApp({ ...Component, render: () => null });
  app.use(pinia);
  app.provide(Symbol.for("v-scx"), { modules: new Set() });
  app.provide(routeLocationKey, { params: { id: cid(5) } });
  const vm = app.mount({});
  t.after(() => app.unmount());
  await new Promise((resolve) => setImmediate(resolve));
  await nextTick();
  assert.equal(automatic, 1);
  assert.equal(manual, 0);
  assert.equal(vm.$.setupState.automaticReceipt.run.appliedLoad, "15.000001");
  assert.equal(vm.$.setupState.receiptResolved, true);
});
test("activation is unavailable when operational version no longer matches displayed accepted conditions", async () => {
  const Component = (
    await server.ssrLoadModule(
      "/src/components/automation/OperationalProgression.vue",
    )
  ).default;
  const { useOperationalProgressionStore } = await server.ssrLoadModule(
    "/src/stores/operational-progression.store.ts",
  );
  const pinia = createPinia(),
    store = useOperationalProgressionStore(pinia);
  store.open = async () => {};
  store.status = { ...status(), consentVersion: 2 };
  const app = createSSRApp(Component, { consent: inspection() });
  app.use(pinia);
  app.component("RouterLink", { template: "<a><slot /></a>" });
  const html = await renderToString(app);
  assert.doesNotMatch(html, /data-testid="activateOperationalGrant"/);
  assert.match(html, /La versión operativa cambió/);
});
test("delayed automatic receipt 404 cannot supersede pending or completed manual recovery", async (t) => {
  const { routeLocationKey } = await import("vue-router");
  const Component = (
    await server.ssrLoadModule("/src/views/ProgressionDetailView.vue")
  ).default;
  const { useProgressionStore } = await server.ssrLoadModule(
    "/src/stores/progression.store.ts",
  );
  const { progressionService } = await server.ssrLoadModule(
    "/src/services/progression.service.ts",
  );
  const { operationalProgressionService } = await server.ssrLoadModule(
    "/src/services/operational-progression.service.ts",
  );
  const originals = {
    inspect: progressionService.inspect,
    receipt: progressionService.receipt,
    application: operationalProgressionService.application,
  };
  t.after(() => {
    Object.assign(progressionService, {
      inspect: originals.inspect,
      receipt: originals.receipt,
    });
    operationalProgressionService.application = originals.application;
  });
  for (const recoveryFirst of [false, true]) {
    const pinia = createPinia(),
      store = useProgressionStore(pinia);
    let rejectAutomatic,
      resolveManual,
      receiptCalls = 0;
    const inspected = {
        proposal: { id: cid(5), status: "APPLIED" },
        events: [],
      },
      receipt = {
        recommendationId: cid(5),
        intentId: cid(6),
        status: "APPLIED",
        origin: "MANUAL",
      };
    progressionService.inspect = async () => inspected;
    progressionService.receipt = () => {
      receiptCalls++;
      return new Promise((resolve) => {
        resolveManual = resolve;
      });
    };
    operationalProgressionService.application = () =>
      new Promise((_resolve, reject) => {
        rejectAutomatic = reject;
      });
    store.pending = {
      kind: "APPLY",
      recommendationId: cid(5),
      intentId: cid(6),
      createdAt: Date.now(),
    };
    const app = renderer.createApp({ ...Component, render: () => null });
    app.use(pinia);
    app.provide(Symbol.for("v-scx"), { modules: new Set() });
    app.provide(routeLocationKey, { params: { id: cid(5) } });
    const vm = app.mount({});
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(typeof rejectAutomatic, "function");
      const recovery = store.recover();
      assert.equal(receiptCalls, 1);
      if (recoveryFirst) {
        resolveManual(receipt);
        await recovery;
        assert.equal(store.pending, null);
      }
      rejectAutomatic({ response: { status: 404 } });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        receiptCalls,
        1,
        "404 must not launch a competing store.loadReceipt read",
      );
      if (!recoveryFirst) {
        resolveManual(receipt);
        await recovery;
      }
      assert.equal(store.pending, null);
      assert.equal(store.receipt.intentId, cid(6));
      assert.equal(vm.$.setupState.receiptResolved, true);
    } finally {
      app.unmount();
      store.$dispose();
    }
  }
});
