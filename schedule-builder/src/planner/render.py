"""HTML を組み立て、Chromium（Playwright）で PDF に変換する。

ページ内リンク（<a href="#pN">）は Chromium が PDF のリンク注釈に変換するため、
「マーカー文字を印字してから後処理でリンクを貼る」現行方式（伊神モード）は不要になる。
ただし既存 Excel 由来の PDF を扱えるよう、その方式は linker.py に残してある。
"""

from __future__ import annotations

import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .calendarmodel import PlannerCalendar
from .models import PlannerInput

__all__ = ["render_html", "build_pdf", "RenderError"]

_HERE = Path(__file__).parent
_TEMPLATES = _HERE / "templates"
_STATIC = _HERE / "static"


class RenderError(RuntimeError):
    """PDF 生成に失敗したとき。"""


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(_TEMPLATES)),
        undefined=StrictUndefined,
        autoescape=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )


def _chromium_path() -> str | None:
    """使用する Chromium を探す。

    Playwright が自前で入れたブラウザがあればそれを使う（None を返す）。
    見つからない場合は環境に既にある Chromium を使う。バージョン差で
    `playwright install` が必要になる事故を避けるため。
    """
    import shutil

    explicit = os.environ.get("PLANNER_CHROMIUM_PATH")
    if explicit:
        return explicit
    for candidate in (
        "/opt/pw-browsers/chromium",
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("google-chrome"),
    ):
        if candidate and Path(candidate).exists():
            return candidate
    return None


def render_html(data: PlannerInput) -> str:
    """1冊分の HTML を返す。PDF 化しないので単体テストが速い。"""
    cal = PlannerCalendar(data)
    template = _env().get_template("planner.html.j2")
    return template.render(
        data=data,
        cal=cal,
        css=(_STATIC / "planner.css").read_text(encoding="utf-8"),
        watermark=data.license.watermark_text,
        legend=_legend(data),
    )


def _legend(data: PlannerInput) -> list[dict[str, str]]:
    """1ページ目に出す凡例。使われている授業の色と、長期休業を並べる。"""
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in data.timetable.grid.values():
        for lesson in row.values():
            if lesson.color and lesson.color not in seen and lesson.background:
                seen.add(lesson.color)
                # 同じ色の授業名をまとめて凡例のラベルにする
                names = sorted(
                    {
                        other.name
                        for r in data.timetable.grid.values()
                        for other in r.values()
                        if other.color == lesson.color and other.name
                    }
                )
                items.append(
                    {"background": lesson.background, "label": "・".join(names[:6])}
                )
    for period in data.breaks:
        items.append(
            {
                "background": "#efe4f5",
                "label": f"{period.name}（{period.start.month}/{period.start.day}〜{period.end.month}/{period.end.day}）",
            }
        )
    return items


def build_pdf(data: PlannerInput, out_path: str | Path) -> Path:
    """HTML を生成し、Chromium で PDF に印刷する。

    生成される PDF のページ数は cal.total_pages と一致するはずで、
    一致しない場合はレイアウト崩れ（1ページに収まっていない）なので例外にする。
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - 環境依存
        raise RenderError(
            "playwright がインストールされていません。`pip install playwright` を実行してください"
        ) from exc

    # file:// URI を作るため絶対パスにする（相対パスのままだと変換に失敗する）
    out = Path(out_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    html = render_html(data)
    cal = PlannerCalendar(data)

    # HTML を一時ファイルに書き、file:// で読ませる。
    # set_content だとアンカーリンクの解決に失敗することがあるため。
    tmp_html = out.with_suffix(".build.html")
    tmp_html.write_text(html, encoding="utf-8")

    launch_args = ["--font-render-hinting=none"]
    if os.geteuid() == 0:  # コンテナ内で root 実行されることが多いため
        launch_args.append("--no-sandbox")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=launch_args, executable_path=_chromium_path())
            try:
                page = browser.new_page()
                page.goto(tmp_html.as_uri(), wait_until="load")
                page.emulate_media(media="print")
                page.pdf(
                    path=str(out),
                    prefer_css_page_size=True,
                    print_background=True,
                    margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                )
            finally:
                browser.close()
    except Exception as exc:  # pragma: no cover - 環境依存
        raise RenderError(f"PDF の生成に失敗しました: {exc}") from exc
    finally:
        tmp_html.unlink(missing_ok=True)

    from .postprocess import finalize

    rewritten = finalize(
        out,
        title=data.display_title,
        author=data.owner.name,
        order_id=data.license.order_id,
        outline=_outline(cal),
    )
    if rewritten == 0:
        raise RenderError(
            "リンクの実体化に失敗しました（0件）。生成された PDF のリンクが機能しない可能性があります"
        )

    _verify(out, expected_pages=cal.total_pages)
    return out


def _outline(cal: PlannerCalendar) -> list[tuple[str, int]]:
    """GoodNotes のサイドバーに出るしおり。"""
    items: list[tuple[str, int]] = [("年間カレンダー", 1), ("年間行事予定", 2)]
    for week in cal.weeks:
        items.append((f"{week.label}（{week.range_text}）", week.page))
    for i, page_no in enumerate(cal.free_pages, start=1):
        items.append((f"自由 {i}", page_no))
    return items


def _verify(pdf_path: Path, expected_pages: int) -> None:
    """ページ数とリンクの有無を検査する。生成物の壊れを早期に検出する。"""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    actual = len(reader.pages)
    if actual != expected_pages:
        raise RenderError(
            f"ページ数が想定と違います（想定 {expected_pages} / 実際 {actual}）。"
            "内容が1ページに収まっていない可能性があります"
        )
    links = sum(1 for page in reader.pages for a in page.get("/Annots") or [] if a.get_object().get("/Subtype") == "/Link")
    if links == 0:
        raise RenderError("PDF 内にリンクが1つもありません。アンカーリンクの生成に失敗しています")
