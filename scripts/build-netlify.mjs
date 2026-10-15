import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  out = resolve(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
// Explicit allowlist: no .env, server code, tests, migration or purchaser database is published.
for (const path of [
  "index.html",
  "data.js",
  "script.js",
  "style.css",
  "school",
  "tools",
  "downloads",
])
  await cp(resolve(root, path), resolve(out, path), { recursive: true });
// This URL is served by the function on Netlify. Keep the static Pages copy fail-closed.
await rm(resolve(out, "tools/shigodeki-sensei/commerce-config.json"));
const htmlPath = resolve(out, "index.html");
const html = await readFile(htmlPath, "utf8");
const version = (process.env.COMMIT_REF || "local").slice(0, 12);
await writeFile(
  htmlPath,
  html.replace(/(data\.js|script\.js|style\.css)"/g, `$1?v=${version}"`),
);
console.log(
  "Netlify static site prepared in dist; purchaser APIs are separate functions.",
);
