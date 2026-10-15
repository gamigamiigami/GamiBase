const CACHE = "shigodeki-shell-v4";
const ROOT = new URL("./", self.location.href);
const FILES = [
  "./",
  "index.html",
  "app.css",
  "notebook.css",
  "app.mjs",
  "model.mjs",
  "sheets.mjs",
  "validation.mjs",
  "storage.mjs",
  "ink.mjs",
  "install.mjs",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
];
const URLS = new Set(FILES.map((path) => new URL(/\.(mjs|css)$/.test(path) ? `${path}?v=4` : path, ROOT).href));
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...URLS]))),
);
// New versions activate after existing windows close, to protect unsaved handwriting.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith("shigodeki-shell-") && key !== CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== ROOT.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (
    event.request.mode === "navigate" &&
    url.pathname.startsWith(ROOT.pathname)
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(new URL("./", ROOT).href)),
    );
  } else if (URLS.has(url.href)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
  }
});
