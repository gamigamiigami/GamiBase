# Educationドメインのポータル

GamiBase用の静的ポータルを、購入者アプリとは別のNetlifyサイトに配置します。
公開用のファイルには購入者データやサーバー用キーを含めません。

公開先は `https://gamibase-education.netlify.app/`。
NetlifyサイトIDは `430c4e5a-af1b-47c3-b398-9ee4ac87f1a8`、チームは `iogames91531` です。

```bash
npm run build:portal
```

生成先は `dist/` です。既定の公開先は `https://gamibase-education.netlify.app`。
別のドメインを使用する場合は、ビルド時の `PORTAL_ORIGIN` にHTTPSオリジンを指定します。
トップページと `/Education/` の両方でポータルを開けます。

`dist/` の内容を静的サイトとしてNetlifyへデプロイしてください。
この別サイトにはFunctionやSupabaseの環境変数を配置しません。
リポジトリ直下の `netlify.toml` は既存の購入者アプリ用なので、
この静的ポータルのデプロイではビルド済みの `dist/` だけを使用します。
既存の購入者アプリのGit連携はそのまま使用します。

購入画面とログイン画面は `_redirects` により、既存のシゴデキ先生の公開先へ転送します。
転送先は `tools/shigodeki-sensei/commerce-config.json` の `appOrigin` から読み込みます。
アカウントとノートの保存先は既存の購入者アプリです。
今後ポータルを更新した場合も、このビルドと静的ファイルのデプロイを再実行してください。

URLのドメイン部分にeducationを含めても、学校のフィルターによる分類やアクセス許可は保証されません。
