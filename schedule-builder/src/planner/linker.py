"""既存 PDF に「Pn … Pn」マーカー方式でリンクを貼る（伊神モードのサーバー移植）。

現行の PDFリンくん（ブラウザ版）と同じ考え方:
  ページ上に `P12` というトークンが2回印字されていたら、その2つに挟まれた矩形を
  「12ページ目へ飛ぶリンク」にする。マーカーは白文字/極小文字で印字されているため
  見た目には出ない。

これにより、Excel から出力した既存の PDF をそのままサーバーで処理できる。
新方式（render.py）で作る PDF はアンカーリンクを使うため、この処理は不要。

使い方:
    from planner.linker import add_marker_links
    add_marker_links("in.pdf", "out.pdf")
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

__all__ = ["add_marker_links", "find_markers", "MarkerLink"]

# 「P」+ 数字 のみをマーカーとみなす。P1 や P57 など。
_MARKER_RE = re.compile(r"^P(\d{1,4})$")

# マーカー同士が同じ行にあるとみなす縦方向の許容差（ポイント）
_ROW_TOLERANCE = 6.0


@dataclass(frozen=True)
class MarkerLink:
    """1つのリンク領域。"""

    source_page: int  # 0始まり
    target_page: int  # 0始まり
    rect: tuple[float, float, float, float]  # (x0, y0, x1, y1) PDF座標
    label: str


@dataclass(frozen=True)
class _Token:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


def _iter_chars(element) -> list:
    """入れ子になったレイアウト要素から LTChar だけを平坦に集める。"""
    from pdfminer.layout import LTChar

    out = []
    stack = [element]
    while stack:
        node = stack.pop()
        if isinstance(node, LTChar):
            out.append(node)
        else:
            stack.extend(getattr(node, "_objs", []) or [])
    return out


def _tokens_by_page(pdf_path: str | Path) -> dict[int, list[_Token]]:
    """ページごとに「Pn」マーカーとその位置を取り出す。

    Excel 由来の PDF ではマーカーが隣の文字とくっついて `P3P7` のように
    1語として抽出されることがあるため、単語区切りに頼らず文字列全体に
    正規表現をかけて検出する。
    """
    from pdfminer.high_level import extract_pages

    pattern = re.compile(r"P\d{1,4}")
    pages: dict[int, list[_Token]] = defaultdict(list)

    for page_index, layout in enumerate(extract_pages(str(pdf_path))):
        # ページ内の全文字を集め、縦位置で行にまとめてから左→右に並べ直す。
        # pdfminer の行分割に任せると "P12" が "P1" と "2" に割れることがあるため。
        for row in _rows_of_chars(_iter_chars(layout)):
            # 行はフォントサイズごとに分けて作られる（_rows_of_chars 参照）。
            text, chars = _row_text(row)
            for match in pattern.finditer(text):
                start, end = match.span()
                if start > 0 and text[start - 1].isalnum():
                    continue  # "TOP3" のような語中の一致を除外
                span = [c for c in chars[start:end] if c is not None]
                if not span:
                    continue
                pages[page_index].append(
                    _Token(
                        text=match.group(),
                        x0=min(c.x0 for c in span),
                        y0=min(c.y0 for c in span),
                        x1=max(c.x1 for c in span),
                        y1=max(c.y1 for c in span),
                    )
                )
    return pages


def _rows_of_chars(chars: list) -> list[list]:
    """文字を「フォントサイズ × 縦位置」で行にまとめ、各行を左から並べる。

    フォントサイズで分けるのが重要。マーカーは本文より小さい文字で印字されており、
    サイズを無視して並べると隣のカレンダーの日付とつながって `P3` + `30` が
    `P330` と読まれてしまう。
    """
    rows: list[list] = []
    keyed = sorted(chars, key=lambda c: (round(c.size, 1), -c.y0, c.x0))
    for char in keyed:
        size = round(char.size, 1)
        for row in rows:
            if round(row[0].size, 1) == size and abs(row[0].y0 - char.y0) <= _ROW_TOLERANCE / 2:
                row.append(char)
                break
        else:
            rows.append([char])
    for row in rows:
        row.sort(key=lambda c: c.x0)
    return rows


def _row_text(row: list) -> tuple[str, list]:
    """行の文字列と、文字列の各位置に対応する LTChar を返す。

    文字間が空いている箇所には区切りの空白を挿入する。挿入した位置の
    対応文字は None にして、インデックスがずれないようにする。
    """
    text_parts: list[str] = []
    mapping: list = []
    prev = None
    for char in row:
        if prev is not None:
            gap = char.x0 - prev.x1
            if gap > max(prev.size, char.size) * 0.3:
                text_parts.append(" ")
                mapping.append(None)
        text_parts.append(char.get_text())
        mapping.append(char)
        prev = char
    return "".join(text_parts), mapping


def find_markers(pdf_path: str | Path, *, page_count: int | None = None) -> list[MarkerLink]:
    """PDF を走査して、マーカー対から作れるリンクの一覧を返す。

    同じページに同じマーカーが2つある場合のみリンクにする（1つだけなら誤検出とみなす）。
    """
    links: list[MarkerLink] = []
    for page_index, tokens in _tokens_by_page(pdf_path).items():
        by_label: dict[str, list[_Token]] = defaultdict(list)
        for token in tokens:
            if _MARKER_RE.match(token.text):
                by_label[token.text].append(token)

        for label, found in by_label.items():
            if len(found) < 2:
                continue
            target = int(_MARKER_RE.match(label).group(1)) - 1  # 1始まり → 0始まり
            if target < 0 or (page_count is not None and target >= page_count):
                continue
            # 行ごとにまとめ、行内で左から2つずつをペアにする。
            # 1つの領域は「開きマーカー … 閉じマーカー」で挟まれた矩形。
            # 同じ行に同じラベルが4つ（＝2領域）現れることがあるため、
            # 先頭と末尾で挟むのではなく必ず2つずつ組にする。
            for row in _group_rows(found):
                for i in range(0, len(row) - 1, 2):
                    open_marker, close_marker = row[i], row[i + 1]
                    links.append(
                        MarkerLink(
                            source_page=page_index,
                            target_page=target,
                            rect=(
                                open_marker.x0,
                                min(open_marker.y0, close_marker.y0),
                                close_marker.x1,
                                max(open_marker.y1, close_marker.y1),
                            ),
                            label=label,
                        )
                    )
    return links


def _group_rows(tokens: list[_Token]) -> list[list[_Token]]:
    """縦位置が近いトークンを同じ行としてまとめ、左から並べる。"""
    rows: list[list[_Token]] = []
    for token in sorted(tokens, key=lambda t: (-t.y0, t.x0)):
        for row in rows:
            if abs(row[0].y0 - token.y0) <= _ROW_TOLERANCE:
                row.append(token)
                break
        else:
            rows.append([token])
    for row in rows:
        row.sort(key=lambda t: t.x0)
    return rows


def add_marker_links(
    src: str | Path,
    dst: str | Path,
    *,
    min_height: float = 10.0,
    pad: float = 1.0,
    replace_existing: bool = False,
) -> int:
    """マーカーを検出してリンク注釈を付けた PDF を書き出す。戻り値は付けたリンク数。

    min_height は、指でタップできる最小の高さ（ポイント）。マーカーが極小文字の場合
    リンク領域も極小になってしまうため、下限を設けて押しやすくする。

    replace_existing=True にすると、既にあるリンク注釈を消してから貼り直す。
    リンク付与済みの PDF をもう一度処理してもリンクが二重にならない。
    """
    from pypdf import PdfReader, PdfWriter
    from pypdf.annotations import Link
    from pypdf.generic import ArrayObject, NameObject

    reader = PdfReader(str(src))
    page_count = len(reader.pages)
    links = find_markers(src, page_count=page_count)

    writer = PdfWriter()
    writer.append(reader)

    if replace_existing:
        for page in writer.pages:
            annots = page.get("/Annots")
            if not annots:
                continue
            kept = [
                ref for ref in annots if ref.get_object().get("/Subtype") != "/Link"
            ]
            page[NameObject("/Annots")] = ArrayObject(kept)

    for link in links:
        x0, y0, x1, y1 = link.rect
        if y1 - y0 < min_height:
            center = (y0 + y1) / 2
            y0, y1 = center - min_height / 2, center + min_height / 2
        annotation = Link(
            rect=(x0 - pad, y0 - pad, x1 + pad, y1 + pad),
            target_page_index=link.target_page,
        )
        writer.add_annotation(page_number=link.source_page, annotation=annotation)

    out = Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as fh:
        writer.write(fh)
    return len(links)
