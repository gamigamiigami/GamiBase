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
import { PRODUCT, couponMatches, freeQuote } from "./commerce.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "/tools/shigodeki-sensei/app/";
const SITE = "/tools/shigodeki-sensei/";
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
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
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

export function createApp({
  dbPath,
  origin = "http://127.0.0.1:3000",
  couponCode = "",
}) {
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
  if (
    typeof couponCode !== "string" ||
    couponCode.length > 100 ||
    couponCode !== couponCode.trim()
  )
    throw new Error(
      "特別クーポンは前後の空白を含まない100文字以内のコードで設定してください。",
    );
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
  function startSession(res, user, extra = {}) {
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
      { user: { id: user.id, email: user.email }, expires, ...extra },
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
      if (path === "/healthz" && req.method === "GET") {
        db.prepare("SELECT 1").get();
        return send(res, 200, { ok: true });
      }
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
        if (path === `${API}product` && req.method === "GET")
          return send(res, 200, {
            ...PRODUCT,
            couponAvailable: Boolean(couponCode),
          });
        if (path === `${API}quote` && req.method === "POST") {
          throttle(`coupon:${req.socket.remoteAddress}`, 100);
          const data = await body(req);
          if (!couponCode)
            throw new Failure(503, "特別クーポンの受付は準備中です。");
          if (!couponMatches(data.coupon, couponCode))
            throw new Failure(400, "クーポンコードを確認してください。");
          const token = randomBytes(32).toString("base64url"),
            expires = Date.now() + 15 * 60000;
          db.prepare("DELETE FROM quotes WHERE expires<?").run(Date.now());
          db.prepare(
            "INSERT INTO quotes(token,coupon_hash,expires) VALUES(?,?,?)",
          ).run(hash(token), hash(couponCode), expires);
          return send(res, 200, { ...freeQuote(), quoteId: token, expires });
        }
        if (path === `${API}checkout/free` && req.method === "POST") {
          throttle(`checkout:${req.socket.remoteAddress}`, 30);
          const data = await body(req),
            email = emailOf(data.email);
          if (!validEmail(email) || !validPassword(data.password))
            throw new Failure(
              400,
              "メールアドレスと12〜128文字のパスワードを入力してください。",
            );
          if (typeof data.quoteId !== "string" || data.quoteId.length > 100)
            throw new Failure(400, "特別クーポンを適用してください。");
          const quoteHash = hash(data.quoteId),
            encoded = await passwordHash(data.password);
          db.exec("BEGIN IMMEDIATE");
          try {
            const quote = db
              .prepare(
                "SELECT * FROM quotes WHERE token=? AND used IS NULL AND expires>?",
              )
              .get(quoteHash, Date.now());
            if (!couponCode || !quote || quote.coupon_hash !== hash(couponCode))
              throw new Failure(
                409,
                "クーポンをもう一度適用してください。有効期限切れ、または取得済みです。",
              );
            const price = freeQuote();
            if (price.total !== 0)
              throw new Failure(409, "無料取得の対象ではありません。");
            if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
              throw new Failure(
                409,
                "このメールアドレスは登録済みです。アプリのログイン画面から開いてください。",
              );
            const user = { id: randomUUID(), email },
              orderId = randomUUID();
            db.prepare(
              "INSERT INTO users(id,email,password) VALUES(?,?,?)",
            ).run(user.id, email, encoded);
            db.prepare(
              "INSERT INTO orders(id,user_id,currency,list_price,coupon_discount,applied_discount,total,created_at) VALUES(?,?,?,?,?,?,?,?)",
            ).run(
              orderId,
              user.id,
              price.currency,
              price.price,
              price.couponDiscount,
              price.appliedDiscount,
              price.total,
              Date.now(),
            );
            db.prepare("UPDATE quotes SET used=? WHERE token=?").run(
              Date.now(),
              quoteHash,
            );
            db.exec("COMMIT");
            return startSession(res, user, {
              order: { id: orderId, ...price },
              appPath: APP,
            });
          } catch (error) {
            if (db.isTransaction) db.exec("ROLLBACK");
            throw error;
          }
        }
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
        if (path === `${API}access` && req.method === "GET") {
          const order = db
            .prepare(
              "SELECT id,currency,list_price AS price,coupon_discount AS couponDiscount,applied_discount AS appliedDiscount,total FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
            )
            .get(user.id);
          return send(res, 200, {
            user: { id: user.id, email: user.email },
            order: order || null,
            appPath: APP,
          });
        }
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
      if (
        path === "/" ||
        path === SITE.slice(0, -1) ||
        path === APP.slice(0, -1)
      ) {
        res.writeHead(302, {
          Location: path === APP.slice(0, -1) ? APP : SITE,
        });
        return res.end();
      }
      if (path === `${SITE}commerce-config.json`)
        return send(res, 200, { appOrigin: expectedOrigin });
      if (!path.startsWith(SITE))
        throw new Failure(404, "ページが見つかりません。");
      const relative =
        decodeURIComponent(path.slice(SITE.length)) || "index.html";
      const appRoot = resolve(ROOT, "tools/shigodeki-sensei");
      const requested = relative.endsWith("/")
        ? relative + "index.html"
        : relative;
      const file = resolve(appRoot, requested);
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
  const { server } = createApp({
    dbPath,
    origin,
    couponCode: process.env.SHIGODEKI_COUPON_CODE || "",
  });
  server.listen(port, host, () =>
    console.log(`Shigodeki server listening on ${host}:${port}`),
  );
}
