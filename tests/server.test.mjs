import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { issueLicense } from "../server/store.mjs";

test("purchaser authentication, account isolation, session replacement, revocation and concurrency", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "shigodeki-test-"));
  const { server, db } = createApp({
    dbPath: join(dir, "test.sqlite"),
    origin: "http://localhost",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (
    route,
    { method = "GET", data, cookie, origin = "http://localhost" } = {},
  ) => {
    const response = await fetch(`${base}/api/shigodeki/${route}`, {
      method,
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
  const password = randomBytes(20).toString("hex");
  const code = issueLicense(db, "teacher@example.com");
  assert.equal((await request("state")).status, 401);
  assert.equal(
    (
      await request("redeem", {
        method: "POST",
        data: { email: "other@example.com", password, code },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("redeem", {
        method: "POST",
        origin: "https://attacker.invalid",
        data: { email: "teacher@example.com", password, code },
      })
    ).status,
    403,
  );
  const registered = await request("redeem", {
    method: "POST",
    data: { email: "teacher@example.com", password, code },
  });
  assert.equal(registered.status, 200);
  assert.match(
    registered.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  assert.equal(
    (
      await request("redeem", {
        method: "POST",
        data: { email: "teacher@example.com", password, code },
      })
    ).status,
    403,
  );
  const cookie = registered.cookie;
  assert.equal(
    (await request("session", { cookie })).body.user.email,
    "teacher@example.com",
  );
  const first = await request("state", { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 0);
  first.body.state.owner = "Only Teacher A";
  assert.equal(
    (await request("state", { method: "PUT", cookie, data: first.body }))
      .status,
    200,
  );
  assert.equal(
    (await request("state", { method: "PUT", cookie, data: first.body }))
      .status,
    409,
  );
  const otherCode = issueLicense(db, "second@example.com");
  const second = await request("redeem", {
    method: "POST",
    data: { email: "second@example.com", password, code: otherCode },
  });
  const secondState = await request("state", { cookie: second.cookie });
  assert.equal(secondState.body.state.owner, "");
  assert.equal(secondState.body.revision, 0);
  const invalid = structuredClone(secondState.body);
  invalid.state.ink = { invalid: [] };
  assert.equal(
    (
      await request("state", {
        method: "PUT",
        cookie: second.cookie,
        data: invalid,
      })
    ).status,
    400,
  );
  const reLogin = await request("login", {
    method: "POST",
    data: { email: "teacher@example.com", password },
  });
  assert.equal(reLogin.status, 200);
  assert.equal((await request("session", { cookie })).status, 401);
  assert.equal(
    (await request("state", { cookie: reLogin.cookie })).body.state.owner,
    "Only Teacher A",
  );
  db.prepare("UPDATE users SET active=0 WHERE email=?").run(
    "teacher@example.com",
  );
  assert.equal(
    (await request("state", { cookie: reLogin.cookie })).status,
    401,
  );
  assert.equal(
    (
      await request("login", {
        method: "POST",
        data: { email: "teacher@example.com", password },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("logout", {
        method: "POST",
        cookie: second.cookie,
        data: {},
      })
    ).status,
    200,
  );
  assert.equal((await request("state", { cookie: second.cookie })).status, 401);
  for (const path of [
    "/server/store.mjs",
    "/.local/shigodeki/app.sqlite",
    "/.git/config",
  ])
    assert.equal((await fetch(base + path)).status, 404);
  const html = await fetch(base + "/tools/shigodeki-sensei/app/");
  assert.equal(html.status, 200);
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});

test("invalid login attempts are limited", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "shigodeki-rate-"));
  const { server } = createApp({
    dbPath: join(dir, "test.sqlite"),
    origin: "http://localhost",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  let response;
  for (let i = 0; i < 16; i++)
    response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/shigodeki/login`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "unknown@example.com",
          password: "deliberately-not-a-real-secret",
        }),
      },
    );
  assert.equal(response.status, 429);
});

test("expired codes fail; a new buyer code resets the password without losing the notebook", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "shigodeki-recovery-"));
  const { server, db } = createApp({
    dbPath: join(dir, "test.sqlite"),
    origin: "https://planner.example.com",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (route, data) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/shigodeki/${route}`, {
      method: "POST",
      headers: {
        Origin: "https://planner.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  const email = "recovery@example.com",
    password = randomBytes(24).toString("hex"),
    newPassword = randomBytes(24).toString("hex");
  const expired = issueLicense(db, email);
  db.prepare("UPDATE licenses SET expires=0").run();
  assert.equal(
    (await request("redeem", { email, password, code: expired })).status,
    403,
  );
  const first = await request("redeem", {
    email,
    password,
    code: issueLicense(db, email),
  });
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie"), /; Secure/);
  const { user } = await first.json();
  const second = await request("redeem", {
    email,
    password: newPassword,
    code: issueLicense(db, email),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).user.id, user.id);
  assert.equal((await request("login", { email, password })).status, 401);
  assert.equal(
    (await request("login", { email, password: newPassword })).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT count(*) as count FROM users").get().count,
    1,
  );
});
