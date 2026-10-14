// Local test harness only. Never deployed: production uses the Netlify function.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createSupabaseHandler, supabaseRpc } from "../server/supabase-api.mjs";
import { hash } from "../server/credentials.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
await db.exec(
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
);
await db.exec(
  await readFile(
    resolve(root, "supabase/migrations/202610140001_shigodeki.sql"),
    "utf8",
  ),
);
await db.exec("SET ROLE service_role");
const rpc = supabaseRpc({
  url: "https://test-project.supabase.co",
  key: "local-test-key",
  fetcher: async (_, options) => {
    const { p_action, p_data } = JSON.parse(options.body);
    const result = await db.query(
      "SELECT public.shigodeki_rpc($1,$2::jsonb) AS result",
      [p_action, JSON.stringify(p_data)],
    );
    return Response.json(result.rows[0].result);
  },
});
if (process.env.TEST_SEED_PATH) {
  const seed = JSON.parse(await readFile(process.env.TEST_SEED_PATH, "utf8"));
  await rpc("issue-license", { email: seed.email, token: hash(seed.code) });
}
const port = Number(process.env.PORT),
  origin = process.env.APP_ORIGIN;
const handler = createSupabaseHandler({
  appOrigin: origin,
  couponCode: process.env.SHIGODEKI_COUPON_CODE || "",
  rpc,
});
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, origin).pathname;
    if (
      path.startsWith("/api/") ||
      path.endsWith("/commerce-config.json") ||
      path === "/healthz"
    ) {
      const request = new Request(new URL(req.url, origin), {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Readable.toWeb(req), duplex: "half" }
          : {}),
      });
      const response = await handler(request, { ip: req.socket.remoteAddress });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const relative = decodeURIComponent(path).replace(/^\//, "");
    const file = resolve(
      root,
      relative.endsWith("/") ? relative + "index.html" : relative,
    );
    if (
      !file.startsWith(resolve(root, "tools/shigodeki-sensei") + sep) ||
      relative.split("/").some((p) => p.startsWith(".")) ||
      !types[extname(file)]
    ) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)],
      "Cache-Control": "no-cache",
    });
    res.end(await readFile(file));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.name }));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log("Local Netlify/PostgreSQL test harness ready."),
);
