"""購入〜入力〜生成〜ダウンロードの一連の流れを動かす Web アプリ。

    python3 -m planner serve            # http://127.0.0.1:5000 で起動

決済は差し替え可能な1点（`/checkout`）に閉じ込めてある。
既定は「テストモード（無料）」で、決済を通さずに購入フローを最後まで試せる。
本番では `/checkout` を Stripe の Webhook などに置き換え、
決済完了時に `store.create_order(...)` を呼んで入力フォームURLを購入者に送る。

流れ:
    /                購入ページ（年度を選ぶ）
    /checkout        注文を作る → 入力フォームURLを発行
    /setup/<token>   購入者が時間割・行事・長期休業を入力
    /done/<token>    生成完了。ダウンロードURLを表示
    /download/<token> PDF を渡す（回数を消費）
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import tempfile
from pathlib import Path

from .models import InputError, LESSON_COLORS, WEEKDAYS, parse_input
from .orders import OrderError, OrderStore, TokenError

LESSON_PERIODS = ["1", "2", "3", "4", "5", "6"]

_COLOR_LABELS = [
    ("", "なし"),
    ("red", "赤"),
    ("blue", "青"),
    ("green", "緑"),
    ("yellow", "黄"),
    ("gray", "灰"),
]

_PAGE_CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f6f7f9; color: #16181d;
       font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; line-height: 1.6; }
.wrap { max-width: 980px; margin: 0 auto; }
.card { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 24px 0 8px; padding-bottom: 6px; border-bottom: 2px solid #eceff3; }
h2:first-of-type { margin-top: 0; }
p.lead { color: #5b6472; margin: 0 0 20px; }
.testbar { background: #fff4d6; border: 1px solid #e8c765; border-radius: 10px;
           padding: 10px 14px; margin-bottom: 20px; font-size: 14px; }
label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
input[type=text], input[type=email], input[type=date], input[type=number], select, textarea {
  width: 100%; padding: 8px 10px; border: 1px solid #ccd2da; border-radius: 7px;
  font: inherit; background: #fff; }
textarea { min-height: 110px; font-family: ui-monospace, monospace; font-size: 13px; }
.row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.row > div { flex: 1 1 200px; }
table.tt { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
table.tt th, table.tt td { border: 1px solid #dfe3e9; padding: 5px; vertical-align: top; }
table.tt th { background: #f2f4f7; font-size: 13px; width: 60px; }
table.tt thead th { text-align: center; width: auto; }
table.tt input { margin-bottom: 4px; padding: 6px 8px; }
table.tt select { padding: 4px 6px; font-size: 12px; }
.btn { display: inline-block; background: #2f6df6; color: #fff; border: 0; border-radius: 8px;
       padding: 12px 22px; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
.btn:hover { background: #2559cf; }
.btn.big { font-size: 17px; padding: 14px 30px; }
.err { background: #fdecec; border: 1px solid #e9a3a3; color: #a12626;
       border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; white-space: pre-wrap; }
.ok { background: #e8f6ec; border: 1px solid #8fca a0; border-radius: 8px; padding: 14px; }
code { background: #f0f2f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
.meta { font-size: 13px; color: #5b6472; }
.badge { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
         font-size: 11px; font-weight: 700; vertical-align: 1px; }
.badge.req { background: #fde8e8; color: #a12626; border: 1px solid #e9a3a3; }
.badge.opt { background: #eef1f5; color: #6b7684; border: 1px solid #d7dde4; }
.btn-sub { background: #fff; color: #40495a; border: 1px solid #ccd2da; border-radius: 7px;
           padding: 7px 14px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-sub:hover { background: #f2f4f7; border-color: #aab3bf; }
.tt-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
           flex-wrap: wrap; margin-bottom: 8px; }
.swatch-red { background: #fde0e0; } .swatch-blue { background: #dce8fb; }
.swatch-green { background: #dff2e0; } .swatch-yellow { background: #fdf3d0; }
.swatch-gray { background: #e8e8e8; }
"""


def _page(title: str, body: str, *, test_mode: bool = True) -> str:
    bar = (
        '<div class="testbar">🧪 <strong>テストモード</strong>：'
        "決済は行われません。購入フローの確認用です。</div>"
        if test_mode
        else ""
    )
    return f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>{_PAGE_CSS}</style></head>
<body><div class="wrap">{bar}{body}</div></body></html>"""


def create_app(
    *,
    db_path: str | Path = "orders.db",
    secret: str | None = None,
    output_dir: str | Path = "generated",
    test_mode: bool = True,
):
    """Flask アプリを作る。"""
    from flask import Flask, redirect, request, send_file, url_for

    secret = secret or os.environ.get("PLANNER_SECRET", "")
    if not secret:
        raise RuntimeError(
            "PLANNER_SECRET が設定されていません。\n"
            "  export PLANNER_SECRET=\"$(python3 -c 'import secrets;print(secrets.token_hex(32))')\""
        )

    app = Flask(__name__)
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    def store() -> OrderStore:
        # SQLite の接続はスレッドをまたげないため、リクエストごとに開く
        return OrderStore(db_path, secret=secret)

    # -- 購入ページ -------------------------------------------------------

    @app.get("/")
    def index():
        this_year = _dt.date.today().year
        options = "".join(
            f'<option value="{y}">令和{y - 2018}年度（{y}年4月〜{y + 1}年3月）</option>'
            for y in range(this_year - 1, this_year + 3)
        )
        body = f"""
<div class="card">
  <h1>先生のスケジュール帳</h1>
  <p class="lead">時間割と行事予定を入力すると、リンク付きPDFを自動で作ります。
     GoodNotes に取り込んで、そのまま手書きで使えます。</p>
  <form method="post" action="{url_for('checkout')}">
    <div class="row">
      <div>
        <label for="year">年度を選ぶ</label>
        <select id="year" name="year">{options}</select>
      </div>
      <div>
        <label for="name">お名前</label>
        <input type="text" id="name" name="name" placeholder="山田 太郎" required>
      </div>
      <div>
        <label for="email">メールアドレス</label>
        <input type="email" id="email" name="email" placeholder="you@example.com">
      </div>
    </div>
    <button class="btn big" type="submit">テスト購入する（無料）</button>
    <p class="meta" style="margin-top:12px">
      本番ではここが決済ボタンになります。決済完了後に同じ入力フォームへ進みます。</p>
  </form>
</div>"""
        return _page("先生のスケジュール帳", body, test_mode=test_mode)

    @app.post("/checkout")
    def checkout():
        """決済の代わり。本番ではここを決済Webhookに置き換える。"""
        db = store()
        try:
            year = int(request.form.get("year", "0"))
            order = db.create_order(
                product=f"令和{year - 2018}年度版",
                issued_to=request.form.get("name", "").strip(),
                email=request.form.get("email", "").strip(),
            )
            token = db.issue_setup_token(order.order_id)
        finally:
            db.close()
        return redirect(url_for("setup", token=token, year=year))

    # -- 入力フォーム -----------------------------------------------------

    @app.get("/setup/<path:token>")
    def setup(token: str):
        db = store()
        try:
            order = db.verify_setup_token(token)
        except TokenError as exc:
            return _page("エラー", f'<div class="card"><div class="err">{exc}</div></div>'), 400
        finally:
            db.close()

        year = _safe_year(request.args.get("year"))
        return _page(
            "入力フォーム",
            _setup_form(token, order, year, error=""),
            test_mode=test_mode,
        )

    @app.post("/setup/<path:token>")
    def submit(token: str):
        db = store()
        try:
            order = db.verify_setup_token(token)
        except TokenError as exc:
            db.close()
            return _page("エラー", f'<div class="card"><div class="err">{exc}</div></div>'), 400

        form = request.form
        year = _safe_year(form.get("year"))

        try:
            raw = _form_to_input(form, request.files.get("events_file"), order)
            data = parse_input(raw)
            db.ensure_can_generate(order.order_id)
        except (InputError, OrderError) as exc:
            db.close()
            return (
                _page("入力フォーム", _setup_form(token, order, year, error=str(exc)), test_mode=test_mode),
                400,
            )

        from .render import RenderError, build_pdf

        pdf_path = out_dir / f"{order.order_id}.pdf"
        try:
            build_pdf(data, pdf_path)
        except RenderError as exc:
            db.close()
            return (
                _page(
                    "入力フォーム",
                    _setup_form(token, order, year, error=f"PDFの作成に失敗しました: {exc}"),
                    test_mode=test_mode,
                ),
                500,
            )

        # 生成が成功してから権利を消費する
        db.claim_generation(order.order_id, raw)
        db.attach_pdf(order.order_id, pdf_path)
        download_token = db.issue_download_token(order.order_id)
        db.close()
        return redirect(url_for("done", token=download_token))

    # -- 完了・ダウンロード -----------------------------------------------

    @app.get("/done/<path:token>")
    def done(token: str):
        parts = token.split(":")
        db = store()
        try:
            order = db.get(parts[0])
        except (OrderError, IndexError):
            db.close()
            return _page("エラー", '<div class="card"><div class="err">注文が見つかりません</div></div>'), 404
        db.close()

        url = url_for("download", token=token, _external=True)
        body = f"""
<div class="card">
  <h1>できあがりました</h1>
  <div class="ok">
    <p><strong>{order.issued_to} 様</strong>／注文番号 <code>{order.order_id}</code></p>
    <p>下のボタンからダウンロードしてください。</p>
    <p><a class="btn big" href="{url_for('download', token=token)}">PDFをダウンロード</a></p>
  </div>
  <h2>ご注意</h2>
  <ul class="meta">
    <li>このダウンロードURLは<strong>72時間有効</strong>・<strong>{order.max_downloads}回まで</strong>です。</li>
    <li>PDFには購入者名と注文番号が薄く入っています。再配布はご遠慮ください。</li>
    <li>入力し直しての作り直しは、お問い合わせください。</li>
  </ul>
  <p class="meta">URL: <code>{url}</code></p>
</div>"""
        return _page("完了", body, test_mode=test_mode)

    @app.get("/download/<path:token>")
    def download(token: str):
        db = store()
        try:
            order = db.redeem_download_token(token)
        except (TokenError, OrderError) as exc:
            db.close()
            return _page("エラー", f'<div class="card"><div class="err">{exc}</div></div>'), 403
        db.close()

        if not order.pdf_path or not Path(order.pdf_path).exists():
            return _page("エラー", '<div class="card"><div class="err">PDFが見つかりません</div></div>'), 404
        return send_file(
            order.pdf_path,
            as_attachment=True,
            download_name=f"{order.product}_{order.issued_to or order.order_id}.pdf",
            mimetype="application/pdf",
        )

    return app


# --------------------------------------------------------------------------
# フォームの組み立てと読み取り
# --------------------------------------------------------------------------


def _safe_year(value) -> int:
    """URL やフォームから来た年度を、扱える範囲に収める。"""
    try:
        year = int(value)
    except (TypeError, ValueError):
        return _dt.date.today().year
    return year if 1990 <= year <= 2099 else _dt.date.today().year


def _setup_form(token: str, order, year: int, *, error: str) -> str:
    from flask import url_for

    color_options = "".join(f'<option value="{v}">{label}</option>' for v, label in _COLOR_LABELS)

    rows = []
    for period in LESSON_PERIODS:
        cells = []
        for weekday in WEEKDAYS:
            cells.append(
                f'<td><input type="text" name="lesson_{weekday}_{period}" placeholder="授業・クラス">'
                f'<select name="color_{weekday}_{period}">{color_options}</select></td>'
            )
        rows.append(f'<tr><th>{period}限</th>{"".join(cells)}</tr>')
    head = "".join(f"<th>{w}</th>" for w in WEEKDAYS)

    # 長期休業は、よくある期間をあらかじめ入れておく（そのまま使えるように）
    defaults = [
        ("夏季休業", f"{year}-07-21", f"{year}-08-31"),
        ("冬季休業", f"{year}-12-25", f"{year + 1}-01-07"),
        ("学年末休業", f"{year + 1}-03-25", f"{year + 1}-03-31"),
    ]
    break_rows = []
    for i, (name, start, end) in enumerate(defaults):
        break_rows.append(
            f"""<div class="row">
  <div><label>名称</label><input type="text" name="break_name_{i}" value="{name}"></div>
  <div><label>開始</label><input type="date" name="break_start_{i}" value="{start}"></div>
  <div><label>終了</label><input type="date" name="break_end_{i}" value="{end}"></div>
</div>"""
        )

    error_html = f'<div class="err">{error}</div>' if error else ""

    return f"""
<div class="card">
  <h1>スケジュール帳の内容を入力</h1>
  <p class="lead">注文番号 <code>{order.order_id}</code>／{order.product}<br>
     <strong>入力して作成できるのは1回だけ</strong>です。内容をよく確認してから作成してください。</p>
  {error_html}
  <form method="post" action="{url_for('submit', token=token)}" enctype="multipart/form-data">
    <input type="hidden" name="year" value="{year}">

    <h2>1. 基本情報</h2>
    <p class="meta" style="margin-top:-4px">
      入力が必要なのは<strong>自由ページ数</strong>だけです。ほかは空欄のままでも作成できます。</p>
    <div class="row">
      <div>
        <label>お名前<span class="badge opt">任意</span></label>
        <input type="text" name="owner_name" value="{order.issued_to}" placeholder="表紙に載せる名前（空欄でも可）">
      </div>
      <div>
        <label>学校名<span class="badge opt">任意</span></label>
        <input type="text" name="owner_school" placeholder="○○市立○○中学校（空欄でも可）">
      </div>
      <div>
        <label>自由ページ数<span class="badge req">必須</span></label>
        <input type="number" name="free_pages" value="30" min="0" max="200" required>
      </div>
    </div>

    <h2>2. 時間割<span class="badge opt">任意</span></h2>
    <div class="tt-head">
      <p class="meta" style="margin:0">授業・クラス名と、色を選んでください。空欄の枠は空きコマになります。</p>
      <button type="button" class="btn-sub" id="clear-tt">時間割をまっさらにする</button>
    </div>
    <table class="tt">
      <thead><tr><th></th>{head}</tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>

    <h2>3. 長期休業<span class="badge opt">任意</span></h2>
    <p class="meta">よくある期間を入れてあります。学校に合わせて直してください。不要な行は名称を空にすると無視されます。</p>
    {"".join(break_rows)}

    <h2>4. 年間行事予定<span class="badge opt">任意</span></h2>
    <p class="meta">学校の行事予定表（CSV / Excel）をアップロードするか、下に貼り付けてください。<br>
       書式:「日付,行事名」を1行ずつ（例: <code>4/8,入学式</code>）。日付は <code>4/8</code>・<code>4月8日</code>・<code>2025-04-08</code> のいずれでも読めます。</p>
    <div class="row">
      <div><label>ファイルから読み込む</label><input type="file" name="events_file" accept=".csv,.tsv,.txt,.xlsx,.xlsm"></div>
    </div>
    <label>または直接貼り付け</label>
    <textarea name="events_text" placeholder="4/7,始業式&#10;4/8,入学式&#10;10/25,体育大会&#10;3/6,卒業式"></textarea>

    <p style="margin-top:22px">
      <button class="btn big" type="submit">この内容で作成する（1回限り）</button>
    </p>
  </form>
</div>
<script>
  // 時間割をまとめて空にする。押し間違いで消えないよう一度確認する。
  document.getElementById("clear-tt").addEventListener("click", function () {{
    var table = document.querySelector("table.tt");
    var filled = [].slice.call(table.querySelectorAll("input")).filter(function (i) {{
      return i.value.trim() !== "";
    }});
    if (filled.length && !confirm("時間割の入力をすべて消します。よろしいですか？")) return;
    [].forEach.call(table.querySelectorAll("input"), function (i) {{ i.value = ""; }});
    [].forEach.call(table.querySelectorAll("select"), function (s) {{ s.value = ""; }});
  }});
</script>"""


def _form_to_input(form, uploaded, order) -> dict:
    """フォームの内容を input.json 相当の辞書にする。"""
    year = _safe_year(form.get("year"))

    grid: dict[str, dict[str, dict[str, str]]] = {}
    for weekday in WEEKDAYS:
        row: dict[str, dict[str, str]] = {}
        for period in LESSON_PERIODS:
            name = (form.get(f"lesson_{weekday}_{period}") or "").strip()
            if not name:
                continue
            color = (form.get(f"color_{weekday}_{period}") or "").strip()
            row[period] = {"name": name, "color": color}
        if row:
            grid[weekday] = row

    breaks = []
    for i in range(6):
        name = (form.get(f"break_name_{i}") or "").strip()
        start = (form.get(f"break_start_{i}") or "").strip()
        end = (form.get(f"break_end_{i}") or "").strip()
        if name and start and end:
            breaks.append({"name": name, "start": start, "end": end})

    events = _collect_events(form, uploaded, year)

    return {
        "schoolYear": year,
        "owner": {
            "name": (form.get("owner_name") or order.issued_to or "").strip(),
            "school": (form.get("owner_school") or "").strip(),
        },
        "timetable": {"grid": grid},
        "breaks": breaks,
        "events": events,
        "freePages": int(form.get("free_pages") or 30),
        "license": {
            "orderId": order.order_id,
            "issuedTo": order.issued_to,
            "watermark": True,
        },
    }


def _collect_events(form, uploaded, year: int) -> list[dict[str, str]]:
    """アップロードファイルと貼り付けテキストの両方から行事を集める。"""
    from .events_import import import_events

    events: list[dict[str, str]] = []

    if uploaded is not None and uploaded.filename:
        suffix = Path(uploaded.filename).suffix or ".csv"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            uploaded.save(tmp.name)
            path = Path(tmp.name)
        try:
            events += import_events(path, year).events
        finally:
            path.unlink(missing_ok=True)

    text = (form.get("events_text") or "").strip()
    if text:
        # 見出し行が無くても読めるように補う
        header = "" if text.splitlines()[0].startswith("日付") else "日付,行事\n"
        with tempfile.NamedTemporaryFile("w", suffix=".csv", encoding="utf-8", delete=False) as tmp:
            tmp.write(header + text)
            path = Path(tmp.name)
        try:
            events += import_events(path, year).events
        finally:
            path.unlink(missing_ok=True)

    seen = set()
    unique = []
    for event in events:
        key = (event["date"], event["title"])
        if key not in seen:
            seen.add(key)
            unique.append(event)
    return sorted(unique, key=lambda e: (e["date"], e["title"]))
