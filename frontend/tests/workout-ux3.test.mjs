import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";
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
async function withAdapter(t, adapter) {
  const { api } = await server.ssrLoadModule("/src/services/api.ts");
  const { workoutGuideService } = await server.ssrLoadModule(
    "/src/services/workout-guide.service.ts",
  );
  api.defaults.adapter = adapter;
  t.after(() => {
    api.defaults.adapter = undefined;
  });
  return workoutGuideService;
}

test("legacy preview still sends the explicit comparison through the existing HTTP contract", async (t) => {
  const calls = [];
  const service = await withAdapter(t, async (config) => {
    calls.push(config);
    return response(config, guide());
  });
  assert.equal(calls.length, 0);
  const value = await service.repetitionPreview(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/progression/workout-guide/repetition-preview");
  assert.deepEqual(JSON.parse(calls[0].data), input);
  assert.equal(value.exercises[0].guidanceSuggested.reps, 9);
});

test("cancelling a pending legacy preview rejects its late response", async (t) => {
  const controller = new AbortController();
  let finish;
  const service = await withAdapter(t, async (config) => {
    assert.equal(config.signal, controller.signal);
    await new Promise((accept) => {
      finish = accept;
    });
    return response(config, guide());
  });
  const pending = assert.rejects(
    service.repetitionPreview(input, controller.signal),
    { code: "ERR_CANCELED" },
  );
  await new Promise((accept) => setImmediate(accept));
  controller.abort();
  finish();
  await pending;
});

test("legacy preview rejects a response that claims operative authorization", async (t) => {
  const service = await withAdapter(t, async (config) =>
    response(config, { ...guide(), executionAuthorized: true }),
  );
  await assert.rejects(service.repetitionPreview(input), { name: "ZodError" });
});
