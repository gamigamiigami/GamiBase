import {
  DAYS,
  COLORS,
  today,
  schoolYearOf,
  createState,
  addDays,
  monday,
  weekday,
  validDate,
  yearBounds,
  inYear,
  closedReason,
  slotAt,
  slotKey,
  setSlot,
  swapSlots,
  saveTemplate,
  templateFor,
  counts,
} from "./model.mjs";
import { Ink } from "./ink.mjs";
import { draft } from "./storage.mjs";
import { validateState } from "./validation.mjs";
const $ = (id) => document.getElementById(id);
let localAvailable = true;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const formatDate = (value) =>
  `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
let user,
  state,
  revision = 0,
  week,
  dirty = false,
  generation = 0,
  syncing = false,
  saveTimer,
  localQueue = Promise.resolve(),
  redeeming = false,
  slotSelection,
  settingsState,
  pendingRecovery,
  conflict = false,
  locked = true;
const ink = new Ink($("ink-canvas"), {
  onChange: (strokes) => {
    if (state && !locked) {
      state.ink[week] = strokes;
      changed();
    }
  },
  onHistory: (undo, redo) => {
    $("undo").disabled = !undo;
    $("redo").disabled = !redo;
  },
  pencilOnly: () => $("pencil-only").checked,
});
async function api(route, { method = "GET", data } = {}) {
  let response;
  try {
    response = await fetch(`/api/shigodeki/${route}`, {
      method,
      credentials: "same-origin",
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store",
    });
  } catch {
    throw Object.assign(
      new Error("接続できません。インターネット接続を確認してください。"),
      { status: 0 },
    );
  }
  if (
    !(response.headers.get("Content-Type") || "").includes("application/json")
  )
    throw Object.assign(
      new Error(
        "この公開先ではアプリを利用できません。販売者から案内されたアプリのURLを開いてください。",
      ),
      { status: 503 },
    );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "操作を完了できませんでした。"),
      { status: response.status },
    );
  return result;
}
function notice(message = "") {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
function status(message, warning = false) {
  $("save-status").textContent = message;
  $("save-status").classList.toggle("warning", warning);
  $("retry-save").hidden = !warning;
}
function persist() {
  const snapshot = {
      revision,
      state: structuredClone(state),
      dirty,
      updatedAt: Date.now(),
    },
    id = user.id;
  localQueue = localQueue
    .catch(() => {})
    .then(() => draft("put", id, snapshot))
    .then(
      () => {
        localAvailable = true;
      },
      (error) => {
        localAvailable = false;
        throw error;
      },
    );
  return localQueue;
}
function changed() {
  if (locked || conflict) return;
  dirty = true;
  generation++;
  status("保存しています…");
  persist().catch(() =>
    notice(
      "端末への一時保存に失敗しました。接続を維持して保存を完了するか、バックアップを書き出してください。",
    ),
  );
  clearTimeout(saveTimer);
  saveTimer = setTimeout(sync, 650);
}
async function sync() {
  if (!user || !dirty || syncing || locked || conflict) return;
  syncing = true;
  try {
    while (dirty) {
      const version = generation;
      const result = await api("state", {
        method: "PUT",
        data: { revision, state: structuredClone(state) },
      });
      revision = result.revision;
      dirty = version !== generation;
      await persist().catch(() => {});
    }
    status("保存済み");
    notice(
      localAvailable
        ? ""
        : "サーバーには保存済みですが、端末に一時保存できません。接続を維持して使用してください。",
    );
  } catch (error) {
    await localQueue.catch(() => {});
    status("未同期の変更あり", true);
    if (error.status === 401) lock(error.message);
    else if (error.status === 409) {
      conflict = true;
      notice(
        `${error.message} バックアップは左下から書き出せます。再ログインすると復旧画面を開けます。`,
      );
      disableNotebook(true);
    } else
      notice(
        `${error.message} ${localAvailable ? "変更は端末に一時保存されています。" : "端末にも保存できません。バックアップを書き出してください。"} ページを閉じる前に保存状態を確認してください。`,
      );
  } finally {
    syncing = false;
  }
}
function lock(message) {
  locked = true;
  clearTimeout(saveTimer);
  ink.setMode("edit");
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("app-view").hidden = true;
  $("auth-view").hidden = false;
  $("auth-error").textContent = message || "";
  $("password").value = "";
  $("license-code").value = "";
}
function disableNotebook(disabled) {
  for (const selector of [".planner-card", ".counts-section", ".reflection"])
    document.querySelector(selector).inert = disabled;
  $("settings-open").disabled = disabled;
  $("restore").disabled = disabled;
}
async function enter(result) {
  user = result.user;
  locked = true;
  conflict = false;
  const remote = await api("state");
  let local;
  try {
    local = await draft("get", user.id);
  } catch {
    notice(
      "この端末では一時保存を利用できません。接続を切らずに使用してください。",
    );
  }
  state = remote.state;
  revision = remote.revision;
  dirty = false;
  generation = 0;
  pendingRecovery = null;
  $("recovery").hidden = true;
  disableNotebook(false);
  if (local?.dirty && local.state?.schema === 1) {
    if (local.revision === remote.revision) {
      state = local.state;
      dirty = true;
    } else {
      pendingRecovery = local;
      $("recovery").hidden = false;
      disableNotebook(true);
    }
  }
  const [first, last] = yearBounds(state),
    current = today();
  week = monday(current < first ? first : current > last ? last : current);
  $("account-email").textContent = user.email;
  $("auth-view").hidden = true;
  $("app-view").hidden = false;
  $("password").value = "";
  $("license-code").value = "";
  locked = !!pendingRecovery;
  render();
  resizePaper();
  if (pendingRecovery) status("未同期の変更を確認してください", true);
  else if (dirty) {
    notice("この端末の未同期の変更を復元しました。");
    await sync();
  } else {
    status("保存済み");
    await persist().catch(() => {});
  }
  if (!pendingRecovery && !state.lessons.length) openSettings();
}

$("auth-toggle").addEventListener("click", () => {
  redeeming = !redeeming;
  $("code-label").hidden = !redeeming;
  $("license-code").required = redeeming;
  $("password").autocomplete = redeeming ? "new-password" : "current-password";
  $("auth-title").textContent = redeeming
    ? "あなたの一冊を、ここから。"
    : "おかえりなさい。";
  $("auth-description").textContent = redeeming
    ? "購入時のメールアドレスと利用コードで登録・再設定します。"
    : "あなたのノートを開きましょう。";
  $("auth-submit").textContent = redeeming
    ? "利用コードで登録・再設定"
    : "ノートを開く →";
  $("auth-toggle").textContent = redeeming
    ? "登録済みの方はこちら"
    : "はじめての方・利用コードをお持ちの方";
  $("auth-error").textContent = "";
});
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("auth-submit").disabled = true;
  $("auth-error").textContent = "";
  try {
    const result = await api(redeeming ? "redeem" : "login", {
      method: "POST",
      data: {
        email: $("email").value,
        password: $("password").value,
        ...(redeeming ? { code: $("license-code").value } : {}),
      },
    });
    await enter(result);
  } catch (error) {
    $("auth-error").textContent = error.message;
  } finally {
    $("auth-submit").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  ink.finish();
  await sync();
  if (dirty || pendingRecovery) {
    notice(
      "未同期の変更があります。先に接続して保存を完了してください。競合している場合はバックアップを書き出し、再読込して復旧してください。",
    );
    return;
  }
  try {
    await api("logout", { method: "POST", data: {} });
    let cleanupMessage = "";
    await draft("delete", user.id).catch(() => {
      cleanupMessage =
        "ログアウトしましたが、端末の一時保存を削除できませんでした。共有端末ではブラウザのサイトデータも削除してください。";
    });
    state = null;
    user = null;
    lock(cleanupMessage);
  } catch (error) {
    notice(error.message);
  }
});
$("retry-save").addEventListener("click", () => {
  if (conflict) location.reload();
  else reconnect();
});
async function reconnect() {
  if (!user || locked || conflict) return;
  try {
    await api("session");
    if (dirty) await sync();
    else status("保存済み");
  } catch (error) {
    if (error.status === 401) lock(error.message);
    else notice(error.message);
  }
}
$("recovery-download").addEventListener("click", () =>
  download(pendingRecovery.state, "未同期バックアップ"),
);
$("recovery-server").addEventListener("click", async () => {
  if (
    !confirm(
      "端末の未同期データは上書きされます。必要なバックアップを書き出しましたか？",
    )
  )
    return;
  pendingRecovery = null;
  locked = false;
  $("recovery").hidden = true;
  disableNotebook(false);
  await persist().catch(() => {});
  status("保存済み");
  if (!state.lessons.length) openSettings();
});

function render() {
  $("owner-label").textContent = state.owner || "わたしの週案";
  $("school-year").textContent = `${state.year}年度`;
  const end = addDays(week, 6);
  $("week-label").textContent = `${formatDate(week)} — ${formatDate(end)}`;
  $("week-subtitle").textContent =
    `${week.slice(0, 4)} / ${Math.floor((Date.parse(week) - Date.parse(monday(`${state.year}-04-01`))) / 604800000) + 1}週目`;
  const [first, last] = yearBounds(state);
  $("jump-date").min = first;
  $("jump-date").max = last;
  $("jump-date").value = week < first ? first : week;
  $("prev-week").disabled = week <= monday(first);
  $("next-week").disabled = week >= monday(last);
  renderGrid();
  renderCounts();
  $("week-note").value = state.notes[week] || "";
  ink.set(state.ink[week] || []);
}
function renderGrid() {
  let html = '<div class="corner" aria-hidden="true"></div>';
  for (let day = 0; day < 7; day++) {
    const date = addDays(week, day),
      reason = closedReason(state, date),
      allowed = inYear(state, date) && date <= today();
    html += `<div class="day-head ${day > 4 ? "weekend" : ""} ${date === today() ? "is-today" : ""}"><strong>${formatDate(date)} <small>${DAYS[day]}</small></strong><small>${escape(reason || (date === today() ? "TODAY" : ""))}</small>${allowed ? `<button class="day-complete" data-complete="${date}" aria-label="${formatDate(date)}の授業を実施済みにする">✓ 実施</button>` : ""}</div>`;
  }
  for (let period = 1; period <= 6; period++) {
    html += `<div class="period-label">${period}</div>`;
    for (let day = 0; day < 7; day++) {
      const date = addDays(week, day),
        slot = slotAt(state, date, period),
        lesson = state.lessons.find((l) => l.id === slot.lessonId);
      const label = lesson?.name || "空き時間",
        statusLabel = {
          planned: "予定",
          done: "✓ 実施済み",
          cancelled: "休講",
          empty: "",
        }[slot.status];
      html += `<button class="lesson-cell ${slot.status} ${slot.outside ? "outside" : ""} ${closedReason(state, date) ? "closed" : ""}" data-date="${date}" data-period="${period}" ${slot.outside ? "disabled" : ""} aria-label="${formatDate(date)} ${DAYS[day]}曜${period}限 ${escape(label)} ${statusLabel}">${lesson ? `<span class="lesson-tag" style="--lesson-color:${escape(lesson.color)}">${escape(lesson.name)}</span>` : ""}${slot.note ? `<span class="lesson-note">${escape(slot.note)}</span>` : ""}<span class="cell-status">${statusLabel}</span>${slot.changed ? '<span class="change-marker">変更</span>' : ""}</button>`;
    }
  }
  $("week-grid").innerHTML = html;
}
function renderCounts() {
  const rows = counts(state, week),
    limit = [today(), addDays(week, 6)].sort()[0];
  $("count-explanation").textContent =
    `累計は年度初めから${formatDate(limit)}までに「実施済み」にした授業です。過去の予定が自動で実施済みになることはありません。`;
  $("counts-list").innerHTML = state.lessons.length
    ? state.lessons
        .map(
          (lesson) =>
            `<article class="count-card" data-lesson-id="${escape(lesson.id)}"><h3><span class="lesson-dot" style="--lesson-color:${escape(lesson.color)}"></span>${escape(lesson.name)}</h3><div class="count-values"><div><strong data-count="week">${rows[lesson.id].week}<small>時間</small></strong><label>この週の予定</label></div><div><strong data-count="done">${rows[lesson.id].done}<small>時間</small></strong><label>累計・実施済み</label></div></div><p>この週までの予定累計 ${rows[lesson.id].plannedToWeek} 時間</p></article>`,
        )
        .join("")
    : '<div class="empty-state">最初に「基本設定」から担当する授業と時間割を登録しましょう。</div>';
}
function switchWeek(value) {
  if (!validDate(value)) return;
  const [first, last] = yearBounds(state);
  if (monday(value) < monday(first) || monday(value) > monday(last)) return;
  ink.finish();
  week = monday(value);
  render();
}
$("prev-week").onclick = () => switchWeek(addDays(week, -7));
$("next-week").onclick = () => switchWeek(addDays(week, 7));
$("today-button").onclick = () => {
  const [first, last] = yearBounds(state),
    now = today();
  switchWeek(now < first ? first : now > last ? last : now);
};
$("jump-date").onchange = () => switchWeek($("jump-date").value);
$("week-grid").addEventListener("click", (event) => {
  if (locked || conflict) return;
  const complete = event.target.closest("[data-complete]");
  if (complete) {
    const date = complete.dataset.complete;
    if (!confirm(`${formatDate(date)}の予定授業をすべて実施済みにしますか？`))
      return;
    for (let p = 1; p <= 6; p++) {
      const slot = slotAt(state, date, p);
      if (slot.status === "planned")
        setSlot(state, date, p, { ...slot, status: "done" });
    }
    changed();
    renderGrid();
    renderCounts();
    return;
  }
  const button = event.target.closest("[data-date]");
  if (!button) return;
  slotSelection = {
    date: button.dataset.date,
    period: Number(button.dataset.period),
  };
  const slot = slotAt(state, slotSelection.date, slotSelection.period);
  $("slot-title").textContent =
    `${formatDate(slotSelection.date)}（${DAYS[weekday(slotSelection.date)]}）${slotSelection.period}限`;
  $("slot-day-note").textContent = closedReason(state, slotSelection.date)
    ? `${closedReason(state, slotSelection.date)}です。授業を指定すると、このコマだけ実施日に変更します。`
    : "この日のコマだけを変更します。";
  $("slot-lesson").innerHTML = options(state.lessons, slot.lessonId);
  $("slot-status").value = slot.status === "empty" ? "planned" : slot.status;
  $("slot-note").value = slot.note || "";
  $("slot-status").querySelector("[value=done]").disabled =
    slotSelection.date > today();
  const [first, last] = yearBounds(state);
  $("swap-date").min = first;
  $("swap-date").max = last;
  $("swap-date").value = slotSelection.date;
  $("swap-period").value = String(slotSelection.period);
  $("slot-error").textContent = "";
  $("slot-dialog").showModal();
});
function options(lessons, selected = "") {
  return (
    '<option value="">空き時間</option>' +
    lessons
      .map(
        (l) =>
          `<option value="${escape(l.id)}" ${l.id === selected ? "selected" : ""}>${escape(l.name)}</option>`,
      )
      .join("")
  );
}
$("slot-form").onsubmit = (event) => {
  event.preventDefault();
  if ($("slot-status").value === "done" && slotSelection.date > today()) {
    $("slot-error").textContent = "未来の授業は実施済みにできません。";
    return;
  }
  setSlot(state, slotSelection.date, slotSelection.period, {
    lessonId: $("slot-lesson").value,
    status: $("slot-status").value,
    note: $("slot-note").value,
  });
  changed();
  renderGrid();
  renderCounts();
  $("slot-dialog").close();
};
$("slot-reset").onclick = () => {
  delete state.overrides[slotKey(slotSelection.date, slotSelection.period)];
  changed();
  renderGrid();
  renderCounts();
  $("slot-dialog").close();
};
$("swap-button").onclick = () => {
  try {
    if (!validDate($("swap-date").value))
      throw new Error("振替先の日付を指定してください。");
    swapSlots(state, slotSelection, {
      date: $("swap-date").value,
      period: Number($("swap-period").value),
    });
    changed();
    renderGrid();
    renderCounts();
    $("slot-dialog").close();
  } catch (error) {
    $("slot-error").textContent = error.message;
  }
};
$("week-note").oninput = () => {
  if (!locked && !conflict) {
    state.notes[week] = $("week-note").value;
    changed();
  }
};

function openSettings() {
  if (locked || conflict) return;
  ink.finish();
  settingsState = structuredClone(state);
  $("owner").value = state.owner;
  $("year").value = state.year;
  $("year").disabled =
    state.lessons.length > 0 ||
    Object.keys(state.ink).length > 0 ||
    Object.keys(state.notes).length > 0;
  $("year-hint").textContent = $("year").disabled
    ? "記録を守るため、使用開始後の年度変更はできません。このノートは1年度分です。"
    : "最初に使用する年度を選んでください。";
  const [first, last] = yearBounds(state);
  $("template-from").min = first;
  $("template-from").max = last;
  $("template-from").value = state.lessons.length
    ? week < first
      ? first
      : week
    : first;
  renderLessonSettings();
  renderTemplate();
  renderBreaks();
  $("settings-error").textContent = "";
  $("settings-dialog").showModal();
}
$("settings-open").onclick = openSettings;
function renderLessonSettings() {
  $("lesson-settings").innerHTML = settingsState.lessons
    .map(
      (l, i) =>
        `<div class="lesson-setting"><input type="color" data-lesson-color="${i}" value="${escape(l.color)}" aria-label="授業${i + 1}の色"><input data-lesson-name="${i}" value="${escape(l.name)}" maxlength="60" required placeholder="例：2年3組 国語" aria-label="授業${i + 1}の名前"></div>`,
    )
    .join("");
}
$("add-lesson").onclick = () => {
  if (settingsState.lessons.length >= 100) {
    $("settings-error").textContent = "授業は100件まで登録できます。";
    return;
  }
  settingsState.lessons.push({
    id: crypto.randomUUID(),
    name: "",
    color: COLORS[settingsState.lessons.length % COLORS.length],
  });
  renderLessonSettings();
  updateTemplateOptions();
  $("lesson-settings")
    .lastElementChild.querySelector("input[type=text],input:not([type])")
    ?.focus();
};
$("lesson-settings").oninput = (event) => {
  const input = event.target;
  if (input.dataset.lessonName !== undefined) {
    settingsState.lessons[Number(input.dataset.lessonName)].name = input.value;
    updateTemplateOptions();
  }
  if (input.dataset.lessonColor !== undefined)
    settingsState.lessons[Number(input.dataset.lessonColor)].color =
      input.value;
};
function renderTemplate() {
  const grid = templateFor(settingsState, $("template-from").value);
  let html =
    "<thead><tr><th>時限</th>" +
    DAYS.map((d) => `<th>${d}</th>`).join("") +
    "</tr></thead><tbody>";
  for (let p = 1; p <= 6; p++)
    html +=
      `<tr><th>${p}</th>` +
      DAYS.map(
        (d, i) =>
          `<td><select data-template="${i}:${p}" aria-label="基本時間割 ${d}曜${p}限">${options(settingsState.lessons, grid[`${i}:${p}`])}</select></td>`,
      ).join("") +
      "</tr>";
  $("template-table").innerHTML = html + "</tbody>";
}
function updateTemplateOptions() {
  document.querySelectorAll("[data-template]").forEach((select) => {
    const value = select.value;
    select.innerHTML = options(settingsState.lessons, value);
  });
}
$("template-from").onchange = renderTemplate;
$("year").onchange = () => {
  const year = Number($("year").value);
  if (!Number.isInteger(year) || year < 2025 || year > 2098) return;
  settingsState = {
    ...createState(year),
    owner: settingsState.owner,
    lessons: settingsState.lessons,
  };
  const [first, last] = yearBounds(settingsState);
  $("template-from").min = first;
  $("template-from").max = last;
  $("template-from").value = first;
  renderTemplate();
  renderBreaks();
};
function renderBreaks() {
  $("break-settings").innerHTML = settingsState.breaks
    .map(
      (b, i) =>
        `<div class="break-setting"><label>休業名<input data-break="${i}" data-field="name" value="${escape(b.name)}" maxlength="60" required></label><label>開始<input data-break="${i}" data-field="start" type="date" value="${b.start}" min="${settingsState.year}-04-01" max="${settingsState.year + 1}-03-31" required></label><label>終了<input data-break="${i}" data-field="end" type="date" value="${b.end}" min="${settingsState.year}-04-01" max="${settingsState.year + 1}-03-31" required></label><button type="button" class="square" data-remove-break="${i}" aria-label="休業期間を削除">×</button></div>`,
    )
    .join("");
}
$("break-settings").oninput = (event) => {
  if (event.target.dataset.break !== undefined)
    settingsState.breaks[Number(event.target.dataset.break)][
      event.target.dataset.field
    ] = event.target.value;
};
$("break-settings").onclick = (event) => {
  const button = event.target.closest("[data-remove-break]");
  if (button) {
    settingsState.breaks.splice(Number(button.dataset.removeBreak), 1);
    renderBreaks();
  }
};
$("add-break").onclick = () => {
  if (settingsState.breaks.length >= 100) return;
  settingsState.breaks.push({
    name: "休業",
    start: `${settingsState.year}-07-21`,
    end: `${settingsState.year}-08-31`,
  });
  renderBreaks();
};
$("settings-form").onsubmit = (event) => {
  event.preventDefault();
  try {
    if (
      !settingsState.lessons.length ||
      settingsState.lessons.some((l) => !l.name.trim())
    )
      throw new Error("授業名を1件以上入力してください。");
    if (
      new Set(settingsState.lessons.map((l) => l.name.trim())).size !==
      settingsState.lessons.length
    )
      throw new Error(
        "同じ名前の授業があります。クラス名などで区別してください。",
      );
    if (settingsState.breaks.some((b) => b.start > b.end))
      throw new Error("休業の終了日は開始日以降にしてください。");
    const grid = {};
    document.querySelectorAll("[data-template]").forEach((select) => {
      if (select.value) grid[select.dataset.template] = select.value;
    });
    saveTemplate(settingsState, $("template-from").value, grid);
    settingsState.owner = $("owner").value.trim();
    settingsState.lessons.forEach((l) => (l.name = l.name.trim()));
    // A settings dialog is a draft. No app data changes until this point.
    state = settingsState;
    const [first, last] = yearBounds(state);
    if (week < monday(first) || week > monday(last)) week = monday(first);
    changed();
    render();
    $("settings-dialog").close();
  } catch (error) {
    $("settings-error").textContent = error.message;
  }
};

document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => $(button.dataset.close).close()),
  );
document.querySelectorAll("[data-mode]").forEach(
  (button) =>
    (button.onclick = () => {
      ink.setMode(button.dataset.mode);
      document.querySelectorAll("[data-mode]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      $("mode-help").textContent =
        button.dataset.mode === "edit"
          ? "コマをタップして、授業・休講・振替を変更できます。"
          : button.dataset.mode === "eraser"
            ? "触れた線を、ひと筆ずつ消します。取り消しで元に戻せます。"
            : "ペンで書き、指で移動。「指では書かない」を外すと指でも書けます。";
    }),
);
$("ink-color").oninput = () => {
  ink.color = $("ink-color").value;
};
$("ink-width").oninput = () => {
  ink.width = Number($("ink-width").value);
};
$("undo").onclick = () => ink.undo();
$("redo").onclick = () => ink.redo();
$("nav-counts").onclick = () =>
  $("counts-section").scrollIntoView({ behavior: "smooth" });
$("nav-week").onclick = () =>
  document
    .querySelector(".planner-card")
    .scrollIntoView({ behavior: "smooth" });
function download(value, label = "バックアップ") {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), state: value },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `シゴデキ先生-${label}-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$("backup").onclick = () => {
  ink.finish();
  download(state);
};
$("restore").onclick = () => $("restore-file").click();
$("restore-file").onchange = async () => {
  const file = $("restore-file").files[0];
  $("restore-file").value = "";
  if (!file || locked || conflict) return;
  let restoring = false;
  try {
    if (file.size > 8 * 1024 * 1024)
      throw new Error("復元できるファイルは8MBまでです。");
    const parsed = JSON.parse(await file.text()),
      replacement = validateState(parsed.state || parsed);
    ink.finish();
    await sync();
    if (dirty || syncing)
      throw new Error(
        "未同期の変更があります。保存が完了してから復元してください。",
      );
    if (
      !confirm(
        `${replacement.year}年度のバックアップで、このノートを置き換えます。現在のノートも復元前のバックアップとしてダウンロードします。よろしいですか？`,
      )
    )
      return;
    download(state, "復元前");
    restoring = true;
    locked = true;
    disableNotebook(true);
    status("復元しています…");
    const result = await api("state", {
      method: "PUT",
      data: { revision, state: replacement },
    });
    state = replacement;
    revision = result.revision;
    dirty = false;
    generation++;
    const [first, last] = yearBounds(state);
    if (week < monday(first) || week > monday(last)) week = monday(first);
    await persist();
    render();
    status("保存済み");
    notice("バックアップから復元しました。");
  } catch (error) {
    if (error.status === 401) lock(error.message);
    else {
      notice(`復元できませんでした。${error.message}`);
      status("復元を中止しました", true);
    }
  } finally {
    if (restoring && !$("app-view").hidden) {
      locked = false;
      disableNotebook(false);
    }
  }
};
const shell = document.createElement("div");
shell.style.cssText = "position:relative;overflow:hidden";
$("paper-viewport").append(shell);
shell.append($("paper"));
$("paper").style.position = "absolute";
function resizePaper() {
  const available = $("paper-viewport").clientWidth;
  if (!available) return;
  const width = Math.max(available, 720),
    scale = width / 1200;
  shell.style.width = `${width}px`;
  shell.style.height = `${920 * scale}px`;
  $("paper").style.transform = `scale(${scale})`;
}
new ResizeObserver(resizePaper).observe($("paper-viewport"));
window.addEventListener("online", reconnect);
window.addEventListener("offline", () => {
  if (user) status(dirty ? "オフライン・未同期" : "オフライン", true);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    ink.finish();
    sync();
  } else if (user && !locked)
    api("session").catch((error) => {
      if (error.status === 401) lock(error.message);
    });
});
// Check entitlement periodically while open. User data/API responses never enter the service-worker cache.
setInterval(() => {
  if (user && !locked && !document.hidden)
    api("session").catch((error) => {
      if (error.status === 401) lock(error.message);
    });
}, 60000);
let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("install-button").hidden = false;
});
$("install-button").onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    $("install-button").hidden = true;
  }
};
if ("serviceWorker" in navigator && window.isSecureContext)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
api("session")
  .then(enter)
  .catch((error) => {
    if (error.status !== 401)
      $("auth-error").textContent =
        error.status === 0
          ? "ノートを開くにはインターネット接続が必要です。接続後にログインしてください。"
          : error.message;
  });
