/* sw.js — SMG PWA (lightweight) */

const CACHE = "smg-pwa-v3.8";

// Static assets yang aman dicache
const ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/config.js",
  "/manifest.webmanifest",
  "/icons/icon16.png",
  "/icons/icon48.png",
  "/icons/icon128.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => (k !== CACHE ? caches.delete(k) : null))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Jangan cache request ke GAS (API harus realtime)
  if (url.hostname.includes("script.google.com")) {
    return; // biarkan network langsung
  }

  // 2) Hanya handle GET untuk caching
  if (req.method !== "GET") return;

  // 3) Cache-first untuk asset static
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // simpan copy untuk request yang aman dicache
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => {
          // fallback kalau offline & tidak ada cache
          return caches.match("/index.html");
        });
    })
  );
});














