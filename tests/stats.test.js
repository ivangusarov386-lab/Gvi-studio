import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, day, validDay } from "../server/stats.js";
import { demoSource } from "../server/demo.js";
const source = (results = [], registrations = []) => ({
  results,
  registrations,
  timeZone: "Europe/Moscow",
  levelMeaning: "Test",
});
const result = (o = {}) => ({
  id: "attempt-a",
  participant: "person-a",
  resultAt: "2026-11-12T10:00:00Z",
  status: "passed",
  level: "gold",
  ...o,
});
test("synthetic totals distinguish registrations, people, attempts, unknown values", () => {
  const s = aggregate(demoSource);
  assert.equal(s.registrations.total, 5);
  assert.equal(s.registrations.uniqueParticipants, 4);
  assert.equal(s.quality.registrationDuplicates, 1);
  assert.equal(s.quality.invalidRegistrations, 1);
  assert.equal(s.results.uniqueParticipants, 5);
  assert.equal(s.results.passed, 3);
  assert.deepEqual(s.results.levels, {
    gold: 1,
    silver: 0,
    bronze: 1,
    unknown: 3,
  });
  assert.equal(s.results.unknownStatus, 1);
  assert.equal(s.results.notPassed, 1);
});
test("registration date is converted to source timezone, event date remains separate", () => {
  assert.equal(day("2026-11-01T21:10:00Z", "Europe/Moscow"), "2026-11-02");
  const s = aggregate(demoSource, {
    from: "2026-11-02",
    to: "2026-11-02",
    eventDate: "2026-11-20",
  });
  assert.equal(s.registrations.period, 1);
  assert.equal(s.registrations.event, 1);
  assert.equal(s.results.uniqueParticipants, 0);
  assert.equal(
    aggregate(demoSource, { eventDate: "2026-11-21" }).registrations.event,
    2,
  );
});
test("duplicates and conflicting IDs are excluded without double-counting", () => {
  const a = result();
  let s = aggregate(source([a, { ...a }]));
  assert.equal(s.results.uniqueParticipants, 1);
  assert.equal(s.quality.resultDuplicates, 1);
  s = aggregate(source([a, { ...a, level: "silver" }]));
  assert.equal(s.results.uniqueParticipants, 0);
  assert.equal(s.quality.resultConflicts, 1);
});
test("latest attempt is chosen within inclusive period, equal-time conflicting attempts unknown", () => {
  const a = result(),
    b = result({
      id: "attempt-b",
      resultAt: "2026-11-13T10:00:00Z",
      level: "silver",
    });
  assert.equal(aggregate(source([a, b])).results.levels.silver, 1);
  assert.equal(
    aggregate(source([a, b]), { to: "2026-11-12" }).results.levels.gold,
    1,
  );
  const s = aggregate(source([a, { ...b, resultAt: a.resultAt }]));
  assert.equal(s.results.passed, 0);
  assert.equal(s.results.unknownStatus, 1);
});
test("unknowns and contradictions are never silently classified as failed", () => {
  for (const status of ["", "pending", "other"]) {
    const s = aggregate(source([result({ status, level: "" })]));
    assert.equal(s.results.notPassed, 0);
    assert.equal(s.results.unknownStatus, 1);
  }
  const s = aggregate(source([result({ status: "not-passed" })]));
  assert.equal(s.results.conflictingResults, 1);
  assert.equal(s.results.notPassed, 0);
});
test("invalid date, blank identity, reversed period and invalid day are rejected", () => {
  assert.equal(validDay("2026-02-30"), false);
  assert.equal(day("12/11/2026", "UTC"), null);
  assert.equal(
    aggregate(
      source([
        result({ participant: "" }),
        result({ id: "b", resultAt: "bad" }),
      ]),
    ).quality.invalidResults,
    2,
  );
  assert.throws(() =>
    aggregate(demoSource, { from: "2026-11-20", to: "2026-11-01" }),
  );
  assert.throws(() => aggregate(demoSource, { to: "2026-02-30" }));
});
test("empty/category filters and end-of-day timezone boundary", () => {
  assert.equal(
    aggregate(demoSource, { category: "Missing" }).registrations.total,
    0,
  );
  assert.equal(aggregate(source()).results.uniqueParticipants, 0);
  const s = aggregate(source([result({ resultAt: "2026-11-12T21:00:00Z" })]), {
    to: "2026-11-12",
  });
  assert.equal(s.results.uniqueParticipants, 0);
});
