/**
 * StreamSink — PWA Service Worker (sw.js)
 * Caches app shell & core libraries for offline loading.
 * Strictly bypasses media streams, proxy endpoints, and Range requests to prevent memory exhaustion.
 */

const CACHE_NAME = "streamsink-cache-v13";

// App shell and CDN streaming dependencies to cache for offline availability
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.png",
  "./title.png",
  "https://cdn.jsdelivr.net/npm/hls.js@1",
  "https://cdn.jsdelivr.net/npm/mux.js@6.0.1/dist/mux.min.js",
  "https://cdn.jsdelivr.net/npm/web-streams-polyfill@3/dist/polyfill.min.js",
  "https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js"
];

// 1. Install Event: Cache Core Static Shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use individual caching so missing optional assets (e.g. title.png) don't reject the whole batch
      for (const asset of ASSETS_TO_CACHE) {
        try {
          await cache.add(asset);
        } catch {
          // Ignore missing non-critical assets (e.g. optional custom logo files)
        }
      }
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Cleanup Obsolete Caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Intercept Shell Requests & Bypass Video Streams
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // CRITICAL BYPASS RULES:
  // Never intercept or buffer Cloudflare Worker proxy calls, media chunks, or Range requests.
  if (
    req.method !== "GET" ||
    req.headers.has("Range") ||
    url.hostname.includes("workers.dev") ||
    url.hostname.includes("allorigins") ||
    url.searchParams.has("url") ||
    url.searchParams.has("sniff") ||
    /\.(m3u8|ts|mp4|m4s|mpd|key)(\?|$)/i.test(url.pathname)
  ) {
    return; // Handled directly by native network stack
  }

  // Network-First strategy for index.html (so code edits in TrebEdit reload instantly)
  if (req.mode === "navigate" || url.pathname.endsWith("index.html") || url.pathname === "/") {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes.ok) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Cache-First strategy for static CDN scripts and icons
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) return cachedRes;

      return fetch(req).then((networkRes) => {
        if (!networkRes || networkRes.status !== 200 || networkRes.type === "opaque") {
          return networkRes;
        }
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return networkRes;
      });
    })
  );
});
