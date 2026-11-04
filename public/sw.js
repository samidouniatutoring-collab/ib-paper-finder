// App shell offline: the page itself and the app's static files (scripts, styles, icons, pdf.js worker).
// Papers are NOT cached here: the app keeps copies of papers you've opened in IndexedDB (src/offline.ts),
// only for approved users, and wipes them on logout or when access is removed.
// The Supabase API and signed file URLs are never cached by this worker (other origin).
const CACHE = "paper-finder-v2";
const SHELL = new URL("./", self.location.href).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SHELL, new URL("manifest.webmanifest", SHELL).href]).catch(() => undefined)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/assets/") || /\.(png|svg|webmanifest|mjs)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.mode === "navigate") {
    // Network first so updates arrive at once; the saved page is used offline.
    e.respondWith(
      fetch(e.request)
        .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)); } return r; })
        .catch(async () => (await caches.match(SHELL)) || new Response("<p style='font-family:system-ui;padding:2rem'>You're offline. Open IB Paper Finder once with a connection first.</p>", { headers: { "Content-Type": "text/html" } })),
    );
  }
});
