import datetime as dt

from planner.events_import import import_events, parse_loose_date


def test_parse_loose_date_infers_school_year():
    # 4〜12月はその年、1〜3月は翌年（学校年度の慣習）
    assert parse_loose_date("4/8", 2025) == dt.date(2025, 4, 8)
    assert parse_loose_date("12/25", 2025) == dt.date(2025, 12, 25)
    assert parse_loose_date("3/6", 2025) == dt.date(2026, 3, 6)
    assert parse_loose_date("1/9", 2025) == dt.date(2026, 1, 9)


def test_parse_loose_date_formats():
    assert parse_loose_date("2025-04-08", 2025) == dt.date(2025, 4, 8)
    assert parse_loose_date("2025/4/8", 2025) == dt.date(2025, 4, 8)
    assert parse_loose_date("4月8日", 2025) == dt.date(2025, 4, 8)
    assert parse_loose_date("4月8日(火)", 2025) == dt.date(2025, 4, 8)
    assert parse_loose_date(dt.date(2025, 4, 8), 2025) == dt.date(2025, 4, 8)


def test_parse_loose_date_invalid():
    assert parse_loose_date("", 2025) is None
    assert parse_loose_date(None, 2025) is None
    assert parse_loose_date("未定", 2025) is None
    assert parse_loose_date("13/45", 2025) is None  # ありえない月日


def test_import_csv_vertical(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text(
        "日付,行事,備考\n2025-04-07,始業式,\n4/8,入学式,午前日課\n3/6,卒業式,\n",
        encoding="utf-8",
    )
    result = import_events(path, 2025)
    assert result.count == 3
    assert result.events[0] == {"date": "2025-04-07", "title": "始業式"}
    assert {"date": "2025-04-08", "title": "入学式", "note": "午前日課"} in result.events
    assert {"date": "2026-03-06", "title": "卒業式"} in result.events


def test_import_reports_unreadable_rows(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text("日付,行事\n未定,遠足\n4/8,入学式\n", encoding="utf-8")
    result = import_events(path, 2025)
    assert result.count == 1
    assert any("遠足" in w for w in result.warnings)


def test_import_deduplicates(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text("日付,行事\n4/8,入学式\n4/8,入学式\n", encoding="utf-8")
    assert import_events(path, 2025).count == 1


def test_import_sorted_by_date(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text("日付,行事\n7/18,終業式\n4/8,入学式\n", encoding="utf-8")
    dates = [e["date"] for e in import_events(path, 2025).events]
    assert dates == sorted(dates)


def test_import_excel(tmp_path):
    openpyxl = __import__("openpyxl")
    path = tmp_path / "events.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["日付", "行事名"])
    ws.append([dt.date(2025, 4, 7), "始業式"])
    ws.append(["4/8", "入学式"])
    wb.save(path)

    result = import_events(path, 2025)
    assert result.count == 2
    assert result.events[0]["title"] == "始業式"


def test_unknown_format_warns(tmp_path):
    path = tmp_path / "events.pdf"
    path.write_bytes(b"%PDF-1.4")
    result = import_events(path, 2025)
    assert result.count == 0
    assert any("未対応" in w for w in result.warnings)


def test_missing_file_warns(tmp_path):
    result = import_events(tmp_path / "nope.csv", 2025)
    assert result.count == 0
    assert any("見つかりません" in w for w in result.warnings)


def test_unrecognized_layout_warns(tmp_path):
    path = tmp_path / "events.csv"
    path.write_text("あ,い,う\n1,2,3\n", encoding="utf-8")
    result = import_events(path, 2025)
    assert result.count == 0
    assert any("判別できませんでした" in w for w in result.warnings)


def test_imported_events_are_accepted_by_the_builder(tmp_path):
    """取り込み結果がそのまま入力JSONとして通ること（結合部分の保証）。"""
    from planner.models import parse_input

    path = tmp_path / "events.csv"
    path.write_text("日付,行事\n4/8,入学式\n3/6,卒業式\n", encoding="utf-8")
    events = import_events(path, 2025).events
    data = parse_input({"schoolYear": 2025, "events": events})
    assert len(data.events) == 2
