const CACHE_NAME = "styletap-ios-web-v4";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/core/design-system/styles.css",
  "./src/app/main.js",
  "./src/core/design-system/components.js",
  "./src/core/design-system/icons.js",
  "./src/features/capture/capture.js",
  "./src/features/home/home.js",
  "./src/features/outfit-builder/outfit.js",
  "./src/features/settings/settings.js",
  "./src/features/wardrobe/wardrobe.js",
  "./src/models/schema.js",
  "./src/services/ai-client.js",
  "./src/services/recommendation-service.js",
  "./src/services/storage.js",
  "./src/assets/outfit-recommendation.png",
  "./src/assets/icons/apple-touch-icon.png",
  "./src/assets/icons/icon-180.png",
  "./src/assets/icons/icon-192.png",
  "./src/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  if (requestUrl.pathname.endsWith("/service-worker.js")) {
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  const shouldPreferNetwork =
    event.request.mode === "navigate" ||
    requestUrl.pathname === "/" ||
    requestUrl.pathname.endsWith("/index.html") ||
    requestUrl.pathname.endsWith(".js") ||
    requestUrl.pathname.endsWith(".css") ||
    requestUrl.pathname.endsWith(".webmanifest");

  if (shouldPreferNetwork) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
