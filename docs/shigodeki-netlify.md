# Netlify＋Supabaseで公開する

購入ページとアプリ画面はNetlify、購入者情報・利用権限・時間割・手書きはSupabaseに保存します。常駐Nodeサーバーや有料の永続ディスクは不要です。利用できる容量・実行回数は各サービスの契約と無料枠によります。

## 設定を代行するために必要なもの

1. 使うSupabaseプロジェクトの管理画面URL。
2. 公開先のNetlifyサイトURL。
3. クラウド環境の秘密情報欄に、Supabaseのアクセストークンを `SUPABASE_ACCESS_TOKEN`、Netlifyのアクセストークンを `NETLIFY_AUTH_TOKEN` として入力。

両方ともまだプロジェクト・サイトがない場合、最初のURLは不要です。接続後に組織・チームと作成可能な無料枠を確認し、シゴデキ先生用を新規作成してから設定します。複数の組織・チームがある場合は対象を確認し、自動では選びません。以下の `apply` は作成済みのIDを指定して使うコマンドです。

トークンを作る画面は [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens) と [Netlify Personal Access Tokens](https://app.netlify.com/user/applications#personal-access-tokens) です。パスワードやトークンをチャットやGitへ貼る必要はありません。代行設定用トークンはアプリの配信ファイルにも保存しません。

この環境でWebを直接操作するツールが利用できない場合でも、接続が有効なら管理API経由で設定できます。接続の設定ドラフトを保存しただけでは、トークンは使えません。環境設定で値を入力・反映後、対象プロジェクトへの接続を確認します。

## 設定代行用コマンド

```bash
npm ci
# アカウント内の候補の名前・ID・URLを確認。秘密キーの値は表示しません。
npm run cloud:setup -- inspect
```

利用する対象を確認してから、`SUPABASE_PROJECT_REF` と `NETLIFY_SITE_ID` を指定します。`SHIGODEKI_COUPON_CODE` は配布する特別クーポンです。ローカル設定はGit管理外の `.env`、代行用の秘密情報はクラウド環境の設定を使います。

```bash
npm run cloud:setup -- apply
```

この操作は実際にSupabaseへ専用スキーマを作成し、指定したNetlifyサイトへ接続用の環境変数を保存し、コミット済みのソースをZIPで送って本番ビルドを開始します。対象サイトの公開内容が更新されます。対象は自動選択しません。新しい契約、課金プランの選択、既存データの削除は行いません。

Supabaseのサーバー用キーは管理APIから取得し、そのままNetlifyの環境変数へ渡します。値をログ・リポジトリ・公開ファイルへ書きません。無関係なNetlify環境変数と、既存変数の他のデプロイ環境の値を維持します。ビルドと本番確認が終わるまで「公開完了」と扱わないでください。

## 手動で設定する場合

SupabaseのSQL Editorで `supabase/migrations/202610140001_shigodeki.sql` を実行します。`shigodeki` スキーマと、サーバー専用の `public.shigodeki_rpc` 関数を作ります。別のアプリのテーブルやSupabase Auth設定は変更しません。

Netlifyの本番環境変数には以下を設定します。

| 名前                        | 値                                                         |
| --------------------------- | ---------------------------------------------------------- |
| `SUPABASE_URL`              | `https://プロジェクトID.supabase.co`                       |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー専用のservice_roleキー。anon/publishableキーは不可 |
| `APP_ORIGIN`                | 実際のNetlifyのHTTPS公開オリジン。末尾スラッシュ・パスなし |
| `SHIGODEKI_COUPON_CODE`     | 配布するクーポンコード                                     |

ビルド設定は `netlify.toml` を使用します。`npm test && npm run build:netlify` で `dist/` を作り、`netlify/functions/` のAPIを配信します。公開用ディレクトリに秘密情報、サーバーソース、テスト、SQLを含めません。代行用トークンをNetlifyへ保存する必要はありません。

起動後は `/healthz`、`/tools/shigodeki-sensei/checkout.html`、`/tools/shigodeki-sensei/app/` を確認します。Pagesから案内する場合は、`tools/shigodeki-sensei/commerce-config.json` の `appOrigin` に検証済みのNetlifyオリジンを指定し、コミット・公開します。Netlify自身では同じURLが動的に自身のオリジンを返します。

## 認証と保存の仕様

既存の購入者ログインを移植し、アカウントは専用の `shigodeki.users` に保存します。パスワードはscrypt、コードとセッションはSHA-256のハッシュのみです。Supabase Authの `auth.users` とは独立しており、プロジェクト全体の認証設定を変える必要はありません。

Supabaseのanon・authenticatedロールは購入者テーブルやRPCへアクセスできません。Netlify Functionだけがservice_roleキーを使います。関数は同じオリジンからの要求だけを受け付け、ブラウザの価格指定や任意のDB操作を採用しません。保存とコード取得はDBトランザクション内で競合を確認し、同一アカウントのログインは1セッションに限定します。

従来のSQLite版とはデータベースが別です。既存の購入者データがある場合は、自動で移したり上書きしたりせず、移行対象を確認してください。この開発環境のテストは一時データだけを使います。

Netlify版はリクエストを5MiBまでに制限します。上限時は保存エラーを表示します。バックアップは端末へ書き出せます。ホーム画面への追加や、起動時のオンライン認証は従来と同じです。通常の980円購入は確認後のコード発行、特別クーポンによる0円取得はアカウントの自動登録です。

```bash
# 管理者の手元だけで実行。Supabase用の接続設定が必要です。
npm run license:supabase -- issue buyer@example.com
npm run license:supabase -- revoke buyer@example.com
npm run license:supabase -- restore buyer@example.com
```

## ローカルでの検証

```bash
npm ci
npm test
npm run build:netlify
SHIGODEKI_TEST_BACKEND=supabase python3 tests/checkout_browser.py
SHIGODEKI_TEST_BACKEND=supabase python3 tests/browser_smoke.py
```

SQLはPGliteのPostgreSQLで実行し、ロール権限とAPIの動作を検証します。ブラウザ確認は同じAPIハンドラーとSQLを使うローカルのテスト用サーバーで実行します。実際のSupabaseプロジェクトやNetlifyアカウントでの本番確認を済ませたという意味ではありません。
