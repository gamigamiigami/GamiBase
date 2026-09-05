import datetime as dt

import pytest
from planner.calendarmodel import PlannerCalendar
from planner.models import InputError, parse_input


def make(year=2025, **kwargs):
    raw = {"schoolYear": year, "freePages": 2}
    raw.update(kwargs)
    return parse_input(raw)


def test_first_week_contains_april_first():
    for year in range(2024, 2035):
        cal = PlannerCalendar(make(year))
        first = cal.weeks[0]
        assert first.days[0].date.weekday() == 0, "第1週は月曜始まり"
        assert first.days[0].date <= dt.date(year, 4, 1) <= first.days[6].date


def test_last_week_reaches_year_end():
    for year in range(2024, 2035):
        cal = PlannerCalendar(make(year, extraWeeks=0))
        last = cal.weeks[-1]
        assert last.days[6].date >= dt.date(year + 1, 3, 31)
        # 余分な週が付いていないこと
        assert last.days[0].date <= dt.date(year + 1, 3, 31)


def test_week_count_is_plausible():
    # 年度をまたぐ週の数え方により 52〜54 週。予備週を足しても 55 週を超えない。
    for year in range(2024, 2040):
        base = PlannerCalendar(make(year, extraWeeks=0))
        assert 52 <= base.week_count <= 54, f"{year}年度の週数が異常: {base.week_count}"
        with_extra = PlannerCalendar(make(year))
        assert with_extra.week_count == base.week_count + 1


def test_extra_weeks_matches_legacy_excel():
    # 現行 Excel（令和7年度）は 54 週 + 年間2ページ + 自由30 = 86 ページだった
    cal = PlannerCalendar(make(2025, freePages=30))
    assert cal.week_count == 54
    assert cal.total_pages == 86


def test_weeks_are_contiguous():
    cal = PlannerCalendar(make(2025))
    for prev, current in zip(cal.weeks, cal.weeks[1:]):
        assert current.days[0].date - prev.days[6].date == dt.timedelta(days=1)


def test_page_numbers_are_sequential_and_unique():
    cal = PlannerCalendar(make(2025, freePages=5))
    pages = [1, 2] + [w.page for w in cal.weeks] + list(cal.free_pages)
    assert pages == list(range(1, cal.total_pages + 1))


def test_week_page_for_roundtrip():
    cal = PlannerCalendar(make(2025))
    for week in cal.weeks:
        for day in week.days:
            assert cal.week_page_for(day.date) == week.page


def test_week_page_for_out_of_range():
    cal = PlannerCalendar(make(2025))
    assert cal.week_page_for(dt.date(2020, 1, 1)) is None
    assert cal.week_page_for(dt.date(2030, 1, 1)) is None


def test_months_cover_april_to_march():
    cal = PlannerCalendar(make(2025))
    assert [m.month for m in cal.months] == [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    assert cal.months[0].year == 2025
    assert cal.months[-1].year == 2026


def test_month_grid_has_all_days():
    cal = PlannerCalendar(make(2024))  # 2025年2月ではなく、うるう年の2024年2月を含む年度
    feb = [m for m in cal.months if m.month == 2][0]
    days = [d.date.day for row in feb.rows for d in row if d is not None]
    assert days == list(range(1, 29 + 1)) or days == list(range(1, 28 + 1))


def test_leap_day_present_in_leap_year():
    cal = PlannerCalendar(make(2027))  # 2028年2月29日を含む年度
    feb = [m for m in cal.months if m.month == 2][0]
    days = [d.date.day for row in feb.rows for d in row if d is not None]
    assert 29 in days


def test_events_land_on_correct_day():
    data = make(2025, events=[{"date": "2025-04-08", "title": "入学式"}])
    cal = PlannerCalendar(data)
    day = cal.day(dt.date(2025, 4, 8))
    assert day.event_text == "入学式"
    assert cal.day(dt.date(2025, 4, 9)).event_text == ""


def test_lessons_skip_closed_days():
    data = make(2025, timetable={"grid": {"月": {"1": "２年１組"}}})
    cal = PlannerCalendar(data)
    monday = cal.day(dt.date(2025, 4, 7))  # 平日
    holiday_monday = cal.day(dt.date(2025, 4, 29))  # 昭和の日（火）
    assert cal.lessons_for(monday, "1") == "２年１組"
    assert cal.lessons_for(holiday_monday, "1") == ""


def test_event_out_of_year_is_rejected():
    with pytest.raises(InputError, match="年度の範囲"):
        make(2025, events=[{"date": "2027-04-08", "title": "入学式"}])


def test_invalid_weekday_is_rejected():
    with pytest.raises(InputError, match="曜日"):
        make(2025, timetable={"grid": {"土": {"1": "補習"}}})


def test_missing_school_year_is_rejected():
    with pytest.raises(InputError, match="schoolYear"):
        parse_input({})
