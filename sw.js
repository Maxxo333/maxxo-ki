/*
 * Maxxo KI Mobil – Service Worker.
 * Speichert NUR die eigenen App-Dateien für den Offline-Start.
 * Anfragen an api.anthropic.com / api.tavily.com (und alle anderen fremden Adressen)
 * werden nicht angefasst und nie zwischengespeichert.
 * Bei jeder Änderung an den App-Dateien CACHE_VERSION erhöhen.
 */
const CACHE_VERSION = "maxxo-mobil-v2";
const APP_FILES = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./engine.js",
  "./markdown.js",
  "./storage.js",
  "./vendor/anthropic-sdk.js",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./manifest.webmanifest",
  "./datenschutz.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_FILES.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("maxxo-mobil-") && n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // z. B. POST an die APIs: unverändert durchlassen
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fremde Adressen (Anthropic, Tavily, …) nie abfangen
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  // Netzwerk zuerst (immer die neueste Version), Cache nur als Rückfall, wenn offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
