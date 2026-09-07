  // 授業リスト（パレット）。「授業名＋色」を1回登録すれば、時間割では選ぶだけでよい。
  const COLORS = [["", "なし"], ["red", "赤"], ["blue", "青"], ["green", "緑"], ["yellow", "黄"], ["gray", "灰"]];
  const DAYS = ["月", "火", "水", "木", "金"];
  const PERIODS = ["1", "2", "3", "4", "5", "6"];

  let nextLessonId = 1;
  // 初期設定は「学年+組　教科」。1〜3年生 × 1〜3組、学年ごとに色を分けておく。
  const GRADE_COLOR = { 1: "yellow", 2: "red", 3: "blue" };
  const palette = [];
  for (let grade = 1; grade <= 3; grade++) {
    for (let cls = 1; cls <= 3; cls++) {
      palette.push({ id: nextLessonId++, name: `${grade}年${cls}組　国語`, color: GRADE_COLOR[grade] });
    }
  }

  // 時間割の初期状態（授業リストの id で指定）。
  const byName = (name) => palette.find((p) => p.name === name).id;
  const PLAN = {
    1: [byName("1年1組　国語"), byName("2年1組　国語"), "", byName("3年1組　国語"), ""],
    2: ["", byName("1年2組　国語"), byName("2年2組　国語"), byName("3年2組　国語"), byName("1年3組　国語")],
    3: [byName("2年3組　国語"), byName("3年3組　国語"), byName("1年1組　国語"), byName("2年1組　国語"), byName("3年1組　国語")],
    4: ["", "", "", "", byName("1年2組　国語")],
    5: [byName("2年2組　国語"), byName("3年2組　国語"), byName("1年3組　国語"), "", ""],
    6: ["", "", "", "", ""]
  };

  const paletteEl = document.getElementById("palette");
  const tbody = document.getElementById("tt");

  function lessonOptionsHtml(selectedId) {
    let html = '<option value="">－</option>';
    palette.forEach((item) => {
      const label = item.name || "（名前未設定）";
      html += `<option value="${item.id}"${String(item.id) === String(selectedId) ? " selected" : ""}>${label}</option>`;
    });
    return html;
  }

  function applyLessonColor(select) {
    const td = select.closest("td");
    const item = palette.find((p) => String(p.id) === select.value);
    td.className = item && item.color ? "c-" + item.color : "";
  }

  // 授業リストが変わるたびに、時間割側の選択肢を作り直す（選択済みの id はそのまま保つ）。
  function syncLessonSelects() {
    tbody.querySelectorAll("select.lesson-select").forEach((select) => {
      const current = select.value;
      select.innerHTML = lessonOptionsHtml(current);
      if (![...select.options].some((o) => o.value === current)) select.value = "";
      applyLessonColor(select);
    });
  }

  function renderPalette() {
    paletteEl.innerHTML = "";
    palette.forEach((item) => {
      const row = document.createElement("div");
      row.className = "palette-row";
      const colorOptions = COLORS.filter(([v]) => v).map(([v, l]) =>
        `<option value="${v}"${v === item.color ? " selected" : ""}>${l}</option>`).join("");
      row.innerHTML = `
        <span class="p-swatch" style="background:${item.color ? "var(--c-" + item.color + ")" : "#fff"}"></span>
        <input type="text" class="p-name" value="${item.name}" placeholder="授業名（例：２－１国語）">
        <select class="p-color">${colorOptions}</select>
        <button type="button" class="p-del" aria-label="この授業を削除">×</button>`;
      const swatch = row.querySelector(".p-swatch");
      row.querySelector(".p-name").addEventListener("input", (e) => {
        item.name = e.target.value;
        syncLessonSelects();
      });
      row.querySelector(".p-color").addEventListener("change", (e) => {
        item.color = e.target.value;
        swatch.style.background = "var(--c-" + item.color + ")";
        syncLessonSelects();
      });
      row.querySelector(".p-del").addEventListener("click", () => {
        const index = palette.findIndex((p) => p.id === item.id);
        palette.splice(index, 1);
        renderPalette();
        syncLessonSelects();
      });
      paletteEl.appendChild(row);
    });
  }

  document.getElementById("add-lesson").addEventListener("click", () => {
    palette.push({ id: nextLessonId++, name: "", color: "" });
    renderPalette();
    syncLessonSelects();
  });

  // 授業の色見本を CSS 変数からも引けるようにする（.p-swatch のインラインスタイル用）
  document.documentElement.style.setProperty("--c-red", "#fde0e0");
  document.documentElement.style.setProperty("--c-blue", "#dce8fb");
  document.documentElement.style.setProperty("--c-green", "#dff2e0");
  document.documentElement.style.setProperty("--c-yellow", "#fdf3d0");
  document.documentElement.style.setProperty("--c-gray", "#e8e8e8");

  PERIODS.forEach((period) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${period}限</th>`;
    (PLAN[period] || ["", "", "", "", ""]).forEach((lessonId, i) => {
      const td = document.createElement("td");
      td.innerHTML = `<select class="lesson-select" aria-label="${DAYS[i]}曜${period}限の授業"></select>`;
      const select = td.querySelector("select");
      select.innerHTML = lessonOptionsHtml(lessonId);
      select.addEventListener("change", () => applyLessonColor(select));
      applyLessonColor(select);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  renderPalette();

  // 長期休業。年度に合わせて既定値を作る。
  const breaksEl = document.getElementById("breaks");
  function renderBreaks(year) {
    const rows = [
      ["夏季休業", `${year}-07-21`, `${year}-08-31`],
      ["冬季休業", `${year}-12-25`, `${year + 1}-01-07`],
      ["学年末休業", `${year + 1}-03-25`, `${year + 1}-03-31`]
    ];
    breaksEl.innerHTML = rows.map(([name, start, end], i) => `
      <div class="break-row">
        <div><label for="bn${i}">名称</label><input id="bn${i}" type="text" value="${name}"></div>
        <div><label for="bs${i}">開始</label><input id="bs${i}" type="date" value="${start}"></div>
        <div><label for="be${i}">終了</label><input id="be${i}" type="date" value="${end}"></div>
      </div>`).join("");
  }

  const yearEl = document.getElementById("year");
  function syncYear() {
    const year = Number(yearEl.value);
    renderBreaks(year);
    document.getElementById("product").textContent = `令和${year - 2018}年度版`;
  }
  yearEl.addEventListener("change", syncYear);
  syncYear();

  // 時間割の割り当てだけをまとめて空にする（授業リストそのものは残す）。
  document.getElementById("clear-tt").addEventListener("click", () => {
    const filled = [...tbody.querySelectorAll("select.lesson-select")].filter((s) => s.value !== "");
    if (filled.length && !confirm("時間割の割り当てをすべて消します。よろしいですか？（授業リストは残ります）")) return;
    tbody.querySelectorAll("select.lesson-select").forEach((select) => {
      select.value = "";
      applyLessonColor(select);
    });
  });

  // 画面の切り替え
  const steps = [...document.querySelectorAll(".step")];
  const urls = {
    1: "https://schedule-builder.example.com/",
    2: "https://schedule-builder.example.com/setup/setup:ORD-D7EBCC4981EA:…",
    3: "https://schedule-builder.example.com/done/ORD-D7EBCC4981EA:…"
  };
  function show(step) {
    steps.forEach((s) => s.setAttribute("aria-selected", String(s.dataset.step === String(step))));
    [1, 2, 3].forEach((n) => { document.getElementById("panel-" + n).hidden = n !== step; });
    document.getElementById("url").textContent = urls[step];
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  steps.forEach((s) => s.addEventListener("click", () => show(Number(s.dataset.step))));

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => show(Number(btn.dataset.go)));
  });

  // 「確認・購入へ進む」で、入力内容から購入画面の確認欄を作る。
  document.getElementById("to-purchase").addEventListener("click", () => {
    const input = collectInput();
    document.getElementById("c-year").textContent = `${input.schoolYear}年度`;
    document.getElementById("c-free").textContent = input.freePages + "枚";
    let lessonCount = 0;
    Object.values(input.timetable.grid).forEach((periods) => { lessonCount += Object.keys(periods).length; });
    document.getElementById("c-lessons").textContent = lessonCount + "コマ";
    document.getElementById("c-events").textContent = input.events.length + "件";
  });

  // ── お会計（見た目だけの購入フロー） ───────────────────
  // 定価は適当な金額。クーポンはその100倍を割り引くので、使うと必ず0円まで
  // 落ちる（遊び心：割引額が定価よりずっと大きいという冗談）。クーポンは
  // 既に取得済みという設定で、使うかどうかだけ選べる。割引額は「使う」を
  // 押すまでは伏せておき、使った瞬間に初めて明かして反映する。
  // 決済は一切行わず、カード欄は見本表示のみで、値は読み取っても保存・送信もしない。
  const PRICE = 1980;
  const COUPON_MULTIPLIER = 100;
  const yen = (n) => "¥" + n.toLocaleString("ja-JP");

  const couponRow = document.querySelector(".coupon-row");
  const couponAmount = document.getElementById("coupon-amount");
  const toggleCoupon = document.getElementById("toggle-coupon");
  const discountRow = document.getElementById("discount-row");
  const priceDiscount = document.getElementById("price-discount");
  const priceStrike = document.getElementById("price-strike");
  const priceTotal = document.getElementById("price-total");
  const paymentBox = document.getElementById("payment");
  const paymentBadge = document.getElementById("payment-badge");
  const paymentNote = document.getElementById("payment-note");

  let couponUsed = false;

  function updatePrice() {
    const discount = PRICE * COUPON_MULTIPLIER;
    const total = couponUsed ? Math.max(0, PRICE - discount) : PRICE;

    document.getElementById("price-base").textContent = yen(PRICE);
    discountRow.hidden = !couponUsed;
    if (couponUsed) priceDiscount.textContent = "−" + yen(discount);
    priceStrike.hidden = !couponUsed;
    priceStrike.textContent = yen(PRICE);
    priceTotal.textContent = yen(total);

    couponRow.classList.toggle("is-applied", couponUsed);
    toggleCoupon.setAttribute("aria-pressed", String(couponUsed));
    toggleCoupon.textContent = couponUsed ? "使用中（取り消す）" : "クーポンを使う";
    couponAmount.textContent = couponUsed
      ? `¥${discount.toLocaleString("ja-JP")}引き（定価の100倍オフ）`
      : "";

    paymentBox.classList.toggle("is-waived", total === 0);
    paymentBadge.hidden = total !== 0;
    document.getElementById("make").textContent = total === 0 ? "0円で購入する" : yen(total) + "で購入する";
    paymentNote.textContent = total === 0
      ? "クーポンにより合計0円です。カード情報は入力しなくても購入に進めます（お試しで入れても実際には使われません）。"
      : "このデモでは実際の請求は発生しません。カード情報は送信・保存されません。";
  }
  toggleCoupon.addEventListener("click", () => {
    couponUsed = !couponUsed;
    updatePrice();
  });
  updatePrice();

  // ── 入力を集めて PDF を作る ──────────────────────────
  function collectInput() {
    const year = Number(yearEl.value);

    const grid = {};
    tbody.querySelectorAll("tr").forEach((tr, rowIndex) => {
      const period = String(rowIndex + 1);
      tr.querySelectorAll("td").forEach((td, i) => {
        const select = td.querySelector("select.lesson-select");
        const item = palette.find((p) => String(p.id) === select.value);
        if (!item || !item.name.trim()) return;
        const weekday = DAYS[i];
        grid[weekday] = grid[weekday] || {};
        grid[weekday][period] = { name: item.name.trim(), color: item.color };
      });
    });

    const breaks = [];
    for (let i = 0; i < 3; i++) {
      const name = (document.getElementById("bn" + i) || {}).value;
      const start = (document.getElementById("bs" + i) || {}).value;
      const end = (document.getElementById("be" + i) || {}).value;
      if (name && name.trim() && start && end && start <= end) {
        breaks.push({ name: name.trim(), start, end });
      }
    }

    // 「4/8,入学式」形式を読む。1〜3月は翌年とみなす（学校年度の慣習）。
    const events = [];
    document.getElementById("events").value.split(/\r?\n/).forEach((line) => {
      const row = line.trim();
      if (!row) return;
      const parts = row.split(/[,、\t]/);
      if (parts.length < 2) return;
      const raw = parts[0].trim();
      const title = parts.slice(1).join(",").trim();
      if (!title) return;
      let y = year, m, d;
      let match = raw.match(/^(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
      if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
      else {
        match = raw.match(/^(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/);
        if (!match) return;
        m = +match[1]; d = +match[2];
        y = m <= 3 ? year + 1 : year;
      }
      if (m < 1 || m > 12 || d < 1 || d > 31) return;
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (iso < `${year}-04-01` || iso > `${year + 1}-03-31`) return;
      events.push({ date: iso, title });
    });

    const free = Number(document.getElementById("fp").value);
    return {
      schoolYear: year,
      title: `令和${year - 2018}年度（${year}年度）スケジュール帳`,
      owner: {
        name: document.getElementById("own").value.trim(),
        school: document.getElementById("sch").value.trim()
      },
      timetable: { grid },
      breaks,
      events,
      freePages: Number.isFinite(free) ? Math.min(Math.max(free, 0), 200) : 30,
      license: { issuedTo: document.getElementById("own").value.trim(), orderId: "" }
    };
  }

  const makeBtn = document.getElementById("make");
  const makeNote = document.getElementById("make-note");
  const progress = document.getElementById("progress");
  const barFill = document.getElementById("bar-fill");
  const progressText = document.getElementById("progress-text");
  const mailEl = document.getElementById("mail");
  let blobUrl = null;

  // 購入前の確認事項は3つとも同意しないと購入ボタンを押せない。
  const agreeBoxes = ["agree-content", "agree-nomod", "agree-noshare"].map((id) => document.getElementById(id));
  function syncMakeEnabled() {
    makeBtn.disabled = !agreeBoxes.every((box) => box.checked);
  }
  agreeBoxes.forEach((box) => box.addEventListener("change", syncMakeEnabled));
  syncMakeEnabled();

  makeBtn.addEventListener("click", async () => {
    // メールアドレスは必須（本番の購入確認メール送付先として使う想定）。
    if (!mailEl.value.trim() || !mailEl.checkValidity()) {
      mailEl.reportValidity();
      mailEl.focus();
      return;
    }
    const input = collectInput();
    makeBtn.disabled = true;
    makeNote.hidden = true;
    progress.hidden = false;
    const started = performance.now();

    try {
      const result = await SchedulePlanner.generate(input, {
        onProgress(message, ratio) {
          progressText.textContent = message;
          barFill.style.width = Math.round(ratio * 100) + "%";
        }
      });

      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));

      const link = document.getElementById("dl");
      link.href = blobUrl;
      link.download = `${input.title}.pdf`;
      document.getElementById("done-for").textContent = input.title;
      document.getElementById("s-pages").textContent = result.pageCount;
      document.getElementById("s-links").textContent = result.linkCount;
      document.getElementById("s-weeks").textContent = result.weekCount;
      document.getElementById("s-time").innerHTML =
        seconds + '<span style="font-size:14px">秒</span>';
      show(3);
    } catch (err) {
      progressText.textContent = "作成できませんでした: " + (err && err.message ? err.message : err);
      barFill.style.width = "0";
    } finally {
      syncMakeEnabled();
      setTimeout(() => { progress.hidden = true; makeNote.hidden = false; }, 600);
    }
  });