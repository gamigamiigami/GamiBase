"""旧Excel由来PDF向けのマーカーリンカーの検証。

リポジトリ同梱の実物 PDF（downloads/pdf-linkun-setsumeisho.pdf）を使う。
無い場合は skip。
"""

from pathlib import Path

import pytest

LEGACY_PDF = Path(__file__).resolve().parents[2] / "downloads" / "pdf-linkun-setsumeisho.pdf"

pytestmark = pytest.mark.skipif(not LEGACY_PDF.exists(), reason="旧PDFが無い")


@pytest.fixture(scope="module")
def markers():
    from planner.linker import find_markers

    return find_markers(LEGACY_PDF, page_count=86)


def test_finds_links(markers):
    assert len(markers) > 100


def test_week_pages_link_back_to_index(markers):
    """週ページ（3ページ目以降）から 1・2 ページ目に戻れること。"""
    by_page: dict[int, set[int]] = {}
    for link in markers:
        by_page.setdefault(link.source_page, set()).add(link.target_page)

    week_pages = range(2, 55)  # 0始まりで 3〜55ページ目
    covered = [p for p in week_pages if {0, 1} <= by_page.get(p, set())]
    assert len(covered) >= 50, "ほとんどの週ページに目次リンクが復元されるはず"


def test_targets_are_within_document(markers):
    for link in markers:
        assert 0 <= link.target_page < 86


def test_rects_are_sane(markers):
    for link in markers:
        x0, y0, x1, y1 = link.rect
        assert x1 > x0, "リンク領域の幅が0以下"
        assert y1 >= y0
        assert x1 - x0 < 700, "リンク領域が広すぎる（ページ幅を超えている）"


def _count_links(pdf) -> int:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf))
    return sum(
        1
        for page in reader.pages
        for a in (page.get("/Annots") or [])
        if a.get_object().get("/Subtype") == "/Link"
    )


def test_add_marker_links_writes_annotations(tmp_path):
    from planner.linker import add_marker_links

    # 元PDFには既にリンクが入っているため、増分で確認する
    before = _count_links(LEGACY_PDF)
    out = tmp_path / "linked.pdf"
    count = add_marker_links(LEGACY_PDF, out)
    assert count > 100
    assert _count_links(out) == before + count


def test_replace_existing_avoids_duplicate_links(tmp_path):
    """リンク付与済みPDFを再処理してもリンクが二重にならないこと。"""
    from planner.linker import add_marker_links

    out = tmp_path / "replaced.pdf"
    count = add_marker_links(LEGACY_PDF, out, replace_existing=True)
    assert _count_links(out) == count

    again = tmp_path / "replaced2.pdf"
    count2 = add_marker_links(out, again, replace_existing=True)
    assert _count_links(again) == count2 == count


def test_min_height_makes_targets_tappable(tmp_path):
    """マーカーが極小文字でも、指でタップできる高さに広げること。"""
    from pypdf import PdfReader
    from planner.linker import add_marker_links

    out = tmp_path / "linked.pdf"
    add_marker_links(LEGACY_PDF, out, min_height=12.0)
    reader = PdfReader(str(out))
    for page in reader.pages:
        for ref in page.get("/Annots") or []:
            annot = ref.get_object()
            if annot.get("/Subtype") != "/Link":
                continue
            rect = annot["/Rect"]
            height = float(rect[3]) - float(rect[1])
            assert height >= 12.0
