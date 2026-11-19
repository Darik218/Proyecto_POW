import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { AxiosError } from "axios";
import {
  operationalStatusSchema,
  activationSchema,
  automaticRunSchema,
} from "../src/schemas/operational-progression.schema.ts";
import { operationalProgressionService as service } from "../src/services/operational-progression.service.ts";
import { api } from "../src/services/api.ts";
import { useOperationalProgressionStore } from "../src/stores/operational-progression.store.ts";
import { useAuthStore } from "../src/stores/auth.store.ts";
import {
  rememberOperationalIntent,
  recoverOperationalIntent,
} from "../src/utils/operational-intents.ts";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const status = () => ({
  consentId: id(1),
  consentVersion: 1,
  contractKey: "a".repeat(64),
  acceptanceEventId: id(2),
  activationTermsVersion: "saved-recommendations-activation-v1",
  conditionsKey: "b".repeat(64),
  grant: null,
  effectiveState: "INACTIVE",
  executionAuthorized: false,
  reasons: [],
  principal: "PULSO_INTERNAL_PROGRESSION_WORKER_V1",
});
const grant = () => ({
  id: id(3),
  consentId: id(1),
  state: "ACTIVE",
  version: 1,
  activatedAt: "2026-11-12T00:00:00Z",
  revokedAt: null,
});
const receipt = (action = "ACTIVATE", intentId = id(4)) => ({
  eventId: id(5),
  intentId,
  action,
  consentId: id(1),
  grant: grant(),
  results: [],
  recordedAt: "2026-11-12T00:00:00Z",
});
const history = () => ({ items: [], page: 1, limit: 20, total: 0 });
const original = { ...service };
after(() => Object.assign(service, original));
function setup() {
  Object.assign(service, original);
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = { id: id(7) };
  auth.status = "authenticated";
  auth.accessToken = "memory";
  auth.getSessionContextId = () => "session";
  return { auth, store: useOperationalProgressionStore() };
}
const network = () => new AxiosError("lost", "ECONNABORTED");
test("strict operational contracts require explicit intent and keep decimal strings exact", () => {
  assert.ok(operationalStatusSchema.parse(status()));
  assert.equal(
    operationalStatusSchema.safeParse({
      ...status(),
      principal: "user-controlled",
    }).success,
    false,
  );
  const input = {
    intentId: id(4),
    expectedConsentVersion: 1,
    expectedContractKey: "a".repeat(64),
    acceptanceEventId: id(2),
    activationTermsVersion: "saved-recommendations-activation-v1",
    conditionsKey: "b".repeat(64),
    confirmActivation: true,
  };
  assert.ok(activationSchema.parse(input));
  assert.equal(
    activationSchema.safeParse({ ...input, confirmActivation: false }).success,
    false,
  );
  assert.equal(
    activationSchema.safeParse({ ...input, athleteId: id(9) }).success,
    false,
  );
  const run = {
    id: id(8),
    grantId: id(3),
    recommendationId: id(9),
    result: "APPLIED",
    reasons: [],
    applicationId: id(10),
    previousLoad: "10.00",
    appliedLoad: "10.125",
    unit: "KG",
    recordedAt: "2026-11-12T00:00:00Z",
    cycleKey: null,
  };
  assert.equal(automaticRunSchema.parse(run).appliedLoad, "10.125");
  assert.equal(
    automaticRunSchema.safeParse({ ...run, appliedLoad: 10.125 }).success,
    false,
  );
});
test("service uses protected API paths and parses before POST", async () => {
  const old = api.post,
    calls = [];
  api.post = async (...args) => {
    calls.push(args);
    return { data: receipt("CHECK") };
  };
  try {
    await original.process(id(1), { intentId: id(4) });
    assert.equal(
      calls[0][0],
      `/progression/automatic/consents/${id(1)}/process`,
    );
    await assert.rejects(() =>
      original.process(id(1), { intentId: id(4), principal: "bad" }),
    );
    assert.equal(calls.length, 1);
  } finally {
    api.post = old;
  }
});
test("storage allowlists identifiers and expires or rejects other sessions", () => {
  const map = new Map(),
    storage = {
      setItem: (k, v) => map.set(k, v),
      getItem: (k) => map.get(k),
      removeItem: (k) => map.delete(k),
    };
  const value = {
    accountId: id(7),
    sessionContext: "session",
    intentId: id(4),
    consentId: id(1),
    action: "ACTIVATE",
    createdAt: 1000,
    privatePayload: "secret",
  };
  rememberOperationalIntent(storage, value);
  assert.equal([...map.values()][0].includes("secret"), false);
  assert.ok(recoverOperationalIntent(storage, id(7), "session", 1001));
  assert.equal(recoverOperationalIntent(storage, id(7), "other", 1001), null);
  rememberOperationalIntent(storage, value);
  assert.equal(
    recoverOperationalIntent(storage, id(7), "session", 1801000),
    null,
  );
});
test("activation starts unconfirmed, binds accepted version, guards double click, and retains receipt if refresh fails", async () => {
  const { store } = setup();
  store.status = status();
  let calls = 0,
    finish;
  service.activate = async (_id, input) => {
    calls++;
    assert.equal(input.expectedConsentVersion, 1);
    return await new Promise(
      (resolve) =>
        (finish = () => resolve(receipt("ACTIVATE", input.intentId))),
    );
  };
  service.status = async () => {
    throw network();
  };
  await store.command("ACTIVATE");
  assert.equal(calls, 0);
  const work = store.command("ACTIVATE", true);
  await store.command("ACTIVATE", true);
  assert.equal(calls, 1);
  finish();
  await work;
  assert.equal(store.receipt.action, "ACTIVATE");
  assert.equal(store.error.uncertain, true);
  assert.ok(store.pending);
  store.$dispose();
});
test("lost response recovery uses same intent and historical grant cannot overwrite current revoked status", async () => {
  const { store } = setup();
  store.status = {
    ...status(),
    grant: grant(),
    effectiveState: "ACTIVE",
    executionAuthorized: true,
  };
  let intent;
  service.process = async (_id, input) => {
    intent = input.intentId;
    throw network();
  };
  await store.command("CHECK");
  assert.equal(store.pending.intentId, intent);
  service.operation = async (value) => {
    assert.equal(value, intent);
    return receipt("CHECK", intent);
  };
  service.status = async () => ({
    ...status(),
    grant: { ...grant(), state: "REVOKED", version: 2 },
    effectiveState: "REVOKED",
  });
  service.history = async () => history();
  await store.recover();
  assert.equal(store.status.effectiveState, "REVOKED");
  assert.equal(store.receipt.grant.state, "ACTIVE");
  assert.equal(store.pending, null);
  store.$dispose();
});
test("stale response from previous identity is ignored", async () => {
  const { auth, store } = setup();
  let finish;
  service.status = () => new Promise((resolve) => (finish = resolve));
  service.history = async () => history();
  const work = store.open(id(1));
  auth.user = { id: id(99) };
  finish(status());
  await work;
  assert.equal(store.status, null);
  assert.equal(store.receipt, null);
  store.$dispose();
});
test("a revoked parent consent blocks processing even when grant row remains active", async () => {
  const { store } = setup();
  store.status = {
    ...status(),
    grant: grant(),
    effectiveState: "REVOKED",
    executionAuthorized: false,
  };
  let calls = 0;
  service.process = async () => {
    calls++;
  };
  await store.command("CHECK");
  await store.command("ACTIVATE", true);
  assert.equal(calls, 0);
  assert.equal(store.pending, null);
  store.$dispose();
});
test("opening another consent clears unrelated receipt; refreshing the same consent preserves confirmed receipt", async () => {
  const { store } = setup();
  store.receipt = receipt();
  service.status = async (value) => ({ ...status(), consentId: value });
  service.history = async () => history();
  await store.open(id(1));
  assert.equal(store.receipt.eventId, id(5));
  await store.open(id(11));
  assert.equal(store.receipt, null);
  assert.equal(store.status.consentId, id(11));
  store.$dispose();
});
const sourceBusy = () =>
  new AxiosError("busy", "ERR_BAD_RESPONSE", undefined, undefined, {
    status: 503,
    data: { code: "SOURCE_BUSY", reasons: ["CHECK_IN_PROGRESS"] },
  });
function storedIntent(t, action = "CHECK") {
  const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    ),
    map = new Map(),
    storage = {
      setItem: (k, v) => map.set(k, v),
      getItem: (k) => map.get(k),
      removeItem: (k) => map.delete(k),
    };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  });
  rememberOperationalIntent(storage, {
    accountId: id(7),
    sessionContext: "session",
    intentId: id(4),
    consentId: id(1),
    action,
    createdAt: Date.now(),
  });
  return { map, storage };
}
test("explicit recovery after reload resumes only interrupted CHECK with original persisted identifiers", async (t) => {
  const { map } = storedIntent(t);
  const first = setup();
  assert.ok(first.store.pending);
  first.store.$dispose();
  const { store } = setup();
  t.after(() => store.$dispose());
  assert.equal(store.canRetry(), false);
  const saved = JSON.parse([...map.values()][0]);
  assert.deepEqual(Object.keys(saved).sort(), [
    "accountId",
    "action",
    "consentId",
    "createdAt",
    "intentId",
    "sessionContext",
  ]);
  const calls = [];
  service.operation = async (intent) => {
    calls.push(["operation", intent]);
    throw sourceBusy();
  };
  service.process = async (consent, input) => {
    calls.push(["process", consent, input]);
    return receipt("CHECK", input.intentId);
  };
  service.status = async () => status();
  service.history = async () => history();
  assert.deepEqual(calls, []);
  await store.recover();
  assert.deepEqual(calls, [
    ["operation", id(4)],
    ["process", id(1), { intentId: id(4) }],
  ]);
  assert.equal(store.receipt.intentId, id(4));
  assert.equal(store.receipt.action, "CHECK");
  assert.equal(store.pending, null);
  assert.equal(map.size, 0);
});
test("SOURCE_BUSY recovery never replays activation or revocation", async (t) => {
  for (const action of ["ACTIVATE", "REVOKE"]) {
    const { store } = setup();
    store.pending = {
      accountId: id(7),
      sessionContext: "session",
      intentId: id(4),
      consentId: id(1),
      action,
      createdAt: Date.now(),
    };
    let writes = 0;
    service.operation = async () => {
      throw sourceBusy();
    };
    service.process = async () => {
      writes++;
    };
    service.activate = async () => {
      writes++;
    };
    service.revoke = async () => {
      writes++;
    };
    await store.recover();
    assert.equal(writes, 0);
    assert.equal(store.pending.action, action);
    store.$dispose();
  }
});
test("interrupted CHECK recovery cannot resume after identity changed while querying operation", async (t) => {
  storedIntent(t);
  const { auth, store } = setup();
  t.after(() => store.$dispose());
  let reject,
    processCalls = 0;
  service.operation = () => new Promise((_resolve, fail) => (reject = fail));
  service.process = async () => {
    processCalls++;
  };
  const recovery = store.recover();
  auth.user = { id: id(99) };
  reject(sourceBusy());
  await recovery;
  assert.equal(processCalls, 0);
  assert.equal(store.receipt, null);
  assert.equal(store.pending, null);
});
test("resumed CHECK response from previous identity is ignored", async (t) => {
  storedIntent(t);
  const { auth, store } = setup();
  t.after(() => store.$dispose());
  let finish;
  service.operation = async () => {
    throw sourceBusy();
  };
  service.process = () => new Promise((resolve) => (finish = resolve));
  const recovery = store.recover();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, "function");
  auth.user = { id: id(99) };
  finish(receipt("CHECK"));
  await recovery;
  assert.equal(store.receipt, null);
  assert.equal(store.status, null);
  assert.equal(store.pending, null);
});
test("missing CHECK receipt does not start processing or replace the original intention", async (t) => {
  storedIntent(t);
  const { store } = setup();
  t.after(() => store.$dispose());
  let processCalls = 0;
  service.operation = async () => {
    throw new AxiosError("missing", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 404,
      data: { code: "SOURCE_NOT_FOUND" },
    });
  };
  service.process = async () => {
    processCalls++;
  };
  await store.recover();
  assert.equal(processCalls, 0);
  assert.equal(store.pending.intentId, id(4));
  assert.equal(store.receipt, null);
});
