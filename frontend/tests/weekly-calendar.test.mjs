import assert from "node:assert/strict";
import { test } from "node:test";
import {
  weekDates,
  shiftCivilDate,
  calendarDayState,
} from "../src/utils/weekly-calendar.ts";
test("weekly calendar uses Monday through Sunday civil dates across year and leap boundaries", () => {
  assert.deepEqual(weekDates("2026-11-15"), [
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
  ]);
  assert.equal(weekDates("2027-01-01")[0], "2026-12-28");
  assert.equal(shiftCivilDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftCivilDate("2028-03-01", -1), "2028-02-29");
  assert.throws(() => weekDates("2026-02-30"));
});
test("no calendar record is not an omitted workout or physical inactivity", () => {
  assert.equal(calendarDayState([], []).code, "UNSCHEDULED");
  assert.equal(
    calendarDayState([{ status: "REST", workouts: [] }], []).code,
    "REST",
  );
  assert.equal(
    calendarDayState([{ status: "OMITTED", workouts: [] }], []).code,
    "OMITTED",
  );
  assert.equal(
    calendarDayState([{ status: "PLANNED", workouts: [] }], []).code,
    "PLANNED",
  );
  assert.equal(
    calendarDayState([{ status: "RESCHEDULED", workouts: [] }], []).code,
    "RESCHEDULED",
  );
});
test("calendar exposes actual completed/ongoing records and preserves multiple activities as multiple", () => {
  assert.equal(
    calendarDayState(
      [{ status: "PLANNED", workouts: [{ status: "COMPLETED" }] }],
      [],
    ).code,
    "COMPLETED",
  );
  assert.equal(
    calendarDayState([], [{ status: "IN_PROGRESS" }]).code,
    "IN_PROGRESS",
  );
  assert.equal(
    calendarDayState(
      [
        { status: "REST", workouts: [] },
        { status: "PLANNED", workouts: [] },
      ],
      [],
    ).code,
    "MULTIPLE",
  );
});
