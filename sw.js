/**
 * StreamSink — Production Service Worker
 * Handles offline PWA shell caching, notifications, and strict media bypass.
 */

const CACHE_NAME = "streamsink-core-v5";

// Static App Shell assets to pre-cache on install
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

// Media extensions & streaming proxy patterns that must NEVER be cached
const STREAM_BYPASS_REGEX = /\.(m3u8|ts|m4s|mp4|aac|mp3|webm|ogg)($|\?)/i;
const PROXY_BYPASS_REGEX = /(allorigins|workers\.dev|\?url=)/i;

/**
 * Installation: Cache core app shell and immediately activate
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use Promise.allSettled so a missing local icon won't break installation
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { mode: url.startsWith("http") ? "cors" : "same-origin" });
          if (res.ok) await cache.put(url, res);
        } catch {
          // Gracefully continue if an asset fails to fetch during install
        }
      });
      await Promise.all(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

/**
 * Activation: Purge legacy caches and take control of all clients
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
 * Network Routing & Fetch Interception
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never intercept non-GET requests
  if (req.method !== "GET") return;

  // 2. Never touch StreamSaver internal pipes or Service Worker mitm endpoints
  if (url.pathname.includes("streamsaver") || url.pathname.includes("stream-saver-sw")) {
    return;
  }

  // 3. Strict bypass for media streams, video segments, range requests, and CORS proxies
  // This prevents high-bandwidth video downloads from exhausting storage quota
  if (
    STREAM_BYPASS_REGEX.test(url.pathname) ||
    STREAM_BYPASS_REGEX.test(url.search) ||
    PROXY_BYPASS_REGEX.test(url.href) ||
    req.headers.has("range")
  ) {
    return;
  }

  // 4. Stale-While-Revalidate strategy for app shell assets and scripts
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(req);

      const networkFetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        // Network failed (offline); fallback to cache
        return cachedResponse;
      });

      // Serve from cache first if present, otherwise wait for network
      return cachedResponse || networkFetchPromise;
    })
  );
});

/**
 * Notification Click Handler: Focus existing tab or open the app
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If a tab is already open, bring it to focus
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow("./");
      }
    })
  );
});
