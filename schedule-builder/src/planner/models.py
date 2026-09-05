"""入力データのモデルとバリデーション。

入力仕様の正本は docs/INPUT_SPEC.md。ここはその実装。
購入者から受け取る JSON をこのモジュールで検証してから生成に渡す。
"""

from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

__all__ = [
    "PlannerInput",
    "Timetable",
    "Event",
    "Owner",
    "License",
    "InputError",
    "WEEKDAYS",
    "DEFAULT_PERIODS",
]

# 週ページの列（授業のある曜日）
WEEKDAYS = ["月", "火", "水", "木", "金"]

# 週ページの行。"昼" と "朝"/"業後" は授業コマではない見出し行。
DEFAULT_PERIODS = ["朝", "1", "2", "3", "4", "昼", "5", "6", "業後"]

# 授業を割り当てられる行（時間割グリッドのキーになる）
LESSON_PERIODS = ["1", "2", "3", "4", "5", "6"]


class InputError(ValueError):
    """入力データが仕様を満たしていないときに送出する。

    メッセージはそのまま購入者に見せられる日本語にすること。
    """


@dataclass(frozen=True)
class Owner:
    name: str = ""
    school: str = ""


@dataclass(frozen=True)
class License:
    """1注文＝1ライセンスを表す。透かしと追跡に使う。"""

    order_id: str = ""
    issued_to: str = ""
    watermark: bool = True

    @property
    def watermark_text(self) -> str:
        parts = [p for p in (self.issued_to, self.order_id) if p]
        return " / ".join(parts)


@dataclass(frozen=True)
class Event:
    """年間行事予定の1件。"""

    date: _dt.date
    title: str
    note: str = ""

    @property
    def label(self) -> str:
        return f"{self.title}（{self.note}）" if self.note else self.title


@dataclass(frozen=True)
class Timetable:
    """週の基本時間割。grid[曜日][時限] = 授業名。"""

    grid: dict[str, dict[str, str]] = field(default_factory=dict)
    periods: list[str] = field(default_factory=lambda: list(DEFAULT_PERIODS))

    def lesson(self, weekday: str, period: str) -> str:
        return self.grid.get(weekday, {}).get(period, "")


@dataclass(frozen=True)
class PlannerInput:
    """1冊分の入力。これだけで最終PDFが決まる（＝再生成が常に可能）。"""

    school_year: int
    timetable: Timetable = field(default_factory=Timetable)
    events: tuple[Event, ...] = ()
    owner: Owner = field(default_factory=Owner)
    license: License = field(default_factory=License)
    free_pages: int = 30
    title: str = ""
    # 年度末（3/31）を含む週の「次の週」を何週分よぶんに付けるか。
    # 現行 Excel が 1 週多く出力していたのに合わせて既定を 1 にしている。
    extra_weeks: int = 1

    @property
    def start_date(self) -> _dt.date:
        """年度開始日（4/1）。"""
        return _dt.date(self.school_year, 4, 1)

    @property
    def end_date(self) -> _dt.date:
        """年度末日（翌年3/31）。"""
        return _dt.date(self.school_year + 1, 3, 31)

    @property
    def reiwa_year(self) -> int:
        """令和の年。令和元年 = 2019年。"""
        return self.school_year - 2018

    @property
    def display_title(self) -> str:
        if self.title:
            return self.title
        return f"令和{self.reiwa_year}年度（{self.school_year}年度）スケジュール帳"

    def events_on(self, date: _dt.date) -> list[Event]:
        return [e for e in self.events if e.date == date]


# --------------------------------------------------------------------------
# パース
# --------------------------------------------------------------------------


def _parse_date(value: Any, where: str) -> _dt.date:
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    if not isinstance(value, str):
        raise InputError(f"{where}: 日付は 'YYYY-MM-DD' 形式の文字列で指定してください（受け取った値: {value!r}）")
    text = value.strip().replace("/", "-")
    try:
        return _dt.date.fromisoformat(text)
    except ValueError as exc:
        raise InputError(f"{where}: 日付 '{value}' を解釈できません。'YYYY-MM-DD' 形式で指定してください") from exc


def _parse_timetable(raw: Any) -> Timetable:
    if raw is None:
        return Timetable()
    if not isinstance(raw, dict):
        raise InputError("timetable: オブジェクト（辞書）で指定してください")

    periods = raw.get("periods") or list(DEFAULT_PERIODS)
    if not isinstance(periods, list) or not all(isinstance(p, str) for p in periods):
        raise InputError("timetable.periods: 文字列の配列で指定してください（例: ['朝','1','2','昼']）")

    grid_raw = raw.get("grid") or {}
    if not isinstance(grid_raw, dict):
        raise InputError("timetable.grid: {曜日: {時限: 授業名}} の形で指定してください")

    grid: dict[str, dict[str, str]] = {}
    for weekday, lessons in grid_raw.items():
        if weekday not in WEEKDAYS:
            raise InputError(
                f"timetable.grid: 曜日 '{weekday}' は使えません。{'・'.join(WEEKDAYS)} のいずれかにしてください"
            )
        if not isinstance(lessons, dict):
            raise InputError(f"timetable.grid.{weekday}: {{時限: 授業名}} の形で指定してください")
        grid[weekday] = {str(period): str(name) for period, name in lessons.items() if name}
    return Timetable(grid=grid, periods=list(periods))


def _parse_events(raw: Any, start: _dt.date, end: _dt.date) -> tuple[Event, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise InputError("events: 配列で指定してください")

    events: list[Event] = []
    for i, item in enumerate(raw, start=1):
        where = f"events[{i}]"
        if not isinstance(item, dict):
            raise InputError(f"{where}: {{'date': ..., 'title': ...}} の形で指定してください")
        date = _parse_date(item.get("date"), where)
        title = str(item.get("title") or "").strip()
        if not title:
            raise InputError(f"{where}: title（行事名）が空です")
        if not (start <= date <= end):
            raise InputError(
                f"{where}: 日付 {date} は年度の範囲（{start} 〜 {end}）外です。年度の指定が正しいか確認してください"
            )
        events.append(Event(date=date, title=title, note=str(item.get("note") or "").strip()))
    events.sort(key=lambda e: (e.date, e.title))
    return tuple(events)


def parse_input(raw: dict[str, Any]) -> PlannerInput:
    """辞書から PlannerInput を作る。不正な入力は InputError。"""
    if not isinstance(raw, dict):
        raise InputError("入力データ全体は JSON オブジェクトである必要があります")

    year = raw.get("schoolYear", raw.get("school_year"))
    if year is None:
        raise InputError("schoolYear（年度）が指定されていません。例: 2025 は令和7年度（2025年4月〜2026年3月）")
    try:
        year = int(year)
    except (TypeError, ValueError) as exc:
        raise InputError(f"schoolYear: 西暦4桁の数値で指定してください（受け取った値: {year!r}）") from exc
    if not (1990 <= year <= 2099):
        raise InputError(f"schoolYear: {year} は対応範囲外です。1990〜2099 で指定してください")

    extra_weeks = raw.get("extraWeeks", raw.get("extra_weeks", 1))
    try:
        extra_weeks = int(extra_weeks)
    except (TypeError, ValueError) as exc:
        raise InputError("extraWeeks: 予備の週数は数値で指定してください") from exc
    if not (0 <= extra_weeks <= 8):
        raise InputError("extraWeeks: 予備の週数は 0〜8 の範囲で指定してください")

    free_pages = raw.get("freePages", raw.get("free_pages", 30))
    try:
        free_pages = int(free_pages)
    except (TypeError, ValueError) as exc:
        raise InputError("freePages: 自由ページ数は数値で指定してください") from exc
    if not (0 <= free_pages <= 200):
        raise InputError("freePages: 自由ページ数は 0〜200 の範囲で指定してください")

    owner_raw = raw.get("owner") or {}
    if not isinstance(owner_raw, dict):
        raise InputError("owner: {'name': ..., 'school': ...} の形で指定してください")

    license_raw = raw.get("license") or {}
    if not isinstance(license_raw, dict):
        raise InputError("license: オブジェクト（辞書）で指定してください")

    parsed = PlannerInput(
        school_year=year,
        timetable=_parse_timetable(raw.get("timetable")),
        owner=Owner(
            name=str(owner_raw.get("name") or ""),
            school=str(owner_raw.get("school") or ""),
        ),
        license=License(
            order_id=str(license_raw.get("orderId") or license_raw.get("order_id") or ""),
            issued_to=str(license_raw.get("issuedTo") or license_raw.get("issued_to") or ""),
            watermark=bool(license_raw.get("watermark", True)),
        ),
        free_pages=free_pages,
        title=str(raw.get("title") or ""),
        extra_weeks=extra_weeks,
    )
    events = _parse_events(raw.get("events"), parsed.start_date, parsed.end_date)
    return PlannerInput(
        school_year=parsed.school_year,
        timetable=parsed.timetable,
        events=events,
        owner=parsed.owner,
        license=parsed.license,
        free_pages=parsed.free_pages,
        title=parsed.title,
        extra_weeks=parsed.extra_weeks,
    )


def load_input(path: str | Path) -> PlannerInput:
    """JSON ファイルを読んで PlannerInput を作る。"""
    p = Path(path)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise InputError(f"入力ファイルが見つかりません: {p}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"入力ファイルの JSON を解釈できません（{p}）: {exc.lineno}行目付近 - {exc.msg}") from exc
    return parse_input(raw)
