/* 週案スケジュール帳を、ブラウザの中だけで組み立てる。
 *
 * サーバーを持たずに公開するため、PDF の生成をすべてクライアント側で行う。
 * 入力した時間割や行事予定は、どこにも送信されない（この点は学校で使う上で重要）。
 *
 * 構成は Python 版（schedule-builder）と同じ:
 *   1ページ目  年間カレンダー
 *   2ページ目  年間行事予定
 *   3ページ目〜 週ページ
 *   その後     自由ページ
 */
(function (global) {
  "use strict";

  const MM = 72 / 25.4;                 // 1mm を PDF のポイントに
  const mm = (v) => v * MM;
  const PAGE_W = mm(297);               // A4 横
  const PAGE_H = mm(210);
  const PAD = mm(6);

  const WEEKDAYS = ["月", "火", "水", "木", "金"];
  const WD_ALL = ["月", "火", "水", "木", "金", "土", "日"];
  const SUN_FIRST = ["日", "月", "火", "水", "木", "金", "土"];

  // 週ページの行。"昼" は授業ではない仕切り行。
  const PERIODS = ["朝", "1", "2", "3", "4", "昼", "5", "6", "業後"];

  const LESSON_BG = {
    "": null,
    red: [0.992, 0.878, 0.878],
    blue: [0.863, 0.910, 0.984],
    green: [0.875, 0.949, 0.878],
    yellow: [0.992, 0.953, 0.816],
    gray: [0.910, 0.910, 0.910]
  };

  const COLOR = {
    ink: [0.07, 0.09, 0.11],
    line: [0.13, 0.13, 0.13],
    thin: [0.6, 0.6, 0.6],
    faint: [0.8, 0.8, 0.8],
    muted: [0.4, 0.4, 0.4],
    closed: [0.902, 0.902, 0.902],
    head: [0.957, 0.957, 0.957],
    sun: [0.816, 0.188, 0.188],
    sat: [0.165, 0.373, 0.816],
    brk: [0.937, 0.894, 0.961],
    accent: [0.961, 0.765, 0.259],
    white: [1, 1, 1]
  };

  /* ── 祝日 ───────────────────────────────────────────── */

  const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const key = (date) => date.toISOString().slice(0, 10);
  const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
  // 月曜=0 になる曜日番号
  const weekdayIndex = (date) => (date.getUTCDay() + 6) % 7;

  function nthMonday(year, month, nth) {
    const first = ymd(year, month, 1);
    const offset = (8 - first.getUTCDay()) % 7; // 日曜=0 なので月曜まで
    return addDays(first, offset + 7 * (nth - 1));
  }

  const vernalEquinox = (y) =>
    Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const autumnalEquinox = (y) =>
    Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  // 五輪特措法などによる移動
  const SPECIAL_MOVES = {
    2020: [[7, 23, "海の日"], [7, 24, "スポーツの日"], [8, 10, "山の日"]],
    2021: [[7, 22, "海の日"], [7, 23, "スポーツの日"], [8, 8, "山の日"]]
  };
  const SPECIAL_SKIP = {
    2020: ["海の日", "スポーツの日", "山の日"],
    2021: ["海の日", "スポーツの日", "山の日"]
  };

  function baseHolidays(year) {
    const skip = SPECIAL_SKIP[year] || [];
    const out = new Map();
    const add = (date, name) => { if (!skip.includes(name)) out.set(key(date), name); };

    add(ymd(year, 1, 1), "元日");
    add(nthMonday(year, 1, 2), "成人の日");
    add(ymd(year, 2, 11), "建国記念の日");
    if (year >= 2020) add(ymd(year, 2, 23), "天皇誕生日");
    add(ymd(year, 3, vernalEquinox(year)), "春分の日");
    add(ymd(year, 4, 29), year >= 2007 ? "昭和の日" : "みどりの日");
    add(ymd(year, 5, 3), "憲法記念日");
    add(ymd(year, 5, 4), year >= 2007 ? "みどりの日" : "国民の休日");
    add(ymd(year, 5, 5), "こどもの日");
    add(nthMonday(year, 7, 3), "海の日");
    if (year >= 2016) add(ymd(year, 8, 11), "山の日");
    add(nthMonday(year, 9, 3), "敬老の日");
    add(ymd(year, 9, autumnalEquinox(year)), "秋分の日");
    add(nthMonday(year, 10, 2), year >= 2020 ? "スポーツの日" : "体育の日");
    add(ymd(year, 11, 3), "文化の日");
    add(ymd(year, 11, 23), "勤労感謝の日");
    if (year <= 2018) add(ymd(year, 12, 23), "天皇誕生日");

    (SPECIAL_MOVES[year] || []).forEach(([m, d, name]) => out.set(key(ymd(year, m, d)), name));
    return out;
  }

  const holidayCache = new Map();
  function holidaysIn(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);

    const base = new Map();
    [year - 1, year, year + 1].forEach((y) => {
      baseHolidays(y).forEach((name, k) => base.set(k, name));
    });
    const result = new Map(base);

    // 振替休日: 日曜が祝日なら、その後の最初の非祝日へ
    [...base.keys()].sort().forEach((k) => {
      const date = new Date(k + "T00:00:00Z");
      if (date.getUTCDay() !== 0) return;
      let cand = addDays(date, 1);
      while (result.has(key(cand))) cand = addDays(cand, 1);
      result.set(key(cand), "振替休日");
    });

    // 国民の休日: 祝日に挟まれた平日
    [...base.keys()].sort().forEach((k) => {
      const date = new Date(k + "T00:00:00Z");
      const gap = addDays(date, 1);
      const after = addDays(date, 2);
      if (base.has(key(after)) && !result.has(key(gap)) && gap.getUTCDay() !== 0) {
        result.set(key(gap), "国民の休日");
      }
    });

    const filtered = new Map();
    [...result.entries()].forEach(([k, name]) => {
      if (Number(k.slice(0, 4)) === year) filtered.set(k, name);
    });
    holidayCache.set(year, filtered);
    return filtered;
  }

  function holidayName(date) {
    return holidaysIn(date.getUTCFullYear()).get(key(date)) || null;
  }

  /* ── 年度の組み立て ─────────────────────────────────── */

  function buildModel(input) {
    const year = input.schoolYear;
    const start = ymd(year, 4, 1);
    const end = ymd(year + 1, 3, 31);
    const extraWeeks = input.extraWeeks == null ? 1 : input.extraWeeks;

    const eventsByDate = new Map();
    (input.events || []).forEach((e) => {
      const list = eventsByDate.get(e.date) || [];
      list.push(e.note ? `${e.title}（${e.note}）` : e.title);
      eventsByDate.set(e.date, list);
    });

    const breaks = (input.breaks || []).map((b) => ({
      name: b.name,
      start: new Date(b.start + "T00:00:00Z"),
      end: new Date(b.end + "T00:00:00Z")
    }));

    function day(date) {
      const holiday = holidayName(date);
      const brk = breaks.find((b) => date >= b.start && date <= b.end);
      const wd = date.getUTCDay();
      return {
        date,
        key: key(date),
        d: date.getUTCDate(),
        month: date.getUTCMonth() + 1,
        weekday: WD_ALL[weekdayIndex(date)],
        isSat: wd === 6,
        isSun: wd === 0,
        isWeekend: wd === 0 || wd === 6,
        holiday,
        breakName: brk ? brk.name : null,
        // 休業名は開始日だけに表示する（毎日書くと紙面が煩雑になるため）。
        // 休みであること自体（グレー表示）は breakName を使って全日に適用する。
        breakLabel: brk && key(brk.start) === key(date) ? brk.name : null,
        // 休業の初日が祝日と重なることもあるため、両方あれば併記する
        // （片方だけにすると、もう一方の情報が紙面から消えてしまう）。
        get closedLabel() { return [this.holiday, this.breakLabel].filter(Boolean).join(" / "); },
        get isClosed() { return this.isWeekend || !!this.holiday || !!this.breakName; },
        events: (eventsByDate.get(key(date)) || []).join(" ")
      };
    }

    // 第1週は 4/1 を含む週の月曜から
    const firstMonday = addDays(start, -weekdayIndex(start));
    const lastMonday = addDays(end, extraWeeks * 7);
    const weeks = [];
    for (let monday = firstMonday, i = 1; monday <= lastMonday; monday = addDays(monday, 7), i++) {
      const days = [];
      for (let k = 0; k < 7; k++) days.push(day(addDays(monday, k)));
      // page は 0 始まりのページ番号。0=年間カレンダー, 1=年間行事予定 なので
      // 第1週（i=1）は 2 になる。
      weeks.push({ index: i, days, page: 1 + i });
    }

    // 4月〜翌3月の月グリッド（日曜始まり）
    const months = [];
    for (let offset = 0; offset < 12; offset++) {
      const m = ((3 + offset) % 12) + 1;
      const y = m < 4 ? year + 1 : year;
      const first = ymd(y, m, 1);
      const lead = first.getUTCDay();
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const cells = new Array(lead).fill(null);
      for (let d = 1; d <= daysInMonth; d++) cells.push(day(ymd(y, m, d)));
      while (cells.length < 42) cells.push(null);
      months.push({ year: y, month: m, daysInMonth, cells, days: cells.filter(Boolean) });
    }

    const freeCount = input.freePages == null ? 30 : input.freePages;
    const freeStart = 2 + weeks.length;
    const freePages = [];
    for (let i = 0; i < freeCount; i++) freePages.push(freeStart + i);

    function weekPageFor(date) {
      const diff = Math.floor((date - firstMonday) / 86400000);
      if (diff < 0) return null;
      const index = Math.floor(diff / 7);
      return index < weeks.length ? 2 + index : null;
    }

    return {
      input, year, start, end, weeks, months, freePages,
      totalPages: 2 + weeks.length + freeCount,
      weekPageFor,
      lessonAt(dayObj, period) {
        if (dayObj.isClosed) return null;
        const row = (input.timetable && input.timetable.grid) || {};
        const cell = (row[dayObj.weekday] || {})[period];
        if (!cell) return null;
        return typeof cell === "string" ? { name: cell, color: "" } : cell;
      }
    };
  }

  /* ── 描画の道具 ─────────────────────────────────────── */

  function makePainter(doc, page, font, links) {
    const { rgb } = PDFLib;
    const col = (c) => rgb(c[0], c[1], c[2]);

    const api = {
      rect(x, y, w, h, opts = {}) {
        const o = { x, y: y - h, width: w, height: h };
        if (opts.fill) o.color = col(opts.fill);
        if (opts.border !== false) {
          o.borderColor = col(opts.border || COLOR.line);
          o.borderWidth = opts.lw == null ? 0.9 : opts.lw;
        }
        page.drawRectangle(o);
      },
      text(str, x, y, opts = {}) {
        if (str == null || str === "") return;
        const size = opts.size || 8;
        let value = String(str);
        if (opts.maxWidth) value = api.clip(value, size, opts.maxWidth);
        let px = x;
        if (opts.align === "center") px = x - font.widthOfTextAtSize(value, size) / 2;
        if (opts.align === "right") px = x - font.widthOfTextAtSize(value, size);
        page.drawText(value, {
          x: px, y: y - size, size, font, color: col(opts.color || COLOR.ink)
        });
      },
      clip(value, size, maxWidth) {
        if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
        let out = value;
        while (out.length > 1 && font.widthOfTextAtSize(out + "…", size) > maxWidth) {
          out = out.slice(0, -1);
        }
        return out + "…";
      },
      width(str, size) { return font.widthOfTextAtSize(String(str), size); },
      // リンクは全ページを作り終えてから貼るので、いったん記録する
      link(x, y, w, h, targetPage) {
        if (targetPage == null) return;
        links.push({ page, rect: [x, y - h, x + w, y], target: targetPage });
      }
    };
    return api;
  }

  function footer(p, model, pageNo, watermark) {
    const y = PAD + mm(3.5);
    p.text(watermark || "", PAD, y, { size: 6.5, color: COLOR.faint });
    p.text(model.input.title, PAGE_W / 2, y, { size: 6.5, color: COLOR.faint, align: "center" });
    p.text(`${pageNo + 1} / ${model.totalPages}`, PAGE_W - PAD, y,
      { size: 6.5, color: COLOR.faint, align: "right" });
  }

  // 目次・前後への移動ボタン。指でタップできる大きさを確保する。
  function navButtons(p, buttons) {
    const h = mm(6);
    const y = PAGE_H - PAD - mm(1);
    let x = PAGE_W - PAD;
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      const w = b.w || mm(24);
      x -= w;
      p.rect(x, y, w, h, {
        fill: b.accent ? COLOR.accent : [0.957, 0.957, 0.957],
        border: COLOR.thin, lw: 0.7
      });
      p.text(b.label, x + w / 2, y - mm(1.6), { size: 7.5, align: "center" });
      if (b.target != null) p.link(x, y, w, h, b.target);
      x -= mm(1.6);
    }
  }

  /* ── 各ページ ───────────────────────────────────────── */

  function drawYearCalendar(p, model) {
    const inner = PAGE_W - PAD * 2;
    let y = PAGE_H - PAD;

    p.text("年間カレンダー", PAD, y - mm(1), { size: 13 });
    const reiwa = model.year - 2018;
    const owner = model.input.owner || {};
    const subtitle = `令和${reiwa}年度（${model.year}年4月 〜 ${model.year + 1}年3月）`
      + (owner.school ? ` ／ ${owner.school}` : "")
      + (owner.name ? ` ／ ${owner.name}` : "");
    p.text(subtitle, PAD + p.width("年間カレンダー", 13) + mm(4), y - mm(2.4),
      { size: 8.5, color: COLOR.muted });

    navButtons(p, [
      { label: "年間行事予定", target: 1, w: mm(26) },
      { label: "自由ページ", target: model.freePages[0], w: mm(24), accent: true }
    ]);

    y -= mm(9);

    // 年間カレンダーは手書きと週ページへのリンクだけに徹する。
    // 授業の色や休業の凡例はここには出さない（週ページ側に情報がある）。

    const bottom = PAD + mm(6);
    const gap = mm(2);
    const cellW = (inner - gap * 3) / 4;
    const cellH = (y - bottom - gap * 2) / 3;

    model.months.forEach((month, i) => {
      const cx = PAD + (i % 4) * (cellW + gap);
      const cy = y - Math.floor(i / 4) * (cellH + gap);
      drawMonth(p, model, month, cx, cy, cellW, cellH);
    });
  }

  function drawMonth(p, model, month, x, y, w, h) {
    p.rect(x, y, w, h, { border: COLOR.line, lw: 1.1 });

    const headH = mm(5);
    p.rect(x, y, w, headH, { fill: COLOR.head, border: COLOR.line, lw: 1.1 });
    p.text(`${month.month}月`, x + mm(1.6), y - mm(1.1), { size: 10 });
    const en = new Date(Date.UTC(2000, month.month - 1, 1))
      .toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    p.text(en, x + mm(1.6) + p.width(`${month.month}月`, 10) + mm(1.5), y - mm(1.5),
      { size: 7, color: COLOR.muted });

    const wdH = mm(3.4);
    const colW = w / 7;
    let ty = y - headH;
    SUN_FIRST.forEach((wd, i) => {
      p.text(wd, x + i * colW + mm(0.8), ty - mm(0.5), { size: 7, color: COLOR.muted });
    });
    p.rect(x, ty - wdH, w, 0, { border: COLOR.thin, lw: 0.7 });
    ty -= wdH;

    const rowH = (h - headH - wdH) / 6;
    month.cells.forEach((day, i) => {
      const cx = x + (i % 7) * colW;
      const cy = ty - Math.floor(i / 7) * rowH;
      if (!day) {
        p.rect(cx, cy, colW, rowH, { fill: [0.98, 0.98, 0.98], border: COLOR.faint, lw: 0.4 });
        return;
      }
      // 年間カレンダーは無地。曜日の色分け（日曜=朱・土曜=藍）だけを付ける。
      p.rect(cx, cy, colW, rowH, { border: COLOR.faint, lw: 0.4 });
      const color = day.isSun ? COLOR.sun : (day.isSat ? COLOR.sat : COLOR.ink);
      // 書き込む前提なので、日付は左上に小さく置く
      p.text(String(day.d), cx + mm(0.7), cy - mm(0.5), { size: 7.5, color });
      p.link(cx, cy, colW, rowH, model.weekPageFor(day.date));
    });
  }

  function drawEventList(p, model) {
    let y = PAGE_H - PAD;
    p.text("年間行事予定", PAD, y - mm(1), { size: 13 });
    p.text("日付をタップするとその週のページに移動します",
      PAD + p.width("年間行事予定", 13) + mm(4), y - mm(2.4), { size: 8.5, color: COLOR.muted });

    navButtons(p, [
      { label: "年間カレンダー", target: 0, w: mm(26) },
      { label: "自由ページ", target: model.freePages[0], w: mm(24), accent: true }
    ]);

    y -= mm(9);
    const bottom = PAD + mm(6);
    const inner = PAGE_W - PAD * 2;
    const colW = inner / 12;
    const headH = mm(5);

    model.months.forEach((month, i) => {
      const x = PAD + i * colW;
      p.rect(x, y, colW, headH, { fill: COLOR.head, border: COLOR.line, lw: 0.8 });
      p.text(`${month.month}月`, x + colW / 2, y - mm(1.1), { size: 8, align: "center" });
    });

    const rowH = (y - headH - bottom) / 31;
    for (let row = 0; row < 31; row++) {
      model.months.forEach((month, i) => {
        const x = PAD + i * colW;
        const cy = y - headH - row * rowH;
        const day = month.cells.filter(Boolean)[row];
        if (!day) {
          p.rect(x, cy, colW, rowH, { fill: [0.94, 0.94, 0.94], border: COLOR.faint, lw: 0.4 });
          return;
        }
        const fill = day.breakName ? COLOR.brk : (day.isClosed ? COLOR.closed : null);
        p.rect(x, cy, colW, rowH, { fill, border: COLOR.faint, lw: 0.4 });
        const color = day.isSun ? COLOR.sun : (day.isSat ? COLOR.sat : COLOR.muted);
        p.text(`${day.d}${day.weekday}`, x + mm(0.6), cy - mm(0.35), { size: 6, color });
        const label = [day.closedLabel, day.events].filter(Boolean).join(" / ");
        p.text(label, x + mm(6), cy - mm(0.35),
          { size: 6, maxWidth: colW - mm(6.6), color: COLOR.ink });
        p.link(x, cy, colW, rowH, model.weekPageFor(day.date));
      });
    }
  }

  function drawWeek(p, model, week) {
    let y = PAGE_H - PAD;
    p.text(`第${week.index}週`, PAD, y - mm(1), { size: 13 });
    const range = `${week.days[0].month}/${week.days[0].d} 〜 ${week.days[6].month}/${week.days[6].d}`;
    p.text(range, PAD + p.width(`第${week.index}週`, 13) + mm(4), y - mm(2.4),
      { size: 8.5, color: COLOR.muted });

    const prev = week.index > 1 ? week.page - 1 : null;
    const next = week.index < model.weeks.length ? week.page + 1 : null;
    navButtons(p, [
      { label: "◀", target: prev, w: mm(10) },
      { label: "年間カレンダー", target: 0, w: mm(26) },
      { label: "年間行事予定", target: 1, w: mm(26) },
      { label: "自由", target: model.freePages[0], w: mm(14), accent: true },
      { label: "▶", target: next, w: mm(10) }
    ]);

    y -= mm(9);
    const bottom = PAD + mm(6);
    const bodyH = y - bottom;
    const gap = mm(3);
    const leftW = (PAGE_W - PAD * 2 - gap) * 0.575;
    const rightW = PAGE_W - PAD * 2 - gap - leftW;
    const rightX = PAD + leftW + gap;

    drawTimetable(p, model, week, PAD, y, leftW, bodyH);
    drawWeekSide(p, model, week, rightX, y, rightW, bodyH);
  }

  function drawTimetable(p, model, week, x, y, w, h) {
    const labelW = mm(8);
    const colW = (w - labelW) / 5;
    const headH = mm(10);

    // 曜日と日付。日付は週ページで最もよく見る情報なので大きく出す。
    p.rect(x, y, labelW, headH, { fill: COLOR.head });
    week.days.slice(0, 5).forEach((day, i) => {
      const cx = x + labelW + i * colW;
      p.rect(cx, y, colW, headH, { fill: day.isClosed ? COLOR.closed : COLOR.head });
      p.text(day.weekday, cx + colW / 2, y - mm(1.2), { size: 10, align: "center" });
      p.text(`${day.month}/${day.d}`, cx + colW / 2, y - mm(4.6), { size: 11, align: "center" });
      if (day.closedLabel) {
        p.text(day.closedLabel, cx + colW / 2, y - mm(8), {
          size: 6.5, align: "center", color: [0.48, 0.35, 0.56], maxWidth: colW - mm(1)
        });
      }
    });

    // 昼の行だけ低くする
    const unit = (h - headH) / (PERIODS.length - 1 + 0.45);
    let ry = y - headH;
    PERIODS.forEach((period) => {
      const rowH = period === "昼" ? unit * 0.45 : unit;
      p.rect(x, ry, labelW, rowH, { fill: period === "昼" ? [0.98, 0.98, 0.98] : [0.98, 0.98, 0.98] });
      p.text(period, x + labelW / 2, ry - rowH / 2 + mm(1.3), { size: 8, align: "center" });

      week.days.slice(0, 5).forEach((day, i) => {
        const cx = x + labelW + i * colW;
        const lesson = model.lessonAt(day, period);
        const bg = day.isClosed ? COLOR.closed
          : (lesson && LESSON_BG[lesson.color] ? LESSON_BG[lesson.color] : null);
        p.rect(cx, ry, colW, rowH, { fill: bg });
        if (lesson && lesson.name) {
          // 授業名は左上。セルの大部分は手書きのために空ける。
          p.text(lesson.name, cx + mm(1), ry - mm(0.8), { size: 8, maxWidth: colW - mm(2) });
        }
      });
      ry -= rowH;
    });
  }

  function drawWeekSide(p, model, week, x, y, w, h) {
    const gap = mm(2);
    const planRows = 5;
    const planH = mm(5) + planRows * mm(8);
    // 指導計画の高さは変えず、日別欄を少し詰めてメモ欄を広くとる。
    const memoH = mm(26);
    const listH = h - planH - memoH - gap * 2;

    // 日別の欄（月〜金＋土日）
    const labelW = mm(17);
    const rowH = listH / 7;
    week.days.forEach((day, i) => {
      const cy = y - i * rowH;
      const fill = day.isClosed ? COLOR.closed : null;
      p.rect(x, cy, labelW, rowH, { fill: fill || [0.98, 0.98, 0.98] });
      p.rect(x + labelW, cy, w - labelW, rowH, { fill });
      const color = day.isSun ? COLOR.sun : (day.isSat ? COLOR.sat : COLOR.ink);
      p.text(`${day.month}/${day.d}(${day.weekday})`, x + mm(1.2), cy - mm(1),
        { size: 9.5, color });
      const label = [day.closedLabel, day.events].filter(Boolean).join(" ");
      p.text(label, x + labelW + mm(1.2), cy - mm(1),
        { size: 8, maxWidth: w - labelW - mm(2.4), color: COLOR.ink });
    });

    // 指導計画（手書きするので行を高くとる）
    let py = y - listH - gap;
    p.rect(x, py, w, mm(5), { fill: COLOR.head });
    p.text("指導計画", x + w / 2, py - mm(1.1), { size: 8.5, align: "center" });
    py -= mm(5);
    for (let i = 0; i < planRows; i++) {
      p.rect(x, py, w * 0.22, mm(8));
      p.rect(x + w * 0.22, py, w * 0.78, mm(8));
      py -= mm(8);
    }

    p.rect(x, py - gap, w, memoH);
  }

  function drawFree(p, model, index) {
    const y = PAGE_H - PAD;
    const labelW = mm(24);
    p.rect(PAD, y, labelW, mm(6), { fill: COLOR.accent, border: COLOR.thin, lw: 0.7 });
    p.text(`自由 ${index + 1}`, PAD + labelW / 2, y - mm(1.5), { size: 10, align: "center" });

    const prev = index > 0 ? model.freePages[index - 1] : null;
    const next = index < model.freePages.length - 1 ? model.freePages[index + 1] : null;
    navButtons(p, [
      { label: "◀", target: prev, w: mm(10) },
      { label: "年間カレンダー", target: 0, w: mm(26) },
      { label: "年間行事予定", target: 1, w: mm(26) },
      { label: "▶", target: next, w: mm(10) }
    ]);

    const top = y - mm(9);
    const bottom = PAD + mm(6);
    p.rect(PAD, top, PAGE_W - PAD * 2, top - bottom);
    // 罫線
    for (let ly = top - mm(8); ly > bottom + mm(2); ly -= mm(8)) {
      p.rect(PAD, ly, PAGE_W - PAD * 2, 0, { border: [0.85, 0.85, 0.85], lw: 0.5 });
    }
  }

  /* ── リンク・しおり ─────────────────────────────────── */

  function applyLinks(doc, pages, links) {
    const { PDFName } = PDFLib;
    const byPage = new Map();
    links.forEach((link) => {
      const list = byPage.get(link.page) || [];
      // ページを直接指すデスティネーションにする。名前付きにすると
      // モバイルの手書きアプリで解決されないことがある。
      list.push(doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: link.rect,
        Border: [0, 0, 0],
        F: 4,
        Dest: [pages[link.target].ref, "Fit"]
      }));
      byPage.set(link.page, list);
    });
    byPage.forEach((annots, page) => {
      page.node.set(PDFName.of("Annots"), doc.context.obj(annots));
    });
  }

  function applyOutline(doc, pages, items) {
    const { PDFName, PDFHexString } = doc ? PDFLib : PDFLib;
    if (!items.length) return;
    const refs = items.map(() => doc.context.nextRef());
    const rootRef = doc.context.nextRef();

    items.forEach((item, i) => {
      doc.context.assign(refs[i], doc.context.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: rootRef,
        Dest: [pages[item.page].ref, "Fit"],
        ...(i > 0 ? { Prev: refs[i - 1] } : {}),
        ...(i < items.length - 1 ? { Next: refs[i + 1] } : {})
      }));
    });

    doc.context.assign(rootRef, doc.context.obj({
      Type: "Outlines",
      First: refs[0],
      Last: refs[refs.length - 1],
      Count: items.length
    }));
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }

  /* ── 入口 ───────────────────────────────────────────── */

  async function generate(input, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const { PDFDocument } = PDFLib;

    onProgress("フォントを読み込んでいます…", 0.05);
    const fontBytes = options.fontBytes || await fetch(options.fontUrl || "fonts/ipag.ttf")
      .then((r) => {
        if (!r.ok) throw new Error("フォントを読み込めませんでした");
        return r.arrayBuffer();
      });

    const model = buildModel(input);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    onProgress("フォントを組み込んでいます…", 0.15);
    const font = await doc.embedFont(fontBytes, { subset: true });

    const watermark = [input.license && input.license.issuedTo, input.license && input.license.orderId]
      .filter(Boolean).join(" / ");

    const pages = [];
    for (let i = 0; i < model.totalPages; i++) pages.push(doc.addPage([PAGE_W, PAGE_H]));

    const links = [];
    const painters = pages.map((page) => makePainter(doc, page, font, links));

    onProgress("年間カレンダーを描いています…", 0.25);
    drawYearCalendar(painters[0], model);
    footer(painters[0], model, 0, watermark);

    drawEventList(painters[1], model);
    footer(painters[1], model, 1, watermark);

    model.weeks.forEach((week, i) => {
      if (i % 12 === 0) {
        onProgress(`週ページを描いています…（${i + 1}/${model.weeks.length}）`,
          0.3 + 0.5 * (i / model.weeks.length));
      }
      drawWeek(painters[week.page], model, week);
      footer(painters[week.page], model, week.page, watermark);
    });

    model.freePages.forEach((pageNo, i) => {
      drawFree(painters[pageNo], model, i);
      footer(painters[pageNo], model, pageNo, watermark);
    });

    onProgress("リンクを貼っています…", 0.85);
    applyLinks(doc, pages, links);

    const outline = [
      { title: "年間カレンダー", page: 0 },
      { title: "年間行事予定", page: 1 }
    ];
    model.weeks.forEach((w) => outline.push({
      title: `第${w.index}週（${w.days[0].month}/${w.days[0].d} 〜 ${w.days[6].month}/${w.days[6].d}）`,
      page: w.page
    }));
    model.freePages.forEach((pageNo, i) => outline.push({ title: `自由 ${i + 1}`, page: pageNo }));
    applyOutline(doc, pages, outline);

    doc.setTitle(input.title);
    doc.setAuthor((input.owner && input.owner.name) || "");
    doc.setCreator("週案スケジュール帳");
    doc.setProducer("週案スケジュール帳");

    onProgress("PDFを書き出しています…", 0.95);
    const bytes = await doc.save();
    onProgress("できあがりました", 1);

    return {
      bytes,
      pageCount: model.totalPages,
      linkCount: links.length,
      weekCount: model.weeks.length
    };
  }

  global.SchedulePlanner = { generate, buildModel, holidaysIn, holidayName, PERIODS, WEEKDAYS };
})(window);
