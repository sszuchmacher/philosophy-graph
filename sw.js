/* ============================================================
   sw.js — Minimal service worker for offline support + installability.

   Strategy: stale-while-revalidate. Serve from cache immediately when
   available (fast, works offline), and refresh the cache from the
   network in the background so the next visit gets what changed.
   Bump CACHE_VERSION on a deploy that needs to force a clean slate.
   ============================================================ */
const CACHE_VERSION = "philograph-v2";

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
