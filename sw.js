// Çevrimdışı çalışma: uygulama dosyaları önbellekte tutulur. Kişisel veriler önbelleğe girmez (IndexedDB'de durur).
const SURUM = "butce-mobil-0.10.0-2";
const DOSYALAR = [
  "./",
  "index.html",
  "stil.css",
  "app.js",
  "hesap.js",
  "grafik.js",
  "depo.js",
  "sim-worker.js",
  "manifest.webmanifest",
  "ornek.json",
  "simge/simge-192.png",
  "simge/simge-512.png",
  "simge/simge-maskable-512.png",
  "simge/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SURUM).then((c) => c.addAll(DOSYALAR.map((d) => new Request(d, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("butce-mobil-") && k !== SURUM).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "hemen") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(
      caches.match("index.html").then((m) => m || fetch(r)).catch(() => caches.match("index.html")),
    );
    return;
  }
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then((m) => m || fetch(r)),
  );
});
