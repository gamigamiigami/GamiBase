import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { hash, passwordMatches } from "../server/store.mjs";

async function fixture(t, couponCode = "test-special-coupon") {
  const dir = await mkdtemp(join(tmpdir(), "shigodeki-commerce-"));
  const app = createApp({
    dbPath: join(dir, "test.sqlite"),
    origin: "https://planner.example.com",
    couponCode,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((done) => app.server.close(done));
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (
    route,
    data,
    cookie,
    origin = "https://planner.example.com",
  ) => {
    const response = await fetch(`${base}/api/shigodeki/${route}`, {
      method: data ? "POST" : "GET",
      headers: {
        Origin: origin,
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  return { ...app, base, request, couponCode };
}

test("coupon reveals its benefit only after validation; free checkout grants an isolated authenticated account", async (t) => {
  const { request, db, couponCode, base } = await fixture(t);
  const product = await request("product");
  assert.deepEqual(product.body, {
    name: "シゴデキ先生 アプリ本体",
    price: 980,
    currency: "JPY",
    couponAvailable: true,
  });
  assert.equal(JSON.stringify(product.body).includes("50000"), false);
  const password = randomBytes(24).toString("hex");
  assert.equal((await request("quote", { coupon: "wrong" })).status, 400);
  assert.equal(
    (
      await request(
        "quote",
        { coupon: couponCode },
        null,
        "https://attacker.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("checkout/free", {
        email: "buyer@example.com",
        password,
        total: 0,
      })
    ).status,
    400,
  );
  const quote = await request("quote", {
    coupon: ` ${couponCode} `,
    total: -49020,
    price: 0,
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.price, 980);
  assert.equal(quote.body.couponDiscount, 50000);
  assert.equal(quote.body.appliedDiscount, 980);
  assert.equal(quote.body.total, 0);
  assert.equal((await request("state")).status, 401);
  assert.ok(
    db.prepare("SELECT token FROM quotes").get().token !== quote.body.quoteId,
  );
  assert.equal(
    (
      await request("checkout/free", {
        email: "buyer@example.com",
        password: "short",
        quoteId: quote.body.quoteId,
      })
    ).status,
    400,
  );
  const result = await request("checkout/free", {
    email: "Buyer@Example.com ",
    password,
    quoteId: quote.body.quoteId,
    total: -49020,
    couponDiscount: 999999,
  });
  assert.equal(result.status, 200);
  assert.match(
    result.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict.*Secure/,
  );
  assert.equal(result.body.order.total, 0);
  assert.equal(result.body.order.appliedDiscount, 980);
  assert.equal(result.body.order.couponDiscount, 50000);
  assert.equal(result.body.user.email, "buyer@example.com");
  assert.equal(
    (await request("access", undefined, result.cookie)).body.order.id,
    result.body.order.id,
  );
  assert.equal(
    (await request("state", undefined, result.cookie)).body.revision,
    0,
  );
  assert.equal(
    (
      await request("checkout/free", {
        email: "other@example.com",
        password,
        quoteId: quote.body.quoteId,
      })
    ).status,
    409,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  const login = await request("login", {
    email: "buyer@example.com",
    password,
  });
  assert.equal(login.status, 200);
  assert.equal((await request("access", undefined, result.cookie)).status, 401);
  db.prepare("UPDATE users SET active=0 WHERE email=?").run(
    "buyer@example.com",
  );
  assert.equal((await request("state", undefined, login.cookie)).status, 401);
  assert.equal((await request("access")).status, 401);
  const config = await (
    await fetch(base + "/tools/shigodeki-sensei/commerce-config.json")
  ).json();
  assert.deepEqual(config, { appOrigin: "https://planner.example.com" });
  assert.equal(
    (await fetch(base + "/tools/shigodeki-sensei/checkout.html")).status,
    200,
  );
  assert.equal((await fetch(base + "/tools/shigodeki-sensei/")).status, 200);
  assert.equal((await fetch(base + "/healthz")).status, 200);
  for (const path of [
    "/server/commerce.mjs",
    "/.env",
    "/tools/shigodeki-sensei/%2e%2e/server/commerce.mjs",
    "/tools/shigodeki-sensei/.env",
  ])
    assert.equal((await fetch(base + path)).status, 404);
});

test("expired, rotated and unconfigured coupons cannot grant access; shared coupons cannot reset existing accounts", async (t) => {
  const { request, db, couponCode } = await fixture(t);
  const password = randomBytes(24).toString("hex"),
    email = "original@example.com";
  const expired = (await request("quote", { coupon: couponCode })).body.quoteId;
  db.prepare("UPDATE quotes SET expires=0 WHERE token=?").run(hash(expired));
  assert.equal(
    (await request("checkout/free", { email, password, quoteId: expired }))
      .status,
    409,
  );
  const rotated = (await request("quote", { coupon: couponCode })).body.quoteId;
  db.prepare(
    "UPDATE quotes SET coupon_hash='previous-coupon' WHERE token=?",
  ).run(hash(rotated));
  assert.equal(
    (await request("checkout/free", { email, password, quoteId: rotated }))
      .status,
    409,
  );
  const valid = (await request("quote", { coupon: couponCode })).body.quoteId;
  assert.equal(
    (await request("checkout/free", { email, password, quoteId: valid }))
      .status,
    200,
  );
  const attack = (await request("quote", { coupon: couponCode })).body.quoteId;
  assert.equal(
    (
      await request("checkout/free", {
        email,
        password: "a-different-password",
        quoteId: attack,
      })
    ).status,
    409,
  );
  const stored = db
    .prepare("SELECT password FROM users WHERE email=?")
    .get(email).password;
  assert.equal(await passwordMatches(password, stored), true);
  db.prepare("UPDATE users SET active=0 WHERE email=?").run(email);
  assert.equal(
    (await request("checkout/free", { email, password, quoteId: attack }))
      .status,
    409,
  );
  assert.equal(
    db.prepare("SELECT active FROM users WHERE email=?").get(email).active,
    0,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  const disabled = await fixture(t, "");
  assert.equal((await disabled.request("product")).body.couponAvailable, false);
  assert.equal(
    (await disabled.request("quote", { coupon: couponCode })).status,
    503,
  );
});

test("a quote can be consumed once even by concurrent requests", async (t) => {
  const { request, db, couponCode } = await fixture(t);
  const quoteId = (await request("quote", { coupon: couponCode })).body.quoteId;
  const password = randomBytes(24).toString("hex");
  const results = await Promise.all(
    ["first@example.com", "second@example.com"].map((email) =>
      request("checkout/free", { email, password, quoteId }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
});
