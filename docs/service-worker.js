const CACHE_NAME = "hesabi-pwa-v25";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const APP_SHELL = [SCOPE_PATH, `${SCOPE_PATH}manifest.json`, `${SCOPE_PATH}service-worker.js`];
const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;

const referencedAssetUrls = (content) => [...content.matchAll(/(?:src|href)\s*(?:=|:)\s*["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\)|["'](\/(?:assets|manus-storage)\/[^"'\s)]+)["']/g)]
  .map((match) => match[1] || match[2] || match[3])
  .filter(Boolean)
  .map((value) => new URL(value, self.registration.scope))
  .filter((url) => url.origin === self.location.origin)
  .map((url) => url.href);

const isTextAsset = (response) => /(?:text|javascript|json)/i.test(response.headers.get("content-type") || "");

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const pendingUrls = [...APP_SHELL];
  const cachedUrls = new Set();
  while (pendingUrls.length) {
    const url = pendingUrls.shift();
    if (!url || cachedUrls.has(url)) continue;
    cachedUrls.add(url);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      await cache.put(url, response.clone());
      if (isTextAsset(response)) {
        const discoveredUrls = referencedAssetUrls(await response.clone().text());
        pendingUrls.push(...discoveredUrls.filter((item) => !cachedUrls.has(item)));
      }
    } catch {
      /* يحتفظ التطبيق بما اكتمل تخزينه كي يفتح بلا شبكة بعد أول تحميل ناجح. */
    }
  }
  if (!await cache.match(SCOPE_PATH)) throw new Error("تعذر تخزين واجهة التطبيق محليًا.");
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell().catch(() => caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!isSameOrigin(event.request)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(SCOPE_PATH, response.clone()));
      return response;
    }).catch(() => caches.match(SCOPE_PATH).then((cached) => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => Response.error())));
});
