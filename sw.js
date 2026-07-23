/* ============================================================
   sw.js — Minimal service worker for offline support + installability.

   Strategy:
   - HTML navigations (the app shell) are NETWORK-FIRST: always fetch the
     latest index.html when online so asset versions (?v=…) never go stale,
     falling back to cache only when offline. This avoids the classic trap
     where an old cached shell keeps loading mismatched old CSS/JS.
   - Everything else is stale-while-revalidate: instant from cache, refreshed
     from the network in the background.
   Bump CACHE_VERSION on a deploy that needs to force a clean slate.
   ============================================================ */
const CACHE_VERSION = "philograph-v7";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles/main.css",
  "./scripts/generator.js",
  "./scripts/store.js",
  "./scripts/panel.js",
  "./scripts/search.js",
  "./scripts/graph.js",
  "./scripts/trails.js",
  "./scripts/router.js",
  "./scripts/toast.js",
  "./scripts/app.js",
  "./data/philosophers.json",
  "./data/relations.json",
  "./data/trails.json",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Only handle same-origin GET requests; let fonts, CDN scripts, and any
// cross-origin request pass straight through to the network untouched.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // App shell (HTML navigations): network-first so the freshest index.html —
  // with the correct asset versions — always loads when online. Fall back to
  // the cached shell only when the network is unavailable.
  const isHTML = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Everything else: stale-while-revalidate (instant from cache, refresh after).
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
