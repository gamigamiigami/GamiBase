import pytest
from planner.orders import OrderError, OrderStore, TokenError

INPUT = {"schoolYear": 2025}


@pytest.fixture
def store(tmp_path):
    s = OrderStore(tmp_path / "orders.db", secret="test-secret")
    yield s
    s.close()


def test_create_and_get(store):
    order = store.create_order(product="令和7年度版", issued_to="山田 太郎", email="a@example.com")
    assert order.order_id.startswith("ORD-")
    assert not order.is_generated
    assert store.get(order.order_id).issued_to == "山田 太郎"


def test_duplicate_order_id_rejected(store):
    store.create_order(product="x", order_id="ORD-1")
    with pytest.raises(OrderError, match="既に存在"):
        store.create_order(product="x", order_id="ORD-1")


def test_generation_can_be_claimed_once(store):
    store.create_order(product="x", order_id="ORD-1")
    store.claim_generation("ORD-1", INPUT)
    assert store.get("ORD-1").is_generated
    # 2回目は拒否される = 1購入1生成
    with pytest.raises(OrderError, match="既に生成済み"):
        store.claim_generation("ORD-1", INPUT)


def test_admin_can_allow_one_regeneration(store):
    store.create_order(product="x", order_id="ORD-1")
    store.claim_generation("ORD-1", INPUT)
    store.allow_regeneration("ORD-1")
    store.claim_generation("ORD-1", INPUT)  # 許可された1回は通る
    with pytest.raises(OrderError):  # 許可は使い切られる
        store.claim_generation("ORD-1", INPUT)


def test_input_is_stored_for_regeneration(store):
    store.create_order(product="x", order_id="ORD-1")
    store.claim_generation("ORD-1", {"schoolYear": 2025, "freePages": 7})
    import json

    saved = json.loads(store.get("ORD-1").input_json)
    assert saved["freePages"] == 7


def test_token_roundtrip_consumes_download(store):
    store.create_order(product="x", order_id="ORD-1", max_downloads=2)
    store.claim_generation("ORD-1", INPUT)
    token = store.issue_download_token("ORD-1")
    assert store.redeem_download_token(token).download_count == 1
    assert store.redeem_download_token(token).download_count == 2
    with pytest.raises(TokenError, match="上限"):
        store.redeem_download_token(token)


def test_tampered_token_rejected(store):
    store.create_order(product="x", order_id="ORD-1")
    store.claim_generation("ORD-1", INPUT)
    token = store.issue_download_token("ORD-1")
    order_id, expires, signature = token.split(":")
    with pytest.raises(TokenError, match="正しくありません"):
        store.redeem_download_token(f"{order_id}:{expires}:{'0' * len(signature)}")
    # 有効期限だけ書き換えても署名が合わない
    with pytest.raises(TokenError, match="正しくありません"):
        store.redeem_download_token(f"{order_id}:{int(expires) + 99999}:{signature}")


def test_token_for_other_order_rejected(store):
    store.create_order(product="x", order_id="ORD-1")
    store.create_order(product="x", order_id="ORD-2")
    store.claim_generation("ORD-1", INPUT)
    token = store.issue_download_token("ORD-1")
    _id, expires, signature = token.split(":")
    with pytest.raises(TokenError):
        store.redeem_download_token(f"ORD-2:{expires}:{signature}")


def test_expired_token_rejected(store):
    store.create_order(product="x", order_id="ORD-1")
    store.claim_generation("ORD-1", INPUT)
    token = store.issue_download_token("ORD-1", ttl_hours=-1)
    with pytest.raises(TokenError, match="有効期限"):
        store.redeem_download_token(token)


def test_token_before_generation_rejected(store):
    store.create_order(product="x", order_id="ORD-1")
    with pytest.raises(OrderError, match="まだ生成されていません"):
        store.issue_download_token("ORD-1")


def test_unknown_order(store):
    with pytest.raises(OrderError, match="見つかりません"):
        store.get("ORD-NOPE")


def test_secret_is_required(tmp_path):
    with pytest.raises(ValueError):
        OrderStore(tmp_path / "x.db", secret="")


def test_different_secret_cannot_forge(tmp_path):
    a = OrderStore(tmp_path / "a.db", secret="secret-a")
    a.create_order(product="x", order_id="ORD-1")
    a.claim_generation("ORD-1", INPUT)
    token = a.issue_download_token("ORD-1")

    b = OrderStore(tmp_path / "b.db", secret="secret-b")
    b.create_order(product="x", order_id="ORD-1")
    b.claim_generation("ORD-1", INPUT)
    with pytest.raises(TokenError):
        b.redeem_download_token(token)
    a.close()
    b.close()


def test_ensure_can_generate_does_not_consume(store):
    """確認だけでは権利を消費しないこと（生成失敗時の救済）。"""
    store.create_order(product="x", order_id="ORD-1")
    store.ensure_can_generate("ORD-1")
    store.ensure_can_generate("ORD-1")
    assert not store.get("ORD-1").is_generated
    store.claim_generation("ORD-1", INPUT)
    with pytest.raises(OrderError, match="既に生成済み"):
        store.ensure_can_generate("ORD-1")
