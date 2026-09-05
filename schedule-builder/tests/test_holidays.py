import datetime as dt

from planner.holidays import holiday_name, holidays_in_year, is_holiday


def test_fixed_holidays():
    assert holiday_name(dt.date(2025, 1, 1)) == "元日"
    assert holiday_name(dt.date(2025, 2, 11)) == "建国記念の日"
    assert holiday_name(dt.date(2025, 4, 29)) == "昭和の日"
    assert holiday_name(dt.date(2025, 5, 5)) == "こどもの日"
    assert holiday_name(dt.date(2025, 11, 3)) == "文化の日"


def test_happy_monday():
    # 成人の日 = 1月第2月曜
    assert holiday_name(dt.date(2025, 1, 13)) == "成人の日"
    assert holiday_name(dt.date(2026, 1, 12)) == "成人の日"
    # 海の日 = 7月第3月曜
    assert holiday_name(dt.date(2025, 7, 21)) == "海の日"
    # スポーツの日 = 10月第2月曜
    assert holiday_name(dt.date(2025, 10, 13)) == "スポーツの日"


def test_equinox():
    assert holiday_name(dt.date(2025, 3, 20)) == "春分の日"
    assert holiday_name(dt.date(2025, 9, 23)) == "秋分の日"
    assert holiday_name(dt.date(2026, 3, 20)) == "春分の日"


def test_substitute_holiday():
    # 2025-11-23（日）勤労感謝の日 → 11-24（月）が振替休日
    assert holiday_name(dt.date(2025, 11, 23)) == "勤労感謝の日"
    assert holiday_name(dt.date(2025, 11, 24)) == "振替休日"
    # 2025-02-23（日）天皇誕生日 → 02-24 が振替休日
    assert holiday_name(dt.date(2025, 2, 24)) == "振替休日"


def test_substitute_across_new_year():
    # 2022-01-01 は土曜なので振替なし。2023-01-01 は日曜 → 1/2 が振替休日
    assert holiday_name(dt.date(2023, 1, 2)) == "振替休日"


def test_citizens_holiday():
    # 2026-09-21 敬老の日(月) / 09-23 秋分の日 → 09-22 が国民の休日
    assert holiday_name(dt.date(2026, 9, 21)) == "敬老の日"
    assert holiday_name(dt.date(2026, 9, 23)) == "秋分の日"
    assert holiday_name(dt.date(2026, 9, 22)) == "国民の休日"


def test_olympic_year_moves():
    # 2021 は特措法で海の日・スポーツの日・山の日が移動した
    assert holiday_name(dt.date(2021, 7, 22)) == "海の日"
    assert holiday_name(dt.date(2021, 7, 23)) == "スポーツの日"
    assert holiday_name(dt.date(2021, 8, 8)) == "山の日"
    # 通常位置には無いこと
    assert holiday_name(dt.date(2021, 7, 19)) is None


def test_no_holiday_on_ordinary_day():
    assert not is_holiday(dt.date(2025, 6, 10))
    assert holiday_name(dt.date(2025, 6, 10)) is None


def test_holiday_count_is_plausible_every_year():
    # 祝日数は年16〜23日程度に収まるはず。式の破綻を検出する。
    for year in range(2020, 2041):
        count = len(holidays_in_year(year))
        assert 15 <= count <= 24, f"{year}年の祝日数が異常: {count}"


def test_all_holidays_are_in_requested_year():
    for year in (2025, 2026, 2030):
        for date in holidays_in_year(year):
            assert date.year == year
