"""日本の祝日を計算する。

内閣府の祝日CSVに依存せず、法令上のルールから算出する（1980-2099 年に有効）。
外部ネットワークに依存しないため、オフラインのサーバーでも動作する。

対応:
  - 固定日の祝日
  - ハッピーマンデー（成人の日・海の日・敬老の日・スポーツの日）
  - 春分の日・秋分の日（天文学的近似式）
  - 振替休日（日曜が祝日の場合、次の平日）
  - 国民の休日（前後を祝日に挟まれた平日。主に9月のシルバーウィーク）
  - 年ごとの特例（2020/2021 の五輪特措法など）
"""

from __future__ import annotations

import datetime as _dt
from functools import lru_cache

__all__ = ["holidays_in_year", "holiday_name", "is_holiday"]


def _nth_monday(year: int, month: int, nth: int) -> _dt.date:
    """その月の第 nth 月曜日を返す。"""
    d = _dt.date(year, month, 1)
    offset = (0 - d.weekday()) % 7  # 0 = 月曜
    return d + _dt.timedelta(days=offset + 7 * (nth - 1))


def _vernal_equinox_day(year: int) -> int:
    """春分の日（日）。1980-2099 で有効な近似式。"""
    return int(20.8431 + 0.242194 * (year - 1980) - int((year - 1980) / 4))


def _autumnal_equinox_day(year: int) -> int:
    """秋分の日（日）。1980-2099 で有効な近似式。"""
    return int(23.2488 + 0.242194 * (year - 1980) - int((year - 1980) / 4))


# 五輪特措法などによる年単位の移動・特例。{年: {(月, 日): 名称}}
_SPECIAL_MOVES: dict[int, dict[tuple[int, int], str]] = {
    2020: {(7, 23): "海の日", (7, 24): "スポーツの日", (8, 10): "山の日"},
    2021: {(7, 22): "海の日", (7, 23): "スポーツの日", (8, 8): "山の日"},
}
# 特例で「その年は存在しない」通常ルールの祝日
_SPECIAL_SKIP: dict[int, set[str]] = {
    2020: {"海の日", "スポーツの日", "山の日"},
    2021: {"海の日", "スポーツの日", "山の日"},
}
# 単発の祝日（即位礼正殿の儀など）
_ONE_OFF: dict[tuple[int, int, int], str] = {
    (2019, 5, 1): "天皇の即位の日",
    (2019, 10, 22): "即位礼正殿の儀の行われる日",
}


def _base_holidays(year: int) -> dict[_dt.date, str]:
    """振替休日・国民の休日を適用する前の祝日一覧。"""
    skip = _SPECIAL_SKIP.get(year, set())
    out: dict[_dt.date, str] = {}

    def add(date: _dt.date, name: str) -> None:
        if name not in skip:
            out[date] = name

    add(_dt.date(year, 1, 1), "元日")
    add(_nth_monday(year, 1, 2), "成人の日")
    add(_dt.date(year, 2, 11), "建国記念の日")
    if year >= 2020:
        add(_dt.date(year, 2, 23), "天皇誕生日")
    add(_dt.date(year, 3, _vernal_equinox_day(year)), "春分の日")
    add(_dt.date(year, 4, 29), "昭和の日" if year >= 2007 else "みどりの日")
    add(_dt.date(year, 5, 3), "憲法記念日")
    add(_dt.date(year, 5, 4), "みどりの日" if year >= 2007 else "国民の休日")
    add(_dt.date(year, 5, 5), "こどもの日")
    add(_nth_monday(year, 7, 3), "海の日")
    if year >= 2016:
        add(_dt.date(year, 8, 11), "山の日")
    add(_nth_monday(year, 9, 3), "敬老の日")
    add(_dt.date(year, 9, _autumnal_equinox_day(year)), "秋分の日")
    add(_nth_monday(year, 10, 2), "スポーツの日" if year >= 2020 else "体育の日")
    add(_dt.date(year, 11, 3), "文化の日")
    add(_dt.date(year, 11, 23), "勤労感謝の日")
    if year <= 2018:
        add(_dt.date(year, 12, 23), "天皇誕生日")

    for (m, d), name in _SPECIAL_MOVES.get(year, {}).items():
        out[_dt.date(year, m, d)] = name
    for (y, m, d), name in _ONE_OFF.items():
        if y == year:
            out[_dt.date(y, m, d)] = name
    return out


@lru_cache(maxsize=256)
def holidays_in_year(year: int) -> dict[_dt.date, str]:
    """その年（1/1-12/31）の祝日を {日付: 名称} で返す。

    振替休日・国民の休日を含む。年末年始をまたぐ振替のため前後の年も内部で計算する。
    """
    base: dict[_dt.date, str] = {}
    for y in (year - 1, year, year + 1):
        base.update(_base_holidays(y))

    result = dict(base)

    # 振替休日: 日曜日が祝日なら、その後の最初の非祝日平日を振替休日にする
    for date in sorted(base):
        if date.weekday() != 6:  # 6 = 日曜
            continue
        cand = date + _dt.timedelta(days=1)
        while cand in result:
            cand += _dt.timedelta(days=1)
        result[cand] = "振替休日"

    # 国民の休日: 祝日に前後を挟まれた平日（日曜・振替休日を除く）
    for date in sorted(base):
        gap = date + _dt.timedelta(days=1)
        after = date + _dt.timedelta(days=2)
        if after in base and gap not in result and gap.weekday() != 6:
            result[gap] = "国民の休日"

    return {d: n for d, n in sorted(result.items()) if d.year == year}


def holiday_name(date: _dt.date) -> str | None:
    """その日が祝日なら名称、そうでなければ None。"""
    return holidays_in_year(date.year).get(date)


def is_holiday(date: _dt.date) -> bool:
    return holiday_name(date) is not None
