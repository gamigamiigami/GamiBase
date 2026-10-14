import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import {
  openStore,
  hash,
  emailOf,
  validEmail,
  validPassword,
  passwordHash,
  passwordMatches,
  defaultDataDir,
} from "./store.mjs";
import { validateState } from "../tools/shigodeki-sensei/app/validation.mjs";
import { createState } from "../tools/shigodeki-sensei/app/model.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "/tools/shigodeki-sensei/app/";
const API = "/api/shigodeki/";
const MAX_BODY = 8 * 1024 * 1024;
const SESSION_MS = 7 * 86400000;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function body(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    throw new Failure(415, "JSON形式で送信してください。");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw new Failure(
        413,
        "ノートの容量が上限に達しました。バックアップを書き出して管理者にご相談ください。",
      );
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new Failure(400, "入力データを読み取れません。");
  }
}

export function createApp({ dbPath, origin = "http://127.0.0.1:3000" }) {
  const expectedOrigin = new URL(origin).origin;
  if (expectedOrigin !== origin)
    throw new Error("APP_ORIGINにはパスを含まないオリジンを指定してください。");
  const secure = new URL(origin).protocol === "https:";
  if (
    !secure &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
  )
    throw new Error("公開環境はHTTPSが必要です。");
  const db = openStore(dbPath);
  function cookie(token, age = SESSION_MS / 1000) {
    return `shigodeki_session=${token}; Path=/api/shigodeki/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  }
  function send(res, status, value, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(value));
  }
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("shigodeki_session="))
      ?.slice(18);
    if (!token) throw new Failure(401, "ログインしてください。");
    const user = db
      .prepare(
        "SELECT u.id,u.email,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1",
      )
      .get(hash(token), Date.now());
    if (!user)
      throw new Failure(
        401,
        "ログインの有効期限が切れたか、別の端末でログインされました。再ログインしてください。",
      );
    return user;
  }
  function startSession(res, user) {
    const token = randomBytes(32).toString("base64url"),
      expires = Date.now() + SESSION_MS;
    db.prepare("DELETE FROM sessions WHERE user_id=? OR expires<?").run(
      user.id,
      Date.now(),
    );
    db.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run(
      hash(token),
      user.id,
      expires,
    );
    send(
      res,
      200,
      { user: { id: user.id, email: user.email }, expires },
      { "Set-Cookie": cookie(token) },
    );
  }
  function throttle(key, limit) {
    const now = Date.now();
    db.prepare("DELETE FROM attempts WHERE reset_at<?").run(now);
    db.prepare(
      "INSERT INTO attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(hash(key), now + 15 * 60000);
    if (
      db.prepare("SELECT count FROM attempts WHERE key=?").get(hash(key))
        .count > limit
    )
      throw new Failure(
        429,
        "試行回数が多いため、15分後に再度お試しください。",
      );
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const path = new URL(req.url, "http://local").pathname;
      if (path.startsWith(API)) {
        if (
          req.headers["sec-fetch-site"] === "cross-site" ||
          (req.headers.origin && req.headers.origin !== expectedOrigin)
        )
          throw new Failure(403, "この接続元からは操作できません。");
        if (
          !["GET", "HEAD"].includes(req.method) &&
          req.headers.origin !== expectedOrigin
        )
          throw new Failure(403, "接続元を確認できません。");
        if (path === `${API}session` && req.method === "GET") {
          const user = session(req);
          return send(res, 200, {
            user: { id: user.id, email: user.email },
            expires: user.expires,
          });
        }
        if (
          (path === `${API}login` || path === `${API}redeem`) &&
          req.method === "POST"
        ) {
          throttle(`ip:${req.socket.remoteAddress}`, 100);
          const data = await body(req),
            email = emailOf(data.email);
          if (!validEmail(email) || !validPassword(data.password))
            throw new Failure(
              400,
              "メールアドレスと12〜128文字のパスワードを入力してください。",
            );
          throttle(`account:${email}`, 15);
          if (path === `${API}login`) {
            const user = db
              .prepare("SELECT * FROM users WHERE email=? AND active=1")
              .get(email);
            // Do comparable password work even for an unknown account.
            const encoded =
              user?.password || `${"0".repeat(32)}:${"0".repeat(128)}`;
            if (!(await passwordMatches(data.password, encoded)) || !user)
              throw new Failure(
                401,
                "メールアドレスまたはパスワードが正しくないか、利用権限がありません。",
              );
            return startSession(res, user);
          }
          if (typeof data.code !== "string" || data.code.length > 100)
            throw new Failure(400, "利用コードを入力してください。");
          const codeHash = hash(data.code.trim());
          const encoded = await passwordHash(data.password);
          db.exec("BEGIN IMMEDIATE");
          try {
            const license = db
              .prepare(
                "SELECT * FROM licenses WHERE token=? AND email=? AND used IS NULL AND expires>?",
              )
              .get(codeHash, email, Date.now());
            if (!license)
              throw new Failure(
                403,
                "利用コードが無効、使用済み、または購入メールアドレスと一致しません。",
              );
            let user = db
              .prepare("SELECT * FROM users WHERE email=?")
              .get(email);
            if (user && !user.active)
              throw new Failure(
                403,
                "利用権限が停止されています。販売者にお問い合わせください。",
              );
            if (!user) {
              user = { id: randomUUID(), email };
              db.prepare(
                "INSERT INTO users(id,email,password) VALUES(?,?,?)",
              ).run(user.id, email, encoded);
            } else
              db.prepare("UPDATE users SET password=? WHERE id=?").run(
                encoded,
                user.id,
              );
            db.prepare("UPDATE licenses SET used=? WHERE token=?").run(
              Date.now(),
              codeHash,
            );
            db.exec("COMMIT");
            return startSession(res, user);
          } catch (error) {
            if (db.isTransaction) db.exec("ROLLBACK");
            throw error;
          }
        }
        const user = session(req);
        if (path === `${API}logout` && req.method === "POST") {
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
          return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
        }
        if (path === `${API}state` && req.method === "GET") {
          const notebook = db
            .prepare("SELECT * FROM notebooks WHERE user_id=?")
            .get(user.id);
          return send(
            res,
            200,
            notebook
              ? {
                  revision: notebook.revision,
                  state: JSON.parse(notebook.document),
                }
              : { revision: 0, state: createState() },
          );
        }
        if (path === `${API}state` && req.method === "PUT") {
          const data = await body(req);
          if (!Number.isSafeInteger(data.revision) || data.revision < 0)
            throw new Failure(400, "保存バージョンが不正です。");
          try {
            validateState(data.state);
          } catch (error) {
            throw new Failure(400, error.message);
          }
          const document = JSON.stringify(data.state);
          db.exec("BEGIN IMMEDIATE");
          try {
            const existing = db
              .prepare("SELECT revision FROM notebooks WHERE user_id=?")
              .get(user.id);
            if ((existing?.revision || 0) !== data.revision)
              throw new Failure(
                409,
                "別の画面の変更が保存されています。端末のバックアップを保存してから再読込してください。",
              );
            const revision = data.revision + 1;
            db.prepare(
              "INSERT INTO notebooks(user_id,revision,document) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,document=excluded.document",
            ).run(user.id, revision, document);
            db.exec("COMMIT");
            return send(res, 200, { revision });
          } catch (error) {
            if (db.isTransaction) db.exec("ROLLBACK");
            throw error;
          }
        }
        throw new Failure(404, "この操作は見つかりません。");
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new Failure(405, "この操作には対応していません。");
      if (path === "/" || path === APP.slice(0, -1)) {
        res.writeHead(302, { Location: APP });
        return res.end();
      }
      if (!path.startsWith(APP))
        throw new Failure(404, "ページが見つかりません。");
      const relative =
        decodeURIComponent(path.slice(APP.length)) || "index.html";
      const appRoot = resolve(ROOT, "tools/shigodeki-sensei/app");
      const file = resolve(appRoot, relative);
      if (
        !file.startsWith(appRoot + sep) ||
        relative.split("/").some((part) => part.startsWith(".")) ||
        !mime[extname(file)]
      )
        throw new Failure(404, "ページが見つかりません。");
      let content;
      try {
        content = await readFile(file);
      } catch {
        throw new Failure(404, "ページが見つかりません。");
      }
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      res.writeHead(200, {
        "Content-Type": mime[extname(file)],
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!error.status) console.error("Request failed:", error.name);
      if (!res.headersSent)
        send(res, error.status || 500, {
          error: error.status
            ? error.message
            : "サーバーで問題が発生しました。時間をおいて再度お試しください。",
        });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on("close", () => db.close());
  return { server, db };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3000),
    host = process.env.HOST || "127.0.0.1";
  const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  const dbPath = resolve(
    process.env.SHIGODEKI_DATA_DIR || defaultDataDir,
    "app.sqlite",
  );
  const { server } = createApp({ dbPath, origin });
  server.listen(port, host, () =>
    console.log(`Shigodeki server listening on ${host}:${port}`),
  );
}
