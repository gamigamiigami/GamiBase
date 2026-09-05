"""購入フロー（テストモード）を通しで検証する。

「お金を払わずに購入フローを確かめる」ための経路が、実際に最後まで通ることを保証する。
"""

import io

import pytest

pytest.importorskip("flask")
from planner.render import _chromium_path  # noqa: E402

pytestmark = pytest.mark.skipif(_chromium_path() is None, reason="Chromium が見つからない")


@pytest.fixture
def client(tmp_path):
    from planner.webapp import create_app

    app = create_app(
        db_path=tmp_path / "orders.db",
        secret="test-secret",
        output_dir=tmp_path / "generated",
        test_mode=True,
    )
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


def _checkout(client, year=2025, name="山田 太郎"):
    res = client.post(
        "/checkout", data={"year": str(year), "name": name, "email": "t@example.com"}
    )
    assert res.status_code == 302
    return res.headers["Location"]


def _fill(year=2025, **overrides):
    data = {
        "year": str(year),
        "owner_name": "山田 太郎",
        "owner_school": "テスト中学校",
        "free_pages": "2",
        "lesson_月_1": "２年１組",
        "color_月_1": "red",
        "lesson_火_2": "３年２組",
        "color_火_2": "blue",
        "break_name_0": "夏季休業",
        "break_start_0": f"{year}-07-21",
        "break_end_0": f"{year}-08-31",
        "events_text": "4/8,入学式\n3/6,卒業式",
    }
    data.update(overrides)
    return data


def test_index_shows_year_choices(client):
    res = client.get("/")
    body = res.get_data(as_text=True)
    assert res.status_code == 200
    assert "テストモード" in body
    assert "年度を選ぶ" in body
    assert "令和7年度" in body  # 2025年度が選択肢にある想定の年ならば


def test_full_purchase_flow(client):
    """購入 → 入力 → 生成 → ダウンロードまで、支払いなしで通ること。"""
    setup_url = _checkout(client)

    form = client.get(setup_url)
    assert form.status_code == 200
    assert "時間割" in form.get_data(as_text=True)

    submitted = client.post(setup_url, data=_fill())
    assert submitted.status_code == 302, submitted.get_data(as_text=True)[:600]
    done_url = submitted.headers["Location"]

    done = client.get(done_url)
    assert done.status_code == 200
    assert "できあがりました" in done.get_data(as_text=True)

    token = done_url.rsplit("/", 1)[-1]
    pdf = client.get(f"/download/{token}")
    assert pdf.status_code == 200
    assert pdf.headers["Content-Type"] == "application/pdf"
    assert pdf.get_data()[:4] == b"%PDF"


def test_generation_is_one_shot(client):
    """同じ注文で2回作成できないこと（1購入1生成）。"""
    setup_url = _checkout(client)
    assert client.post(setup_url, data=_fill()).status_code == 302

    second = client.post(setup_url, data=_fill())
    assert second.status_code == 400
    assert "既に生成済み" in second.get_data(as_text=True)


def test_download_limit_enforced(client):
    setup_url = _checkout(client)
    done_url = client.post(setup_url, data=_fill()).headers["Location"]
    token = done_url.rsplit("/", 1)[-1]

    for _ in range(3):  # 既定の上限は3回
        assert client.get(f"/download/{token}").status_code == 200
    over = client.get(f"/download/{token}")
    assert over.status_code == 403
    assert "上限" in over.get_data(as_text=True)


def test_tampered_setup_token_rejected(client):
    setup_url = _checkout(client)
    path, _, query = setup_url.partition("?")
    broken = path[:-4] + "0000"  # 署名の末尾を書き換える
    assert client.get(f"{broken}?{query}").status_code == 400

    # 別の注文のIDに差し替えても通らない
    swapped = path.replace("ORD-", "ORD-X", 1)
    assert client.get(f"{swapped}?{query}").status_code == 400


def test_invalid_input_is_reported_and_does_not_consume(client):
    """入力エラーでは権利を消費せず、直して再送できること。"""
    setup_url = _checkout(client)

    bad = client.post(setup_url, data=_fill(**{"break_start_0": "2025-08-31", "break_end_0": "2025-07-21"}))
    assert bad.status_code == 400
    assert "より前" in bad.get_data(as_text=True)

    good = client.post(setup_url, data=_fill())
    assert good.status_code == 302, "エラー後に作り直せること"


def test_events_file_upload(client):
    setup_url = _checkout(client)
    data = _fill(events_text="")
    data["events_file"] = (io.BytesIO("日付,行事\n4/8,入学式\n".encode("utf-8")), "events.csv")
    res = client.post(setup_url, data=data, content_type="multipart/form-data")
    assert res.status_code == 302


def test_year_choice_is_respected(client):
    setup_url = _checkout(client, year=2026)
    res = client.post(setup_url, data=_fill(year=2026))
    assert res.status_code == 302

    token = res.headers["Location"].rsplit("/", 1)[-1]
    pdf = client.get(f"/download/{token}")
    assert pdf.status_code == 200
    # 令和8年度＝2026年度のPDFになっていること
    assert "令和8年度" in pdf.headers["Content-Disposition"] or "%E4%BB%A4%E5%92%8C8" in pdf.headers[
        "Content-Disposition"
    ]


def test_watermark_carries_order_id(client, tmp_path):
    from pypdf import PdfReader

    setup_url = _checkout(client)
    done_url = client.post(setup_url, data=_fill()).headers["Location"]
    order_id = done_url.rsplit("/", 1)[-1].split(":")[0]

    token = done_url.rsplit("/", 1)[-1]
    pdf_bytes = client.get(f"/download/{token}").get_data()
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert reader.metadata.get("/OrderID") == order_id
