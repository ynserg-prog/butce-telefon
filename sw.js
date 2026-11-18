// Çevrimdışı çalışma: uygulama dosyaları önbellekte tutulur. Kişisel veriler önbelleğe girmez (IndexedDB'de durur).
const SURUM = "butce-mobil-0.13.0-1";
const DOSYALAR = [
  "./",
  "index.html",
  "stil.css",
  "app.js",
  "hesap.js",
  "ekstre.js",
  "grafik.js",
  "depo.js",
  "sim-worker.js",
  "manifest.webmanifest",
  "ornek.json",
  "simge/simge-192.png",
  "simge/simge-512.png",
  "simge/simge-maskable-512.png",
  "simge/apple-touch-icon.png",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
];
const PAYLASILAN = "butce-paylasilan";

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

// Android: başka uygulamadan 'Paylaş → Bütçe' (manifest share_target). Dosyalar yalnızca bu cihazın önbelleğine
// konur, uygulama açılınca okunup silinir; hiçbir yere gönderilmez.
async function paylasilanAl(r) {
  try {
    const fd = await r.formData();
    const c = await caches.open(PAYLASILAN);
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of fd.getAll("dosya")) {
      if (!(f instanceof File) || f.size > 25 * 1024 * 1024) continue;
      await c.put(new Request(`paylasilan/${i++}`), new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream",
        "X-Dosya-Adi": encodeURIComponent(f.name || "paylasilan") } }));
    }
  } catch { /* dosya okunamadı: uygulama yine açılır */ }
  return Response.redirect("./?paylasilan=1", 303);
}

self.addEventListener("fetch", (e) => {
  const r = e.request;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  if (r.method === "POST" && url.pathname.endsWith("/paylas")) {
    e.respondWith(paylasilanAl(r));
    return;
  }
  if (r.method !== "GET") return;
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
