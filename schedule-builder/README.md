# スケジュール帳ビルダー（シゴデキ先生 / PDFリンくん 自動化）

Excel → PDF化 → リンク付与 → GoodNotes という手作業のフローを、
**`input.json` を渡すと最終PDFが出てくる1コマンド**に置き換えたもの。

```
入力(年度・時間割・行事予定)  →  [ planner build ]  →  リンク付きPDF（完成品）
```

Excel も PDFリンくんも通らない。Chromium で直接PDFを組むので、
レイアウト崩れ・リンク切れが起きにくく、サーバー上で無人実行できる。

## できること

- 年間カレンダー・年間行事予定・週ページ（52〜54週）・自由ページを自動生成
- 祝日は年度から自動計算（振替休日・国民の休日・五輪特措法の移動まで対応）
- **授業の色分け**（赤・青・緑・黄・灰。1ページ目に凡例）
- **長期休業**（夏季・冬季など）を期間指定で反映。祝日は年度から自動
- **ページ内リンクを自動付与**（カレンダーの日付 → その週のページ、週ページ → 目次、前後の週）
- GoodNotes 用のしおり（アウトライン）を付与
- 購入者名・注文IDの透かしとメタデータ埋め込み
- **1注文＝1生成**を強制する受注台帳と、期限つきダウンロードトークン
- 学校の行事予定表（CSV / Excel）の取り込み
- 旧Excel由来のPDFに後からリンクを貼る互換ツール（伊神モードのサーバー移植）

## セットアップ

```bash
cd schedule-builder
pip install -r requirements.txt
python3 -m playwright install chromium   # 既に Chromium がある環境では不要
```

日本語フォント（IPAゴシック等）がインストールされている必要がある。
Chromium の場所を明示したい場合は環境変数 `PLANNER_CHROMIUM_PATH` を設定する。

## 使い方

### 1. 入力のひな形を作る

```bash
PYTHONPATH=src python3 -m planner sample --out input.json
```

### 2. 学校の行事予定表を取り込む（任意）

```bash
PYTHONPATH=src python3 -m planner import-events -f 年間行事予定.xlsx -y 2025 -o events.json
```

読めなかった行は警告として表示される。**内容は必ず目視で確認する**（→ docs/ARCHITECTURE.md「行事予定の取り込み」）。
出力された配列を `input.json` の `events` に貼る。

### 3. 検証する（PDFは作らない・速い）

```bash
PYTHONPATH=src python3 -m planner check -i input.json
```

### 4. PDFを作る

```bash
PYTHONPATH=src python3 -m planner build -i input.json -o 完成.pdf
```

86ページ・1100リンクで **約4秒**。

## 購入フローを試す（決済なし・無料）

```bash
export PLANNER_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
PYTHONPATH=src python3 -m planner serve
# → http://127.0.0.1:5000/ をブラウザで開く
```

「テスト購入する（無料）」から、購入者と同じ流れを最後まで確認できる。

```
購入ページ（年度を選ぶ）
  → 入力フォーム（時間割＋色／長期休業／行事予定）
  → PDF生成（1注文につき1回だけ）
  → ダウンロード（72時間・3回まで）
```

決済は `/checkout` の1か所に閉じ込めてある。本番では、ここを Stripe などの
決済完了Webhookに置き換えて `store.create_order(...)` を呼ぶだけでよい。

## 販売運用（1注文1生成）

```bash
# 署名鍵を一度だけ作って、環境変数として保存する（絶対に外部に出さない）
export PLANNER_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"

# 注文を登録（決済確認後）
PYTHONPATH=src python3 -m planner order-new --product "令和8年度版" --name "山田 太郎" --email t@example.com

# 購入者の入力で生成（この注文では以後生成できなくなる）
PYTHONPATH=src python3 -m planner order-build --order-id ORD-XXXX -i input.json -o 山田様.pdf

# 一覧・再生成の許可（入力ミスの救済）
PYTHONPATH=src python3 -m planner order-list
PYTHONPATH=src python3 -m planner order-allow-regen --order-id ORD-XXXX
```

- `order-build` は**生成に成功してから**権利を消費する。失敗しても購入者の権利は減らない。
- 発行されるダウンロードトークンは HMAC 署名つき・期限つき・回数制限つき。
  Web サーバー側で `OrderStore.redeem_download_token()` を呼べばそのまま使える。

## 旧Excel由来PDFへのリンク付与（互換ツール）

```bash
PYTHONPATH=src python3 -m planner link -i 既存.pdf -o リンク付き.pdf
```

`P12 … P12` のようなマーカー対を検出して、12ページ目へのリンクにする。
既存の PDFリンくん（伊神モード）と同じ考え方をサーバー側で行う。
**注意**: 元ツールのソースを参照して作ったものではないため、週ページのナビゲーションは
再現できているが、年間カレンダー面のリンクは一部しか復元できていない（→ HANDOFF.md）。

## テスト

```bash
python3 -m pytest
```

祝日計算・週の割付・PDFのリンク・受注台帳・行事取り込みを検証する（68件）。
PDF生成テストは Chromium が無い環境では自動的に skip される。

## ファイル構成

```
src/planner/
  models.py         入力の検証（エラーメッセージは購入者向けの日本語）
  holidays.py       日本の祝日計算
  calendarmodel.py  年度→週・月グリッド・ページ割付
  render.py         HTML生成 → Chromium で PDF化
  templates/, static/  レイアウト（ここを直すと見た目が変わる）
  postprocess.py    リンクの実体化・しおり・メタデータ
  linker.py         旧PDF向けマーカーリンカー（互換）
  events_import.py  行事予定表の取り込み
  orders.py         受注・ライセンス台帳（SQLite）
  cli.py            コマンドライン
docs/
  INPUT_SPEC.md     入力仕様（購入者向け説明の元ネタにもなる）
  ARCHITECTURE.md   設計と、旧Excelとの対応
HANDOFF.md          あなたが決める・用意することの一覧
```
