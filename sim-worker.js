// Simülasyon arka planda çalışır; ekran donmaz.
import { simule } from "./hesap.js";

self.onmessage = (e) => {
  const { id, isler } = e.data;
  try {
    const sonuclar = [];
    const toplam = isler.reduce((a, x) => a + (x.senaryo || 0), 0) || 1;
    let biten = 0;
    let son = 0;
    for (const is of isler) {
      const r = simule({ ...is, ilerleme: (x) => {
        const o = (biten + x * is.senaryo) / toplam;
        if (o - son > 0.02 || x === 1) {
          son = o;
          self.postMessage({ id, ilerleme: o });
        }
      } });
      biten += is.senaryo;
      sonuclar.push(r);
    }
    const aktar = [];
    for (const r of sonuclar) {
      if (r.yol_ornek) aktar.push(r.yol_ornek.buffer, r.fiyat_ornek.buffer);
    }
    self.postMessage({ id, sonuclar }, aktar);
  } catch (err) {
    self.postMessage({ id, hata: String((err && err.message) || err) });
  }
};
