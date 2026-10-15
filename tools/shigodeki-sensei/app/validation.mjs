import {validatePlanner} from './sheets.mjs?v=4';
import { validDate, monday, yearBounds } from "./model.mjs?v=4";

export function validateState(state) {
  const fail = () => {
    throw new Error("保存データの形式または容量が不正です。");
  };
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const text = (v, n) => typeof v === "string" && v.length <= n;
  if (
    !object(state) ||
    state.schema !== 1 ||
    !Number.isInteger(state.year) ||
    state.year < 2025 ||
    state.year > 2098 ||
    !text(state.owner, 80)
  )
    fail();
  const [start, end] = yearBounds(state);
  const date = (v) => validDate(v) && v >= start && v <= end;
  const week = (v) =>
    validDate(v) && monday(v) === v && v >= monday(start) && v <= monday(end);
  if (!Array.isArray(state.lessons) || state.lessons.length > 100) fail();
  const ids = new Set();
  for (const lesson of state.lessons) {
    if (
      !object(lesson) ||
      !text(lesson.id, 64) ||
      !/^[a-zA-Z0-9-]+$/.test(lesson.id) ||
      ids.has(lesson.id) ||
      !text(lesson.name, 60) ||
      !lesson.name.trim() ||
      !/^#[0-9a-fA-F]{6}$/.test(lesson.color)
    )
      fail();
    ids.add(lesson.id);
  }
  if (
    !Array.isArray(state.templates) ||
    !state.templates.length ||
    state.templates.length > 500
  )
    fail();
  const dates = new Set();
  for (const template of state.templates) {
    if (
      !object(template) ||
      !date(template.from) ||
      dates.has(template.from) ||
      !object(template.grid)
    )
      fail();
    dates.add(template.from);
    for (const [key, id] of Object.entries(template.grid))
      if (!/^[0-6]:[1-6]$/.test(key) || !ids.has(id)) fail();
  }
  if (!Array.isArray(state.breaks) || state.breaks.length > 100) fail();
  for (const b of state.breaks)
    if (
      !object(b) ||
      !text(b.name, 60) ||
      !date(b.start) ||
      !date(b.end) ||
      b.start > b.end
    )
      fail();
  if (!object(state.overrides) || Object.keys(state.overrides).length > 2200)
    fail();
  for (const [key, slot] of Object.entries(state.overrides)) {
    if (
      !/^\d{4}-\d{2}-\d{2}:[1-6]$/.test(key) ||
      !date(key.slice(0, 10)) ||
      !object(slot) ||
      !(slot.lessonId === "" || ids.has(slot.lessonId)) ||
      !["planned", "done", "cancelled", "empty"].includes(slot.status) ||
      (slot.lessonId === ""
        ? slot.status !== "empty"
        : slot.status === "empty") ||
      !text(slot.note, 2000)
    )
      fail();
  }
  if (
    !object(state.notes) ||
    !object(state.ink) ||
    Object.keys(state.notes).length > 54 ||
    Object.keys(state.ink).length > 54
  )
    fail();
  for (const [key, value] of Object.entries(state.notes))
    if (!week(key) || !text(value, 10000)) fail();
  if (state.planner !== undefined) validatePlanner(state.planner,state);
  if (Object.keys(state.ink).some(key => !week(key))) fail();
  let points = 0;
  for (const [key, strokes] of [...Object.entries(state.ink), ...Object.entries(state.planner?.ink || {})]) {
    if (!(week(key) || ['blocks','list','free'].includes(key)) || !Array.isArray(strokes) || strokes.length > 5000) fail();
    for (const stroke of strokes) {
      if (
        !object(stroke) ||
        !["pen", "marker"].includes(stroke.tool) ||
        !/^#[0-9a-fA-F]{6}$/.test(stroke.color) ||
        !Number.isFinite(stroke.width) ||
        stroke.width < 1 ||
        stroke.width > 30 ||
        !Array.isArray(stroke.points) ||
        !stroke.points.length
      )
        fail();
      points += stroke.points.length;
      if (points > 200000) fail();
      for (const p of stroke.points)
        if (
          !Array.isArray(p) ||
          p.length !== 3 ||
          p.some((v) => !Number.isFinite(v)) ||
          p[0] < 0 ||
          p[0] > 1200 ||
          p[1] < 0 ||
          p[1] > 920 ||
          p[2] < 0 ||
          p[2] > 1
        )
          fail();
    }
  }
  return state;
}
