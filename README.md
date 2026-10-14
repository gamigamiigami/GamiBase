# GamiBase 🌈

自分の作ったサイト・ツールのURLをまとめておくポータルサイトです。

## シゴデキ先生 アプリ版

購入者用ログイン、時間割の変更、授業時数の集計、手書きができるPWA版を追加しています。
Node.js 24以上で `npm start` を実行してください。PDF作成デモは `tools/shigodeki-sensei/pdf.html` で利用できます。
購入者への利用コード発行と本番公開の手順は [アプリ版の説明](docs/shigodeki-app.md) を参照してください。
本体価格は980円。特別クーポン適用後は50,000円引きで0円となり、無料取得とアカウント登録ができます。クーポン受付とホーム画面への追加には、アプリサーバーの公開設定が必要です。
アプリの認証・保存にはサーバー側の処理が必要です（GitHub Pages単独では動きません）。
Netlify＋Supabaseでの公開にも対応しています。[接続設定と公開手順](docs/shigodeki-netlify.md) を参照してください。公開先の接続が済むまでは、本体の取得受付は準備中です。

## 運用フロー

新しいサイト・ツールができたら、Claudeに「このURLをポータルに追加して」と伝えるだけでOKです。
紹介文はClaudeが自動で作成し、カテゴリ分けに迷ったら質問します。

## サイトの追加方法（手動でやる場合）

`data.js` の `SITE_DATA` 配列に、以下の形式でオブジェクトを追加するだけです。

```js
{
  category: "game", // "game" | "tool" | "useful" | "event" | "other"
  title: "サイト名",
  description: "紹介文",
  url: "https://...",
  emoji: "🎮", // カードに表示する絵文字（省略可）
  tags: ["タグ1", "タグ2"], // 省略可
  zip: { url: "./downloads/xxx.zip", label: "ダウンロード名" }, // 省略可
}
```

カテゴリの一覧・色・アイコンは `CATEGORY_META` で管理しています。

## ZIPファイルの配布

`downloads/` フォルダにZIPファイルを置き、`data.js` の該当項目に `zip` を指定するとダウンロードボタンが表示されます。

## ローカルで確認する

```bash
python3 -m http.server 8000
```

その後 `http://localhost:8000` を開いてください。

## GitHub Pagesで公開する

1. リポジトリの Settings → Pages
2. Source を「Deploy from a branch」にし、公開したいブランチ（例: main）とルート `/` を選択
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます
