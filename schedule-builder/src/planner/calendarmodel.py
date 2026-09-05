"""年度カレンダーの組み立てとページ割付。

現行 Excel の仕様に合わせている:
  1ページ目  年間カレンダー
  2ページ目  年間行事予定（一覧）
  3ページ目〜 週ページ（第1週〜第N週）
  その後     自由ページ

週は月曜始まり。第1週は「4/1 を含む週」で、年度末（翌3/31）を含む週まで続く。
年度により 52 週または 53 週になる（4/1 の曜日とうるう年で変動）。
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from functools import cached_property

from .holidays import holiday_name
from .models import EMPTY_LESSON, WEEKDAYS, Event, PlannerInput

__all__ = ["Day", "Week", "MonthGrid", "PlannerCalendar", "PAGE_YEAR_CALENDAR", "PAGE_EVENT_LIST"]

# 固定ページ番号（1始まり = PDF のページ番号）
PAGE_YEAR_CALENDAR = 1
PAGE_EVENT_LIST = 2
FIRST_WEEK_PAGE = 3

_WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"]


@dataclass(frozen=True)
class Day:
    """週ページ・カレンダーの1日分。"""

    date: _dt.date
    events: tuple[Event, ...] = ()
    holiday: str | None = None
    school_break: str | None = None  # 長期休業の名称（夏季休業など）。is_closed 判定に使う
    break_label: str | None = None  # 表示用。休業の初日だけに入る（毎日書くと紙面が煩雑なため）

    @property
    def weekday_ja(self) -> str:
        return _WEEKDAY_JA[self.date.weekday()]

    @property
    def is_weekend(self) -> bool:
        return self.date.weekday() >= 5

    @property
    def is_saturday(self) -> bool:
        return self.date.weekday() == 5

    @property
    def is_sunday(self) -> bool:
        return self.date.weekday() == 6

    @property
    def is_holiday(self) -> bool:
        return self.holiday is not None

    @property
    def is_break(self) -> bool:
        """長期休業中の日。"""
        return self.school_break is not None

    @property
    def is_closed(self) -> bool:
        """授業が無い日（土日・祝日・長期休業）。週ページでグレー表示する。"""
        return self.is_weekend or self.is_holiday or self.is_break

    @property
    def closed_label(self) -> str:
        """休みの理由。祝日名や、休業の初日だけ休業名を表示するために使う。

        休業の初日がたまたま祝日と重なることもあるため、両方あれば併記する
        （片方だけにすると、もう一方の情報が紙面から消えてしまう）。
        """
        return " / ".join(label for label in (self.holiday, self.break_label) if label)

    @property
    def md(self) -> str:
        return f"{self.date.month}/{self.date.day}"

    @property
    def md_with_weekday(self) -> str:
        return f"{self.date.month}/{self.date.day}({self.weekday_ja})"

    @property
    def event_text(self) -> str:
        return " ".join(e.label for e in self.events)


@dataclass(frozen=True)
class Week:
    """週ページ1枚分。"""

    index: int  # 第 index 週（1始まり）
    days: tuple[Day, ...]  # 月〜日の7日

    @property
    def page(self) -> int:
        return FIRST_WEEK_PAGE + self.index - 1

    @property
    def weekdays(self) -> tuple[Day, ...]:
        """月〜金。"""
        return self.days[:5]

    @property
    def saturday(self) -> Day:
        return self.days[5]

    @property
    def sunday(self) -> Day:
        return self.days[6]

    @property
    def monday(self) -> Day:
        return self.days[0]

    @property
    def label(self) -> str:
        return f"第{self.index}週"

    @property
    def range_text(self) -> str:
        return f"{self.days[0].md} 〜 {self.days[6].md}"


@dataclass(frozen=True)
class MonthGrid:
    """年間カレンダー用の1か月分（6行×7列、日曜始まり）。"""

    year: int
    month: int
    rows: tuple[tuple[Day | None, ...], ...]  # 6行 × 7列（日〜土）

    @property
    def label(self) -> str:
        return f"{self.month}月"

    @property
    def label_en(self) -> str:
        return _dt.date(2000, self.month, 1).strftime("%B")


class PlannerCalendar:
    """PlannerInput から1冊分の構造を組み立てる。"""

    def __init__(self, data: PlannerInput) -> None:
        self.data = data
        self._events_by_date: dict[_dt.date, list[Event]] = {}
        for event in data.events:
            self._events_by_date.setdefault(event.date, []).append(event)

    # -- 基本 ---------------------------------------------------------------

    def day(self, date: _dt.date) -> Day:
        period = self.data.break_on(date)
        return Day(
            date=date,
            events=tuple(self._events_by_date.get(date, ())),
            holiday=holiday_name(date),
            school_break=period.name if period else None,
            break_label=period.name if period and period.start == date else None,
        )

    @cached_property
    def first_monday(self) -> _dt.date:
        """第1週の月曜（4/1 を含む週の月曜）。"""
        start = self.data.start_date
        return start - _dt.timedelta(days=start.weekday())

    @cached_property
    def weeks(self) -> tuple[Week, ...]:
        """第1週から年度末を含む週まで（＋ extra_weeks 分の予備週）。"""
        weeks: list[Week] = []
        monday = self.first_monday
        index = 1
        last_monday = self.data.end_date + _dt.timedelta(weeks=self.data.extra_weeks)
        while monday <= last_monday:
            days = tuple(self.day(monday + _dt.timedelta(days=i)) for i in range(7))
            weeks.append(Week(index=index, days=days))
            monday += _dt.timedelta(days=7)
            index += 1
        return tuple(weeks)

    @cached_property
    def week_count(self) -> int:
        return len(self.weeks)

    def week_page_for(self, date: _dt.date) -> int | None:
        """その日付を含む週ページのページ番号。年度外なら None。"""
        if date < self.first_monday:
            return None
        index = (date - self.first_monday).days // 7 + 1
        if index > self.week_count:
            return None
        return FIRST_WEEK_PAGE + index - 1

    # -- 年間カレンダー -----------------------------------------------------

    @cached_property
    def months(self) -> tuple[MonthGrid, ...]:
        """4月〜翌3月の12か月分。日曜始まりの6行グリッド。"""
        grids: list[MonthGrid] = []
        for offset in range(12):
            month_index = (3 + offset) % 12 + 1
            year = self.data.school_year + (1 if month_index < 4 else 0)
            grids.append(self._month_grid(year, month_index))
        return tuple(grids)

    def _month_grid(self, year: int, month: int) -> MonthGrid:
        first = _dt.date(year, month, 1)
        # 日曜始まり: 日曜=0 になるようずらす
        lead = (first.weekday() + 1) % 7
        next_month = _dt.date(year + (month == 12), month % 12 + 1, 1)
        days_in_month = (next_month - first).days

        cells: list[Day | None] = [None] * lead
        cells += [self.day(_dt.date(year, month, d)) for d in range(1, days_in_month + 1)]
        while len(cells) % 7:
            cells.append(None)
        while len(cells) < 42:
            cells.append(None)
        rows = tuple(tuple(cells[i : i + 7]) for i in range(0, 42, 7))
        return MonthGrid(year=year, month=month, rows=rows)

    # -- 年間行事予定 -------------------------------------------------------

    @cached_property
    def event_columns(self) -> tuple[tuple[str, tuple[Day | None, ...]], ...]:
        """行事予定一覧用。(月ラベル, 1〜31日のDay) を12か月分。"""
        columns: list[tuple[str, tuple[Day | None, ...]]] = []
        for grid in self.months:
            year, month = grid.year, grid.month
            next_month = _dt.date(year + (month == 12), month % 12 + 1, 1)
            days_in_month = (next_month - _dt.date(year, month, 1)).days
            days: list[Day | None] = [
                self.day(_dt.date(year, month, d)) if d <= days_in_month else None for d in range(1, 32)
            ]
            columns.append((f"{month}月", tuple(days)))
        return tuple(columns)

    # -- ページ割付 ---------------------------------------------------------

    @property
    def free_page_start(self) -> int:
        return FIRST_WEEK_PAGE + self.week_count

    @cached_property
    def free_pages(self) -> tuple[int, ...]:
        """自由ページのページ番号一覧。"""
        return tuple(range(self.free_page_start, self.free_page_start + self.data.free_pages))

    @property
    def total_pages(self) -> int:
        return 2 + self.week_count + self.data.free_pages

    # -- 週ページの授業 -----------------------------------------------------

    def lessons_for(self, day: Day, period: str):
        """その日・その時限の Lesson。休業日は空の Lesson。"""
        if day.is_closed:
            return EMPTY_LESSON
        weekday = day.weekday_ja
        if weekday not in WEEKDAYS:
            return EMPTY_LESSON
        return self.data.timetable.lesson(weekday, period)
