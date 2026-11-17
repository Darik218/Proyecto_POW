import assert from "node:assert/strict";
import { test } from "node:test";
import {
  setInputSchema,
  setRecordSchema,
} from "../src/services/workout-sessions.service.ts";
import { referenceSetSchema } from "../src/schemas/workout-insights.schema.ts";
const base = {
  setNumber: 1,
  status: "COMPLETED",
  kind: "WORK",
  load: "60",
  loadUnit: "KG",
  repetitions: 8,
};
test("RIR accepts open categories and omission independently of RPE", () => {
  for (const rir of ["0", "1", "2", "3", "4_PLUS", null])
    assert.equal(setInputSchema.parse({ ...base, rir }).rir, rir);
  assert.deepEqual(setInputSchema.parse({ ...base, rir: "4_PLUS", rpe: 9 }), {
    ...base,
    rir: "4_PLUS",
    rpe: 9,
  });
  assert.equal(setInputSchema.parse(base).rir, undefined);
  for (const rir of [0, 4, "4", "5", ""])
    assert.equal(setInputSchema.safeParse({ ...base, rir }).success, false);
});
test("pending and skipped sets reject even zero RIR", () => {
  for (const status of ["PENDING", "SKIPPED"]) {
    assert.equal(
      setInputSchema.safeParse({ setNumber: 1, kind: "WORK", status, rir: "0" })
        .success,
      false,
    );
    assert.equal(
      setInputSchema.safeParse({
        setNumber: 1,
        kind: "WORK",
        status,
        rir: null,
      }).success,
      true,
    );
  }
});
test("legacy and new RIR response contracts remain readable in details and references", () => {
  const reference = {
    id: "11111111-1111-4111-8111-111111111111",
    ...base,
    rpe: null,
    isCompleted: true,
  };
  for (const rir of [undefined, null, "4_PLUS"]) {
    const value = { ...reference, ...(rir !== undefined ? { rir } : {}) };
    assert.equal(referenceSetSchema.parse(value).rir, rir);
    assert.equal(
      setRecordSchema.parse({
        ...value,
        loadKg: "60",
        notes: null,
        recordedAt: "2026-01-01T00:00:00Z",
        version: 0,
      }).rir,
      rir,
    );
  }
});
