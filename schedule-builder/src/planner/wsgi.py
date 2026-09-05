"""本番サーバー（gunicorn など）用のエントリポイント。

    gunicorn planner.wsgi:app

設定は環境変数から読む:
    PLANNER_SECRET      署名鍵（必須）
    PLANNER_DB          注文台帳のパス（既定: orders.db）
    PLANNER_OUTPUT_DIR  生成PDFの保存先（既定: generated）
    PLANNER_TEST_MODE   "0" にすると「テストモード」表示を消す（既定: 有効）
"""

from __future__ import annotations

import os

from .webapp import create_app

app = create_app(
    db_path=os.environ.get("PLANNER_DB", "orders.db"),
    output_dir=os.environ.get("PLANNER_OUTPUT_DIR", "generated"),
    test_mode=os.environ.get("PLANNER_TEST_MODE", "1") != "0",
)
