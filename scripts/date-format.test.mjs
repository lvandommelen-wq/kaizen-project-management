import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCalendarDate,
  formatTimestamp,
} from "../src/lib/date-format.ts";

test("calendar dates support date-only and full ISO values", () => {
  assert.equal(formatCalendarDate("2026-10-22"), "Oct 22, 2026");
  assert.equal(
    formatCalendarDate("2026-10-22T21:16:53.712Z"),
    "Oct 22, 2026",
  );
  assert.equal(
    formatCalendarDate("2026-10-23T00:30:00+02:00"),
    "Oct 22, 2026",
  );
});

test("date formatting safely handles missing and malformed historical values", () => {
  for (const value of [null, undefined, "", "   ", "legacy-date", "2026-02-30"]) {
    assert.equal(formatCalendarDate(value), "Not set");
    assert.equal(formatTimestamp(value), "Not set");
  }
});

test("timestamps retain time and use UTC", () => {
  assert.equal(
    formatTimestamp("2026-10-22T21:16:53.712Z"),
    "Oct 22, 2026, 9:16 PM",
  );
  assert.equal(formatTimestamp("2026-10-22"), "Oct 22, 2026, 12:00 AM");
});
