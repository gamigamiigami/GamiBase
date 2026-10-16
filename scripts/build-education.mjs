import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the portal source so both URLs always have the same content.
// The base keeps assets and tool/download links relative to the site root,
// including when GitHub Pages hosts the site under /GamiBase/.
export async function buildEducationEntry(siteRoot) {
  const html = await readFile(resolve(siteRoot, "index.html"), "utf8");
  await mkdir(resolve(siteRoot, "Education"), { recursive: true });
  await writeFile(
    resolve(siteRoot, "Education/index.html"),
    html.replace("<head>", '<head>\n<base href="../">'),
  );
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await buildEducationEntry(fileURLToPath(new URL("../", import.meta.url)));
  console.log("Education/index.html prepared from the portal source.");
}
