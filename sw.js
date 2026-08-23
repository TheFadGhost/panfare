// sw.js — cache-first app shell. Bump CACHE_VERSION when assets change.
const CACHE_VERSION = "panfare-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/src/styles/base.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // modules: network-first so updates land; shell: cache-first for instant boot
  const isModule = url.pathname.startsWith("/src/");
  event.respondWith(
    isModule
      ? fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
            return res;
          })
          .catch(() => caches.match(event.request))
      : caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
