# GamiBase 🌈

自分の作ったサイト・ツールのURLをまとめておくポータルサイトです。

## サイトの追加方法

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
