"""生成直後の PDF に対する後処理。

1. 名前付きデスティネーションの実体化
   Chromium は <a href="#p3"> を「名前付きデスティネーション（/Dest /p3）」として書き出す。
   PC の PDF ビューアはこれを解決できるが、モバイルの手書きアプリ（GoodNotes 等）には
   名前付きデスティネーションを解決しない実装があるため、ページを直接指す明示的な
   デスティネーション配列に書き換える。これをやらないと「リンクを押しても飛ばない」事故になる。

2. しおり（アウトライン）の付与
   GoodNotes のサイドバーから週ページへ直接飛べるようにする。

3. メタデータの埋め込み
   注文IDなどを残し、流出時に発行元をたどれるようにする。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NullObject, TextStringObject

__all__ = ["finalize", "inline_named_destinations", "count_links"]


def _named_dests(reader: PdfReader) -> dict[str, Any]:
    """カタログの /Dests から {名前: デスティネーション配列} を取り出す。"""
    root = reader.trailer["/Root"].get_object()
    out: dict[str, Any] = {}

    dests = root.get("/Dests")
    if dests is not None:
        for key, value in dests.get_object().items():
            out[str(key)] = value.get_object() if hasattr(value, "get_object") else value

    # /Names /Dests（名前ツリー）形式にも対応しておく
    names = root.get("/Names")
    if names is not None:
        tree = names.get_object().get("/Dests")
        if tree is not None:
            _walk_name_tree(tree.get_object(), out)
    return out


def _walk_name_tree(node: DictionaryObject, out: dict[str, Any]) -> None:
    if "/Names" in node:
        items = node["/Names"].get_object()
        for i in range(0, len(items) - 1, 2):
            value = items[i + 1]
            value = value.get_object() if hasattr(value, "get_object") else value
            if isinstance(value, DictionaryObject) and "/D" in value:
                value = value["/D"].get_object()
            out[str(items[i])] = value
    for kid in node.get("/Kids", []) or []:
        _walk_name_tree(kid.get_object(), out)


def inline_named_destinations(writer: PdfWriter, name_to_index: dict[str, int]) -> int:
    """リンク注釈の /Dest 名を、ページを直接指す配列に置き換える。

    `name_to_index` は {デスティネーション名: 0始まりのページ番号}。
    ページ番号で受け取るのは、writer.append() の際にページオブジェクトが
    作り直され、元 PDF のページ参照と同一性比較ができなくなるため。

    戻り値は書き換えたリンクの数。
    """
    if not name_to_index:
        return 0

    page_by_index = list(writer.pages)
    rewritten = 0

    for page in page_by_index:
        annots = page.get("/Annots")
        if not annots:
            continue
        for annot_ref in annots:
            annot = annot_ref.get_object()
            if annot.get("/Subtype") != "/Link":
                continue

            name = annot.get("/Dest")
            # /A << /S /GoTo /D (name) >> 形式にも対応
            action = annot.get("/A")
            if name is None and action is not None:
                action_obj = action.get_object()
                if action_obj.get("/S") == "/GoTo":
                    name = action_obj.get("/D")

            if not isinstance(name, (str, TextStringObject, NameObject)):
                continue
            page_index = name_to_index.get(str(name))
            if page_index is None or not (0 <= page_index < len(page_by_index)):
                continue

            explicit = ArrayObject(
                [page_by_index[page_index].indirect_reference, NameObject("/Fit")]
            )
            annot[NameObject("/Dest")] = explicit
            if "/A" in annot:
                del annot[NameObject("/A")]
            rewritten += 1
    return rewritten


def _dest_page_index(dest: Any, pages: list[Any]) -> int | None:
    """デスティネーション配列の先頭（ページ参照）が何ページ目かを返す。"""
    if not isinstance(dest, (list, ArrayObject)) or not dest:
        return None
    target = dest[0]
    target_obj = target.get_object() if hasattr(target, "get_object") else target
    if isinstance(target_obj, NullObject):
        return None
    for i, page in enumerate(pages):
        if page.get_object() == target_obj:
            return i
    return None


def count_links(pdf_path: str | Path) -> int:
    reader = PdfReader(str(pdf_path))
    return sum(
        1
        for page in reader.pages
        for a in (page.get("/Annots") or [])
        if a.get_object().get("/Subtype") == "/Link"
    )


def finalize(
    pdf_path: str | Path,
    *,
    title: str = "",
    author: str = "",
    order_id: str = "",
    outline: list[tuple[str, int]] | None = None,
) -> int:
    """PDF を開いて後処理し、同じパスに書き戻す。戻り値は実体化したリンク数。"""
    path = Path(pdf_path)
    reader = PdfReader(str(path))

    # 名前 → ページ番号（0始まり）を、元 PDF のページ同一性で先に解決しておく
    reader_pages = [p.get_object() for p in reader.pages]
    name_to_index: dict[str, int] = {}
    for name, dest in _named_dests(reader).items():
        index = _dest_page_index(dest, reader_pages)
        if index is not None:
            name_to_index[name] = index

    writer = PdfWriter()
    writer.append(reader)

    rewritten = inline_named_destinations(writer, name_to_index)

    if outline:
        for label, page_number in outline:
            index = page_number - 1
            if 0 <= index < len(writer.pages):
                writer.add_outline_item(label, index)

    metadata = {
        "/Title": title,
        "/Author": author,
        "/Creator": "shigodeki-sensei planner",
        "/Producer": "shigodeki-sensei planner",
    }
    if order_id:
        # 流出時の追跡用。ビューアには表示されないが PDF 内には残る。
        metadata["/OrderID"] = order_id
    writer.add_metadata({k: v for k, v in metadata.items() if v})

    with path.open("wb") as fh:
        writer.write(fh)
    return rewritten
