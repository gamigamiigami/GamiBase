export const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
export const COLORS = [
  "#5c7c72",
  "#6785ad",
  "#b98365",
  "#927da3",
  "#b49c50",
  "#bb7782",
];
export const dateOf = (value) => new Date(`${value}T00:00:00Z`);
export const iso = (date) => date.toISOString().slice(0, 10);
export const addDays = (value, count) =>
  iso(new Date(dateOf(value).getTime() + count * 86400000));
export const weekday = (value) => (dateOf(value).getUTCDay() + 6) % 7;
export const monday = (value) => addDays(value, -weekday(value));
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
export const schoolYearOf = (value) =>
  Number(value.slice(0, 4)) - (Number(value.slice(5, 7)) < 4 ? 1 : 0);
export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(dateOf(value).getTime()) &&
    iso(dateOf(value)) === value
  );
}

// Supported school years are 2025–2098 (equinox approximation valid through 2099).
const holidaysCache = new Map();
export function holidays(year) {
  if (holidaysCache.has(year)) return holidaysCache.get(year);
  const result = new Map();
  const put = (m, d, label) =>
    result.set(
      `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      label,
    );
  const nthMonday = (m, n) =>
    1 +
    ((8 - dateOf(`${year}-${String(m).padStart(2, "0")}-01`).getUTCDay()) % 7) +
    7 * (n - 1);
  [
    [1, 1, "元日"],
    [2, 11, "建国記念の日"],
    [2, 23, "天皇誕生日"],
    [4, 29, "昭和の日"],
    [5, 3, "憲法記念日"],
    [5, 4, "みどりの日"],
    [5, 5, "こどもの日"],
    [8, 11, "山の日"],
    [11, 3, "文化の日"],
    [11, 23, "勤労感謝の日"],
  ].forEach((args) => put(...args));
  [
    [1, 2, "成人の日"],
    [7, 3, "海の日"],
    [9, 3, "敬老の日"],
    [10, 2, "スポーツの日"],
  ].forEach(([m, n, label]) => put(m, nthMonday(m, n), label));
  put(
    3,
    Math.floor(
      20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
    ),
    "春分の日",
  );
  put(
    9,
    Math.floor(
      23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
    ),
    "秋分の日",
  );
  const base = [...result.keys()].sort();
  for (const day of base) {
    const gap = addDays(day, 1);
    if (result.has(addDays(day, 2)) && !result.has(gap) && weekday(gap) !== 6)
      result.set(gap, "国民の休日");
  }
  for (const day of base) {
    if (weekday(day) !== 6) continue;
    let substitute = addDays(day, 1);
    while (result.has(substitute)) substitute = addDays(substitute, 1);
    result.set(substitute, "振替休日");
  }
  holidaysCache.set(year, result);
  return result;
}

export function createState(year = schoolYearOf(today())) {
  return {
    schema: 1,
    year,
    owner: "",
    lessons: [],
    templates: [{ from: `${year}-04-01`, grid: {} }],
    breaks: [],
    overrides: {},
    notes: {},
    ink: {},
  };
}
export function yearBounds(state) {
  return [`${state.year}-04-01`, `${state.year + 1}-03-31`];
}
export function inYear(state, date) {
  const [first, last] = yearBounds(state);
  return date >= first && date <= last;
}
export function closedReason(state, date) {
  return (
    holidays(Number(date.slice(0, 4))).get(date) ||
    state.breaks.find((b) => date >= b.start && date <= b.end)?.name ||
    ""
  );
}
export function templateFor(state, date) {
  return (
    [...state.templates]
      .sort((a, b) => a.from.localeCompare(b.from))
      .filter((t) => t.from <= date)
      .at(-1)?.grid || {}
  );
}
export function slotKey(date, period) {
  return `${date}:${period}`;
}
export function slotAt(state, date, period) {
  if (!inYear(state, date))
    return { lessonId: "", status: "empty", note: "", outside: true };
  const override = state.overrides[slotKey(date, period)];
  if (override) return { ...override, ...(override.status === 'cancelled' ? {lessonId:'',status:'empty'} : {}), changed: true };
  const lessonId = closedReason(state, date)
    ? ""
    : templateFor(state, date)[`${weekday(date)}:${period}`] || "";
  return {
    lessonId,
    status: lessonId ? "planned" : "empty",
    note: "",
    changed: false,
  };
}
export function setSlot(state, date, period, entry) {
  if (!inYear(state, date)) throw new Error("年度内の日付を選んでください。");
  if (entry.lessonId && !state.lessons.some((l) => l.id === entry.lessonId))
    throw new Error("授業が見つかりません。");
  state.overrides[slotKey(date, period)] = {
    lessonId: entry.lessonId || "",
    status: entry.lessonId ? entry.status : "empty",
    note: entry.note || "",
    ...(!entry.lessonId && entry.customText?.trim() ? {customText:entry.customText.trim(), textColor:entry.textColor || '#263238'} : {}),
  };
}
export function swapSlots(state, from, to) {
  const a = slotAt(state, from.date, from.period),
    b = slotAt(state, to.date, to.period);
  if (a.outside || b.outside) throw new Error("年度内のコマを選んでください。");
  setSlot(state, to.date, to.period, a);
  setSlot(state, from.date, from.period, b);
}
export function saveTemplate(state, from, grid) {
  if (!inYear(state, from))
    throw new Error("適用開始日は年度内にしてください。");
  state.templates = state.templates
    .filter((t) => t.from !== from)
    .concat({ from, grid: { ...grid } })
    .sort((a, b) => a.from.localeCompare(b.from));
}
export function counts(state, week, asOf = today()) {
  const [first, last] = yearBounds(state),
    endOfWeek = addDays(week, 6), realWeekEnd = addDays(monday(asOf), 6);
  const result = Object.fromEntries(
    state.lessons.map((l) => [l.id, { week: 0, done: 0, plannedToWeek: 0, throughCurrentWeek: 0 }]),
  );
  for (let date = first; date <= last; date = addDays(date, 1)) {
    for (let period = 1; period <= 6; period++) {
      const slot = slotAt(state, date, period),
        row = result[slot.lessonId];
      if (!row || slot.status === "cancelled" || slot.status === "empty")
        continue;
      if (date >= week && date <= endOfWeek) row.week++;
      if (date <= endOfWeek) row.plannedToWeek++;
      if (date <= realWeekEnd) row.throughCurrentWeek++;
      if (slot.status === "done" && date <= asOf && date <= endOfWeek)
        row.done++;
    }
  }
  return result;
}
