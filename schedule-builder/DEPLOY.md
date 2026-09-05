# 公開手順（実際に動くサイトを立てる）

このアプリは **Python と Chromium が動くサーバー**が必要です。
GitHub Pages（GamiBase を公開しているところ）は静的ファイルしか置けないので、
そこでは動きません。別のホスティングに置きます。

所要時間は10分程度、無料〜月数百円です。

---

## 方式A: Render（推奨・GUI で完結）

リポジトリを連携するだけで、`render.yaml` の通りに構築されます。

1. https://render.com にGitHubアカウントで登録
2. **New → Blueprint** を選ぶ
3. `gamigamiigami/GamiBase` を選択（`render.yaml` が自動で読まれます）
4. **Apply** を押す。5〜10分でビルドが終わります
5. 表示された `https://schedule-builder-xxxx.onrender.com` が公開URLです

`PLANNER_SECRET` は Render が自動生成します（自分で作る必要はありません）。

### 注意点

- **プランは `starter`（月$7程度）を推奨**しています。無料プランはメモリ512MBで、
  Chromium がPDFを生成する瞬間に落ちることがあります。まず無料で試して、
  生成が失敗するようなら starter に上げてください（`render.yaml` の `plan:` を変更）。
- 無料プランは15分アクセスが無いとスリープし、次のアクセスで30秒ほど待たされます。
- ディスク（`/data`）を付けてあるので、注文台帳と生成済みPDFは再起動後も残ります。

---

## 方式B: Fly.io（コマンドで完結・無料枠が大きい）

```bash
# 初回のみ
curl -L https://fly.io/install.sh | sh
fly auth signup

cd schedule-builder
fly launch --no-deploy --name あなたの好きな名前
fly secrets set PLANNER_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
fly volumes create data --size 1
fly deploy
```

`fly.toml` に以下を足してから deploy してください（ディスクの割り当て）:

```toml
[mounts]
  source = "data"
  destination = "/data"

[env]
  PLANNER_DB = "/data/orders.db"
  PLANNER_OUTPUT_DIR = "/data/generated"
  PLANNER_TEST_MODE = "1"

[[vm]]
  memory = "1gb"   # Chromium のために 1GB は確保する
```

---

## 方式C: 自宅・職場のPCで一時的に公開（無料・すぐ）

人に見せるだけなら、手元で動かして一時URLを発行するのが最短です。

```bash
# ターミナル1
cd schedule-builder
export PLANNER_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
PYTHONPATH=src python3 -m planner serve

# ターミナル2（cloudflared をインストールしてから）
cloudflared tunnel --url http://localhost:5000
```

表示される `https://xxxx.trycloudflare.com` が、そのまま外部から見えるURLです。
**PCを閉じると消えます。** 常設には向きませんが、確認用には十分です。

---

## 公開したあとに必ずやること

- [ ] `PLANNER_SECRET` を控える（パスワード管理ソフトへ）。
      **変えると発行済みのダウンロードURLが全部無効になります。**
- [ ] テストモードのまま公開して、実機（iPad）で一通り試す
- [ ] 決済をつなぐまでは `PLANNER_TEST_MODE=1` のままにする。
      1 のあいだは「🧪 テストモード：決済は行われません」と全画面に出ます
- [ ] 誰でもPDFを作れる状態になるので、**公開URLを不特定多数に配らない**
      （テスト中は知人だけに渡す。生成には毎回サーバー資源を使います）

## 決済をつなぐとき

`src/planner/webapp.py` の `/checkout` だけを差し替えます。

```python
@app.post("/checkout")
def checkout():
    # ここを Stripe の決済セッション作成にする
    # 決済完了の Webhook 側で:
    #     order = store.create_order(product=..., issued_to=..., email=...)
    #     token = store.issue_setup_token(order.order_id)
    #     → 入力フォームURL（/setup/<token>）をメールで送る
```

生成・ライセンス・ダウンロードの仕組みは変更不要です。
差し替えが済んだら `PLANNER_TEST_MODE=0` にしてテスト表示を消します。
