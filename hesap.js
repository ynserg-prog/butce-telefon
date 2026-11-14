// Bütçe Planlayıcı telefon uygulaması: hesap çekirdeği (DOM'suz; tarayıcıda, Web Worker'da ve Node testlerinde çalışır).
// Masaüstündeki butce/simulation.py, karisim.py, nakit.py ve takip.py'nin JavaScript karşılığı. Yöntem ve sabitler
// aynıdır; rastgele sayı üreteci farklı olduğu için sonuçlar senaryo hatası kadar (genelde %1-2) farklı çıkabilir.
// Yatırım tavsiyesi değildir.

// ------------------------------------------------------------------------------------------ biçimler ve aylar
export const AY_ADI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim",
  "Kasım", "Aralık"];

function binlik(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function tl(x, birim = " TL") {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const r = Math.round(Math.abs(x));
  return (x < 0 && r !== 0 ? "-" : "") + binlik(r) + birim;
}

export function yuzde(x, ondalik = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const v = "%" + (Math.abs(x) * 100).toFixed(ondalik).replace(".", ",");
  return x < 0 && Number((Math.abs(x) * 100).toFixed(ondalik)) !== 0 ? "-" + v : v;
}

export function yuzdeIsaretli(x) {
  return (x >= 0 ? "+" : "−") + "%" + (Math.abs(x) * 100).toFixed(1).replace(".", ",");
}

export function sayi(x, ondalik = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const s = Math.abs(x).toFixed(ondalik);
  let [t, k] = s.split(".");
  t = binlik(t);
  k = k ? k.replace(/0+$/, "") : "";
  return (x < 0 ? "-" : "") + t + (k ? "," + k : "");
}

export function kisaTl(x) {
  const a = Math.abs(x);
  const s = x < 0 ? "-" : "";
  if (a >= 1e9) return s + (a / 1e9).toFixed(1).replace(".", ",") + " Mr";
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",") + " Mn";
  if (a >= 1e3) return s + Math.round(a / 1e3) + " B";
  return s + Math.round(a);
}

export function ay(ym) {
  const [y, m] = String(ym || "").split("-");
  const i = parseInt(m, 10);
  return i >= 1 && i <= 12 ? `${AY_ADI[i - 1]} ${y}` : String(ym || "");
}

export function ayKisa(ym) {
  const [y, m] = String(ym || "").split("-");
  const i = parseInt(m, 10);
  return i >= 1 && i <= 12 ? `${AY_ADI[i - 1].slice(0, 3)} ${y.slice(2)}` : String(ym || "");
}

export function ayEkle(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${String(Math.floor(k / 12)).padStart(4, "0")}-${String((k % 12) + 1).padStart(2, "0")}`;
}

export function ayFarki(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

export function buAy(t = new Date()) {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
}

export function bugunIso(t = new Date()) {
  return `${buAy(t)}-${String(t.getDate()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------ rastgele sayılar
// xoshiro128** (32 bit), splitmix32 ile tohumlanır. Normal dağılım: Marsaglia kutupsal yöntemi.
export class Rng {
  constructor(seed = 7) {
    let s = seed >>> 0;
    const sm = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    this._yedek = null;
  }

  next() {
    const r = Math.imul(((Math.imul(this.b, 5) << 7) | (Math.imul(this.b, 5) >>> 25)), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a; this.d ^= this.b; this.b ^= this.c; this.a ^= this.d; this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return r;
  }

  random() {   // [0, 1), 53 bit
    return ((this.next() >>> 5) * 67108864 + (this.next() >>> 6)) / 9007199254740992;
  }

  normal() {
    if (this._yedek !== null) {
      const v = this._yedek;
      this._yedek = null;
      return v;
    }
    let u, v, s;
    do {
      u = this.random() * 2 - 1;
      v = this.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    this._yedek = v * f;
    return u * f;
  }

  kikare(nu) {   // tam sayı serbestlik derecesi
    let t = 0;
    for (let i = 0; i < nu; i++) {
      const z = this.normal();
      t += z * z;
    }
    return t;
  }
}

// ------------------------------------------------------------------------------------------ araçlar ve korelasyon
export function netBeklenen(i, enflasyon) {
  const g = i.reel_ek !== null && i.reel_ek !== undefined ? (1 + enflasyon) * (1 + i.reel_ek) - 1 : i.yillik_getiri;
  return g * (1 - (i.stopaj || 0));
}

const CORR = { "altin|doviz": 0.6, "hisse|doviz": 0.2, "altin|hisse": 0.1, "mevduat|ppf": 0.9, "tufe|mevduat": 0.3,
  "tufe|ppf": 0.3, "kripto|hisse": 0.3, "kripto|doviz": 0.3, "kripto|altin": 0.1 };
const AYNI_SINIF = { hisse: 0.55, altin: 0.85, doviz: 0.9, ppf: 0.9, mevduat: 0.9, tufe: 0.7, kripto: 0.7 };
const ENF_DUYARLILIK = { altin: 1.0, doviz: 1.0, hisse: 0.6, mevduat: 0.3, ppf: 0.4, kripto: 0.8 };
const SOK_TEPKISI = { doviz: 1.0, altin: 0.8, hisse: -0.3, kripto: 0.8 };
const STRES_KAYMA = { hisse: -0.5, kripto: -0.5, altin: 0.2, doviz: 0.2 };
export const MODELLER = { guclu: "Güçlendirilmiş (önerilen)", klasik: "Klasik (normal dağılım)" };
export const VARSAYILAN_SENARYO = 10000, EN_AZ_SENARYO = 1000, EN_COK_SENARYO = 100000;
const T_SERBESTLIK = 5;
const Z_SINIR = 7.0;
const REJIM_GECIS = [0.04, 0.25];
const REJIM_CARPAN = [0.82, 1.73];
const BELIRSIZLIK_YIL = 10;
const YOL_ORNEK = 10000;     // yüzdelik yolları için saklanan en fazla yol (telefon belleği için masaüstünden az)
const HEDEF_ORNEK = 2000;
export const YUZDELIKLER = [5, 10, 25, 50, 75, 90, 95];

function sinif(inst, k) {
  return (inst[k] && inst[k].sinif) || k;
}

export function korelasyonMatrisi(keys, inst) {
  const n = keys.length;
  const c = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = keys[i], b = keys[j];
      let v = null;
      if (inst[a] && inst[a].korelasyon && inst[a].korelasyon[b] !== undefined) v = inst[a].korelasyon[b];
      if (v === null && inst[b] && inst[b].korelasyon && inst[b].korelasyon[a] !== undefined) v = inst[b].korelasyon[a];
      if (v === null) {
        const sa = sinif(inst, a), sb = sinif(inst, b);
        v = sa === sb ? (AYNI_SINIF[sa] ?? 0.5) : (CORR[`${sa}|${sb}`] ?? CORR[`${sb}|${sa}`] ?? 0.0);
      }
      v = Math.min(0.95, Math.max(-0.95, Number(v)));
      c[i][j] = c[j][i] = v;
    }
  }
  return pozitifTanimli(c);
}

// Simetrik matrisin öz değerleri (Jacobi dönüşümleri)
export function ozAyrisim(m) {
  const n = m.length;
  const a = m.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let tur = 0; tur < 100; tur++) {
    let kare = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) kare += a[i][j] * a[i][j];
    if (kare < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { degerler: a.map((r, i) => r[i]), vektorler: v };
}

function pozitifTanimli(c) {
  const n = c.length;
  const { degerler, vektorler } = ozAyrisim(c);
  if (Math.min(...degerler) > 1e-8) return c;
  const w = degerler.map((x) => Math.max(x, 1e-6));
  const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let t = 0;
    for (let k = 0; k < n; k++) t += vektorler[i][k] * w[k] * vektorler[j][k];
    return t;
  }));
  const d = m.map((r, i) => Math.sqrt(r[i]));
  return m.map((r, i) => r.map((x, j) => x / (d[i] * d[j])));
}

export function cholesky(m) {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let t = m[i][j] + (i === j ? 1e-9 : 0);
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(t, 1e-12));
      else L[i][j] = t / L[j][j];
    }
  }
  return L;
}

// ------------------------------------------------------------------------------------------ yüzdelikler
export function yuzdelik(sirali, p) {   // numpy 'linear' ile aynı; dizi sıralı olmalı
  const n = sirali.length;
  if (!n) return NaN;
  const h = (n - 1) * p / 100;
  const lo = Math.floor(h), hi = Math.min(lo + 1, n - 1);
  return sirali[lo] + (h - lo) * (sirali[hi] - sirali[lo]);
}

function sirala(a) {
  return Float64Array.from(a).sort();
}

function guven(sirali, p) {
  const n = sirali.length;
  if (n < 20) return NaN;
  const k = 1.96 * Math.sqrt(n * p * (1 - p));
  const lo = sirali[Math.max(0, Math.floor(n * p - k))];
  const hi = sirali[Math.min(n - 1, Math.ceil(n * p + k))];
  const orta = sirali[Math.min(n - 1, Math.floor(n * p))];
  return orta ? (hi - lo) / 2 / Math.abs(orta) : NaN;
}

export function senaryoSayisi(n) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return VARSAYILAN_SENARYO;
  return Math.min(Math.max(x, EN_AZ_SENARYO), EN_COK_SENARYO);
}

// ------------------------------------------------------------------------------------------ Monte Carlo
// Bir yolun aylık araç getirilerini (ay x araç) ve aylık enflasyonu üretir (simulation._draw ile aynı model).
function yolUret(rng, ctx, months, r, inflM, z) {
  const { keys, insts, mu, sig, sigM, L, model, A, kayma, sd, ps } = ctx;
  const k = keys.length;
  const infMean = A.enflasyon_yillik ?? 0.25, infSd = A.enflasyon_belirsizlik ?? 0.05;
  const pShock = A.kur_soku_olasiligi ?? 0.10, size = A.kur_soku_buyuklugu ?? 0.30;
  const years = Math.ceil(months / 12);
  const infBaz = Math.pow(1 + infMean, 1 / 12) - 1;
  const sokAy = new Int32Array(years).fill(-1);
  for (let y = 0; y < years; y++) {
    let inf = infMean + infSd * rng.normal();
    const sokYil = rng.random() < pShock;
    const sm = Math.floor(rng.random() * 12);
    if (sokYil) {
      inf += size * 0.4;
      sokAy[y] = y * 12 + sm;
    }
    inf = Math.max(inf, -0.05);
    const im = Math.pow(1 + inf, 1 / 12) - 1;
    for (let t = y * 12; t < Math.min(months, y * 12 + 12); t++) inflM[t] = im;
  }
  const guclu = model === "guclu";
  let stres = false;
  const belirsiz = new Float64Array(k), reelBelirsiz = new Float64Array(k);
  if (guclu) {
    stres = rng.random() < REJIM_GECIS[0] / (REJIM_GECIS[0] + REJIM_GECIS[1]);
    for (let j = 0; j < k; j++) belirsiz[j] = rng.normal() * sd[j];
    for (let j = 0; j < k; j++) reelBelirsiz[j] = rng.normal() * 0.01;
  }
  const e = new Float64Array(k);
  const tCarpan = Math.sqrt((T_SERBESTLIK - 2) / T_SERBESTLIK);
  for (let t = 0; t < months; t++) {
    for (let j = 0; j < k; j++) e[j] = rng.normal();
    for (let i = 0; i < k; i++) {      // z = L e
      let s = 0;
      const Li = L[i];
      for (let j = 0; j <= i; j++) s += Li[j] * e[j];
      z[i] = s;
    }
    let karistir = 1;
    if (guclu) {
      karistir = rng.kikare(T_SERBESTLIK) / T_SERBESTLIK;
      const f = tCarpan / Math.sqrt(karistir);
      for (let j = 0; j < k; j++) z[j] = Math.min(Z_SINIR, Math.max(-Z_SINIR, z[j] * f));
    }
    const surprise = inflM[t] - infBaz;
    const shock = sokAy[Math.floor(t / 12)] === t ? 1 : 0;
    const carpan = stres ? REJIM_CARPAN[1] : REJIM_CARPAN[0];
    for (let j = 0; j < k; j++) {
      const i = insts[j];
      let volM, logR;
      if (guclu) {
        volM = sigM[j] * carpan;
        const surukle = stres ? kayma[j] : -kayma[j] * ps / (1 - ps);
        logR = Math.log1p(mu[j]) / 12 + belirsiz[j] / 12 + surukle - volM * volM / 2 + volM * z[j];
      } else {
        volM = sigM[j];
        logR = Math.log1p(mu[j]) / 12 - volM * volM / 2 + volM * z[j];
      }
      let rr = Math.expm1(logR);
      if (i.reel_ek !== null && i.reel_ek !== undefined) {
        const reel = i.reel_ek + reelBelirsiz[j];
        rr = ((1 + inflM[t]) * Math.pow(1 + reel, 1 / 12) - 1) * (1 - (i.stopaj || 0)) + volM * 0.6 * z[j];
      } else {
        rr += (ENF_DUYARLILIK[sinif(ctx.instMap, keys[j])] ?? 0) * surprise * (1 - (i.stopaj || 0));
      }
      const jump = (SOK_TEPKISI[sinif(ctx.instMap, keys[j])] ?? 0) * size;
      if (jump && shock) rr = (1 + rr) * (1 + jump) - 1;
      r[t * k + j] = rr;
    }
    if (guclu) {   // bir sonraki ayın rejimi
      const u = rng.random();
      stres = stres ? u >= REJIM_GECIS[1] : u < REJIM_GECIS[0];
    }
  }
}

function hazirla(keys, instMap, A, model) {
  const insts = keys.map((k) => instMap[k]);
  const infMean = A.enflasyon_yillik ?? 0.25;
  const mu = Float64Array.from(insts, (i) => netBeklenen(i, infMean));
  const sig = Float64Array.from(insts, (i) => i.volatilite);
  const sigM = Float64Array.from(sig, (s) => s / Math.sqrt(12));
  const L = cholesky(korelasyonMatrisi(keys, instMap));
  const kayma = Float64Array.from(keys, (k, j) => (STRES_KAYMA[sinif(instMap, k)] ?? 0) * sigM[j]);
  const sd = Float64Array.from(sig, (s) => (s > 0 ? Math.max(s / Math.sqrt(BELIRSIZLIK_YIL), 0.02) : 0));
  const ps = REJIM_GECIS[0] / (REJIM_GECIS[0] + REJIM_GECIS[1]);
  return { keys, insts, instMap, mu, sig, sigM, L, model, A, kayma, sd, ps };
}

/**
 * Monte Carlo birikim simülasyonu (simulation.simulate).
 * o: {agirliklar, araclar, aylik, ay, varsayimlar, baslangic, senaryo, tohum, artsin, model, takvim, hedefOrnegi,
 *     ilerleme(oran)}
 */
export function simule(o) {
  const A = o.varsayimlar || {};
  const model = o.model || A.mc_model || "guclu";
  const months = Math.max(1, Math.floor(o.ay));
  const nPaths = Math.floor(Math.min(Math.max(o.senaryo || 4000, 100), EN_COK_SENARYO));
  const instMap = Object.fromEntries((o.araclar || []).map((i) => [i.key, i]));
  const keys = Object.keys(o.agirliklar).filter((k) => o.agirliklar[k] > 0 && instMap[k]);
  if (!keys.length) throw new Error("Karışımda simüle edilecek araç yok.");
  const wt = keys.map((k) => o.agirliklar[k]);
  const wSum = wt.reduce((a, b) => a + b, 0);
  const w = Float64Array.from(wt, (x) => x / wSum);
  const ctx = hazirla(keys, instMap, A, model);
  const k = keys.length;
  const takvim = o.takvim ? Float64Array.from(o.takvim) : null;
  const initial = Number(o.baslangic) || 0;
  const monthly = Number(o.aylik) || 0;
  const grow = o.artsin !== false;
  const rng = new Rng(o.tohum ?? 7);
  const nYol = Math.min(nPaths, YOL_ORNEK);
  const nHedef = o.hedefOrnegi === false ? 0 : Math.min(nPaths, HEDEF_ORNEK);
  const yollar = new Float32Array(nYol * months);
  const yolOrnek = nHedef ? new Float32Array(nHedef * months) : null;
  const fiyatOrnek = nHedef ? new Float32Array(nHedef * months) : null;
  const value = new Float64Array(nPaths), real = new Float64Array(nPaths), cNomA = new Float64Array(nPaths),
    cRealA = new Float64Array(nPaths), maxDdA = new Float64Array(nPaths), yn = new Float64Array(nPaths),
    yr = new Float64Array(nPaths);
  const cPath = new Float64Array(months);
  let eksikSay = 0;
  const r = new Float64Array(months * k), inflM = new Float64Array(months), z = new Float64Array(k);
  const yil = months / 12;
  const adim = Math.max(1, Math.floor(nPaths / 50));
  for (let p = 0; p < nPaths; p++) {
    yolUret(rng, ctx, months, r, inflM, z);
    let v = initial, price = 1, cNom = initial, cReal = initial, peak = initial, maxDd = 0, nav = 1, eksik = false;
    let twr = 0;
    for (let t = 0; t < months; t++) {
      let c = takvim ? (t < takvim.length ? takvim[t] : 0) : monthly * (grow ? price : 1);
      let vv = v + c;
      if (takvim) {
        if (vv < -0.5) eksik = true;
        vv = Math.max(vv, 0);
        c = vv - v;
      }
      let rt = 0;
      const o2 = t * k;
      for (let j = 0; j < k; j++) rt += w[j] * r[o2 + j];
      v = vv * (1 + rt);
      price *= 1 + inflM[t];
      cNom += c;
      cReal += c / price;
      cPath[t] += cNom;
      twr += Math.log1p(rt);
      if (p < nYol) yollar[p * months + t] = v;
      if (p < nHedef) {
        yolOrnek[p * months + t] = v;
        fiyatOrnek[p * months + t] = price;
      }
      if (takvim) {
        nav *= 1 + rt;
        peak = t ? Math.max(peak, nav) : Math.max(nav, 1);
        maxDd = Math.max(maxDd, 1 - nav / peak);
      } else {
        peak = Math.max(peak, v);
        maxDd = Math.max(maxDd, 1 - v / (peak > 0 ? peak : 1));
      }
    }
    value[p] = v;
    real[p] = v / price;
    cNomA[p] = cNom;
    cRealA[p] = cReal;
    maxDdA[p] = maxDd;
    if (eksik) eksikSay++;
    const tw = Math.exp(twr);
    yn[p] = Math.pow(tw, 1 / yil) - 1;
    yr[p] = Math.pow(tw / price, 1 / yil) - 1;
    if (o.ilerleme && p % adim === 0) o.ilerleme(p / nPaths);
  }
  const sv = sirala(value), sr = sirala(real), syn = sirala(yn), syr = sirala(yr);
  const yolP = { 10: new Float64Array(months), 50: new Float64Array(months), 90: new Float64Array(months) };
  const kolon = new Float64Array(nYol);
  for (let t = 0; t < months; t++) {
    for (let p = 0; p < nYol; p++) kolon[p] = yollar[p * months + t];
    kolon.sort();
    for (const q of [10, 50, 90]) yolP[q][t] = yuzdelik(kolon, q);
  }
  const p5 = yuzdelik(sr, 5);
  let kotuT = 0, kotuN = 0;
  for (let p = 0; p < nPaths; p++) if (real[p] <= p5) { kotuT += real[p]; kotuN++; }
  let reelKayip = 0, nomKayip = 0;
  for (let p = 0; p < nPaths; p++) {
    if (real[p] < Math.max(cRealA[p], 0) * 0.999) reelKayip++;
    if (value[p] < Math.max(cNomA[p], 0) * 0.999) nomKayip++;
  }
  const ort = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const pct = (s) => Object.fromEntries(YUZDELIKLER.map((q) => [q, yuzdelik(s, q)]));
  if (o.ilerleme) o.ilerleme(1);
  return {
    aylar: months, toplam_katki: ort(cNomA), nominal_p: pct(sv), reel_p: pct(sr),
    yol_p: { 10: Array.from(yolP[10]), 50: Array.from(yolP[50]), 90: Array.from(yolP[90]) },
    reel_kayip_olasiligi: reelKayip / nPaths, nominal_kayip_olasiligi: nomKayip / nPaths,
    en_kotu_dusus_medyan: yuzdelik(sirala(maxDdA), 50), reel_katki: yuzdelik(sirala(cRealA), 50),
    agirliklar: Object.fromEntries(keys.map((x, j) => [x, w[j]])),
    katki_yol: Array.from(cPath, (x) => x / nPaths), senaryo: nPaths, model,
    yillik_nominal_p: pct(syn), yillik_reel_p: pct(syr),
    kotu5_ortalama: kotuN ? kotuT / kotuN : sr[0], medyan_hata: guven(sr, 0.5), p10_hata: guven(sr, 0.1),
    eksik_olasiligi: eksikSay / nPaths, katki_takvimi: takvim ? Array.from(takvim.slice(0, months)) : null,
    baslangic: initial, yol_ornek: yolOrnek, fiyat_ornek: fiyatOrnek, ornek_sayisi: nHedef,
  };
}

/** ay. ayın sonunda değerin tutar'a ulaşma olasılığı (reel: tutar bugünkü TL ile). */
export function hedefOlasiligi(res, tutar, ayNo, reel = false) {
  const n = res.ornek_sayisi || 0;
  if (!n || ayNo < 1) return NaN;
  const m = res.aylar;
  const t = Math.min(Math.floor(ayNo), m) - 1;
  let say = 0;
  for (let p = 0; p < n; p++) {
    let v = res.yol_ornek[p * m + t];
    if (reel) v /= res.fiyat_ornek[p * m + t];
    if (v >= tutar * 0.999) say++;
  }
  return say / n;
}

// ------------------------------------------------------------------------------------------ karışımlar
export const KLASIK = { ppf: 0.45, tufe: 0.25, altin: 0.20, doviz: 0.10 };
export const RISK_ADI = { 1: "Çok düşük", 2: "Düşük", 3: "Orta", 4: "Yüksek", 5: "Çok yüksek" };
export const KULLANICI_DAGILIMI = { altin: 0.30, acil: 0.20, piyasa: 0.20, konservatif: 0.30 };

export function normalize(paylar) {
  const p = {};
  for (const [k, v] of Object.entries(paylar || {})) if (v && Number(v) > 0) p[k] = Number(v);
  const t = Object.values(p).reduce((a, b) => a + b, 0);
  if (!(t > 0)) return {};
  for (const k of Object.keys(p)) p[k] /= t;
  return p;
}

/** Karışım payları -> araç ağırlıkları (toplam 1). tablo: karışım -> {araç: ağırlık} */
export function birlestir(paylar, tablo) {
  const out = {};
  const p = normalize(Object.fromEntries(Object.entries(paylar).filter(([k]) => tablo[k])));
  for (const [k, pay] of Object.entries(p)) {
    for (const [arac, w] of Object.entries(tablo[k])) out[arac] = (out[arac] || 0) + pay * w;
  }
  const t = Object.values(out).reduce((a, b) => a + b, 0);
  if (!t) return {};
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v / t > 1e-9).sort((a, b) => b[1] - a[1])
    .map(([kk, v]) => [kk, v / t]));
}

export function riskSeviyesi(agirliklar, araclar) {
  const risk = Object.fromEntries(araclar.map((i) => [i.key, i.risk]));
  const toplam = Object.values(agirliklar).reduce((a, b) => a + b, 0) || 1;
  const puan = Object.entries(agirliklar).reduce((a, [k, w]) => a + w * (risk[k] ?? 3), 0) / toplam;
  return RISK_ADI[Math.min(5, Math.max(1, Math.round(puan)))];
}

export function vadeAnahtari(ayS) {
  return ayS <= 6 ? "kisa" : ayS <= 30 ? "orta" : "uzun";
}

/** Paketten bu süre için kullanılacak araçlar (piyasa adayları vadeye göre) ve karışım tablosu. */
export function aracVeTablo(paket, ayS) {
  const araclar = [...(paket.araclar || [])];
  const vade = paket.al_sat ? "kisa" : vadeAnahtari(ayS);
  const ek = (paket.aday_araclari || {})[vade] || [];
  for (const i of ek) if (!araclar.some((x) => x.key === i.key)) araclar.push(i);
  const tablo = {};
  for (const h of paket.karisimlar || []) if (h.agirliklar && Object.keys(h.agirliklar).length) tablo[h.key] = h.agirliklar;
  return { araclar, tablo };
}

export function agirlikMetni(agirliklar, araclar) {
  const ad = Object.fromEntries(araclar.map((i) => [i.key, i.ad]));
  return Object.entries(agirliklar).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.005)
    .map(([k, v]) => `%${Math.round(v * 100)} ${ad[k] || k}`).join(", ");
}

export function payMetni(paylar, hazirAd) {
  return Object.entries(normalize(paylar)).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `%${Math.round(v * 100)} ${(hazirAd[k] || k).toLocaleLowerCase("tr")}`).join(" + ");
}

function fark(x) {
  return (x >= 0 ? "+" : "−") + tl(Math.abs(x));
}

/** Sonucu sade dille anlatır (karisim.ozet_cumle). */
export function ozetCumle(ks) {
  const r = ks.sonuc;
  const yilS = ks.ay / 12;
  const sure = `${ks.ay} ay` + (ks.ay % 12 === 0 && ks.ay >= 12 ? ` (${yilS.toFixed(0)} yıl)` : "");
  let s;
  if (r.katki_takvimi) {
    const acik = r.katki_takvimi.filter((x) => x < 0).length;
    s = `${sure} boyunca kasadaki ${tl(ks.baslangic)} ile başlayıp projeksiyondaki gelir − gider farkıyla ayda ortalama `
      + `${tl(ks.aylik)} yatırırsanız` + (acik ? ` (${acik} açık ayda açığı birikimden çekerek)` : "")
      + ` bugünkü parayla net ${tl(r.reel_katki)} yatırmış olursunuz. `;
  } else {
    s = `${sure} boyunca ayda ${tl(ks.aylik)} yatırırsanız bugünkü parayla toplam ${tl(r.reel_katki)} yatırmış olursunuz. `;
  }
  s += `Tipik senaryoda birikiminiz bugünkü parayla ${tl(r.reel_p[50])} olur (${fark(r.reel_p[50] - r.reel_katki)}). `
    + `10 senaryodan birinde ${tl(r.reel_p[10])} veya altında kalır (${fark(r.reel_p[10] - r.reel_katki)}); `
    + `10 senaryodan birinde ${tl(r.reel_p[90])} veya üstüne çıkar. `;
  if (r.eksik_olasiligi > 0.005) {
    s += `Senaryoların ${yuzde(r.eksik_olasiligi)}'inde açık veren bir ayda birikim açığı karşılamaya yetmiyor. `;
  }
  s += `Yıllık getiri tahmini (enflasyondan arındırılmış): tipik ${yuzdeIsaretli(r.yillik_reel_p[50])}, `
    + `kötü senaryoda ${yuzdeIsaretli(r.yillik_reel_p[10])}, iyi senaryoda ${yuzdeIsaretli(r.yillik_reel_p[90])}. `;
  s += `Enflasyonun altında kalma olasılığı ${yuzde(r.reel_kayip_olasiligi)}; `;
  if (r.en_kotu_dusus_medyan < 0.01) {
    s += "her ay yeni alım yapıldığı için tipik senaryoda yolda belirgin bir geri çekilme görülmez.";
  } else {
    s += `yolda değer tipik olarak en yüksek noktasından ${yuzde(r.en_kotu_dusus_medyan)} kadar geri çekilir.`;
  }
  return s;
}

export function guvenilirlik(r) {
  if (!r.senaryo) return "";
  const model = (MODELLER[r.model] || r.model).split(":")[0].replace(" (önerilen)", "").toLocaleLowerCase("tr");
  let s = `${binlik(r.senaryo)} senaryo, ${model} model`;
  if (!Number.isNaN(r.medyan_hata)) {
    const o = (x) => "%" + (x * 100).toFixed(1).replace(".", ",");
    s += `; tipik sonuç %95 güvenle ±${o(r.medyan_hata)}, kötü senaryo (P10) ±${o(r.p10_hata)} hata payıyla hesaplandı`;
  }
  return s + ".";
}

/** Seçilen karışıma ve plandaki duruma göre öneriler: [durum, başlık, açıklama] (karisim.oneriler). */
export function oneriler(ks, araclar, baglam, maksSonuc) {
  const w = ks.agirliklar, r = ks.sonuc, ayS = ks.ay;
  const ad = Object.fromEntries(araclar.map((i) => [i.key, i.ad]));
  const likitOlmayan = new Set(araclar.filter((i) => !i.likit).map((i) => i.key));
  const out = [];
  const b = baglam || { acil_eksik: 0, acil_hedef: 0, pahali_borclar: [], kapasite: 0, tipik_acik: false };
  if (baglam && b.kapasite <= 0) {
    out.push(["critical", "Önce açığı kapatın", "Düzenli birikim kapasitesi yok. Simülasyon bir hedefi gösterir; yatırım "
      + "ancak kesinti önerileri uygulanıp aylık fazla oluşunca başlamalı."]);
  } else if (baglam && b.tipik_acik) {
    out.push(["critical", "Önce tipik aydaki açığı kapatın", "Ortalamada fazla oluşuyor ama tipik (medyan) bir ayda "
      + "gider geliri aşıyor; plan bunu ilk adım sayıyor. Kesintiler oturana kadar sabit bir aylık tutara bağlanmayın, "
      + "yalnızca fazla oluşan aylarda yatırın ve açık veren aylarda yatırım için borçlanmayın."]);
  }
  if (b.acil_eksik > 0) {
    out.push([b.acil_eksik >= b.acil_hedef * 0.5 ? "critical" : "warning", "Önce acil durum fonu",
      `Acil durum fonunda ${tl(b.acil_eksik)} eksik (hedef ${tl(b.acil_hedef)}). Bu tutar karışıma değil, para piyasası `
      + "fonuna gitmeli; karışıma ancak fon tamamlanınca (ya da birikimin küçük bir kısmıyla) başlayın."]);
  }
  if ((b.pahali_borclar || []).length) {
    out.push(["critical", "Pahalı borç varken riskli yatırım yapmayın", `${b.pahali_borclar.join(", ")}: faizi güvenli `
      + "getiriden yüksek. Bu borcu kapatmak, hiçbir karışımın sağlayamayacağı kesin bir getiridir."]);
  }
  const sin = Object.fromEntries(araclar.map((i) => [i.key, i.sinif || i.key]));
  const topla = (f) => Object.entries(w).reduce((a, [k, v]) => a + (f(sin[k] || k) ? v : 0), 0);
  const kripto = topla((s) => s === "kripto"), hisse = topla((s) => s === "hisse");
  const riskli = kripto + hisse;
  if (kripto > 0.10) {
    out.push(["critical", `Kripto payı yüksek: %${Math.round(kripto * 100)}`, "Toplam birikimin %5–10'unu aşmaması "
      + "önerilir. Bu kısım birkaç ayda yarı yarıya düşebilir; yalnızca tamamen kaybetmeyi göze alabileceğiniz tutarla "
      + "sınırlayın."]);
  } else if (kripto > 0) {
    out.push(["warning", `Kripto payı sınırlı: %${Math.round(kripto * 100)}`, "SPK'nın yetkili kripto varlık hizmet "
      + "sağlayıcıları listesindeki platformları kullanın, kaldıraçlı ve vadeli işlem yapmayın, 'garantili getiri' "
      + "vaatlerine itibar etmeyin."]);
  }
  if (ayS < 12 && riskli > 0) {
    out.push(["critical", "Vade bir yıldan kısa", `Hisse ve kripto payı %${Math.round(riskli * 100)}. Bir yıldan kısa `
      + "sürede ihtiyaç duyulacak para oynak araçlarda tutulmamalı; maksimum ihtiyatlı karışım bu vadede yalnızca likit "
      + "fon önerir."]);
  } else if (ayS < 60 && riskli > 0.4) {
    out.push(["warning", `Vade ${ayS} ay, oynak araç payı %${Math.round(riskli * 100)}`, "Hisse ve kripto ağırlıklı "
      + "karışımlar için 5 yıldan uzun vade önerilir. Paraya daha önce ihtiyaç olabilecekse agresif ve çok riskli "
      + "paylarını azaltın."]);
  }
  const kayip = r.reel_katki > 0 ? 1 - r.reel_p[10] / r.reel_katki : 0;
  if (kayip > 0.15) {
    out.push(["warning", `Kötü senaryoda %${Math.round(kayip * 100)} reel kayıp`, `10 senaryodan birinde, yatırdığınız `
      + `${tl(r.reel_katki)} (bugünkü parayla) ${tl(r.reel_p[10])} olur. Bu kaybı taşıyamayacaksanız ihtiyatlı `
      + "karışımların payını artırın."]);
  }
  if (r.reel_kayip_olasiligi > 0.35) {
    out.push(["warning", `Enflasyonun altında kalma olasılığı %${Math.round(r.reel_kayip_olasiligi * 100)}`,
      "Karışım her üç senaryodan birinden fazlasında enflasyonu yenemiyor."]);
  }
  if (r.en_kotu_dusus_medyan > 0.20) {
    out.push(["warning", `Yolda %${Math.round(r.en_kotu_dusus_medyan * 100)} düşüş beklenmeli`, "Tipik senaryoda bile "
      + "değer bir ara zirvesinden bu kadar düşüyor. Düşüşte satmamak planın parçası olmalı; satmak zorunda "
      + "kalabilecekseniz riski azaltın."]);
  }
  for (const [k, v] of Object.entries(w)) {
    if (k !== "ppf" && v > 0.6) {
      out.push(["warning", `Tek araca yoğunlaşma: %${Math.round(v * 100)} ${ad[k] || k}`, "Tek bir araç TL'nin, "
        + "altının veya borsanın kötü dönemine tamamen açık kalır; payı dağıtın."]);
    } else if (k.startsWith("aday:") && ["hisse", "kripto"].includes(sin[k]) && v > 0.15) {
      out.push(["warning", `Tek varlığa yoğunlaşma: %${Math.round(v * 100)} ${ad[k] || k}`, "Tek bir şirketin ya da "
        + "coinin sonucu, endeks veya fonlardan çok daha oynaktır (şirkete özgü haberler, bilanço, sektör). Tek varlığın "
        + "payının toplam birikimin %5–15'ini aşmaması yaygın bir risk yönetimi ilkesidir."]);
    }
  }
  const il = Object.entries(w).reduce((a, [k, v]) => a + (likitOlmayan.has(k) ? v : 0), 0);
  if (il > 0.4) {
    out.push(["info", `Vadesinden önce bozulması zor araçlar %${Math.round(il * 100)}`, "TÜFE'ye endeksli kısım vadeden "
      + "önce satılırsa fiyat dalgalanabilir; kısa vadeli ihtiyaçları buradan karşılamayın."]);
  }
  if (maksSonuc) {
    const d50 = r.reel_p[50] - maksSonuc.reel_p[50], d10 = r.reel_p[10] - maksSonuc.reel_p[10];
    const yalnizMaks = Object.keys(ks.paylar).length === 1 && ks.paylar.maks;
    if (yalnizMaks) {
      out.push(["good", "Seçiminiz maksimum ihtiyatlı karışım", `Kötü senaryoda reel sonuç ${tl(r.reel_p[10])}, tipik `
        + `${tl(r.reel_p[50])}.`]);
    } else if (d50 > 0 && d10 < 0) {
      out.push(["info", "Daha yüksek beklenti, daha büyük kötü senaryo", `Maksimum ihtiyatlı karışıma göre tipik sonuç `
        + `${tl(d50)} fazla, kötü senaryo ${tl(-d10)} daha kötü. Bu farkı göze alabiliyorsanız seçim tutarlı; `
        + "alamıyorsanız ihtiyatlı payları artırın."]);
    } else if (d50 <= 0 && d10 < 0) {
      out.push(["warning", "Maksimum ihtiyatlı karışım daha iyi görünüyor", `Bu varsayımlarla seçtiğiniz karışım hem tipik `
        + `(${tl(d50)}) hem kötü senaryoda (${tl(d10)}) maksimum ihtiyatlı karışımın gerisinde kalıyor.`]);
    }
  }
  if (riskli <= 0.1 && kayip <= 0.05) {
    out.push(["good", "Karışım ihtiyatlı", `Oynak araç payı %${Math.round(riskli * 100)}; kötü senaryoda reel kayıp en `
      + `fazla %${Math.round(Math.max(kayip, 0) * 100)}.`]);
  }
  out.push(["info", "Disiplin", "Her ay aynı oranlarla alın ve yılda bir kez oranları yeniden dengeleyin. Oranları kısa "
    + "vadeli fiyat hareketine ya da haberlere göre değiştirmeyin."]);
  const sira = { critical: 0, warning: 1, info: 2, good: 3 };
  return out.map((x, i) => [x, i]).sort((a, b) => sira[a[0][0]] - sira[b[0][0]] || a[1] - b[1]).map((x) => x[0]);
}

// ------------------------------------------------------------------------------------------ nakit akışı
/** Projeksiyon aylarında fark × pay (açıkta açığın tamamı), sonra ortalama (nakit.takvim_kur). */
export function takvimKur(projeksiyon, nAy, pay = 1, artsin = true, enflasyonYillik = 0.25) {
  pay = Math.min(Math.max(Number(pay), 0), 1);
  const ana = projeksiyon.map((x) => {
    const f = x.gelir - x.gider;
    return f > 0 ? f * pay : f;
  }).slice(0, nAy);
  const ort = ana.length ? ana.reduce((a, b) => a + b, 0) / ana.length : 0;
  const im = Math.pow(1 + enflasyonYillik, 1 / 12) - 1;
  const uz = [];
  for (let k = 0; k < Math.max(0, nAy - ana.length); k++) uz.push(ort * (artsin ? Math.pow(1 + im, k + 1) : 1));
  return { takvim: ana.concat(uz), uzatma: ort };
}

export function isaretli(islem, tutar) {
  return islem === "satis" ? -Math.abs(Number(tutar)) : Math.abs(Number(tutar));
}

/** Kayıtlı yatırımlarla kasadan çıkan net para (aktarım sayılmaz), basAy'dan bu aya kadar. */
export function kasaCikisi(kayitlar, basAy, simdi) {
  let t = 0;
  for (const k of kayitlar || []) {
    if (k.islem === "aktarim" || k.ay > simdi) continue;
    if (basAy && k.ay < basAy) continue;
    t += isaretli(k.islem, k.tutar);
  }
  return t;
}

export function varlikDegeri(v) {
  return v.birim_fiyat === null || v.birim_fiyat === undefined ? null : Number(v.miktar || 0) * Number(v.birim_fiyat);
}

/** Sepete bağlı varlıkların değeri: {toplam, sepetler, eksik} */
export function portfoyDegeri(varliklar) {
  let toplam = 0;
  const sepetler = {}, eksik = [];
  for (const v of varliklar || []) {
    if (!v.sepet) continue;
    const d = varlikDegeri(v);
    if (d === null) {
      eksik.push(v.ad);
      continue;
    }
    sepetler[v.sepet] = (sepetler[v.sepet] || 0) + d;
    toplam += d;
  }
  return { toplam, sepetler, eksik };
}

/**
 * Telefondaki durumla nakit akışı (nakit.nakit_akisi + Simülasyon sekmesindeki kasa/bırakılan mantığı).
 * s: {ay, pay, artsin, paylar, kasaElle, birakElle} (boş alanlar paketteki masaüstü ayarından)
 */
export function nakitHesapla(paket, durum, s, simdi) {
  const n = paket.nakit || {};
  const enf = (paket.varsayimlar || {}).enflasyon_yillik ?? 0.25;
  const bagla = n.portfoy_bagla !== false;
  const kasaElle = "kasaElle" in s ? s.kasaElle : n.kasa_elle;
  const yatirilan = bagla && (kasaElle === null || kasaElle === undefined) ? kasaCikisi(durum.kayitlar, n.bas_ay, simdi) : 0;
  const kasaFarki = Number(durum.kasaFarki || 0);     // telefonda girilen hareketler ve ödemeler (yaklaşık)
  const kasaOtomatik = Number(n.kasa_taban || 0) + kasaFarki - (bagla ? kasaCikisi(durum.kayitlar, n.bas_ay, simdi) : 0);
  const kasa = kasaElle !== null && kasaElle !== undefined ? Number(kasaElle) : Number(n.kasa_taban || 0) + kasaFarki - yatirilan;
  const birakElle = "birakElle" in s ? s.birakElle : n.birak_elle;
  const acilSepette = (normalize(s.paylar || {}).acil || 0) > 0;
  const birak = Math.max(0, birakElle !== null && birakElle !== undefined ? Number(birakElle)
    : acilSepette ? 0 : Number(n.birak_onerisi || 0));
  const portfoy = bagla ? portfoyDegeri(durum.varliklar).toplam : 0;
  const projeksiyon = (n.projeksiyon || []).filter((x) => x.ay >= simdi);
  const { takvim, uzatma } = takvimKur(projeksiyon, s.ay, s.pay ?? n.pay ?? 1, s.artsin !== false, enf);
  const nP = projeksiyon.length;
  const aylikOrt = nP ? takvim.slice(0, nP).reduce((a, b) => a + b, 0) / nP
    : takvim.length ? takvim.reduce((a, b) => a + b, 0) / takvim.length : 0;
  return { kasa, kasaOtomatik, kasaFarki, yatirilan, birak, portfoy, acilSepette, kasaElle: kasaElle ?? null, projeksiyon, takvim, uzatma,
    aylikOrt, baslangic: Math.max(0, kasa - birak) + portfoy, ilkAy: projeksiyon.length ? projeksiyon[0].ay : "" };
}

// ------------------------------------------------------------------------------------------ ay ay birikim tablosu
export function aylikKatkilar(res) {
  const n = res.aylar;
  if (res.katki_takvimi) {
    const t = res.katki_takvimi.slice(0, n);
    while (t.length < n) t.push(0);
    return t;
  }
  const out = [];
  let once = res.baslangic;
  for (const x of res.katki_yol) {
    out.push(x - once);
    once = x;
  }
  return out;
}

/** Ay ay: yatırılacak, toplam yatırılan, bu ayın tahmini getirisi, tipik/kötü/iyi değer (takip.aylik_birikim). */
export function aylikBirikim(res, ilkAy, paylar) {
  const c = aylikKatkilar(res);
  const p10 = res.yol_p[10], p50 = res.yol_p[50], p90 = res.yol_p[90];
  const sepetler = paylar && Object.keys(paylar).length > 1 ? Object.keys(paylar).filter((k) => paylar[k] > 0) : [];
  const rows = [];
  let toplam = res.baslangic, onceki = res.baslangic;
  for (let t = 0; t < res.aylar; t++) {
    const taban = onceki + c[t];
    const eksik = Math.max(0, -taban);
    toplam += c[t] + eksik;
    const sepet = {};
    for (const s of sepetler) sepet[s] = c[t] * paylar[s];
    rows.push({ ay: ayEkle(ilkAy, t), yatirilacak: c[t], toplam, getiri: p50[t] - Math.max(taban, 0), p50: p50[t],
      kazanc: p50[t] - toplam, p10: p10[t], p90: p90[t], eksik, sepet });
    onceki = p50[t];
  }
  return rows;
}

// ------------------------------------------------------------------------------------------ takip ve plan
export function aylikYatirim(kayitlar, aktarim = false) {
  const out = {};
  for (const k of kayitlar || []) {
    if (!aktarim && k.islem === "aktarim") continue;
    out[k.ay] = (out[k.ay] || 0) + isaretli(k.islem, k.tutar);
  }
  return out;
}

export function planOzeti(res, ilkAy, paylar, bugun) {
  const r2 = (x) => Math.round(x * 100) / 100;
  return { kayit: bugun, ilk_ay: ilkAy, aylar: res.aylar, baslangic: res.baslangic,
    katki: aylikKatkilar(res).map(r2), paylar: { ...paylar },
    yillik_p50: res.yillik_nominal_p ? res.yillik_nominal_p[50] : null,
    p10: res.yol_p[10].map(r2), p50: res.yol_p[50].map(r2), p90: res.yol_p[90].map(r2) };
}

export function plandakiTutar(plan, m, sepet) {
  if (!plan || !plan.katki) return null;
  const t = ayFarki(m, plan.ilk_ay);
  if (t < 0 || t >= plan.katki.length) return null;
  return Number(plan.katki[t]) * Number((plan.paylar || {})[sepet] || 0);
}

export function planKarsilastirma(plan, kayitlar, degerler, simdi) {
  if (!plan || !plan.p50) return [];
  const akis = aylikYatirim(kayitlar);
  const rows = [];
  let farkTop = 0;
  const n = Math.min(plan.p50.length, ayFarki(simdi, plan.ilk_ay) + 1);
  for (let t = 0; t < n; t++) {
    const m = ayEkle(plan.ilk_ay, t);
    const pl = t < plan.katki.length ? Number(plan.katki[t]) : 0;
    const ger = akis[m] || 0;
    farkTop += ger - pl;
    const p10 = plan.p10[t] + farkTop, p50 = plan.p50[t] + farkTop, p90 = plan.p90[t] + farkTop;
    const v = (degerler || {})[m] || {};
    const gd = v.toplam !== undefined && v.toplam !== null ? Number(v.toplam) : NaN;
    let durum;
    if (Number.isNaN(gd)) durum = m < simdi ? "değer kaydı yok" : "ay sürüyor";
    else if (gd < p10) durum = "kötü senaryonun altında";
    else if (gd > p90) durum = "iyi senaryonun üstünde";
    else if (gd >= p50) durum = "tipiğin üstünde";
    else durum = "tipiğin altında (aralıkta)";
    if (m === simdi && !Number.isNaN(gd)) durum += " · ay sürüyor";
    rows.push({ ay: m, planlanan: pl, gercek: ger, fark: ger - pl, p10, p50, p90, deger: gd, durum });
  }
  return rows;
}

export function sepetAdi(k, paket) {
  const h = (paket.karisimlar || []).find((x) => x.key === k);
  return h ? h.ad : (k || "Sepetsiz");
}

export function planMetni(plan, simdi, paket) {
  if (!plan) {
    return "Kayıtlı plan yok. Simülasyon ekranında simüle edip 'Planı takip için kaydet' deyin; her ay planlanan ve "
      + "gerçekleşen burada karşılaştırılır.";
  }
  const son = ayEkle(plan.ilk_ay, Number(plan.aylar || (plan.p50 || []).length) - 1);
  const paylar = Object.entries(plan.paylar || {}).map(([k, v]) => `%${Math.round(v * 100)} `
    + sepetAdi(k, paket).toLocaleLowerCase("tr")).join(", ");
  const [y, m, g] = String(plan.kayit || "").slice(0, 10).split("-");
  let s = `Kayıtlı plan (${g}.${m}.${y}): ${ay(plan.ilk_ay)} – ${ay(son)}, başlangıç ${tl(plan.baslangic || 0)}`
    + (paylar ? `; dağılım ${paylar}` : "") + ".";
  if (plan.ilk_ay > simdi) {
    s += ` Plan ${ay(plan.ilk_ay)} ayında başlıyor; karşılaştırma o aydan itibaren görünür. Bu ayın yatırımları planın `
      + "başlangıç tutarındadır.";
  }
  return s;
}

export function gerceklesenGetiri(degerler, kayitlar) {
  const d = {};
  for (const [m, v] of Object.entries(degerler || {})) if (v) d[m] = Number(v.toplam || 0);
  const akis = aylikYatirim(kayitlar, true);
  const out = [];
  for (const m of Object.keys(d).sort()) {
    const onceki = ayEkle(m, -1);
    if (!(onceki in d)) continue;
    const c = akis[m] || 0;
    const payda = d[onceki] + c / 2;
    if (payda <= 0) continue;
    out.push({ ay: m, getiri: (d[m] - d[onceki] - c) / payda, yatirim: c, deger: d[m] });
  }
  return out;
}

export function yillikGetiri(aylik) {
  if (!aylik.length) return NaN;
  const t = aylik.reduce((a, x) => a * (1 + x.getiri), 1);
  return t > 0 ? Math.pow(t, 12 / aylik.length) - 1 : NaN;
}

export function gerceklesenMetni(degerler, kayitlar, planYillik) {
  const g = gerceklesenGetiri(degerler, kayitlar);
  if (!g.length) {
    return "Gerçekleşen getiri için en az iki ardışık ayın portföy değeri gerekir: masaüstünde her ay fiyatları "
      + "güncelleyin ya da burada 'Ay sonu değeri yaz' deyin.";
  }
  let s = `Gerçekleşen: son ${g.length} ayda aylık ortalama ${yuzde(g.reduce((a, x) => a + x.getiri, 0) / g.length, 1)}`;
  const y = yillikGetiri(g);
  if (!Number.isNaN(y)) s += `, yıllık karşılığı ${yuzde(y, 1)}`;
  if (planYillik !== null && planYillik !== undefined && !Number.isNaN(planYillik)) {
    s += ` (planın tipik beklentisi yıllık ${yuzde(planYillik, 1)})`;
  }
  return s + ". Birkaç aylık getiri tesadüfe açıktır; varsayımları değiştirmek için uzun dönem gerekir.";
}

/** Her sepet: plan payı, yatırılan (net), bugünkü değer, getiri. */
export function sepetOzeti(kayitlar, varliklar, paylar) {
  const { sepetler: degerler } = portfoyDegeri(varliklar);
  const yatirilan = {};
  for (const k of kayitlar || []) yatirilan[k.sepet || ""] = (yatirilan[k.sepet || ""] || 0) + isaretli(k.islem, k.tutar);
  const sira = [...new Set([...Object.keys(paylar || {}), ...Object.keys(yatirilan), ...Object.keys(degerler)])];
  return sira.map((s) => {
    const y = yatirilan[s] || 0;
    const d = s in degerler ? degerler[s] : NaN;
    const getiri = !Number.isNaN(d) && (y || d) ? d - y : NaN;
    return { sepet: s, pay: (paylar || {})[s] ?? NaN, yatirilan: y, deger: d, getiri,
      oran: y > 0 && !Number.isNaN(getiri) ? getiri / y : NaN };
  });
}

/** Kaydın bağlı varlığın miktarına etkisi (takip.varliga_eklenecek). */
export function varligaEklenecek(kayit, varlik) {
  if (!varlik || kayit.islem === "aktarim") return 0;
  let m = Number(kayit.miktar || 0);
  if (m <= 0 && ["tl", "try"].includes(String(varlik.birim || "TL").trim().toLocaleLowerCase("tr"))) {
    m = Number(kayit.tutar || 0);
  }
  return kayit.islem === "satis" ? -m : m;
}

// ------------------------------------------------------------------------------------------ telefon durumu
/**
 * Paket + telefonda bekleyen işlemler -> telefonun gördüğü durum. İşlemler masaüstündeki takip.kayit_ekle /
 * kayit_guncelle / kayit_sil ile aynı kurallarla uygulanır; masaüstü dosyayı yükleyince aynı sonuca ulaşır.
 * fiyatElle: {varlik_id: birim fiyatı} (yalnızca telefonda)
 */
export function durumKur(paket, islemler, fiyatElle = {}, simdi = null, bugun = null) {
  const varliklar = (paket.varliklar || []).map((v) => ({ ...v }));
  const kayitlar = (paket.kayitlar || []).map((k) => ({ ...k, telefonda: false }));
  const hareketler = (paket.hareketler || []).map((h) => ({ ...h }));
  const degerler = JSON.parse(JSON.stringify(paket.portfoy_degerleri || {}));
  let plan = paket.plan || null;
  const uyarilar = [];
  const vBul = (id) => varliklar.find((v) => String(v.id) === String(id));
  const kBul = (id) => kayitlar.findIndex((k) => String(k.id) === String(id));
  const uygula = (vid, delta, sepet) => {
    const v = vBul(vid);
    if (!v) return;
    if (delta) v.miktar = Math.max(0, Number(v.miktar || 0) + delta);
    if (sepet && !v.sepet) v.sepet = sepet;
  };
  for (const op of islemler || []) {
    if (op.op === "varlik_ekle") {
      varliklar.push({ ...op.varlik, id: op.mobil_id, miktar: Number(op.varlik.miktar || 0), telefonda: true,
        birim_fiyat: op.varlik.birim_fiyat ?? (["tl", "try"].includes(String(op.varlik.birim || "TL").toLowerCase()) ? 1 : null) });
    } else if (op.op === "kayit_ekle") {
      const k = { ...op.kayit, id: op.mobil_id, telefonda: true };
      if (k.varlik_id !== null && k.varlik_id !== undefined && !vBul(k.varlik_id)) k.varlik_id = null;
      const delta = op.varliga_ekle !== false ? varligaEklenecek(k, vBul(k.varlik_id)) : 0;
      uygula(k.varlik_id, delta, k.sepet);
      k.varliga_eklenen = delta;
      kayitlar.push(k);
    } else if (op.op === "kayit_guncelle") {
      const i = kBul(op.hedef);
      if (i < 0) {
        uyarilar.push("Telefonda düzenlenen bir kayıt masaüstü verisinde artık yok; düzenleme atlanacak.");
        continue;
      }
      const e = kayitlar[i];
      uygula(e.varlik_id, -Number(e.varliga_eklenen || 0));
      const k = { ...op.kayit, id: e.id, telefonda: e.telefonda, duzenlendi: true };
      if (k.varlik_id !== null && k.varlik_id !== undefined && !vBul(k.varlik_id)) k.varlik_id = null;
      const delta = op.varliga_ekle !== false ? varligaEklenecek(k, vBul(k.varlik_id)) : 0;
      uygula(k.varlik_id, delta, k.sepet);
      k.varliga_eklenen = delta;
      kayitlar[i] = k;
    } else if (op.op === "kayit_sil") {
      const i = kBul(op.hedef);
      if (i < 0) continue;
      if (op.geri_al !== false) uygula(kayitlar[i].varlik_id, -Number(kayitlar[i].varliga_eklenen || 0));
      kayitlar.splice(i, 1);
    } else if (op.op === "ay_sonu") {
      if (op.toplam === null || op.toplam === undefined) delete degerler[op.ay];
      else degerler[op.ay] = { tarih: op.tarih, toplam: Number(op.toplam), sepetler: {}, elle: true };
    } else if (op.op === "plan") {
      plan = op.plan;
    } else if (op.op === "hareket_ekle") {
      hareketler.push({ ...hareketDuzelt(op.hareket), id: op.mobil_id, kaynak: op.hareket.tur === "kart_detay" ? "telefon" : "elle",
        telefonda: true, odeme: op.odeme || null });
    } else if (op.op === "hareket_guncelle") {
      const i = hareketler.findIndex((h) => String(h.id) === String(op.hedef));
      if (i < 0) {
        uyarilar.push("Telefonda düzenlenen bir hareket masaüstü verisinde artık yok; düzenleme atlanacak.");
        continue;
      }
      hareketler[i] = { ...hareketler[i], ...hareketDuzelt(op.hareket), id: hareketler[i].id, duzenlendi: true };
    } else if (op.op === "hareket_sil") {
      const i = hareketler.findIndex((h) => String(h.id) === String(op.hedef));
      if (i >= 0) hareketler.splice(i, 1);
    } else if (op.op === "ekstre") {
      // masaüstündeki replace_source gibi: aynı kaynağın eski satırları (ve eski adlandırmayla aynı dosyanın bu tarih
      // aralığındaki satırları) silinir, yenileri eklenir
      const ts = (op.hareketler || []).map((h) => h.tarih).sort();
      const eski = op.dosya ? `${String(op.kaynak).split(":")[0]}:${op.dosya}` : null;
      for (let i = hareketler.length - 1; i >= 0; i--) {
        const h = hareketler[i];
        if (h.kaynak === op.kaynak || (eski && h.kaynak === eski && ts.length && h.tarih >= ts[0] && h.tarih <= ts[ts.length - 1])) hareketler.splice(i, 1);
      }
      for (const h of op.hareketler || []) hareketler.push({ ...hareketDuzelt(h), id: h.hid, kaynak: op.kaynak, telefonda: true, ekstre: op.id });
    }
  }
  for (const v of varliklar) {
    if (fiyatElle[v.id] !== undefined && fiyatElle[v.id] !== null && fiyatElle[v.id] !== "") {
      v.birim_fiyat_masaustu = v.birim_fiyat;
      v.birim_fiyat = Number(fiyatElle[v.id]);
      v.fiyat_elle = true;
    }
    v.deger = varlikDegeri(v);
  }
  // Bu ayın portföy değeri telefondaki varlıklarla güncellenir (masaüstündeki anlık kayıt gibi); elle yazılan ezilmez.
  if (simdi && !(degerler[simdi] || {}).elle) {
    const pf = portfoyDegeri(varliklar);
    if (Object.keys(pf.sepetler).length || pf.eksik.length) {
      const yuvarla = (x) => Math.round(x * 100) / 100;
      degerler[simdi] = { tarih: bugun || bugunIso(), toplam: yuvarla(pf.toplam),
        sepetler: Object.fromEntries(Object.entries(pf.sepetler).map(([k, x]) => [k, yuvarla(x)])), eksik: pf.eksik,
        telefonda: true };
    }
  }
  kayitlar.sort((a, b) => (b.ay + b.tarih).localeCompare(a.ay + a.tarih));
  // hareketler: elle girilen gelir aynı ay ve akıştaki diğer geliri geçersiz kılar (masaüstündeki kural)
  const once = (paket.hareketler || []).map((h) => ({ ...h }));
  elleGelirUstun(once);
  elleGelirUstun(hareketler);
  hareketler.sort((a, b) => String(b.tarih).localeCompare(String(a.tarih)) || String(b.id).localeCompare(String(a.id)));
  const ay0 = simdi || buAy();
  const odemeler = odemeDurumu(paket.odemeler || [], hareketler, ay0);
  const n = paket.nakit || {};
  const odenmemisMasaustu = (paket.odemeler || []).length ? (paket.odemeler || []).reduce((t, o) => t + Number(o.kalan || 0), 0)
    : Number(n.odenmemis || 0);
  const odenmemis = (paket.odemeler || []).length ? odemeler.reduce((t, o) => t + o.kalan, 0) : Number(n.odenmemis || 0);
  const kasaFarki = kasaToplami(hareketler, n.bas_ay, ay0) - kasaToplami(once, n.bas_ay, ay0) + (odenmemisMasaustu - odenmemis);
  const aylar = ayOzetiFarkli(paket.aylar || [], once, hareketler);
  return { varliklar, kayitlar, degerler, plan, uyarilar, hareketler, odemeler, odenmemis, kasaFarki, aylar,
    hareketDegisti: islemler.some((o) => String(o.op).startsWith("hareket_") || o.op === "ekstre") };
}

// ------------------------------------------------------------------------------------------ hareketler
export const SAYILAN_TURLER = ["gelir", "gider"];

function hareketDuzelt(h) {
  const tarih = String(h.tarih || "").slice(0, 10);
  return { tarih, ay: tarih.slice(0, 7), tur: h.tur, kategori: h.kategori || (h.tur === "gelir" ? "Diğer gelir" : "Diğer gider"),
    kalem: String(h.kalem || "").trim(), tutar: Math.abs(Number(h.tutar) || 0), plan: !!h.plan, not: h.not || "" };
}

/** Masaüstündeki db.gelir_akisi ile aynı. */
export function gelirAkisi(kategori, kalem) {
  const akis = (x) => {
    const t = String(x || "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (t.includes("danisman")) return "danismanlik";
    if (t.includes("maas") || t.includes("ucret") || t.includes("salary")) return "maas";
    if (t.includes("kira")) return "kira";
    if (t.includes("prim") || t.includes("ikramiye")) return "prim";
    return null;
  };
  return akis(kalem) || akis(kategori);
}

/** db._elle_gelir_ustun: elle girilen gelir, aynı ay ve akıştaki diğer kaynaklı gelirin yerine geçer (yerine=true). */
export function elleGelirUstun(liste) {
  const gruplar = new Map();
  for (const h of liste) {
    h.yerine = false;
    if (h.tur !== "gelir" || h.kaynak === "projeksiyon") continue;
    const a = gelirAkisi(h.kategori, h.kalem);
    if (!a) continue;
    const k = `${h.ay}|${a}`;
    if (!gruplar.has(k)) gruplar.set(k, []);
    gruplar.get(k).push(h);
  }
  for (const g of gruplar.values()) {
    const elle = g.filter((h) => h.kaynak === "elle");
    if (!elle.length) continue;
    for (const h of g) if (h.kaynak !== "elle") h.yerine = true;
  }
  return liste;
}

/** Kasadaki paraya giren gerçekleşen gelir − gider (başlangıç ayından bu aya; plan ve kart harcaması sayılmaz). */
export function kasaToplami(liste, basAy, simdi) {
  let t = 0;
  for (const h of liste) {
    if (h.plan || h.yerine || h.ay > simdi || (basAy && h.ay < basAy)) continue;
    if (h.tur === "gelir") t += Number(h.tutar);
    else if (h.tur === "gider") t -= Number(h.tutar);
  }
  return t;
}

function ayToplamlari(liste) {
  const o = {};
  for (const h of liste) {
    if (h.yerine || !SAYILAN_TURLER.includes(h.tur)) continue;
    const x = (o[h.ay] = o[h.ay] || { gelir: 0, gider: 0 });
    x[h.tur] += Number(h.tutar);
  }
  return o;
}

/** Masaüstünden gelen aylık gelir-gider özetine telefondaki değişikliklerin farkı eklenir. */
export function ayOzetiFarkli(aylar, once, sonra) {
  const a = ayToplamlari(once), b = ayToplamlari(sonra);
  const out = aylar.map((x) => ({ ...x }));
  for (const m of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const dg = (b[m]?.gelir || 0) - (a[m]?.gelir || 0), dc = (b[m]?.gider || 0) - (a[m]?.gider || 0);
    if (Math.abs(dg) < 0.005 && Math.abs(dc) < 0.005) continue;
    let x = out.find((y) => y.ay === m);
    if (!x) {
      x = { ay: m, gelir: 0, gider: 0, net: 0, plan: false };
      out.push(x);
    }
    x.gelir += dg;
    x.gider += dc;
    x.net = x.gelir - x.gider;
    x.telefonda = true;
  }
  return out.sort((x, y) => x.ay.localeCompare(y.ay));
}

function adSade(x) {
  return String(x || "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Bu ayın planlı ödemeleri ve telefonda girilen karşılıkları. Masaüstü ödenen tutarı kendi eşleştirmesiyle gönderir;
 * telefonda eklenen gerçekleşen giderler şu sırayla eşleştirilir: 'Ödendi' düğmesiyle girilen (ödeme anahtarı),
 * aynı ya da birbirini içeren ad, aynı kategoride ±%3 tutar (borc_projeksiyon.bu_ay_odemeleri'ne benzer, yaklaşık).
 */
export function odemeDurumu(odemeler, hareketler, simdi) {
  const out = odemeler.map((o) => ({ ...o, telefonda: 0, eslesen: [] }));
  const yeni = hareketler.filter((h) => h.telefonda && h.tur === "gider" && !h.plan && h.ay === simdi);
  const kullanildi = new Set();
  const ekle = (o, h) => {
    kullanildi.add(h);
    o.telefonda += Number(h.tutar);
    o.eslesen.push(h);
  };
  for (const h of yeni) {
    if (!h.odeme) continue;
    const o = out.find((x) => x.anahtar === h.odeme);
    if (o) ekle(o, h);
  }
  const odendiMi = (o) => (o.elle ? o.elle === "odendi" : Number(o.odenen) + o.telefonda >= Number(o.planlanan) * 0.95 - 0.5);
  for (const o of out) {
    const a = adSade(o.kalem);
    for (const h of yeni) {
      if (odendiMi(o) || kullanildi.has(h) || h.odeme) continue;
      const b = adSade(h.kalem);
      if (a && b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b)))) ekle(o, h);
    }
  }
  for (const o of out) {
    if (o.eslesen.length || odendiMi(o)) continue;
    const kalan = Number(o.planlanan) - Number(o.odenen);
    const aday = yeni.filter((h) => !kullanildi.has(h) && !h.odeme && h.kategori === o.kategori
      && Math.abs(Number(h.tutar) - kalan) <= 0.03 * Number(o.planlanan));
    if (aday.length) ekle(o, aday.sort((x, y) => Math.abs(x.tutar - kalan) - Math.abs(y.tutar - kalan))[0]);
  }
  for (const o of out) {
    const odenen = Number(o.odenen) + o.telefonda;
    o.odendi = odendiMi(o);
    o.kalan = o.odendi ? 0 : Math.max(0, Number(o.planlanan) - odenen);
    o.durumTel = o.elle === "odendi" ? "ödendi (işaretli)" : o.odendi ? "ödendi" : odenen > 0 ? "kısmen ödendi" : "ödenmedi";
  }
  return out;
}

/** Yeni paket yüklenince: masaüstüne işlenmiş işlemler düşer, kalanlar bekler. */
export function bekleyenler(islemler, paket) {
  const u = new Set(paket.uygulanan || []);
  return (islemler || []).filter((op) => !u.has(op.id));
}

/** Bekleyen işlemlere yeni bir işlem ekler; telefonda oluşturulmuş kaydın düzenlemesi/silinmesi o işlemi değiştirir. */
export function islemEkle(islemler, op) {
  const out = [...islemler];
  if ((op.op === "kayit_guncelle" || op.op === "kayit_sil") && String(op.hedef).startsWith("m:")) {
    const i = out.findIndex((x) => x.op === "kayit_ekle" && x.mobil_id === op.hedef);
    if (i >= 0) {   // sona taşınır: düzenlemede eklenen yeni varlık işleminden sonra gelsin
      const eski = out.splice(i, 1)[0];
      if (op.op !== "kayit_sil") out.push({ ...eski, kayit: op.kayit, varliga_ekle: op.varliga_ekle });
      return out;
    }
  }
  if (op.op === "kayit_guncelle") {
    const i = out.findIndex((x) => x.op === "kayit_guncelle" && String(x.hedef) === String(op.hedef));
    if (i >= 0) {
      const eski = out.splice(i, 1)[0];
      out.push({ ...op, id: eski.id });
      return out;
    }
  }
  if (op.op === "kayit_sil") {   // aynı kaydın bekleyen düzenlemesi gereksiz
    const kalan = out.filter((x) => !(x.op === "kayit_guncelle" && String(x.hedef) === String(op.hedef)));
    kalan.push(op);
    return kalan;
  }
  if (op.op === "ay_sonu") {
    const kalan = out.filter((x) => !(x.op === "ay_sonu" && x.ay === op.ay));
    kalan.push(op);
    return kalan;
  }
  if (op.op === "plan") {
    const kalan = out.filter((x) => x.op !== "plan");
    kalan.push(op);
    return kalan;
  }
  if (op.op === "hareket_guncelle" || op.op === "hareket_sil") {
    const hedef = String(op.hedef);
    if (hedef.startsWith("m:")) {      // telefonda eklenmiş hareket: ekleme işlemi değişir
      const i = out.findIndex((x) => x.op === "hareket_ekle" && x.mobil_id === hedef);
      if (i >= 0) {
        if (op.op === "hareket_sil") out.splice(i, 1);
        else out[i] = { ...out[i], hareket: op.hareket };
        return out;
      }
    }
    if (hedef.startsWith("e:")) {      // telefonda okunan dökümün bir satırı: döküm işlemi değişir
      const i = out.findIndex((x) => x.op === "ekstre" && (x.hareketler || []).some((h) => h.hid === hedef));
      if (i >= 0) {
        const e = { ...out[i], hareketler: out[i].hareketler.map((h) => (h.hid === hedef && op.op === "hareket_guncelle"
          ? { ...op.hareket, hid: hedef } : h)).filter((h) => op.op !== "hareket_sil" || h.hid !== hedef) };
        if (e.hareketler.length) out[i] = e;
        else out.splice(i, 1);
        return out;
      }
    }
    const kalan = out.filter((x) => !(x.op === "hareket_guncelle" && String(x.hedef) === hedef));
    const eski = out.find((x) => x.op === "hareket_guncelle" && String(x.hedef) === hedef);
    kalan.push(op.op === "hareket_guncelle" && eski ? { ...op, id: eski.id } : op);
    return kalan;
  }
  if (op.op === "ekstre") {      // aynı döküm yeniden okunursa öncekinin yerine geçer
    const kalan = out.filter((x) => !(x.op === "ekstre" && x.kaynak === op.kaynak));
    kalan.push(op);
    return kalan;
  }
  out.push(op);
  return out;
}

export function kimlik() {
  const b = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues ? globalThis.crypto.getRandomValues(b)
    : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------------------------------ şifreleme (Web Crypto)
export const TUR_PAKET = "butce-planlayici-telefon";
export const TUR_DEGISIKLIK = "butce-planlayici-telefon-degisiklikleri";
export const TUR_SIFRELI = "butce-planlayici-sifreli";
const PBKDF2_TUR = 310000;

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64coz(s) {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function anahtar(parola, tuz, tur) {
  const c = globalThis.crypto.subtle;
  const ham = await c.importKey("raw", new TextEncoder().encode(parola), "PBKDF2", false, ["deriveKey"]);
  return c.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: tuz, iterations: tur }, ham,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sifrele(metin, parola) {
  const tuz = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const k = await anahtar(parola, tuz, PBKDF2_TUR);
  const veri = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, k,
    new TextEncoder().encode(metin)));
  return { tur: TUR_SIFRELI, bicim: 1, kdf: "PBKDF2-SHA256", tur_sayisi: PBKDF2_TUR, sifre: "AES-256-GCM",
    tuz: b64(tuz), iv: b64(iv), veri: b64(veri) };
}

export async function coz(zarf, parola) {
  const k = await anahtar(parola, b64coz(zarf.tuz), Number(zarf.tur_sayisi || PBKDF2_TUR));
  try {
    const d = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(zarf.iv) }, k, b64coz(zarf.veri));
    return new TextDecoder().decode(d);
  } catch {
    throw new Error("Parola yanlış ya da dosya bozulmuş.");
  }
}

/** Dosya metnini çözümler: {sifreli: true} ya da {veri}. */
export function dosyaCozumle(metin) {
  let d;
  try {
    d = JSON.parse(metin.replace(/^﻿/, ""));
  } catch {
    throw new Error("Dosya okunamadı: Bütçe Planlayıcı telefon dosyası değil.");
  }
  if (d && d.tur === TUR_SIFRELI) return { sifreli: true, zarf: d };
  if (!d || (d.tur !== TUR_PAKET && d.tur !== TUR_DEGISIKLIK)) {
    throw new Error("Bu dosya Bütçe Planlayıcı telefon dosyası değil.");
  }
  if (Number(d.bicim || 0) > 1) throw new Error("Dosya programın daha yeni bir sürümüyle oluşturulmuş; telefon uygulamasını yenileyin.");
  return { sifreli: false, veri: d };
}

/** Hedefler: portföyün hedef tarihindeki değeri, o tarihe kadarki hedeflerin kalan toplamını karşılıyor mu. */
export function hedefOlasiliklari(res, ilkAy, hedefler) {
  const h = (hedefler || []).map((x) => ({ ...x, hay: String(x.hedef_tarih || "").slice(0, 7) }))
    .filter((x) => /^\d{4}-\d{2}$/.test(x.hay)).sort((a, b) => a.hay.localeCompare(b.hay));
  let birikmis = 0;
  const out = [];
  for (const r of h) {
    birikmis += Math.max(0, Number(r.hedef_tutar || 0) - Number(r.mevcut || 0));
    const k = ayFarki(r.hay, ilkAy) + 1;
    if (k < 1) continue;
    if (k > res.aylar) {
      out.push({ ad: r.ad, ay: r.hay, tutar: birikmis, disarida: true });
      continue;
    }
    out.push({ ad: r.ad, ay: r.hay, tutar: birikmis, olasilik: hedefOlasiligi(res, birikmis, k, false) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ örnek veriler
/** Örnek paketin tarihlerini içinde bulunulan aya kaydırır (örnek hangi ay açılırsa açılsın güncel görünsün). */
export function ornegiKaydir(paket, hedefAy) {
  const p = JSON.parse(JSON.stringify(paket));
  const n = ayFarki(hedefAy, p.bu_ay);
  if (!n) return p;
  const ay = (x) => (typeof x === "string" && /^\d{4}-\d{2}/.test(x) ? ayEkle(x.slice(0, 7), n) + x.slice(7) : x);
  const gun = (x) => {
    const s = ay(x);
    return typeof s === "string" && /^\d{4}-\d{2}-(29|30|31)/.test(s) ? s.slice(0, 8) + "28" + s.slice(10) : s;
  };
  p.bu_ay = ay(p.bu_ay);
  p.bugun = gun(p.bugun);
  p.olusturma = gun(p.olusturma);
  if (p.nakit) {
    p.nakit.bas_ay = ay(p.nakit.bas_ay);
    for (const x of p.nakit.projeksiyon || []) x.ay = ay(x.ay);
    if (p.nakit.masaustu) p.nakit.masaustu.ilk_ay = ay(p.nakit.masaustu.ilk_ay);
  }
  if (p.ayar?.hedef?.ay) p.ayar.hedef.ay = ay(p.ayar.hedef.ay);
  for (const k of p.kayitlar || []) {
    k.ay = ay(k.ay);
    k.tarih = gun(k.tarih);
  }
  for (const h of p.hedefler || []) h.hedef_tarih = gun(h.hedef_tarih);
  for (const h of p.hareketler || []) {
    h.tarih = gun(h.tarih);
    h.ay = ay(h.ay);
    if (typeof h.kaynak === "string") h.kaynak = h.kaynak.replace(/(\d{2})\.(\d{2})\.(\d{4})/g, (m, g, a, y) => {
      const t = ay(`${y}-${a}`);
      return `${g}.${t.slice(5, 7)}.${t.slice(0, 4)}`;
    });
  }
  for (const o of p.odemeler || []) {
    o.tarih = gun(o.tarih);
    o.anahtar = String(o.anahtar || "").replace(/^\d{4}-\d{2}/, (m) => ay(m));
  }
  for (const x of p.aylar || []) x.ay = ay(x.ay);
  if (p.plan) {
    p.plan.ilk_ay = ay(p.plan.ilk_ay);
    p.plan.kayit = gun(p.plan.kayit);
  }
  p.portfoy_degerleri = Object.fromEntries(Object.entries(p.portfoy_degerleri || {})
    .map(([m, v]) => [ay(m), { ...v, tarih: gun(v.tarih) }]));
  return p;
}
