import test from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  counts,
  setSlot,
  slotAt,
  swapSlots,
  saveTemplate,
  holidays,
} from "../tools/shigodeki-sensei/app/model.mjs";
import { validateState } from "../tools/shigodeki-sensei/app/validation.mjs";
function fixture() {
  const s = createState(2026);
  s.lessons = [
    { id: "a", name: "2年3組 国語", color: "#5c7c72" },
    { id: "b", name: "1年1組 国語", color: "#6785ad" },
  ];
  s.templates[0].grid = {
    "0:1": "a",
    "1:1": "a",
    "2:1": "a",
    "3:1": "a",
    "4:1": "b",
  };
  return s;
}
test("weekly periods distinguish classes, exclude cancellations, reflect replacements immediately", () => {
  const s = fixture();
  assert.equal(counts(s, "2026-04-06").a.week, 4);
  assert.equal(counts(s, "2026-04-06").b.week, 1);
  setSlot(s, "2026-04-06", 1, { lessonId: "a", status: "cancelled" });
  setSlot(s, "2026-04-08", 1, { lessonId: "b", status: "planned" });
  assert.equal(counts(s, "2026-04-06").a.week, 2);
  assert.equal(counts(s, "2026-04-06").b.week, 2);
});
test("actual cumulative count requires completion, excludes future completions and future weeks", () => {
  const s = fixture();
  assert.equal(counts(s, "2026-04-06", "2026-04-10").a.done, 0);
  setSlot(s, "2026-04-06", 1, { lessonId: "a", status: "done" });
  setSlot(s, "2026-04-07", 1, { lessonId: "a", status: "done" });
  setSlot(s, "2026-04-13", 1, { lessonId: "a", status: "done" });
  assert.equal(counts(s, "2026-04-06", "2026-04-06").a.done, 1);
  assert.equal(counts(s, "2026-04-06", "2026-04-20").a.done, 2);
  assert.equal(counts(s, "2026-04-13", "2026-04-20").a.done, 3);
});
test("cross-week swaps update both weeks without moving handwritten notes", () => {
  const s = fixture();
  s.notes["2026-04-06"] = "元の週のメモ";
  swapSlots(
    s,
    { date: "2026-04-06", period: 1 },
    { date: "2026-04-14", period: 2 },
  );
  assert.equal(counts(s, "2026-04-06").a.week, 3);
  assert.equal(counts(s, "2026-04-13").a.week, 5);
  assert.equal(s.notes["2026-04-06"], "元の週のメモ");
  setSlot(s, "2026-04-14", 2, { lessonId: "a", status: "done" });
  assert.throws(
    () =>
      swapSlots(
        s,
        { date: "2026-04-14", period: 2 },
        { date: "2026-04-15", period: 1 },
      ),
    /実施済み/,
  );
});
test("dated basic timetable revisions preserve history and individual exceptions", () => {
  const s = fixture();
  setSlot(s, "2026-04-15", 1, {
    lessonId: "a",
    status: "planned",
    note: "個別変更",
  });
  saveTemplate(s, "2026-04-13", { "0:1": "b", "2:1": "b" });
  assert.equal(slotAt(s, "2026-04-06", 1).lessonId, "a");
  assert.equal(slotAt(s, "2026-04-13", 1).lessonId, "b");
  assert.equal(slotAt(s, "2026-04-15", 1).lessonId, "a");
});
test("holidays, substitute holidays, school breaks and explicit holiday lessons", () => {
  const s = fixture();
  assert.equal(holidays(2026).get("2026-05-06"), "振替休日");
  assert.equal(holidays(2026).get("2026-09-22"), "国民の休日");
  assert.equal(counts(s, "2026-05-04").a.week, 1);
  s.breaks.push({ name: "休業", start: "2026-04-06", end: "2026-04-10" });
  assert.equal(counts(s, "2026-04-06").a.week, 0);
  setSlot(s, "2026-04-06", 1, { lessonId: "a", status: "planned" });
  assert.equal(counts(s, "2026-04-06").a.week, 1);
});
test("school-year and leap-day boundaries do not count adjacent years", () => {
  const s = fixture();
  assert.equal(slotAt(s, "2026-03-31", 1).outside, true);
  assert.equal(slotAt(s, "2027-04-01", 1).outside, true);
  s.year = 2027;
  s.templates = [{ from: "2027-04-01", grid: { "1:1": "a" } }];
  assert.equal(slotAt(s, "2028-02-29", 1).lessonId, "a");
});
test("validation rejects invalid dates, missing lesson references, malformed ink and oversized notes", () => {
  const s = fixture();
  assert.equal(validateState(s), s);
  for (const mutate of [
    (s) => (s.templates[0].from = "2026-02-30"),
    (s) => (s.templates[0].grid["0:1"] = "unknown"),
    (s) => (s.notes["2026-04-06"] = "x".repeat(10001)),
    (s) =>
      (s.ink["2026-04-06"] = [
        { tool: "pen", color: "#000000", width: 2, points: [[Infinity, 0, 1]] },
      ]),
    (s) =>
      (s.overrides["2026-04-06:1"] = {
        lessonId: "",
        status: "done",
        note: "",
      }),
  ]) {
    const bad = structuredClone(s);
    mutate(bad);
    assert.throws(() => validateState(bad));
  }
});
