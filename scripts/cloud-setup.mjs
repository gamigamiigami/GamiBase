// Provision only explicitly selected projects. Secret values stay in memory and
// are sent directly to the relevant service; never log API responses wholesale.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2] || "inspect";
class SetupFailure extends Error {}
async function api(service, path, { method = "GET", data, zip } = {}) {
  const netlify = service === "netlify",
    token =
      process.env[netlify ? "NETLIFY_AUTH_TOKEN" : "SUPABASE_ACCESS_TOKEN"];
  if (!token)
    throw new SetupFailure(
      `${netlify ? "NETLIFY_AUTH_TOKEN" : "SUPABASE_ACCESS_TOKEN"} を環境設定に入力してください。`,
    );
  const base = netlify
    ? "https://api.netlify.com/api/v1"
    : "https://api.supabase.com/v1";
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(zip ? { "Content-Type": "application/zip" } : {}),
    },
    body: zip || (data ? JSON.stringify(data) : undefined),
    signal: AbortSignal.timeout(zip ? 120000 : 30000),
  });
  if (!response.ok)
    throw new SetupFailure(
      `${service} ${method} ${path.split("?")[0]}: HTTP ${response.status}。接続権限または設定を確認してください。`,
    );
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new SetupFailure(`${service} の応答を読み取れませんでした。`);
  }
}
try {
  if (command === "inspect") {
    const [projects, sites, organizations, accounts] = await Promise.all([
      api("supabase", "/projects"),
      api("netlify", "/sites?per_page=100"),
      api("supabase", "/organizations"),
      api("netlify", "/accounts"),
    ]);
    console.log(
      JSON.stringify(
        {
        organizations: organizations.map((o) => ({ id:o.id,slug:o.slug,name:o.name })),
        accounts: accounts.map((a) => ({ id:a.id,slug:a.slug,name:a.name })),
          supabase: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
          })),
          netlify: sites.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.ssl_url || s.url,
          })),
        },
        null,
        2,
      ),
    );
  } else if (command === "apply") {
    const ref = process.env.SUPABASE_PROJECT_REF,
      siteId = process.env.NETLIFY_SITE_ID;
    if (
      !/^[a-z0-9]{10,30}$/.test(ref || "") ||
      !/^[a-zA-Z0-9-]{10,100}$/.test(siteId || "")
    )
      throw new SetupFailure(
        "対象の SUPABASE_PROJECT_REF と NETLIFY_SITE_ID を指定してください。自動では選びません。",
      );
    if (!process.env.SHIGODEKI_COUPON_CODE)
      throw new SetupFailure("SHIGODEKI_COUPON_CODE を設定してください。");
    const [projects, site] = await Promise.all([
      api("supabase", "/projects"),
      api("netlify", `/sites/${siteId}`),
    ]);
    const project = projects.find((p) => p.id === ref);
    if (!project || project.status !== "ACTIVE_HEALTHY")
      throw new SetupFailure(
        "指定したSupabaseプロジェクトが利用可能か確認してください。",
      );
    const origin = new URL(site.ssl_url || site.url).origin;
    if (!origin.startsWith("https://") || !site.account_id)
      throw new SetupFailure("NetlifyサイトのHTTPS公開URLを確認してください。");
    // Pin the exact committed source before changing any external configuration.
    execFileSync("git", ["diff", "--exit-code", "HEAD"], {
      cwd: root,
      stdio: "pipe",
    });
    if (
      execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
        cwd: root,
        encoding: "utf8",
      }).trim()
    )
      throw new SetupFailure("公開する変更を先にコミットしてください。");
    const source = execFileSync("git", ["archive", "--format=zip", "HEAD"], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    const sql = await readFile(
      new URL(
        "../supabase/migrations/202610140001_shigodeki.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await api("supabase", `/projects/${ref}/database/query`, {
      method: "POST",
      data: { query: sql },
    });
    console.log("シゴデキ先生の専用スキーマを準備しました。");
    const keys = await api("supabase", `/projects/${ref}/api-keys?reveal=true`);
    const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
    if (!serviceKey)
      throw new SetupFailure(
        "サーバー用のservice_roleキーを取得できません。プロジェクトのAPIキー設定を確認してください。",
      );
    const account = encodeURIComponent(site.account_id),
      query = `?site_id=${encodeURIComponent(site.id)}`;
    const existing = await api("netlify", `/accounts/${account}/env${query}`);
    const values = {
      SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      APP_ORIGIN: origin,
      SHIGODEKI_COUPON_CODE: process.env.SHIGODEKI_COUPON_CODE,
    };
    for (const [key, value] of Object.entries(values)) {
      if (existing.some((item) => item.key === key))
        await api("netlify", `/accounts/${account}/env/${key}${query}`, {
          method: "PATCH",
          data: { context: "production", value },
        });
      else
        await api("netlify", `/accounts/${account}/env${query}`, {
          method: "POST",
          data: [{ key, values: [{ context: "production", value }] }],
        });
    }
    console.log(
      "Netlifyへサーバー用の接続設定を保存しました。キーの値は表示しません。",
    );
    const build = await api(
      "netlify",
      `/sites/${site.id}/builds?title=${encodeURIComponent("シゴデキ先生・購入者用アプリ")}`,
      { method: "POST", zip: source },
    );
    console.log(
      JSON.stringify({
        site: site.id,
        appOrigin: origin,
        buildId: build.id,
        deployId: build.deploy_id || null,
      }),
    );
    console.log(
      "ビルド・公開の完了と本番の無料取得を確認してから、PagesのアプリURLを切り替えてください。",
    );
  } else throw new SetupFailure("Usage: npm run cloud:setup -- inspect|apply");
} catch (error) {
  // Do not expose upstream request headers, bodies, keys or command output.
  console.error(
    error instanceof SetupFailure
      ? error.message
      : "接続設定・ネットワーク・コミット済みソースを確認してください。秘密情報を含む詳細は表示しません。",
  );
  process.exitCode = 1;
}
