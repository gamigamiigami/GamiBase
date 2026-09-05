"""コマンドラインインタフェース。

    python -m planner build   --input input.json --out 完成.pdf
    python -m planner import-events --file 行事予定.xlsx --year 2025 --out events.json
    python -m planner link    --in 既存.pdf --out リンク付き.pdf
    python -m planner sample  --out input.json
    python -m planner check   --input input.json

手動運用（管理者が代行して出力する）モードでも、購入者セルフサービス化した後でも、
実際に PDF を作るのは常にこの build コマンド1本。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .models import InputError, load_input

SAMPLE = {
    "schoolYear": 2025,
    "title": "",
    "owner": {"name": "山田 太郎", "school": "○○市立○○中学校"},
    "timetable": {
        "grid": {
            "月": {"1": "２年５組", "3": "２年６組", "5": "特別支援"},
            "火": {"1": "３年１組", "2": "２年１組", "3": "２年２組", "5": "外国人"},
            "水": {"2": "２年３組", "3": "３年２組", "5": "外国人"},
            "木": {"1": "３年５組", "2": "２年４組", "3": "特別支援"},
            "金": {"2": "３年４組", "3": "３年６組", "4": "３年３組"},
        }
    },
    "events": [
        {"date": "2025-04-07", "title": "始業式"},
        {"date": "2025-04-08", "title": "入学式"},
        {"date": "2025-07-18", "title": "終業式", "note": "午前日課"},
        {"date": "2026-03-06", "title": "卒業式"},
    ],
    "freePages": 30,
    "license": {"orderId": "", "issuedTo": "", "watermark": True},
}


def _cmd_build(args: argparse.Namespace) -> int:
    from .render import RenderError, build_pdf

    try:
        data = load_input(args.input)
    except InputError as exc:
        print(f"入力エラー: {exc}", file=sys.stderr)
        return 2

    try:
        out = build_pdf(data, args.out)
    except RenderError as exc:
        print(f"生成エラー: {exc}", file=sys.stderr)
        return 3

    from .calendarmodel import PlannerCalendar
    from .postprocess import count_links

    cal = PlannerCalendar(data)
    print(f"生成しました: {out}")
    print(f"  年度      : 令和{data.reiwa_year}年度（{data.start_date} 〜 {data.end_date}）")
    print(f"  週ページ  : {cal.week_count} 週")
    print(f"  自由ページ: {data.free_pages}")
    print(f"  総ページ  : {cal.total_pages}")
    print(f"  リンク数  : {count_links(out)}")
    return 0


def _cmd_import_events(args: argparse.Namespace) -> int:
    from .events_import import import_events

    result = import_events(args.file, args.year)
    for warning in result.warnings:
        print(f"警告: {warning}", file=sys.stderr)
    if not result.events:
        print("行事を1件も読み取れませんでした。", file=sys.stderr)
        return 2

    payload = json.dumps(result.events, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
        print(f"{result.count} 件を書き出しました: {args.out}")
        print("※ 内容を必ず目視で確認してから build に渡してください。")
    else:
        print(payload)
    return 0


def _cmd_link(args: argparse.Namespace) -> int:
    from .linker import add_marker_links

    count = add_marker_links(args.src, args.out)
    print(f"リンクを {count} 件付与しました: {args.out}")
    if count == 0:
        print("マーカー（Pn …Pn）が見つかりませんでした。", file=sys.stderr)
        return 2
    return 0


def _cmd_sample(args: argparse.Namespace) -> int:
    payload = json.dumps(SAMPLE, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
        print(f"サンプル入力を書き出しました: {args.out}")
    else:
        print(payload)
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    from .calendarmodel import PlannerCalendar

    try:
        data = load_input(args.input)
    except InputError as exc:
        print(f"入力エラー: {exc}", file=sys.stderr)
        return 2
    cal = PlannerCalendar(data)
    print("入力は正しい形式です。")
    print(f"  年度      : 令和{data.reiwa_year}年度（{data.start_date} 〜 {data.end_date}）")
    print(f"  週ページ  : {cal.week_count} 週（第1週の月曜: {cal.first_monday}）")
    print(f"  行事      : {len(data.events)} 件")
    print(f"  総ページ  : {cal.total_pages}")
    return 0


def _store(args: argparse.Namespace):
    """注文台帳を開く。署名鍵は環境変数 PLANNER_SECRET から取る。"""
    import os

    from .orders import OrderStore

    secret = os.environ.get("PLANNER_SECRET", "")
    if not secret:
        print(
            "環境変数 PLANNER_SECRET が未設定です。ダウンロードURLの署名鍵として必ず設定してください。\n"
            "  例: export PLANNER_SECRET=\"$(python3 -c 'import secrets;print(secrets.token_hex(32))')\"",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return OrderStore(args.db, secret=secret)


def _cmd_order_new(args: argparse.Namespace) -> int:
    from .orders import OrderError

    store = _store(args)
    try:
        order = store.create_order(
            product=args.product,
            issued_to=args.name or "",
            email=args.email or "",
            order_id=args.order_id,
            max_downloads=args.max_downloads,
        )
    except OrderError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 2
    print(f"注文を作成しました: {order.order_id}")
    print(f"  商品        : {order.product}")
    print(f"  購入者      : {order.issued_to} {order.email}")
    print(f"  DL上限      : {order.max_downloads} 回")
    return 0


def _cmd_order_build(args: argparse.Namespace) -> int:
    """注文に紐づけて生成する。1注文1生成をここで強制する。"""
    from .orders import OrderError
    from .render import RenderError, build_pdf

    store = _store(args)
    try:
        order = store.get(args.order_id)
    except OrderError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 2

    try:
        raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"入力ファイルを読めません: {exc}", file=sys.stderr)
        return 2

    # 透かしと追跡情報を注文から流し込む（購入者の指定より優先する）
    raw["license"] = {
        "orderId": order.order_id,
        "issuedTo": order.issued_to,
        "watermark": True,
    }

    try:
        data = load_input_from_dict(raw)
    except InputError as exc:
        print(f"入力エラー: {exc}", file=sys.stderr)
        return 2

    # 先に権利を確認し、生成が成功してから消費する。
    # 逆順にすると、生成に失敗しただけで購入者の権利が消えてしまう。
    try:
        store.ensure_can_generate(order.order_id)
    except OrderError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 3

    try:
        out = build_pdf(data, args.out)
    except RenderError as exc:
        print(f"生成エラー: {exc}（権利は消費していません。修正して再実行できます）", file=sys.stderr)
        return 4

    store.claim_generation(order.order_id, raw)
    store.attach_pdf(order.order_id, out)
    token = store.issue_download_token(order.order_id, ttl_hours=args.ttl_hours)
    print(f"生成しました: {out}")
    print(f"  注文        : {order.order_id}（{order.issued_to}）")
    print(f"  DLトークン  : {token}")
    print(f"  有効期限    : {args.ttl_hours} 時間 / 残り {order.max_downloads} 回")
    return 0


def _cmd_order_list(args: argparse.Namespace) -> int:
    store = _store(args)
    orders = store.list_orders()
    if not orders:
        print("注文はありません。")
        return 0
    print(f"{'注文ID':<18}{'商品':<16}{'購入者':<12}{'生成':<6}{'DL'}")
    for order in orders:
        state = "済" if order.is_generated else "未"
        print(
            f"{order.order_id:<18}{order.product:<16}{order.issued_to:<12}"
            f"{state:<6}{order.download_count}/{order.max_downloads}"
        )
    return 0


def _cmd_order_allow_regen(args: argparse.Namespace) -> int:
    from .orders import OrderError

    store = _store(args)
    try:
        store.allow_regeneration(args.order_id)
    except OrderError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 2
    print(f"注文 {args.order_id} の再生成を1回だけ許可しました。")
    return 0


def load_input_from_dict(raw: dict):
    from .models import parse_input

    return parse_input(raw)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="planner",
        description="時間割・行事予定からリンク付きスケジュール帳PDFを生成する",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build", help="入力JSONからPDFを生成する")
    p_build.add_argument("--input", "-i", required=True, help="入力JSONのパス")
    p_build.add_argument("--out", "-o", required=True, help="出力PDFのパス")
    p_build.set_defaults(func=_cmd_build)

    p_import = sub.add_parser("import-events", help="学校の行事予定表を取り込んで events を作る")
    p_import.add_argument("--file", "-f", required=True, help="CSV / Excel のパス")
    p_import.add_argument("--year", "-y", type=int, required=True, help="年度（例: 2025）")
    p_import.add_argument("--out", "-o", help="出力JSONのパス（省略時は標準出力）")
    p_import.set_defaults(func=_cmd_import_events)

    p_link = sub.add_parser("link", help="既存PDFにマーカー方式でリンクを付ける（旧Excel用）")
    p_link.add_argument("--in", "-i", dest="src", required=True, help="入力PDF")
    p_link.add_argument("--out", "-o", required=True, help="出力PDF")
    p_link.set_defaults(func=_cmd_link)

    p_sample = sub.add_parser("sample", help="入力JSONのひな形を出力する")
    p_sample.add_argument("--out", "-o", help="出力先（省略時は標準出力）")
    p_sample.set_defaults(func=_cmd_sample)

    p_check = sub.add_parser("check", help="入力JSONを検証する（PDFは作らない）")
    p_check.add_argument("--input", "-i", required=True, help="入力JSONのパス")
    p_check.set_defaults(func=_cmd_check)

    # -- 受注管理（1注文1生成の強制） -------------------------------------
    def add_db(p: argparse.ArgumentParser) -> None:
        p.add_argument("--db", default="orders.db", help="注文台帳のパス（既定: orders.db）")

    p_new = sub.add_parser("order-new", help="注文を登録する")
    add_db(p_new)
    p_new.add_argument("--product", required=True, help="商品名（例: 令和8年度版）")
    p_new.add_argument("--name", help="購入者名")
    p_new.add_argument("--email", help="購入者メールアドレス")
    p_new.add_argument("--order-id", help="注文ID（省略時は自動採番）")
    p_new.add_argument("--max-downloads", type=int, default=3, help="ダウンロード上限回数")
    p_new.set_defaults(func=_cmd_order_new)

    p_obuild = sub.add_parser("order-build", help="注文に紐づけてPDFを生成する（1注文1回のみ）")
    add_db(p_obuild)
    p_obuild.add_argument("--order-id", required=True, help="注文ID")
    p_obuild.add_argument("--input", "-i", required=True, help="入力JSONのパス")
    p_obuild.add_argument("--out", "-o", required=True, help="出力PDFのパス")
    p_obuild.add_argument("--ttl-hours", type=int, default=72, help="DLリンクの有効時間")
    p_obuild.set_defaults(func=_cmd_order_build)

    p_olist = sub.add_parser("order-list", help="注文一覧を表示する")
    add_db(p_olist)
    p_olist.set_defaults(func=_cmd_order_list)

    p_oregen = sub.add_parser("order-allow-regen", help="再生成を1回だけ許可する")
    add_db(p_oregen)
    p_oregen.add_argument("--order-id", required=True, help="注文ID")
    p_oregen.set_defaults(func=_cmd_order_allow_regen)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
