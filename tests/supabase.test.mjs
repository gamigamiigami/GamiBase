import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createSupabaseHandler,
  supabaseRpc,
  NETLIFY_MAX_BODY,
} from "../server/supabase-api.mjs";
import { hash } from "../server/credentials.mjs";

test("Netlify purchaser API with the actual PostgreSQL migration", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202610140001_shigodeki.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply during setup.
  const coupon = "postgres-only-coupon",
    origin = "https://teacher.example.com";
  const rpc = supabaseRpc({
    url: "https://test-project.supabase.co",
    key: "test-server-key",
    fetcher: async (url, options) => {
      assert.equal(
        url,
        "https://test-project.supabase.co/rest/v1/rpc/shigodeki_rpc",
      );
      assert.equal(options.headers.apikey, "test-server-key");
      const { p_action, p_data } = JSON.parse(options.body);
      const result = await db.query(
        "SELECT public.shigodeki_rpc($1,$2::jsonb) AS result",
        [p_action, JSON.stringify(p_data)],
      );
      return Response.json(result.rows[0].result);
    },
  });
  const handle = createSupabaseHandler({
    appOrigin: origin,
    couponCode: coupon,
    rpc,
  });
  const request = async (
    route,
    {
      data,
      cookie,
      method = data ? "POST" : "GET",
      from = origin,
      ip = "test-client",
    } = {},
  ) => {
    const response = await handle(
      new Request(origin + "/api/shigodeki/" + route, {
        method,
        headers: {
          Origin: from,
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      }),
      { ip },
    );
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  let first, saved, quoteId;
  const password = randomBytes(24).toString("hex");
  await t.test(
    "price is public; valid coupon reveals discount; free order and account are committed together",
    async () => {
      const product = await request("product");
      assert.equal(product.body.price, 980);
      assert.equal(JSON.stringify(product.body).includes("50000"), false);
      assert.equal(
        (await request("quote", { data: { coupon: "wrong" } })).status,
        400,
      );
      assert.equal(
        (
          await request("quote", {
            from: "https://attacker.invalid",
            data: { coupon },
          })
        ).status,
        403,
      );
      const quote = await request("quote", {
        data: { coupon, price: 0, total: -49020 },
      });
      assert.equal(quote.body.couponDiscount, 50000);
      assert.equal(quote.body.total, 0);
      quoteId = quote.body.quoteId;
      first = await request("checkout/free", {
        data: { email: "First@example.com ", password, quoteId, total: -49020 },
      });
      assert.equal(first.status, 200);
      assert.equal(first.body.order.total, 0);
      assert.equal(first.body.user.email, "first@example.com");
      assert.match(
        first.headers.get("set-cookie"),
        /HttpOnly; SameSite=Strict.*Secure/,
      );
      const order = (await request("access", { cookie: first.cookie })).body
        .order;
      assert.equal(order.id, first.body.order.id);
      assert.equal(order.price, 980);
      assert.equal(order.appliedDiscount, 980);
      assert.equal(
        (
          await request("checkout/free", {
            data: { email: "stolen@example.com", password, quoteId },
          })
        ).status,
        409,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS n FROM shigodeki.users"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS n FROM shigodeki.orders"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query("SELECT used FROM shigodeki.quotes WHERE token=$1", [
            hash(quoteId),
          ])
        ).rows[0].used > 0,
        true,
      );
    },
  );
  await t.test(
    "URL copying gives no data; saves are isolated and stale versions cannot overwrite",
    async () => {
      assert.equal((await request("state")).status, 401);
      saved = (await request("state", { cookie: first.cookie })).body;
      saved.state.owner = "先生Aのノート";
      assert.equal(
        (
          await request("state", {
            method: "PUT",
            cookie: first.cookie,
            data: saved,
          })
        ).body.revision,
        1,
      );
      assert.equal(
        (
          await request("state", {
            method: "PUT",
            cookie: first.cookie,
            data: saved,
          })
        ).status,
        409,
      );
      const q = (await request("quote", { data: { coupon } })).body;
      const second = await request("checkout/free", {
        data: { email: "second@example.com", password, quoteId: q.quoteId },
      });
      assert.equal(second.status, 200);
      assert.equal(
        (await request("state", { cookie: second.cookie })).body.state.owner,
        "",
      );
      const invalid = structuredClone(saved);
      invalid.state.ink = { invalid: [] };
      assert.equal(
        (
          await request("state", {
            method: "PUT",
            cookie: first.cookie,
            data: invalid,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("revoke", {
            cookie: first.cookie,
            data: { email: "second@example.com" },
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "shared coupon cannot take over an existing account; password login rotates sessions",
    async () => {
      const q = (await request("quote", { data: { coupon } })).body;
      assert.equal(
        (
          await request("checkout/free", {
            data: {
              email: "first@example.com",
              password: "attacker-password",
              quoteId: q.quoteId,
            },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request("login", {
            data: { email: "first@example.com", password: "attacker-password" },
          })
        ).status,
        401,
      );
      const login = await request("login", {
        data: { email: "first@example.com", password },
      });
      assert.equal(login.status, 200);
      assert.equal(
        (await request("state", { cookie: first.cookie })).status,
        401,
      );
      first = login;
      assert.equal(
        (await request("state", { cookie: first.cookie })).body.state.owner,
        "先生Aのノート",
      );
      await rpc("revoke", { email: "first@example.com" });
      assert.equal(
        (await request("state", { cookie: first.cookie })).status,
        401,
      );
      assert.equal(
        (
          await request("checkout/free", {
            data: { email: "first@example.com", password, quoteId: q.quoteId },
          })
        ).status,
        409,
      );
      await rpc("restore", { email: "first@example.com" });
      assert.equal(
        (
          await request("login", {
            data: { email: "first@example.com", password },
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "expired/rotated quotes fail and manual licenses support recovery without deleting notes",
    async () => {
      const q = (await request("quote", { data: { coupon } })).body;
      await db.query("UPDATE shigodeki.quotes SET expires=0 WHERE token=$1", [
        hash(q.quoteId),
      ]);
      assert.equal(
        (
          await request("checkout/free", {
            data: {
              email: "expired@example.com",
              password,
              quoteId: q.quoteId,
            },
          })
        ).status,
        409,
      );
      const rotated = (await request("quote", { data: { coupon } })).body;
      await db.query(
        "UPDATE shigodeki.quotes SET coupon_hash='old' WHERE token=$1",
        [hash(rotated.quoteId)],
      );
      assert.equal(
        (
          await request("checkout/free", {
            data: {
              email: "rotated@example.com",
              password,
              quoteId: rotated.quoteId,
            },
          })
        ).status,
        409,
      );
      const license = randomBytes(24).toString("base64url"),
        nextPassword = randomBytes(24).toString("hex");
      await rpc("issue-license", {
        email: "first@example.com",
        token: hash(license),
      });
      const reset = await request("redeem", {
        data: {
          email: "first@example.com",
          password: nextPassword,
          code: license,
        },
      });
      assert.equal(reset.status, 200);
      assert.equal(
        (await request("state", { cookie: reset.cookie })).body.state.owner,
        "先生Aのノート",
      );
      assert.equal(
        (
          await request("redeem", {
            data: {
              email: "first@example.com",
              password: nextPassword,
              code: license,
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("login", {
            data: { email: "first@example.com", password },
          })
        ).status,
        401,
      );
      assert.equal(
        (await request("logout", { cookie: reset.cookie, data: {} })).status,
        200,
      );
      assert.equal(
        (await request("session", { cookie: reset.cookie })).status,
        401,
      );
    },
  );
  await t.test(
    "anonymous and Supabase Auth roles cannot execute privileged RPCs or read purchaser tables",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        try {
          await assert.rejects(
            db.query("SELECT public.shigodeki_rpc('get-user','{}')"),
            /permission denied/,
          );
          await assert.rejects(
            db.query("SELECT * FROM shigodeki.users"),
            /permission denied/,
          );
        } finally {
          await db.exec("RESET ROLE");
        }
      }
      await db.exec("SET ROLE service_role");
      try {
        assert.deepEqual(await rpc("health"), { ok: true });
      } finally {
        await db.exec("RESET ROLE");
      }
    },
  );
  await t.test(
    "rate limits survive function instances and unconfigured transport errors do not leak keys",
    async () => {
      for (let i = 0; i < 15; i++)
        assert.equal(
          (
            await request("login", {
              data: { email: "unknown@example.com", password },
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await request("login", {
            data: { email: "unknown@example.com", password },
          })
        ).status,
        429,
      );
      const fail = createSupabaseHandler({
        appOrigin: origin,
        rpc: supabaseRpc({
          url: "https://test-project.supabase.co",
          key: "do-not-expose",
          fetcher: async () =>
            Response.json(
              { error: "secret upstream details" },
              { status: 403 },
            ),
        }),
      });
      const response = await fail(
        new Request(origin + "/api/shigodeki/state", {
          headers: { Cookie: "shigodeki_session=unknown" },
        }),
      );
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes("do-not-expose"), false);
      assert.equal(text.includes("upstream"), false);
      const over = await handle(
        new Request(origin + "/api/shigodeki/quote", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ coupon: "x".repeat(NETLIFY_MAX_BODY) }),
        }),
        { ip: "oversize" },
      );
      assert.equal(over.status, 413);
    },
  );
});
