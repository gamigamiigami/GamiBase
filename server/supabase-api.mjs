import { randomBytes, randomUUID } from "node:crypto";
import {
  hash,
  emailOf,
  validEmail,
  validPassword,
  passwordHash,
  passwordMatches,
} from "./credentials.mjs";
import { PRODUCT, couponMatches, freeQuote } from "./commerce.mjs";
import { validateState } from "../tools/shigodeki-sensei/app/validation.mjs";
import { createState } from "../tools/shigodeki-sensei/app/model.mjs";

const API = "/api/shigodeki/",
  APP = "/tools/shigodeki-sensei/app/";
// Leave headroom under the serverless request/response payload limit.
export const NETLIFY_MAX_BODY = 5 * 1024 * 1024;
class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function supabaseRpc({ url, key, fetcher = fetch }) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== url ||
    !parsed.hostname.endsWith(".supabase.co")
  )
    throw new Error("SupabaseのHTTPSプロジェクトURLを設定してください。");
  if (!key) throw new Error("Supabaseのサーバー用キーを設定してください。");
  return async (action, data = {}) => {
    let response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/shigodeki_rpc`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_action: action, p_data: data }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Failure(
        503,
        "保存先に接続できません。時間をおいて再度お試しください。",
      );
    }
    if (!response.ok)
      throw new Failure(
        503,
        "保存先の設定を確認できません。販売者にお問い合わせください。",
      );
    const result = await response.json();
    if (result.error) throw new Failure(result.status || 500, result.error);
    return result;
  };
}

export function createSupabaseHandler({ appOrigin, couponCode = "", rpc }) {
  const parsed = new URL(appOrigin);
  if (
    parsed.origin !== appOrigin ||
    (parsed.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  )
    throw new Error("アプリのHTTPSオリジンを設定してください。");
  if (
    typeof couponCode !== "string" ||
    couponCode !== couponCode.trim() ||
    couponCode.length > 100
  )
    throw new Error("特別クーポンの設定が不正です。");
  const secure = parsed.protocol === "https:";
  function cookie(token, age = 604800) {
    return `shigodeki_session=${token}; Path=/api/shigodeki/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  }
  return async (request, context = {}) => {
    const send = (status, value, headers = {}) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY",
          ...(secure
            ? { "Strict-Transport-Security": "max-age=31536000" }
            : {}),
          ...headers,
        },
      });
    async function body() {
      if (
        !(request.headers.get("content-type") || "").startsWith(
          "application/json",
        )
      )
        throw new Failure(415, "JSON形式で送信してください。");
      let size = 0;
      const chunks = [],
        reader = request.body?.getReader();
      if (!reader) throw new Failure(400, "入力データを読み取れません。");
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > NETLIFY_MAX_BODY) {
          await reader.cancel();
          throw new Failure(
            413,
            "この公開先では送信データは5MiBまでです。バックアップを書き出して販売者にご相談ください。",
          );
        }
        chunks.push(part.value);
      }
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw Error();
        return data;
      } catch {
        throw new Failure(400, "入力データを読み取れません。");
      }
    }
    const throttle = (key, limit) => rpc("throttle", { key: hash(key), limit });
    const getToken = () => {
      const token = (request.headers.get("cookie") || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("shigodeki_session="))
        ?.slice(18);
      if (!token || token.length > 100)
        throw new Failure(401, "ログインしてください。");
      return hash(token);
    };
    async function register(action, data, extra = {}) {
      const token = randomBytes(32).toString("base64url");
      const result = await rpc(action, { ...data, session_token: hash(token) });
      return send(
        200,
        { ...result, ...extra },
        { "Set-Cookie": cookie(token) },
      );
    }
    try {
      const path = new URL(request.url).pathname;
      if (
        path === "/tools/shigodeki-sensei/commerce-config.json" &&
        request.method === "GET"
      )
        return send(200, { appOrigin });
      if (path === "/healthz" && request.method === "GET")
        return send(200, await rpc("health"));
      if (!path.startsWith(API))
        throw new Failure(404, "この操作は見つかりません。");
      const origin = request.headers.get("origin");
      if (
        request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== appOrigin) ||
        (!["GET", "HEAD"].includes(request.method) && origin !== appOrigin)
      )
        throw new Failure(403, "この接続元からは操作できません。");
      const route = path.slice(API.length);
      if (route === "product" && request.method === "GET")
        return send(200, { ...PRODUCT, couponAvailable: Boolean(couponCode) });
      // context.ip is supplied by Netlify; never trust client-supplied forwarding headers.
      const ip = context.ip || "unknown";
      if (route === "quote" && request.method === "POST") {
        await throttle(`coupon:${ip}`, 100);
        const data = await body();
        if (!couponCode)
          throw new Failure(503, "特別クーポンの受付は準備中です。");
        if (!couponMatches(data.coupon, couponCode))
          throw new Failure(400, "クーポンコードを確認してください。");
        const token = randomBytes(32).toString("base64url");
        const result = await rpc("quote", {
          token: hash(token),
          coupon_hash: hash(couponCode),
        });
        return send(200, {
          ...freeQuote(),
          quoteId: token,
          expires: result.expires,
        });
      }
      if (
        ["login", "redeem", "checkout/free"].includes(route) &&
        request.method === "POST"
      ) {
        await throttle(
          `${route === "checkout/free" ? "checkout" : "ip"}:${ip}`,
          route === "checkout/free" ? 30 : 100,
        );
        const data = await body(),
          email = emailOf(data.email);
        if (!validEmail(email) || !validPassword(data.password))
          throw new Failure(
            400,
            "メールアドレスと12〜128文字のパスワードを入力してください。",
          );
        await throttle(`account:${email}`, 15);
        if (route === "login") {
          const { user } = await rpc("get-user", { email });
          const encoded =
            user?.password || `${"0".repeat(32)}:${"0".repeat(128)}`;
          if (!(await passwordMatches(data.password, encoded)) || !user)
            throw new Failure(
              401,
              "メールアドレスまたはパスワードが正しくないか、利用権限がありません。",
            );
          return await register("login", { email, password: encoded });
        }
        const encoded = await passwordHash(data.password),
          userId = randomUUID();
        if (route === "redeem") {
          if (typeof data.code !== "string" || data.code.length > 100)
            throw new Failure(400, "利用コードを入力してください。");
          return await register("redeem", {
            email,
            password: encoded,
            user_id: userId,
            license_token: hash(data.code.trim()),
          });
        }
        if (
          !couponCode ||
          typeof data.quoteId !== "string" ||
          data.quoteId.length > 100
        )
          throw new Failure(400, "特別クーポンを適用してください。");
        const orderId = randomUUID();
        return await register(
          "free-checkout",
          {
            email,
            password: encoded,
            user_id: userId,
            order_id: orderId,
            quote_token: hash(data.quoteId),
            coupon_hash: hash(couponCode),
          },
          { order: { id: orderId, ...freeQuote() }, appPath: APP },
        );
      }
      const sessionToken = getToken();
      if (["session", "access"].includes(route) && request.method === "GET")
        return send(200, await rpc(route, { session_token: sessionToken }));
      if (route === "logout" && request.method === "POST")
        return send(200, await rpc("logout", { session_token: sessionToken }), {
          "Set-Cookie": cookie("", 0),
        });
      if (route === "state" && request.method === "GET") {
        const result = await rpc("state-get", { session_token: sessionToken });
        if (!result.state) result.state = createState();
        return send(200, result);
      }
      if (route === "state" && request.method === "PUT") {
        const data = await body();
        if (
          !Number.isSafeInteger(data.revision) ||
          data.revision < 0 ||
          data.revision >= 2147483647
        )
          throw new Failure(400, "保存バージョンが不正です。");
        try {
          validateState(data.state);
        } catch (error) {
          throw new Failure(400, error.message);
        }
        return send(
          200,
          await rpc("state-put", {
            session_token: sessionToken,
            revision: data.revision,
            state: data.state,
          }),
        );
      }
      throw new Failure(404, "この操作は見つかりません。");
    } catch (error) {
      return send(error.status || 500, {
        error: error.status
          ? error.message
          : "サーバーで問題が発生しました。時間をおいて再度お試しください。",
      });
    }
  };
}
