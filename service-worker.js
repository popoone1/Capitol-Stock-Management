const CACHE_NAME = "capitol-stock-shell-v1";
const SHELL_PATHS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/styles.css",
  "/app.js",
  "/vendor/bootstrap.min.css",
  "/vendor/bootstrap.bundle.min.js",
  "/assets/capitol-catering-logo.png",
  "/assets/capitol-stock-icon-180.png",
  "/assets/capitol-stock-icon-192.png",
  "/assets/capitol-stock-icon-512.png",
  "/assets/fonts/inter-regular.ttf",
  "/assets/fonts/inter-bold.ttf",
  "/assets/fonts/manrope-regular.ttf",
  "/assets/fonts/manrope-bold.ttf",
];
const SHELL_PATH_SET = new Set(SHELL_PATHS);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_PATHS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("capitol-stock-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/index.html")) || Response.error()));
    return;
  }
  if (!SHELL_PATH_SET.has(url.pathname)) return;

  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        return caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).then(() => response);
      }
      return response;
    }).catch(async () => (await caches.match(request)) || Response.error()),
  );
});
