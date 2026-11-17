import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkoutComparabilityMemory } from "../src/services/workout-comparability.service.ts";
const key = "a".repeat(64),
  other = "b".repeat(64);
test("a declaration is reusable only for the same authenticated generation and exact comparison", () => {
  const memory = createWorkoutComparabilityMemory();
  memory.setScope("account-a/session-1");
  assert.deepEqual(
    memory.missing("account-a/session-1", key, [
      "sameVariant",
      "sameEquipment",
      "sameLoadConvention",
    ]),
    ["sameVariant", "sameEquipment", "sameLoadConvention"],
  );
  memory.record("account-a/session-1", key, {
    sameVariant: true,
    sameEquipment: true,
    sameLoadConvention: true,
  });
  assert.deepEqual(
    memory.missing("account-a/session-1", key, [
      "sameVariant",
      "sameEquipment",
      "sameLoadConvention",
    ]),
    [],
  );
  assert.deepEqual(
    memory.missing("account-a/session-1", key, [
      "sameVariant",
      "sameEquipment",
      "externalTotal",
    ]),
    ["externalTotal"],
  );
  assert.deepEqual(
    memory.missing("account-a/session-1", other, ["sameVariant"]),
    ["sameVariant"],
  );
  memory.setScope("account-a/session-2");
  assert.deepEqual(
    memory.missing("account-a/session-2", key, ["sameVariant"]),
    ["sameVariant"],
  );
  memory.record("account-a/session-1", key, { sameVariant: true });
  assert.deepEqual(
    memory.missing("account-a/session-2", key, ["sameVariant"]),
    ["sameVariant"],
  );
});
test("claims can be partial, total-load declaration establishes its recording convention, and no key means no reusable claim", () => {
  const memory = createWorkoutComparabilityMemory();
  memory.setScope("a");
  memory.record("a", key, { sameVariant: true });
  assert.deepEqual(memory.missing("a", key, ["sameVariant", "sameEquipment"]), [
    "sameEquipment",
  ]);
  memory.record("a", key, { externalTotal: true });
  assert.deepEqual(memory.missing("a", key, ["sameLoadConvention"]), []);
  memory.record("a", null, { sameEquipment: true });
  assert.deepEqual(memory.missing("a", null, ["sameEquipment"]), [
    "sameEquipment",
  ]);
  memory.setScope(null);
  memory.setScope("a");
  assert.deepEqual(memory.missing("a", key, ["sameVariant"]), ["sameVariant"]);
});
test("the in-memory evidence cache is bounded and never stores payloads or false confirmations", () => {
  const memory = createWorkoutComparabilityMemory(2);
  memory.setScope("a");
  memory.record("a", key, { sameVariant: true });
  memory.record("a", other, { sameEquipment: true });
  memory.record("a", "c".repeat(64), { sameVariant: true });
  assert.deepEqual(memory.missing("a", key, ["sameVariant"]), ["sameVariant"]);
  assert.deepEqual(memory.missing("a", other, ["sameEquipment"]), []);
});
