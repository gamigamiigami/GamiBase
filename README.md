# GamiBase for Education 🌈

授業・学習支援ツールや教材を中心に、ゲーム・イベント・便利ツールのリンクをまとめたポータルサイトです。
画面のサイト名、ページタイトル、説明文、SNS共有用情報、WebSiteの構造化データに教育用途を明記しています。

## 学校タブレットからのアクセス

公開URLは `https://gamigamiigami.github.io/GamiBase/Education/` です。従来の `https://gamigamiigami.github.io/GamiBase/` でも同じポータルを開けます。「Education」という表記や教育用途の説明は、学校のフィルターの解除・教育カテゴリへの分類を保証するものではありません。

開けない場合は、学校の管理者へ公開URLと用途、制限画面の理由・カテゴリ名を伝え、アクセス許可や分類の確認を依頼してください。ドメイン `gamigamiigami.github.io` が制限されている場合、タイトルやURLのパスに単語を足すだけでは解決しません。ポータルから開く各ツールは、それぞれのURLに対する許可が必要になる場合もあります。

[学校での利用について](school/index.html) に、掲載内容、確認対象のURL、学校のICT担当者へ渡せる依頼文を掲載しています。「不確定サイト」の表示だけではフィルター製品や判定範囲は特定できません。分類の再審査方法は、学校側で製品名を確認してから案内してください。

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
npm run build:education
python3 -m http.server 8000
```

Node.js 24以上を使用し、その後 `http://localhost:8000/Education/` を開いてください。`Education/index.html` はルートの `index.html` から生成します。ルートを編集したら生成コマンドを再実行してください。GitHub PagesとNetlifyへの公開時にも自動生成されます。

## GitHub Pagesで公開する

1. リポジトリの Settings → Pages
2. Source を「Deploy from a branch」にし、公開したいブランチ（例: main）とルート `/` を選択
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます
