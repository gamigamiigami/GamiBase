import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// A separate static portal uses the existing purchaser app and its accounts.
// No purchaser database credentials or server functions belong in this deploy.
const root = new URL("../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL("tools/shigodeki-sensei/commerce-config.json", root), "utf8"),
);
function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password)
    throw new Error("Use an HTTPS origin without a path or trailing slash.");
  return url.origin;
}
const appOrigin = httpsOrigin(config.appOrigin);
const portalOrigin = httpsOrigin(
  process.env.PORTAL_ORIGIN || "https://gamibase-education.netlify.app",
);
if (portalOrigin === appOrigin)
  throw new Error("The static portal must have a separate origin from the purchaser app.");

await import("./build-netlify.mjs");
const out = new URL("dist/", root);
await writeFile(
  new URL("tools/shigodeki-sensei/commerce-config.json", out),
  JSON.stringify({ appOrigin }, null, 2) + "\n",
);
await rm(new URL("tools/shigodeki-sensei/app/", out), { recursive: true, force: true });
await writeFile(
  new URL("_redirects", out),
  [
    `/tools/shigodeki-sensei/app ${appOrigin}/tools/shigodeki-sensei/app/ 302!`,
    `/tools/shigodeki-sensei/app/* ${appOrigin}/tools/shigodeki-sensei/app/:splat 302!`,
    `/tools/shigodeki-sensei/checkout ${appOrigin}/tools/shigodeki-sensei/checkout.html 302!`,
    `/tools/shigodeki-sensei/checkout.html ${appOrigin}/tools/shigodeki-sensei/checkout.html 302!`,
    "",
  ].join("\n"),
);
const school = new URL("school/index.html", out);
await writeFile(
  school,
  (await readFile(school, "utf8")).replaceAll(
    "https://gamigamiigami.github.io/GamiBase/",
    `${portalOrigin}/`,
  ),
);
console.log(`Static education portal prepared in ${fileURLToPath(out)} for ${portalOrigin}.`);
