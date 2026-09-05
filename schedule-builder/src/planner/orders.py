"""注文とライセンスの管理（SQLite）。

「PDF を守る」のではなく「生成する権利を1回に絞る」ための仕組み。
同じ形の PDF を再配布されることは原理的に防げないので、ここで担保するのは次の3点:

  1. 1注文につき生成は1回だけ（再生成は管理者の明示的な許可が要る）
  2. ダウンロードは期限つき・回数制限つきのワンタイムURLトークン
  3. 入力データを注文と一緒に保存し、いつでも同じものを再生成できる（サポート対応用）

Web フレームワークには依存しない。Flask でも FastAPI でも、この層を呼ぶだけで済む。
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import json
import secrets
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

__all__ = ["OrderStore", "Order", "OrderError", "TokenError"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    order_id      TEXT PRIMARY KEY,
    product       TEXT NOT NULL,
    issued_to     TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    input_json    TEXT,
    pdf_path      TEXT,
    generated_at  TEXT,
    regen_allowed INTEGER NOT NULL DEFAULT 0,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER NOT NULL DEFAULT 3,
    created_at    TEXT NOT NULL
);
"""


class OrderError(RuntimeError):
    """注文の状態が操作を許さないとき。"""


class TokenError(RuntimeError):
    """ダウンロードトークンが無効・期限切れのとき。"""


@dataclass(frozen=True)
class Order:
    order_id: str
    product: str
    issued_to: str
    email: str
    input_json: str | None
    pdf_path: str | None
    generated_at: str | None
    regen_allowed: bool
    download_count: int
    max_downloads: int
    created_at: str

    @property
    def is_generated(self) -> bool:
        return self.generated_at is not None

    @property
    def downloads_left(self) -> int:
        return max(0, self.max_downloads - self.download_count)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


class OrderStore:
    """注文台帳。secret はダウンロードトークンの署名に使う。"""

    def __init__(self, db_path: str | Path, secret: str) -> None:
        if not secret:
            raise ValueError("secret は必須です（ダウンロードURLの署名鍵）")
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._secret = secret.encode("utf-8")
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # -- 注文 ---------------------------------------------------------------

    def create_order(
        self,
        *,
        product: str,
        issued_to: str = "",
        email: str = "",
        order_id: str | None = None,
        max_downloads: int = 3,
    ) -> Order:
        """注文を作る。決済 Webhook から呼ぶ想定。"""
        order_id = order_id or "ORD-" + secrets.token_hex(6).upper()
        try:
            self._conn.execute(
                "INSERT INTO orders (order_id, product, issued_to, email, max_downloads, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (order_id, product, issued_to, email, max_downloads, _now()),
            )
        except sqlite3.IntegrityError as exc:
            raise OrderError(f"注文 {order_id} は既に存在します") from exc
        self._conn.commit()
        return self.get(order_id)

    def get(self, order_id: str) -> Order:
        row = self._conn.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,)).fetchone()
        if row is None:
            raise OrderError(f"注文が見つかりません: {order_id}")
        return Order(
            order_id=row["order_id"],
            product=row["product"],
            issued_to=row["issued_to"],
            email=row["email"],
            input_json=row["input_json"],
            pdf_path=row["pdf_path"],
            generated_at=row["generated_at"],
            regen_allowed=bool(row["regen_allowed"]),
            download_count=row["download_count"],
            max_downloads=row["max_downloads"],
            created_at=row["created_at"],
        )

    def list_orders(self, limit: int = 100) -> list[Order]:
        rows = self._conn.execute(
            "SELECT order_id FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self.get(row["order_id"]) for row in rows]

    # -- 生成 ---------------------------------------------------------------

    def ensure_can_generate(self, order_id: str) -> Order:
        """生成してよい注文かを確認する（消費はしない）。

        生成に失敗したときに権利を消費してしまわないよう、
        「確認 → 生成 → claim」の順で使うためのメソッド。
        """
        order = self.get(order_id)
        if order.is_generated and not order.regen_allowed:
            raise OrderError(
                f"注文 {order_id} は既に生成済みです。"
                "再生成するには管理者が order-allow-regen で許可してください"
            )
        return order

    def claim_generation(self, order_id: str, input_data: dict[str, Any]) -> None:
        """生成の権利を1回だけ使う。

        既に生成済みで再生成許可も無ければ拒否する。ここが「1購入＝1生成」の要。
        """
        order = self.get(order_id)
        if order.is_generated and not order.regen_allowed:
            raise OrderError(
                f"注文 {order_id} は既に生成済みです。"
                "再生成するには allow_regeneration() で管理者が許可してください"
            )
        self._conn.execute(
            "UPDATE orders SET input_json = ?, generated_at = ?, regen_allowed = 0 WHERE order_id = ?",
            (json.dumps(input_data, ensure_ascii=False), _now(), order_id),
        )
        self._conn.commit()

    def attach_pdf(self, order_id: str, pdf_path: str | Path) -> None:
        self._conn.execute(
            "UPDATE orders SET pdf_path = ? WHERE order_id = ?", (str(pdf_path), order_id)
        )
        self._conn.commit()

    def allow_regeneration(self, order_id: str) -> None:
        """管理者が再生成を1回だけ許可する（入力ミスの救済用）。"""
        self.get(order_id)  # 存在確認
        self._conn.execute("UPDATE orders SET regen_allowed = 1 WHERE order_id = ?", (order_id,))
        self._conn.commit()

    # -- ダウンロードトークン -----------------------------------------------

    def issue_setup_token(self, order_id: str, *, ttl_hours: int = 24 * 14) -> str:
        """入力フォーム用のトークン。購入直後に購入者へ渡す。

        ダウンロード用と混同できないよう先頭に用途を入れる（形式が違うので取り違えは弾かれる）。
        """
        self.get(order_id)  # 存在確認
        expires = int(
            (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=ttl_hours)).timestamp()
        )
        payload = f"setup:{order_id}:{expires}"
        return f"{payload}:{self._sign(payload)}"

    def verify_setup_token(self, token: str) -> Order:
        """入力フォーム用トークンを検証する。回数は消費しない。"""
        parts = token.split(":")
        if len(parts) != 4 or parts[0] != "setup":
            raise TokenError("入力フォームのURLが正しくありません")
        _purpose, order_id, expires_raw, signature = parts
        if not hmac.compare_digest(self._sign(f"setup:{order_id}:{expires_raw}"), signature):
            raise TokenError("入力フォームのURLが正しくありません")
        try:
            expires = int(expires_raw)
        except ValueError as exc:
            raise TokenError("入力フォームURLの有効期限が読めません") from exc
        if _dt.datetime.now(_dt.timezone.utc).timestamp() > expires:
            raise TokenError("入力フォームURLの有効期限が切れています。再発行をご依頼ください")
        return self.get(order_id)

    def issue_download_token(self, order_id: str, *, ttl_hours: int = 72) -> str:
        """期限つきの署名トークンを発行する。URL に載せて渡す。"""
        order = self.get(order_id)
        if not order.is_generated:
            raise OrderError(f"注文 {order_id} はまだ生成されていません")
        expires = int(
            (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=ttl_hours)).timestamp()
        )
        payload = f"{order_id}:{expires}"
        signature = self._sign(payload)
        return f"{payload}:{signature}"

    def _sign(self, payload: str) -> str:
        return hmac.new(self._secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:32]

    def redeem_download_token(self, token: str) -> Order:
        """トークンを検証し、ダウンロード回数を1つ消費して注文を返す。

        期限切れ・改ざん・回数超過はすべて TokenError。
        """
        parts = token.split(":")
        if len(parts) != 3:
            raise TokenError("ダウンロードURLの形式が正しくありません")
        order_id, expires_raw, signature = parts

        if not hmac.compare_digest(self._sign(f"{order_id}:{expires_raw}"), signature):
            raise TokenError("ダウンロードURLが正しくありません")

        try:
            expires = int(expires_raw)
        except ValueError as exc:
            raise TokenError("ダウンロードURLの有効期限が読めません") from exc
        if _dt.datetime.now(_dt.timezone.utc).timestamp() > expires:
            raise TokenError("ダウンロードURLの有効期限が切れています。再発行をご依頼ください")

        order = self.get(order_id)
        if order.downloads_left <= 0:
            raise TokenError(
                f"ダウンロード回数の上限（{order.max_downloads}回）に達しています。再発行をご依頼ください"
            )
        self._conn.execute(
            "UPDATE orders SET download_count = download_count + 1 WHERE order_id = ?", (order_id,)
        )
        self._conn.commit()
        return self.get(order_id)
