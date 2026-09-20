const CACHE_NAME = "streamsink-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", (e) => {
  // Let media downloads pass through directly without caching
  if (e.request.url.includes(".ts") || e.request.url.includes(".m3u8")) {
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
