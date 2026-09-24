/**
 * StreamSink — Production Service Worker (v11)
 * Provides offline PWA shell caching and strict video/proxy bypass.
 */

// Bumped version forces Chrome to immediately install the updated index.html
const CACHE_NAME = "streamsink-core-v12";

const PRECACHE_ASSETS = [
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

// Media extensions & proxy endpoints that must NEVER be stored in the SW cache
const STREAM_BYPASS_REGEX = /\.(m3u8|ts|m4s|mp4|aac|mp3|webm|ogg)($|\?)/i;
const PROXY_BYPASS_REGEX = /(allorigins|workers\.dev|\?url=)/i;

/**
 * Install: Cache core UI assets
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { mode: url.startsWith("http") ? "cors" : "same-origin" });
          if (res.ok) await cache.put(url, res);
        } catch {
          // Gracefully continue if an optional asset (like title.png) is missing
        }
      });
      await Promise.all(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

/**
 * Activate: Instantly delete legacy caches (v1, v2) and claim clients
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Network Fetch Interception
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Only intercept standard GET requests
  if (req.method !== "GET") return;

  // 2. Do not intercept StreamSaver internal pipes
  if (url.pathname.includes("streamsaver") || url.pathname.includes("stream-saver-sw")) {
    return;
  }

  // 3. Strict bypass for video segments and Cloudflare proxy requests
  // Ensures video streams bypass cache storage directly to your download pipe
  if (
    STREAM_BYPASS_REGEX.test(url.pathname) ||
    STREAM_BYPASS_REGEX.test(url.search) ||
    PROXY_BYPASS_REGEX.test(url.href) ||
    req.headers.has("range")
  ) {
    return;
  }

  // 4. Stale-While-Revalidate for app shell
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(req);

      const networkFetch = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});

/**
 * Notification Click Handler
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("./");
      }
    })
  );
});
