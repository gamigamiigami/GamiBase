"""PDF を実際に生成して検証する。

Chromium が必要なため、無い環境では skip する。
ここが通れば「購入者に渡して壊れていない」ことの最低保証になる。
"""

import pytest
from planner.calendarmodel import PlannerCalendar
from planner.models import parse_input
from planner.render import _chromium_path, build_pdf, render_html

pytest.importorskip("playwright")
pytestmark = pytest.mark.skipif(_chromium_path() is None, reason="Chromium が見つからない")

SMALL = {
    "schoolYear": 2025,
    "freePages": 2,
    "owner": {"name": "山田 太郎", "school": "テスト中学校"},
    "timetable": {"grid": {"月": {"1": "２年１組"}, "金": {"6": "３年３組"}}},
    "events": [
        {"date": "2025-04-08", "title": "入学式"},
        {"date": "2026-03-06", "title": "卒業式", "note": "午前"},
    ],
    "license": {"orderId": "ORD-TEST", "issuedTo": "山田 太郎"},
}


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    data = parse_input(SMALL)
    out = tmp_path_factory.mktemp("pdf") / "out.pdf"
    build_pdf(data, out)
    return data, out


def test_page_count_matches_model(built):
    from pypdf import PdfReader

    data, out = built
    cal = PlannerCalendar(data)
    assert len(PdfReader(str(out)).pages) == cal.total_pages


def test_every_link_points_to_a_real_page(built):
    """名前付きデスティネーションが実体化され、全リンクがページを直接指していること。

    これが壊れると GoodNotes でリンクを押しても飛ばない。
    """
    from pypdf import PdfReader

    _data, out = built
    reader = PdfReader(str(out))
    pages = [p.get_object() for p in reader.pages]

    total = 0
    for page in reader.pages:
        for ref in page.get("/Annots") or []:
            annot = ref.get_object()
            if annot.get("/Subtype") != "/Link":
                continue
            total += 1
            dest = annot.get("/Dest")
            assert isinstance(dest, list), "リンクが名前付きのまま残っている"
            target = dest[0].get_object() if hasattr(dest[0], "get_object") else dest[0]
            assert any(target == p for p in pages), "リンク先が実在するページでない"
    assert total > 100, f"リンクが少なすぎる: {total}"


def test_year_calendar_links_to_week_pages(built):
    from pypdf import PdfReader

    data, out = built
    cal = PlannerCalendar(data)
    reader = PdfReader(str(out))
    pages = [p.get_object() for p in reader.pages]

    targets = set()
    for ref in reader.pages[0].get("/Annots") or []:
        annot = ref.get_object()
        if annot.get("/Subtype") != "/Link":
            continue
        dest = annot.get("/Dest")
        target = dest[0].get_object() if hasattr(dest[0], "get_object") else dest[0]
        for i, page in enumerate(pages, start=1):
            if page == target:
                targets.add(i)

    week_pages = {w.page for w in cal.weeks}
    # 年間カレンダーの日付から、ほとんどの週ページに飛べること
    assert len(targets & week_pages) >= cal.week_count - 2


def test_outline_present(built):
    from pypdf import PdfReader

    data, out = built
    cal = PlannerCalendar(data)
    outline = PdfReader(str(out)).outline
    assert len(outline) == cal.total_pages


def test_metadata_carries_order_id(built):
    from pypdf import PdfReader

    _data, out = built
    meta = PdfReader(str(out)).metadata
    assert meta.get("/OrderID") == "ORD-TEST"


def test_watermark_text_in_html():
    data = parse_input(SMALL)
    html = render_html(data)
    assert "ORD-TEST" in html
    assert "山田 太郎" in html


def test_watermark_can_be_disabled():
    raw = dict(SMALL)
    raw["license"] = {"orderId": "ORD-X", "issuedTo": "誰か", "watermark": False}
    html = render_html(parse_input(raw))
    # 透かし表示は消えるが、追跡用にメタデータへは残す設計
    assert "ORD-X" not in html


def test_lessons_rendered(built):
    data, _out = built
    html = render_html(data)
    assert "２年１組" in html
    assert "３年３組" in html


def test_events_rendered(built):
    data, _out = built
    html = render_html(data)
    assert "入学式" in html
    assert "卒業式（午前）" in html
