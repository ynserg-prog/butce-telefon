// Bütçe Planlayıcı telefon uygulaması: ekranlar ve olaylar.
import * as H from "./hesap.js";
import { netCubuk, yelpaze } from "./grafik.js";
import * as depo from "./depo.js";

export const SURUM = "0.10.0";
const UYARI = "Bu uygulamadaki simülasyonlar ve öneriler yatırım tavsiyesi değildir; varsayımlara dayalı hesaplamalardır. "
  + "Kararlarınızı kendi araştırmanıza ve gerekirse lisanslı bir danışmana dayandırın.";
const SEPET_TURU = { altin: ["altin", "gr"], acil: ["fon", "TL"], konservatif: ["mevduat", "TL"], piyasa: ["hisse", "TL"],
  klasik: ["fon", "TL"], maks: ["fon", "TL"], agresif: ["hisse", "TL"], cok_riskli: ["hisse", "TL"] };
const AYARLAR = { altin: { "24 ayar (gram, külçe)": 1, "22 ayar (bilezik, hatıra para)": 0.916, "21 ayar": 0.875,
  "18 ayar": 0.75, "14 ayar": 0.585 }, gumus: { "999 (külçe)": 1, "925 (takı)": 0.925 } };
const SENARYOLAR = [1000, 2000, 5000, 10000, 20000, 50000];
const EKRANLAR = { ozet: "Özet", sim: "Simülasyon", yatirim: "Yatırımlar", varlik: "Varlıklar", veri: "Veri" };

const S = { paket: null, islemler: [], ayar: {}, fiyatElle: {}, ornek: false, sonGonderim: null, ekran: "ozet",
  sonuc: null, karsilastirma: null, calisiyor: false, ilerleme: 0 };
let D = null;
let kurulumIstemi = null;
const sonrasi = [];

// ------------------------------------------------------------------------------------------ yardımcılar
const $ = (s, k = document) => k.querySelector(s);
function esc(x) {
  return String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const simdi = () => H.buAy();

export function sayiOku(x) {
  let s = String(x ?? "").trim().replace(/\s|TL|₺/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

function toast(metin, sure = 4000) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = metin;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), sure);
}

function hazirAd() {
  return Object.fromEntries((S.paket?.karisimlar || []).map((h) => [h.key, h.ad]));
}
function sepetKisa(k) {
  return (S.paket?.sepet_kisa || {})[k] || hazirAd()[k] || k || "Sepetsiz";
}
function sepetAdi(k) {
  return hazirAd()[k] || k || "Sepetsiz";
}
function tarihTr(iso) {
  if (!iso) return "";
  const [t, z] = String(iso).split("T");
  const [y, m, g] = t.split("-");
  return `${g}.${m}.${y}` + (z ? " " + z.slice(0, 5) : "");
}

async function kaydet() {
  await depo.yaz("durum", { paket: S.paket, islemler: S.islemler, ayar: S.ayar, fiyatElle: S.fiyatElle, ornek: S.ornek,
    sonGonderim: S.sonGonderim });
}

function turet() {
  D = S.paket ? H.durumKur(S.paket, S.islemler, S.fiyatElle, simdi()) : null;
}

function degisti() {
  turet();
  kaydet();
  ciz();
}

// ------------------------------------------------------------------------------------------ simülasyon ayarları
function simAyar() {
  const a = S.paket.ayar || {}, n = S.paket.nakit || {}, o = S.ayar;
  const projVar = (n.projeksiyon || []).some((x) => x.ay >= simdi());
  let kaynak = o.kaynak ?? (n.kaynak === "projeksiyon" ? "projeksiyon" : "sabit");
  if (kaynak === "projeksiyon" && !projVar) kaynak = "sabit";
  const sa = { kaynak, projVar, ay: o.ay ?? a.ay ?? 36, pay: o.pay ?? n.pay ?? 1, artsin: o.artsin ?? a.artsin ?? true,
    aylik: o.aylik ?? a.aylik ?? 0, baslangic: o.baslangic ?? a.baslangic ?? 0, paylar: o.paylar ?? a.paylar ?? { maks: 1 },
    senaryo: o.senaryo ?? Math.min(a.senaryo || 10000, 20000), model: o.model ?? a.model ?? "guclu",
    hedef: o.hedef ?? a.hedef ?? {} };
  if ("kasaElle" in o) sa.kasaElle = o.kasaElle;
  if ("birakElle" in o) sa.birakElle = o.birakElle;
  return sa;
}

function nakit(sa) {
  return H.nakitHesapla(S.paket, D, sa, simdi());
}

function baglam(sa, nk, paylar) {
  const b = { ...(S.paket.baglam || {}) };
  if (sa.kaynak === "projeksiyon" && nk.projeksiyon.length) {
    const farklar = nk.projeksiyon.map((x) => x.gelir - x.gider).sort((x, y) => x - y);
    b.kapasite = Math.max(0, nk.aylikOrt);
    b.tipik_acik = farklar[Math.floor(farklar.length / 2)] < 0;
    b.acil_eksik = Math.max(0, Number(S.paket.nakit.birak_onerisi || 0) - nk.birak - (paylar.acil || 0) * nk.baslangic);
  }
  return b;
}

// ------------------------------------------------------------------------------------------ simülasyon çalıştırma
let isci = null, isNo = 0;
const bekleyen = new Map();

function isciAl() {
  if (isci === null) {
    try {
      isci = new Worker("sim-worker.js", { type: "module" });
      isci.onmessage = (e) => {
        const b = bekleyen.get(e.data.id);
        if (!b) return;
        if (e.data.ilerleme !== undefined) b.ilerleme(e.data.ilerleme);
        else {
          bekleyen.delete(e.data.id);
          if (e.data.hata) b.red(new Error(e.data.hata));
          else b.coz(e.data.sonuclar);
        }
      };
      isci.onerror = () => {
        for (const b of bekleyen.values()) b.red(new Error("Arka plan hesabı başlatılamadı."));
        bekleyen.clear();
        isci = false;
      };
    } catch {
      isci = false;
    }
  }
  return isci;
}

function calistir(isler, ilerleme) {
  const w = isciAl();
  if (!w) {   // Web Worker yoksa ana iş parçacığında (ekran kısa süre donabilir)
    return new Promise((coz, red) => setTimeout(() => {
      try {
        coz(isler.map((is) => H.simule(is)));
      } catch (e) {
        red(e);
      }
    }, 30));
  }
  const id = ++isNo;
  return new Promise((coz, red) => {
    bekleyen.set(id, { coz, red, ilerleme });
    w.postMessage({ id, isler });
  });
}

function ilerlemeYaz(x) {
  S.ilerleme = x;
  const b = $("#ilerleme > div");
  if (b) b.style.width = `${Math.round(x * 100)}%`;
}

async function simuleEt() {
  const p = S.paket, sa = simAyar();
  const { araclar, tablo } = H.aracVeTablo(p, sa.ay);
  const paylar = H.normalize(Object.fromEntries(Object.entries(sa.paylar).filter(([k]) => tablo[k])));
  if (!Object.keys(paylar).length) return toast("En az bir karışıma pay verin.");
  const w = H.birlestir(paylar, tablo);
  let takvim = null, aylik = sa.aylik, bas = sa.baslangic, ilkAy = H.ayEkle(simdi(), 1);
  const nk = nakit(sa);
  if (sa.kaynak === "projeksiyon") {
    if (!nk.projeksiyon.length) return toast("Projeksiyon ayı yok: masaüstünde Gelir ve Borç Projeksiyonu'nu kaydedip dosyayı yeniden gönderin ya da 'Sabit tutar'ı seçin.", 7000);
    takvim = nk.takvim;
    aylik = nk.aylikOrt;
    bas = nk.baslangic;
    ilkAy = nk.ilkAy;
    if (bas <= 0 && !takvim.some((x) => x > 0)) return toast("Kasada yatırılacak para ve projeksiyonda fazla veren ay yok.");
  } else if (aylik <= 0 && bas <= 0) {
    return toast("Aylık tutar ya da başlangıç tutarı girin.");
  }
  const A = { ...p.varsayimlar, mc_model: sa.model };
  const ortak = { araclar, aylik, ay: sa.ay, varsayimlar: A, baslangic: bas, artsin: sa.artsin, model: sa.model, takvim };
  const isler = [{ ...ortak, agirliklar: w, senaryo: H.senaryoSayisi(sa.senaryo), tohum: 7 }];
  const maksKarsilastir = tablo.maks && !(Object.keys(paylar).length === 1 && paylar.maks);
  if (maksKarsilastir) isler.push({ ...ortak, agirliklar: tablo.maks, senaryo: 2000, hedefOrnegi: false, tohum: 11 });
  S.calisiyor = true;
  S.karsilastirma = null;
  ilerlemeYaz(0);
  ciz();
  const bas0 = performance.now();
  try {
    const r = await calistir(isler, ilerlemeYaz);
    const ks = { sonuc: r[0], paylar, agirliklar: w, ay: sa.ay, aylik, baslangic: bas, ilkAy, araclar };
    const bg = baglam(sa, nk, paylar);
    ks.risk = H.riskSeviyesi(w, araclar);
    ks.oneriler = H.oneriler(ks, araclar, bg, maksKarsilastir ? r[1] : ks.sonuc);
    ks.sure = (performance.now() - bas0) / 1000;
    ks.kaynak = sa.kaynak;
    S.sonuc = ks;
  } catch (e) {
    toast(`Simülasyon yapılamadı: ${e.message}`, 7000);
  } finally {
    S.calisiyor = false;
    ciz();
    const k = $("#sonuc-basi");
    if (k && S.sonuc) k.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function karisimlariKarsilastir() {
  const ks = S.sonuc;
  if (!ks) return;
  const { araclar, tablo } = H.aracVeTablo(S.paket, ks.ay);
  const A = { ...S.paket.varsayimlar, mc_model: ks.sonuc.model };
  const keys = Object.keys(tablo);
  const isler = keys.map((k) => ({ araclar, aylik: ks.aylik, ay: ks.ay, varsayimlar: A, baslangic: ks.baslangic,
    artsin: simAyar().artsin, model: ks.sonuc.model, takvim: ks.sonuc.katki_takvimi, agirliklar: tablo[k], senaryo: 2000,
    hedefOrnegi: false, tohum: 13 }));
  S.calisiyor = true;
  ilerlemeYaz(0);
  ciz();
  try {
    const r = await calistir(isler, ilerlemeYaz);
    S.karsilastirma = keys.map((k, i) => ({ key: k, r: r[i], risk: H.riskSeviyesi(tablo[k], araclar) }));
  } catch (e) {
    toast(`Karşılaştırma yapılamadı: ${e.message}`, 6000);
  } finally {
    S.calisiyor = false;
    ciz();
    $("#karsilastirma")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ------------------------------------------------------------------------------------------ ortak parçalar
function serit(tur, ikon, metin, dugme = "") {
  return `<div class="serit ${tur}" role="${tur === "kritik" ? "alert" : "note"}"><span class="ikon" aria-hidden="true">${ikon}</span><div>${metin}</div>${dugme}</div>`;
}

function karo(etiket, deger, alt = "", eksi = false) {
  return `<div class="karo"><div class="etiket">${esc(etiket)}</div><div class="deger say${eksi ? " eksi" : ""}">${esc(deger)}</div>${alt ? `<div class="alt">${esc(alt)}</div>` : ""}</div>`;
}

function uyariAlt() {
  return `<p class="uyari-alt">⚠ ${esc(S.paket?.uyari || UYARI)}</p>`;
}

function durumSeritleri() {
  const p = S.paket;
  let s = "";
  if (S.ornek) {
    s += serit("bilgi", "i", "Uydurma <b>örnek verilerle</b> çalışıyorsunuz. Kendi verileriniz için masaüstünde "
      + "<b>Dosya → Telefon uygulamasına gönder</b> deyip dosyayı buradan seçin.",
    `<button class="ince" data-is="dosya-sec">Dosya seç</button>`);
  } else if (p.bu_ay < simdi()) {
    s += serit("uyari", "!", `Bu veriler ${esc(tarihTr(p.olusturma))} tarihli, yani geçen aya ait. Kasa ve projeksiyon `
      + "güncel değil: masaüstünde verileri güncelleyip dosyayı yeniden gönderin.");
  }
  if (S.islemler.length) {
    s += serit("uyari", "↑", `Masaüstüne aktarılmamış <b>${S.islemler.length} değişiklik</b> var.`,
      `<button class="ince" data-is="ekran" data-ekran="veri">Gönder</button>`);
  }
  for (const u of D.uyarilar) s += serit("uyari", "!", esc(u));
  return s;
}

// ------------------------------------------------------------------------------------------ Özet
function bosEkran() {
  return `<div class="kart bos">
    <h2>Bütçe Planlayıcı, telefonunuzda</h2>
    <p class="not">Simülasyonu çalıştırın, her ay gerçekten yaptığınız yatırımları kaydedin, planla karşılaştırın. Veriler
      yalnızca bu telefonda saklanır; masaüstüyle bir dosya üzerinden alışveriş yapılır.</p>
  </div>
  <div class="kart">
    <h2>Kendi verilerinizle başlayın</h2>
    <ol class="adim">
      <li>Masaüstünde <b>Dosya → Telefon uygulamasına gönder</b> deyin (isterseniz parola koyun).</li>
      <li>Oluşan dosyayı telefona aktarın: AirDrop, kendinize e-posta, iCloud Drive ya da Google Drive.</li>
      <li>Aşağıdaki düğmeyle dosyayı seçin.</li>
    </ol>
    <div class="dugmeler tam"><button class="ana" data-is="dosya-sec">Telefon dosyasını seç</button>
      <button data-is="ornek">Örnek verilerle dene</button></div>
  </div>
  ${kurulumKarti()}
  <p class="uyari-alt">⚠ ${esc(UYARI)}</p>`;
}

function buAyKarti() {
  const m = simdi(), plan = D.plan;
  const gercek = {};
  for (const k of D.kayitlar) if (k.ay === m && k.islem !== "aktarim") gercek[k.sepet || ""] = (gercek[k.sepet || ""] || 0) + H.isaretli(k.islem, k.tutar);
  const sepetler = [...new Set([...Object.keys(plan?.paylar || {}), ...Object.keys(gercek)])];
  let tablo = "";
  if (sepetler.length) {
    let tp = 0, tg = 0;
    const satirlar = sepetler.map((s) => {
      const pl = H.plandakiTutar(plan, m, s);
      tp += pl || 0;
      tg += gercek[s] || 0;
      return `<tr><td>${esc(sepetKisa(s))}</td><td>${pl === null ? "–" : H.tl(pl)}</td><td>${H.tl(gercek[s] || 0)}</td></tr>`;
    }).join("");
    tablo = `<div class="tablo-kap"><table><thead><tr><th>Sepet</th><th>Planlanan</th><th>Yapılan</th></tr></thead><tbody>${satirlar}
      <tr><td><b>Toplam</b></td><td><b>${H.tl(tp)}</b></td><td><b>${H.tl(tg)}</b></td></tr></tbody></table></div>`;
  }
  const bilgi = !plan ? "Kayıtlı plan yok: Simülasyon'da simüle edip planı kaydedin, her ay planlanan burada görünür."
    : plan.ilk_ay > m ? `Plan ${H.ay(plan.ilk_ay)} ayında başlıyor.` : "";
  return `<div class="kart"><h2>${esc(H.ay(m))} yatırımları</h2>${bilgi ? `<p class="not">${esc(bilgi)}</p>` : ""}${tablo}
    <div class="dugmeler"><button class="ana" data-is="kayit-yeni">+ Yatırım kaydı</button></div></div>`;
}

function ekranOzet() {
  if (!S.paket) return bosEkran();
  const p = S.paket, sa = simAyar(), nk = nakit(sa);
  const pf = H.portfoyDegeri(D.varliklar);
  const acil = p.ozet?.acil;
  let s = durumSeritleri();
  s += `<div class="karolar">
    ${karo("Kasadaki para", H.tl(nk.kasa), nk.kasaElle !== null ? "elle yazıldı" : nk.yatirilan ? `kayıtlı yatırımlar düşüldü` : "masaüstü hesabı", nk.kasa < 0)}
    ${karo("Yatırıma başlangıç", H.tl(nk.baslangic), nk.birak ? `kasada ${H.tl(nk.birak)} kalır` : "kasa + sepetler")}
    ${karo("Sepetlerdeki varlıklar", H.tl(pf.toplam), `${D.varliklar.filter((v) => v.sepet).length} varlık`)}
    ${acil ? karo("Acil durum fonu", acil.eksik > 0 ? `${H.tl(acil.eksik)} eksik` : "Tamam", `hedef ${H.tl(acil.hedef)} (${acil.ay} ay)`) : ""}
  </div>`;
  s += buAyKarti();
  if ((p.aylar || []).length) {
    s += `<div class="kart"><h2>Aylık gelir − gider farkı</h2><div id="g-net"></div>
      <div class="lejant"><span><i class="alan" style="background:var(--pos)"></i>Fazla</span>
      <span><i class="alan" style="background:var(--neg)"></i>Açık</span><span><i class="alan" style="background:var(--pos);opacity:.5"></i>Soluk: projeksiyon</span></div>
      ${p.nakit?.kasa_aciklama ? `<details><summary>Kasa nasıl hesaplandı?</summary><p class="not">${esc(p.nakit.kasa_aciklama)}</p></details>` : ""}</div>`;
    sonrasi.push(() => netCubuk($("#g-net"), p.aylar));
  }
  if ((p.hedefler || []).length) {
    const ol = S.sonuc ? H.hedefOlasiliklari(S.sonuc.sonuc, S.sonuc.ilkAy, p.hedefler) : [];
    const olAd = Object.fromEntries(ol.map((x) => [x.ad + x.ay, x]));
    s += `<div class="kart"><h2>Hedefler</h2><ul class="liste">${p.hedefler.map((h) => {
      const o = olAd[h.ad + String(h.hedef_tarih).slice(0, 7)];
      const ek = o ? (o.disarida ? "simülasyon süresinin dışında" : `ulaşma olasılığı ${H.yuzde(o.olasilik)}`) : "";
      return `<li><div class="govde"><div class="baslik">${esc(h.ad)}</div><div class="alt">${esc(H.ay(String(h.hedef_tarih).slice(0, 7)))}${h.mevcut ? ` · birikmiş ${H.tl(h.mevcut)}` : ""}${ek ? ` · ${ek}` : ""}</div></div><div class="tutar">${H.tl(h.hedef_tutar)}</div></li>`;
    }).join("")}</ul>${S.sonuc ? "" : `<p class="kucuk">Olasılıkları görmek için simülasyonu çalıştırın.</p>`}</div>`;
  }
  if ((p.ozet?.adimlar || []).length) {
    s += `<div class="kart"><details><summary>İhtiyatlı plan adımları (masaüstünden)</summary><ol class="adim">${p.ozet.adimlar.map((a) => `<li><b>${esc(a.baslik)}</b><br><span class="not">${esc(a.aciklama)}</span></li>`).join("")}</ol></details></div>`;
  }
  s += `<p class="kucuk">Masaüstü verisi: ${esc(tarihTr(p.olusturma))} · program ${esc(p.surum)}</p>`;
  return s + uyariAlt();
}

// ------------------------------------------------------------------------------------------ Simülasyon
function ekranSim() {
  if (!S.paket) return bosEkran();
  const p = S.paket, sa = simAyar(), nk = nakit(sa);
  const { tablo } = H.aracVeTablo(p, sa.ay);
  let s = durumSeritleri();
  s += `<div class="kart"><h2>Yatırılacak para</h2>
    <div class="secim" role="group" aria-label="Yatırılacak para">
      <button data-is="kaynak" data-deger="projeksiyon" aria-pressed="${sa.kaynak === "projeksiyon"}" ${sa.projVar ? "" : "disabled"}>Kasa + projeksiyon</button>
      <button data-is="kaynak" data-deger="sabit" aria-pressed="${sa.kaynak === "sabit"}">Sabit tutar</button>
    </div>`;
  if (sa.kaynak === "projeksiyon") {
    s += `<p class="not">Kasadaki <b>${H.tl(nk.kasa)}</b>${nk.birak ? ` (bunun ${H.tl(nk.birak)} kadarı kasada kalır)` : ""}${nk.portfoy ? ` ve sepetlerdeki ${H.tl(nk.portfoy)}` : ""} ile başlanır: <b>${H.tl(nk.baslangic)}</b>. Sonra her ay projeksiyondaki gelir − gider farkı yatırılır, açık veren aylarda açık birikimden çekilir. Ortalama aylık: <b>${H.tl(nk.aylikOrt)}</b>.</p>
      ${nk.acilSepette && !("birakElle" in sa) && p.nakit.birak_elle == null ? `<p class="kucuk">Acil durum fonu karışımdaki ${H.yuzde(H.normalize(sa.paylar).acil)} PPF sepetinde birikiyor; kasada ayrıca bırakılmıyor.</p>` : ""}
      <div class="iki"><label class="alan"><span>Süre (ay)</span><input inputmode="numeric" data-ayar="ay" value="${sa.ay}"></label>
      <label class="alan"><span>Fazla veren ayda yatırılan</span><input inputmode="decimal" data-ayar="pay" data-yuzde="1" value="${H.sayi(sa.pay * 100, 1)}"></label></div>
      <details><summary>Kasa ve projeksiyon ayrıntısı</summary>
        <div class="iki"><label class="alan"><span>Kasadaki para (elle)</span><input inputmode="decimal" data-ayar="kasaElle" placeholder="${esc(H.sayi(Number(p.nakit.kasa_taban) - nk.yatirilan, 0))}" value="${"kasaElle" in sa && sa.kasaElle !== null ? H.sayi(sa.kasaElle, 0) : p.nakit.kasa_elle != null && !("kasaElle" in sa) ? H.sayi(p.nakit.kasa_elle, 0) : ""}"></label>
        <label class="alan"><span>Kasada bırakılacak</span><input inputmode="decimal" data-ayar="birakElle" placeholder="${esc(H.sayi(nk.acilSepette ? 0 : p.nakit.birak_onerisi, 0))}" value="${"birakElle" in sa && sa.birakElle !== null ? H.sayi(sa.birakElle, 0) : p.nakit.birak_elle != null && !("birakElle" in sa) ? H.sayi(p.nakit.birak_elle, 0) : ""}"></label></div>
        <p class="kucuk">Boş bırakırsanız hesaplanan değer kullanılır. Kasa = masaüstündeki gerçekleşen gelir − gider (ödenmemiş planlı ödemeler düşülmüş) − kaydettiğiniz yatırımlar.</p>
        <div class="tablo-kap"><table><thead><tr><th>Ay</th><th>Gelir</th><th>Gider</th><th>Fark</th><th>Yatırılacak</th></tr></thead><tbody>
        ${nk.projeksiyon.map((x, i) => `<tr><td>${esc(H.ayKisa(x.ay))}</td><td>${H.tl(x.gelir)}</td><td>${H.tl(x.gider)}</td><td class="${x.gelir < x.gider ? "eksi" : ""}">${H.tl(x.gelir - x.gider)}</td><td class="${nk.takvim[i] < 0 ? "eksi" : ""}">${H.tl(nk.takvim[i])}</td></tr>`).join("")}
        </tbody></table></div>
        ${nk.takvim.length > nk.projeksiyon.length ? `<p class="kucuk">Projeksiyondan sonraki ${nk.takvim.length - nk.projeksiyon.length} ayda ayda ${H.tl(nk.uzatma)}${sa.artsin ? ", enflasyonla artarak" : ""}.</p>` : ""}
      </details>`;
  } else {
    s += `<div class="iki"><label class="alan"><span>Aylık tutar</span><input inputmode="decimal" data-ayar="aylik" value="${H.sayi(sa.aylik, 0)}"></label>
      <label class="alan"><span>Başlangıç tutarı</span><input inputmode="decimal" data-ayar="baslangic" value="${H.sayi(sa.baslangic, 0)}"></label></div>
      <label class="alan"><span>Süre (ay)</span><input inputmode="numeric" data-ayar="ay" value="${sa.ay}"></label>`;
  }
  s += `<label class="onay"><input type="checkbox" data-ayar="artsin" ${sa.artsin ? "checked" : ""}> ${sa.kaynak === "projeksiyon" ? "Projeksiyondan sonra tutar enflasyonla artsın" : "Aylık tutar her yıl enflasyon kadar artsın"}</label></div>`;

  // karışım
  const paylar = sa.paylar;
  let toplam = 0;
  const satirlar = (p.karisimlar || []).filter((h) => tablo[h.key]).map((h) => {
    const v = Number(paylar[h.key] || 0);
    toplam += v;
    return `<div class="pay-satir"><div><div class="ad">${esc(h.ad)}</div><div class="risk">Risk: ${esc(h.risk)}</div></div>
      <input inputmode="decimal" aria-label="${esc(h.ad)} payı (yüzde)" data-pay="${esc(h.key)}" value="${v ? H.sayi(v * 100, 1) : ""}" placeholder="%"></div>`;
  }).join("");
  const maksNot = tablo.maks && p.maks && p.maks.ay !== sa.ay
    ? `<p class="kucuk">Maksimum ihtiyatlı karışım masaüstünde ${p.maks.ay} ay için hesaplandı; ${sa.ay} ay için masaüstünde yeniden hesaplanır.</p>` : "";
  s += `<div class="kart"><h2>Karışım</h2><p class="not">Her ayın birikimi bu paylarla dağıtılır. Toplam 100 değilse oranlanır.</p>
    ${satirlar}<div class="toplam-satir"><span>Toplam</span><span class="say">%${H.sayi(toplam * 100, 1)}</span></div>
    ${maksNot}
    <div class="dugmeler"><button class="ince" data-is="dagilimim">Dağılımım (30/20/20/30)</button><button class="ince" data-is="paylar-sifir">Temizle</button></div>
    <div class="iki" style="margin-top:12px"><label class="alan"><span>Senaryo sayısı</span><select data-ayar="senaryo">${SENARYOLAR.map((n) => `<option value="${n}" ${n === Number(sa.senaryo) ? "selected" : ""}>${H.sayi(n, 0)}</option>`).join("")}</select></label>
    <label class="alan"><span>Model</span><select data-ayar="model">${Object.entries(H.MODELLER).map(([k, v]) => `<option value="${k}" ${k === sa.model ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label></div>
    <button class="ana" style="width:100%" data-is="simule" ${S.calisiyor ? "disabled" : ""}>${S.calisiyor ? "Hesaplanıyor…" : "Simüle et"}</button>
    <div class="ilerleme ${S.calisiyor ? "" : "gizli"}" id="ilerleme"><div style="width:${Math.round(S.ilerleme * 100)}%"></div></div>
    ${Object.keys(S.ayar).length ? `<div class="dugmeler"><button class="metin" data-is="ayar-sifirla">Masaüstü ayarlarına dön</button></div>` : ""}
  </div>`;
  if (S.sonuc) s += sonucBolumu();
  return s + uyariAlt();
}

function sonucBolumu() {
  const ks = S.sonuc, r = ks.sonuc;
  const ad = hazirAd();
  let s = `<div class="kart" id="sonuc-basi"><h2>Sonuç</h2>
    <p class="kucuk">${esc(H.payMetni(ks.paylar, ad))} · risk ${esc(ks.risk.toLocaleLowerCase("tr"))}</p>
    <div class="karolar">${karo("Tipik sonuç", H.tl(r.reel_p[50]), "bugünkü parayla")}
    ${karo("Kötü senaryo (10'da 1)", H.tl(r.reel_p[10]), "bugünkü parayla")}
    ${karo("İyi senaryo (10'da 1)", H.tl(r.reel_p[90]), "bugünkü parayla")}
    ${karo("Yatırılan", H.tl(r.reel_katki), "bugünkü parayla")}</div>
    <p>${esc(H.ozetCumle(ks))}</p>
    <h3>Ay ay değer (o ayın parasıyla)</h3><div id="g-yelpaze"></div>
    <div class="lejant"><span><i style="background:var(--series-1)"></i>Tipik (P50)</span><span><i class="alan" style="background:var(--band-1)"></i>Kötü–iyi aralığı (P10–P90)</span><span><i style="background:var(--series-2)"></i>Toplam yatırılan</span></div>
    <p class="kucuk">Araçlar: ${esc(H.agirlikMetni(ks.agirliklar, ks.araclar))}.</p>
    <p class="kucuk">${esc(H.guvenilirlik(r))} Süre ${H.sayi(ks.sure, 1)} sn.</p>
  </div>`;
  const yat = [];
  let t = r.baslangic;
  for (const c of H.aylikKatkilar(r)) {
    t += c;
    yat.push(t);
  }
  sonrasi.push(() => yelpaze($("#g-yelpaze"), { ilkAy: ks.ilkAy, p10: r.yol_p[10], p50: r.yol_p[50], p90: r.yol_p[90], yatirilan: yat }));
  // hedef
  const sa = simAyar();
  const h = sa.hedef || {};
  const aySecili = h.ay && H.ayFarki(h.ay, ks.ilkAy) >= 0 && H.ayFarki(h.ay, ks.ilkAy) < r.aylar ? h.ay : H.ayEkle(ks.ilkAy, r.aylar - 1);
  const k = H.ayFarki(aySecili, ks.ilkAy) + 1;
  let hm;
  if (!h.tutar) {
    hm = `${H.ay(aySecili)} sonunda tipik değer ${H.tl(r.yol_p[50][k - 1])} (kötü senaryo ${H.tl(r.yol_p[10][k - 1])}). Olasılık için hedef tutar yazın.`;
  } else {
    const o = H.hedefOlasiligi(r, h.tutar, k, !!h.reel);
    hm = `${H.ay(aySecili)} sonunda ${H.tl(h.tutar)}${h.reel ? " (bugünkü TL)" : ""} değerine ulaşma olasılığı: ${H.yuzde(o)}. Tipik değer ${H.tl(r.yol_p[50][k - 1])}, kötü senaryo ${H.tl(r.yol_p[10][k - 1])}${h.reel ? " (nominal)" : ""}.`;
  }
  const hedefler = H.hedefOlasiliklari(r, ks.ilkAy, S.paket.hedefler || []);
  s += `<div class="kart"><h2>Hedefe ulaşma olasılığı</h2>
    <div class="iki"><label class="alan"><span>Hedef tutar</span><input inputmode="decimal" data-hedef="tutar" value="${h.tutar ? H.sayi(h.tutar, 0) : ""}" placeholder="ör. 2.000.000"></label>
    <label class="alan"><span>Hangi ayın sonunda</span><select data-hedef="ay">${Array.from({ length: r.aylar }, (_, i) => H.ayEkle(ks.ilkAy, i)).map((m) => `<option value="${m}" ${m === aySecili ? "selected" : ""}>${esc(H.ay(m))}</option>`).join("")}</select></label></div>
    <label class="onay"><input type="checkbox" data-hedef="reel" ${h.reel ? "checked" : ""}> Tutar bugünkü parayla (o aya kadarki enflasyon eklenir)</label>
    <p><b>${esc(hm)}</b></p>
    ${hedefler.length ? `<h3>Kayıtlı hedefleriniz</h3><ul class="liste">${hedefler.map((x) => `<li><div class="govde"><div class="baslik">${esc(x.ad)}</div><div class="alt">${esc(H.ay(x.ay))} · o tarihe kadarki hedeflerle ${H.tl(x.tutar)}</div></div><div class="tutar">${x.disarida ? "süre dışında" : H.yuzde(x.olasilik)}</div></li>`).join("")}</ul>` : ""}
  </div>`;
  // ay ay tablo
  const rows = H.aylikBirikim(r, ks.ilkAy, ks.paylar);
  const acikVar = rows.some((x) => x.eksik > 0.5);
  const sepetler = Object.keys(rows[0]?.sepet || {});
  s += `<div class="kart"><h2>Ay ay birikim</h2><p class="not">Her ay önceki ayın sonundaki değere o ayın yatırımı eklenir, sonra o ayın getirisi işler (bileşik). Tutarlar o ayın parasıyla.</p>
    <div class="tablo-kap"><table><thead><tr><th>Ay</th><th>Yatırılacak</th><th>Toplam yatırılan</th><th>Bu ayın getirisi</th><th>Tipik (P50)</th><th>Tipik kazanç</th><th>Kötü (P10)</th><th>İyi (P90)</th>${acikVar ? "<th>Karşılanamayan açık</th>" : ""}${sepetler.map((x) => `<th>↳ ${esc(sepetKisa(x))}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${esc(H.ayKisa(x.ay))}</td><td class="${x.yatirilacak < 0 ? "eksi" : ""}">${H.tl(x.yatirilacak)}</td><td>${H.tl(x.toplam)}</td><td class="${x.getiri < 0 ? "eksi" : ""}">${H.tl(x.getiri)}</td><td><b>${H.tl(x.p50)}</b></td><td class="${x.kazanc < 0 ? "eksi" : ""}">${H.tl(x.kazanc)}</td><td>${H.tl(x.p10)}</td><td>${H.tl(x.p90)}</td>${acikVar ? `<td class="eksi">${H.tl(x.eksik)}</td>` : ""}${sepetler.map((k2) => `<td>${H.tl(x.sepet[k2])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <div class="dugmeler tam"><button class="ana" data-is="plan-kaydet">Planı takip için kaydet</button><button data-is="karsilastir" ${S.calisiyor ? "disabled" : ""}>Karışımları karşılaştır</button></div>
    <p class="kucuk">Kaydedilen plan, Yatırımlar ekranında her ay gerçekleşenle karşılaştırılır ve masaüstüne de gönderilir.</p>
  </div>`;
  s += `<div class="kart"><h2>Öneriler</h2>${ks.oneriler.map(([d, b, a]) => `<div class="oneri"><span class="simge ${d}" aria-hidden="true">${{ critical: "!", warning: "!", info: "i", good: "✓" }[d]}</span><div><b>${esc({ critical: "Riskli: ", warning: "Dikkat: ", info: "", good: "" }[d] + b)}</b><span class="ac">${esc(a)}</span></div></div>`).join("")}</div>`;
  if (S.karsilastirma) {
    s += `<div class="kart" id="karsilastirma"><h2>Karışımlar tek başına</h2><p class="not">Aynı tutar ve sürede, bugünkü parayla. 2.000 senaryo.</p>
      <div class="tablo-kap"><table><thead><tr><th>Karışım</th><th>Kötü P10</th><th>Tipik P50</th><th>İyi P90</th><th>Enflasyonun altında</th></tr></thead><tbody>
      <tr><td><b>Seçiminiz</b></td><td>${H.tl(r.reel_p[10])}</td><td>${H.tl(r.reel_p[50])}</td><td>${H.tl(r.reel_p[90])}</td><td>${H.yuzde(r.reel_kayip_olasiligi)}</td></tr>
      ${S.karsilastirma.map((x) => `<tr><td>${esc(ad[x.key] || x.key)}</td><td>${H.tl(x.r.reel_p[10])}</td><td>${H.tl(x.r.reel_p[50])}</td><td>${H.tl(x.r.reel_p[90])}</td><td>${H.yuzde(x.r.reel_kayip_olasiligi)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  return s;
}

// ------------------------------------------------------------------------------------------ Yatırımlar
function kayitSatiri(k) {
  const v = D.varliklar.find((x) => String(x.id) === String(k.varlik_id));
  const isaret = k.islem === "satis" ? "−" : k.islem === "aktarim" ? "" : "+";
  const etiket = k.telefonda ? `<span class="etiketcik bekliyor">telefonda</span>` : k.duzenlendi ? `<span class="etiketcik bekliyor">düzenlendi</span>` : "";
  const miktar = k.miktar ? ` · ${H.sayi(Number(k.miktar), 4)} ${esc(v?.birim || "")}` : "";
  return `<li class="tiklanir" data-is="kayit-ac" data-id="${esc(k.id)}"><div class="govde"><div class="baslik">${etiket}${esc(k.ad || sepetAdi(k.sepet))}</div>
    <div class="alt">${esc(sepetKisa(k.sepet))} · ${esc((S.paket.islemler || {})[k.islem] || k.islem)} · ${esc(tarihTr(k.tarih))}${miktar}</div></div>
    <div class="tutar">${isaret}${H.tl(Number(k.tutar))}</div></li>`;
}

function ekranYatirim() {
  if (!S.paket) return bosEkran();
  const p = S.paket, m = simdi();
  let s = durumSeritleri();
  s += `<div class="kart"><h2>Aylık yatırım kayıtları</h2><p class="not">${esc(H.planMetni(D.plan, m, p))}</p>
    <div class="dugmeler tam"><button class="ana" data-is="kayit-yeni">+ Yatırım kaydı</button><button data-is="ay-sonu">Ay sonu değeri yaz</button></div></div>`;
  const gruplar = {};
  for (const k of D.kayitlar) (gruplar[k.ay] = gruplar[k.ay] || []).push(k);
  const aylar = Object.keys(gruplar).sort().reverse();
  if (!aylar.length) {
    s += `<div class="kart"><p class="not">Henüz kayıt yok. Her ay gerçekten yaptığınız yatırımı (ör. 30.000 TL gram altın) kaydedin; bağlı varlığın miktarı da güncellenir.</p></div>`;
  }
  for (const a of aylar.slice(0, 18)) {
    const net = gruplar[a].filter((k) => k.islem !== "aktarim").reduce((t, k) => t + H.isaretli(k.islem, k.tutar), 0);
    s += `<div class="kart"><h2 style="display:flex;justify-content:space-between"><span>${esc(H.ay(a))}</span><span class="say">${H.tl(net)}</span></h2><ul class="liste">${gruplar[a].map(kayitSatiri).join("")}</ul></div>`;
  }
  const paylar = D.plan?.paylar || simAyar().paylar;
  const oz = H.sepetOzeti(D.kayitlar, D.varliklar, paylar).filter((x) => x.sepet || x.yatirilan || !Number.isNaN(x.deger));
  if (oz.length) {
    s += `<div class="kart"><h2>Sepetler</h2><div class="tablo-kap"><table><thead><tr><th>Sepet</th><th>Plan payı</th><th>Yatırılan</th><th>Bugünkü değer</th><th>Getiri</th></tr></thead><tbody>
      ${oz.map((x) => `<tr><td>${esc(sepetKisa(x.sepet))}</td><td>${Number.isNaN(x.pay) ? "–" : H.yuzde(x.pay)}</td><td>${H.tl(x.yatirilan)}</td><td>${H.tl(x.deger)}</td><td class="${x.getiri < 0 ? "eksi" : ""}">${H.tl(x.getiri)}${Number.isNaN(x.oran) ? "" : ` (${H.yuzde(x.oran, 1)})`}</td></tr>`).join("")}
      </tbody></table></div><p class="kucuk">Değerler masaüstündeki son fiyatlarla (Varlıklar'da telefonda değiştirdiğiniz fiyatlar dahil).</p></div>`;
  }
  const kars = H.planKarsilastirma(D.plan, D.kayitlar, D.degerler, m);
  if (kars.length) {
    s += `<div class="kart"><h2>Plan ve gerçekleşen</h2><p class="not">Planın aralığı gerçek yatırımla plan arasındaki farkla kaydırılır.</p><div class="tablo-kap"><table><thead><tr><th>Ay</th><th>Planlanan</th><th>Gerçek</th><th>Fark</th><th>Plan P10</th><th>Plan P50</th><th>Plan P90</th><th>Gerçek değer</th><th>Durum</th></tr></thead><tbody>
      ${kars.map((x) => `<tr><td>${esc(H.ayKisa(x.ay))}</td><td>${H.tl(x.planlanan)}</td><td>${H.tl(x.gercek)}</td><td class="${x.fark < 0 ? "eksi" : ""}">${H.tl(x.fark)}</td><td>${H.tl(x.p10)}</td><td>${H.tl(x.p50)}</td><td>${H.tl(x.p90)}</td><td>${H.tl(x.deger)}</td><td style="text-align:left">${esc(x.durum)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  s += `<div class="kart"><p class="not">${esc(H.gerceklesenMetni(D.degerler, D.kayitlar, D.plan?.yillik_p50))}</p></div>`;
  return s + uyariAlt();
}

// ------------------------------------------------------------------------------------------ Varlıklar
function ekranVarlik() {
  if (!S.paket) return bosEkran();
  const tur = S.paket.varlik_turleri || {};
  let toplam = 0, eksik = 0;
  for (const v of D.varliklar) {
    if (v.deger === null) eksik++;
    else toplam += v.deger;
  }
  const pf = H.portfoyDegeri(D.varliklar);
  let s = durumSeritleri();
  s += `<div class="karolar">${karo("Toplam varlık", H.tl(toplam), eksik ? `${eksik} varlığın fiyatı yok` : `${D.varliklar.length} varlık`)}${karo("Sepetlere bağlı", H.tl(pf.toplam), "simülasyona eklenir")}</div>`;
  s += `<div class="kart"><h2>Varlıklarım</h2><ul class="liste">${D.varliklar.map((v) => `<li class="tiklanir" data-is="varlik-ac" data-id="${esc(v.id)}"><div class="govde"><div class="baslik">${v.telefonda ? `<span class="etiketcik bekliyor">telefonda</span>` : ""}${esc(v.ad)}</div>
      <div class="alt">${H.sayi(Number(v.miktar || 0), 4)} ${esc(v.birim)} · ${esc(tur[v.tur] || v.tur)}${v.sepet ? ` · sepet: ${esc(sepetKisa(v.sepet))}` : ""}${v.fiyat_elle ? " · fiyat telefonda" : ""}</div></div>
      <div class="tutar">${v.deger === null ? "fiyat yok" : H.tl(v.deger)}</div></li>`).join("") || "<li>Varlık yok.</li>"}</ul>
    <p class="kucuk">Fiyatlar masaüstünde son güncellenen fiyatlardır (${esc(tarihTr(S.paket.olusturma))}). Bir varlığa dokunup birim fiyatını değiştirebilirsiniz; değiştirdiğiniz fiyat yalnızca bu telefonda kullanılır. Yeni varlık, yatırım kaydı eklerken oluşturulur.</p></div>`;
  return s + uyariAlt();
}

// ------------------------------------------------------------------------------------------ Veri
function islemMetni(op) {
  const k = op.kayit || {};
  const kayit = (id) => (S.paket.kayitlar || []).find((x) => String(x.id) === String(id));
  switch (op.op) {
    case "kayit_ekle": return `Yeni kayıt: ${sepetKisa(k.sepet)} · ${k.ad || ""} · ${H.tl(Number(k.tutar))} (${H.ay(k.ay)})`;
    case "kayit_guncelle": return `Düzenleme: ${sepetKisa(k.sepet)} · ${k.ad || ""} · ${H.tl(Number(k.tutar))} (${H.ay(k.ay)})`;
    case "kayit_sil": {
      const e = kayit(op.hedef);
      return `Silme: ${e ? `${e.ad || sepetKisa(e.sepet)} · ${H.tl(Number(e.tutar))} (${H.ay(e.ay)})` : "kayıt"}`;
    }
    case "varlik_ekle": return `Yeni varlık: ${op.varlik.ad}`;
    case "ay_sonu": return op.toplam === null ? `${H.ay(op.ay)} ay sonu değeri silindi` : `${H.ay(op.ay)} ay sonu değeri: ${H.tl(op.toplam)}`;
    case "plan": return `Plan kaydı (${H.ay(op.plan.ilk_ay)} başlangıçlı, ${op.plan.aylar} ay)`;
    default: return op.op;
  }
}

function kurulumKarti() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return "";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return `<div class="kart"><h2>Ana ekrana ekleyin</h2>
    ${kurulumIstemi ? `<p class="not">Uygulama gibi açılsın, internetsiz de çalışsın:</p><button class="ana" data-is="kur">Uygulamayı yükle</button>` : ios
    ? `<p class="not">Safari'de alttaki <b>Paylaş</b> düğmesine (kare ve yukarı ok) dokunun, <b>Ana Ekrana Ekle</b>'yi seçin. Uygulama simgesinden açılır, internetsiz de çalışır ve verileriniz kalıcı saklanır.</p>`
    : `<p class="not">Chrome'da sağ üstteki <b>⋮</b> menüsünden <b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi seçin. Uygulama simgesinden açılır ve internetsiz de çalışır.</p>`}</div>`;
}

function ekranVeri() {
  let s = "";
  if (S.paket) {
    s += `<div class="kart"><h2>Masaüstünden gelen veriler</h2><p class="not">${S.ornek ? "Örnek (uydurma) veriler." : `${esc(tarihTr(S.paket.olusturma))} tarihli dosya, program ${esc(S.paket.surum)}.`} ${D.varliklar.length} varlık, ${(S.paket.kayitlar || []).length} yatırım kaydı, ${(S.paket.nakit?.projeksiyon || []).length} projeksiyon ayı.</p>
      <div class="dugmeler"><button class="ana" data-is="dosya-sec">Yeni dosya yükle</button></div>
      <p class="kucuk">Yeni dosya yüklendiğinde masaüstüne işlenmiş değişiklikler listeden düşer, işlenmemişler bekler.</p></div>`;
    s += `<div class="kart"><h2>Masaüstüne gönderilecekler</h2>${S.islemler.length ? `<ul class="liste">${S.islemler.map((op) => `<li><div class="govde"><div class="baslik" style="font-weight:500">${esc(islemMetni(op))}</div></div><button class="ince" data-is="islem-geri" data-id="${esc(op.id)}">Geri al</button></li>`).join("")}</ul>
      <div class="dugmeler tam"><button class="ana" data-is="gonder">Değişiklik dosyasını oluştur</button></div>
      <p class="kucuk">Dosyayı masaüstüne aktarıp <b>Dosya → Telefondaki değişiklikleri içe aktar</b> deyin. Sonra masaüstünden yeni telefon dosyası gönderin; değişiklikler o zaman bu listeden düşer.${S.sonGonderim ? ` Son dosya: ${esc(tarihTr(S.sonGonderim))}.` : ""}</p>`
      : `<p class="not">Bekleyen değişiklik yok.</p>`}</div>`;
  }
  s += kurulumKarti();
  s += `<div class="kart"><h2>Gizlilik</h2><p class="not">Verileriniz yalnızca bu telefonda, bu uygulamanın kendi deposunda saklanır; hiçbir sunucuya gönderilmez. Uygulamanın adresinde yalnızca program dosyaları vardır. Telefon dosyalarını taşırken parola kullanmanızı öneririz.</p>
    <div class="dugmeler">${S.paket ? "" : `<button data-is="ornek">Örnek verilerle dene</button>`}${S.paket ? `<button class="tehlike" data-is="sil">Telefondaki verileri sil</button>` : ""}</div></div>`;
  s += `<p class="kucuk">Bütçe Planlayıcı telefon uygulaması ${SURUM}.</p>`;
  return s + `<p class="uyari-alt">⚠ ${esc(UYARI)}</p>`;
}

// ------------------------------------------------------------------------------------------ çizim
function ciz() {
  const baslik = $("#baslik");
  baslik.textContent = S.ekran === "ozet" ? "Bütçe Planlayıcı" : EKRANLAR[S.ekran];
  const rozet = $("#rozet");
  rozet.classList.toggle("gizli", !S.islemler.length);
  rozet.textContent = `↑ ${S.islemler.length}`;
  rozet.setAttribute("aria-label", `Masaüstüne gönderilecek ${S.islemler.length} değişiklik`);
  sonrasi.length = 0;
  const f = { ozet: ekranOzet, sim: ekranSim, yatirim: ekranYatirim, varlik: ekranVarlik, veri: ekranVeri }[S.ekran];
  $("#icerik").innerHTML = f();
  for (const b of document.querySelectorAll("nav.alt button")) {
    if (b.dataset.ekran === S.ekran) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  for (const fn of sonrasi) fn();
}

// ------------------------------------------------------------------------------------------ alt pencere (sheet)
function sayfa(html) {
  const d = $("#sayfa");
  d.innerHTML = `<div class="ic">${html}</div>`;
  if (!d.open) d.showModal();
  return d;
}
function sayfaKapat() {
  const d = $("#sayfa");
  if (d.open) d.close();
}
// Pencere kapanınca bir kez çalışır. Kapatıp hemen yeni pencere açıldığında gecikmeli gelen eski 'close' olayı yok sayılır.
function kapaninca(d, fn) {
  const h = () => {
    if (d.open) return;
    d.removeEventListener("close", h);
    fn();
  };
  d.addEventListener("close", h);
}

function soru(baslik, metin, dugmeler) {
  return new Promise((coz) => {
    const d = sayfa(`<h2>${esc(baslik)}</h2><p class="not">${metin}</p><div class="dugmeler tam">${dugmeler.map((b, i) => `<button class="${b.tur || ""}" data-cevap="${i}">${esc(b.ad)}</button>`).join("")}</div>`);
    d.querySelectorAll("[data-cevap]").forEach((b) => b.addEventListener("click", () => {
      sayfaKapat();
      coz(dugmeler[Number(b.dataset.cevap)].deger);
    }));
    kapaninca(d, () => coz(null));
  });
}

function parolaSor(baslik, aciklama) {
  return new Promise((coz) => {
    const d = sayfa(`<h2>${esc(baslik)}</h2><p class="not">${esc(aciklama)}</p><form id="parola-form"><label class="alan"><span>Parola</span><input type="password" name="parola" autocomplete="off" autofocus></label>
      <div class="dugmeler tam"><button type="submit" class="ana">Tamam</button><button type="button" data-is="kapat">Vazgeç</button></div></form>`);
    let bitti = false;
    $("#parola-form", d).addEventListener("submit", (e) => {
      e.preventDefault();
      bitti = true;
      const v = e.target.parola.value;
      sayfaKapat();
      coz(v);
    });
    kapaninca(d, () => { if (!bitti) coz(null); });
  });
}

// ------------------------------------------------------------------------------------------ kayıt formu
function aySecenekleri(secili) {
  const out = [];
  for (let i = -12; i <= 1; i++) out.push(H.ayEkle(simdi(), i));
  if (secili && !out.includes(secili)) out.push(secili);
  return out.sort().reverse().map((m) => `<option value="${m}" ${m === secili ? "selected" : ""}>${esc(H.ay(m))}</option>`).join("");
}

function kayitFormu(k = null) {
  const p = S.paket;
  const plan = D.plan;
  const once = Object.keys(plan?.paylar || simAyar().paylar || {});
  const sepetSec = k ? k.sepet : once[0] || "";
  const tumSepet = [...new Set([...once, ...(p.karisimlar || []).map((h) => h.key)])];
  const tarih = k ? String(k.tarih).slice(0, 10) : H.bugunIso();
  const ayS = k ? k.ay : simdi();
  const islemSec = k ? k.islem : "alis";
  const vSec = k && k.varlik_id !== null && k.varlik_id !== undefined ? String(k.varlik_id) : "";
  const turlar = p.varlik_turleri || {};
  const d = sayfa(`<h2>${k ? "Yatırım kaydını düzenle" : "Yatırım kaydı"}</h2>
    <form id="kayit-form" novalidate>
      <div class="iki"><label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${tarih}" required></label>
      <label class="alan"><span>Hangi ayın birikimi</span><select name="ay">${aySecenekleri(ayS)}</select></label></div>
      <div class="iki"><label class="alan"><span>Sepet</span><select name="sepet"><option value="">Sepetsiz</option>${tumSepet.map((s) => `<option value="${esc(s)}" ${s === sepetSec ? "selected" : ""}>${esc(sepetAdi(s))}</option>`).join("")}</select></label>
      <label class="alan"><span>İşlem</span><select name="islem">${Object.entries(p.islemler || {}).map(([a, b]) => `<option value="${a}" ${a === islemSec ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label></div>
      <label class="alan"><span>Ne alındı</span><input name="ad" value="${esc(k?.ad || "")}" placeholder="ör. Gram altın, para piyasası fonu, THYAO"></label>
      <label class="alan"><span>Varlık</span><select name="varlik"><option value="">— Varlığa bağlama —</option><option value="__yeni__">+ Yeni varlık olarak ekle</option>
        ${D.varliklar.map((v) => `<option value="${esc(v.id)}" ${String(v.id) === vSec ? "selected" : ""}>${esc(v.ad)} · ${H.sayi(Number(v.miktar || 0), 2)} ${esc(v.birim)}</option>`).join("")}</select></label>
      <div id="yeni-varlik" class="gizli kart" style="background:var(--surface-2)">
        <label class="alan"><span>Varlığın adı</span><input name="v_ad" placeholder="ör. Gram altın"></label>
        <div class="iki"><label class="alan"><span>Tür</span><select name="v_tur">${Object.entries(turlar).map(([a, b]) => `<option value="${a}">${esc(b)}</option>`).join("")}</select></label>
        <label class="alan"><span>Birim</span><select name="v_birim"></select></label></div>
        <label class="alan" id="v-ayar-k"><span>Ayar</span><select name="v_ayar"></select></label>
        <label class="alan"><span>Birim fiyatı (TL, telefonda değer için; boş bırakılabilir)</span><input name="v_fiyat" inputmode="decimal"></label>
      </div>
      <div class="iki"><label class="alan"><span>Tutar (TL)</span><input name="tutar" inputmode="decimal" value="${k ? H.sayi(Number(k.tutar), 2) : ""}" required></label>
      <label class="alan"><span>Miktar <span id="birim-etiket"></span></span><input name="miktar" inputmode="decimal" value="${k?.miktar ? H.sayi(Number(k.miktar), 4) : ""}" placeholder="gram, adet, pay"></label></div>
      <label class="onay" id="ekle-k"><input type="checkbox" name="ekle" ${!k || Number(k.varliga_eklenen) ? "checked" : ""}> Miktarı varlığa ekle (çekişte düş)</label>
      <label class="alan"><span>Not</span><input name="notlar" value="${esc(k?.notlar || "")}"></label>
      <p class="kucuk" id="plan-bilgi"></p>
      <div class="dugmeler tam"><button type="submit" class="ana">Kaydet</button>${k ? `<button type="button" class="tehlike" data-is="kayit-sil" data-id="${esc(k.id)}">Sil</button>` : ""}<button type="button" data-is="kapat">Vazgeç</button></div>
    </form>`);
  const f = $("#kayit-form", d);
  const tutarOtomatik = { v: !k };
  const birimDoldur = () => {
    const t = f.v_tur.value;
    const birimler = (p.birimler || {})[t] || ["TL"];
    f.v_birim.innerHTML = birimler.map((b) => `<option>${esc(b)}</option>`).join("");
    const ayarlar = AYARLAR[t];
    $("#v-ayar-k", d).classList.toggle("gizli", !ayarlar || f.v_birim.value !== "gr");
    f.v_ayar.innerHTML = ayarlar ? Object.entries(ayarlar).map(([a, b]) => `<option value="${b}">${esc(a)}</option>`).join("") : "";
  };
  const varlikDegisti = () => {
    const yeni = f.varlik.value === "__yeni__";
    $("#yeni-varlik", d).classList.toggle("gizli", !yeni);
    const v = D.varliklar.find((x) => String(x.id) === f.varlik.value);
    $("#birim-etiket", d).textContent = v ? `(${v.birim})` : "";
    $("#ekle-k", d).classList.toggle("gizli", (!v && !yeni) || f.islem.value === "aktarim");
    if (v && !f.ad.value.trim()) f.ad.value = v.ad;
    if (yeni) {
      const [tur] = SEPET_TURU[f.sepet.value] || ["diger", "TL"];
      f.v_tur.value = tur in turlar ? tur : "diger";
      birimDoldur();
      const [, birim] = SEPET_TURU[f.sepet.value] || ["", "TL"];
      if ([...f.v_birim.options].some((o) => o.value === birim)) f.v_birim.value = birim;
      $("#v-ayar-k", d).classList.toggle("gizli", !AYARLAR[f.v_tur.value] || f.v_birim.value !== "gr");
      if (!f.v_ad.value) f.v_ad.value = f.ad.value;
    }
  };
  const planYaz = () => {
    const t = H.plandakiTutar(plan, f.ay.value, f.sepet.value);
    $("#plan-bilgi", d).textContent = t === null ? "" : `Kayıtlı planda ${H.ay(f.ay.value)} için bu sepete ayrılan: ${H.tl(t)}.`;
    if (tutarOtomatik.v && t > 0 && f.islem.value === "alis") f.tutar.value = H.sayi(Math.round(t * 100) / 100, 2);
  };
  f.tarih.addEventListener("change", () => {
    if (/^\d{4}-\d{2}/.test(f.tarih.value)) {
      f.ay.innerHTML = aySecenekleri(f.tarih.value.slice(0, 7));
      planYaz();
    }
  });
  f.tutar.addEventListener("input", () => { tutarOtomatik.v = false; });
  f.ay.addEventListener("change", planYaz);
  f.sepet.addEventListener("change", planYaz);
  f.varlik.addEventListener("change", varlikDegisti);
  f.islem.addEventListener("change", varlikDegisti);
  f.v_tur.addEventListener("change", birimDoldur);
  f.v_birim.addEventListener("change", () => $("#v-ayar-k", d).classList.toggle("gizli", !AYARLAR[f.v_tur.value] || f.v_birim.value !== "gr"));
  f.ad.addEventListener("input", () => { if (f.varlik.value === "__yeni__" && !f.v_ad.dataset.elle) f.v_ad.value = f.ad.value; });
  f.v_ad.addEventListener("input", () => { f.v_ad.dataset.elle = "1"; });
  varlikDegisti();
  planYaz();
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const tutar = sayiOku(f.tutar.value);
    if (!(tutar > 0)) return toast("Tutarı yazın.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.tarih.value)) return toast("Tarihi seçin.");
    const miktar = sayiOku(f.miktar.value);
    if (Number.isNaN(miktar)) return toast("Miktar sayı olmalı.");
    let varlikId = f.varlik.value || null;
    let yeniOp = null;
    if (varlikId === "__yeni__") {
      const ad = f.v_ad.value.trim() || f.ad.value.trim();
      if (!ad) return toast("Yeni varlığın adını yazın.");
      const fiyat = sayiOku(f.v_fiyat.value);
      const mid = "m:" + H.kimlik();
      const birim = f.v_birim.value || "TL";
      yeniOp = { id: H.kimlik(), op: "varlik_ekle", mobil_id: mid, varlik: { ad, tur: f.v_tur.value, birim,
        likit: true, ayar: AYARLAR[f.v_tur.value] && birim === "gr" ? Number(f.v_ayar.value) : null, sepet: f.sepet.value,
        miktar: 0, birim_fiyat: fiyat > 0 ? fiyat : (["tl", "try"].includes(birim.toLowerCase()) ? 1 : null) } };
      varlikId = mid;
    }
    const kayit = { tarih: f.tarih.value, ay: f.ay.value, sepet: f.sepet.value, islem: f.islem.value,
      varlik_id: varlikId === null ? null : (String(varlikId).startsWith("m:") ? varlikId : Number(varlikId)),
      ad: f.ad.value.trim(), tutar, miktar: miktar || null, notlar: f.notlar.value.trim() };
    const ekle = yeniOp ? true : f.ekle.checked && !$("#ekle-k", d).classList.contains("gizli");
    let ops = S.islemler;
    if (yeniOp) ops = H.islemEkle(ops, yeniOp);
    if (k) ops = H.islemEkle(ops, { id: H.kimlik(), op: "kayit_guncelle", hedef: k.id, kayit, varliga_ekle: ekle });
    else ops = H.islemEkle(ops, { id: H.kimlik(), op: "kayit_ekle", mobil_id: "m:" + H.kimlik(), kayit, varliga_ekle: ekle });
    S.islemler = ops;
    sayfaKapat();
    degisti();
    toast(`${sepetKisa(kayit.sepet)}: ${H.tl(tutar)} kaydedildi. Masaüstüne göndermeyi unutmayın.`);
  });
}

async function kayitSil(id) {
  const k = D.kayitlar.find((x) => String(x.id) === String(id));
  if (!k) return;
  let geriAl = false;
  if (Number(k.varliga_eklenen)) {
    const c = await soru("Kaydı sil", `'${esc(k.ad || sepetAdi(k.sepet))}' silinsin mi? Varlığa eklenen miktar da geri alınsın mı?`,
      [{ ad: "Sil ve miktarı geri al", deger: "geri", tur: "tehlike" }, { ad: "Yalnızca kaydı sil", deger: "kayit" }, { ad: "Vazgeç", deger: null }]);
    if (!c) return;
    geriAl = c === "geri";
  } else {
    const c = await soru("Kaydı sil", "Kayıt silinsin mi?", [{ ad: "Sil", deger: true, tur: "tehlike" }, { ad: "Vazgeç", deger: null }]);
    if (!c) return;
  }
  S.islemler = H.islemEkle(S.islemler, { id: H.kimlik(), op: "kayit_sil", hedef: k.id, geri_al: geriAl });
  degisti();
  toast("Kayıt silindi.");
}

function aySonuFormu() {
  const pf = H.portfoyDegeri(D.varliklar);
  const d = sayfa(`<h2>Ay sonu portföy değeri</h2><p class="not">Sepetlere bağlı varlıklarınızın o ayın sonundaki toplam değeri. Elle yazılan değer masaüstünde otomatik hesapla ezilmez.</p>
    <form id="aysonu-form"><label class="alan"><span>Ay</span><select name="ay">${Array.from({ length: 13 }, (_, i) => H.ayEkle(simdi(), -i)).map((m) => `<option value="${m}">${esc(H.ay(m))}</option>`).join("")}</select></label>
    <label class="alan"><span>Toplam değer (TL)</span><input name="toplam" inputmode="decimal" value="${H.sayi(Math.round(pf.toplam), 0)}"></label>
    <p class="kucuk" id="aysonu-mevcut"></p>
    <div class="dugmeler tam"><button type="submit" class="ana">Kaydet</button><button type="button" data-is="aysonu-sil">Elle değeri sil</button><button type="button" data-is="kapat">Vazgeç</button></div></form>`);
  const f = $("#aysonu-form", d);
  const yaz = () => {
    const v = D.degerler[f.ay.value];
    $("#aysonu-mevcut", d).textContent = v ? `Kayıtlı: ${H.tl(v.toplam)}${v.elle ? " (elle)" : " (otomatik)"}` : "Bu ay için kayıt yok.";
  };
  f.ay.addEventListener("change", yaz);
  yaz();
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = sayiOku(f.toplam.value);
    if (!(v >= 0)) return toast("Değeri yazın.");
    S.islemler = H.islemEkle(S.islemler, { id: H.kimlik(), op: "ay_sonu", ay: f.ay.value, toplam: v, tarih: H.bugunIso() });
    sayfaKapat();
    degisti();
  });
  $("[data-is=aysonu-sil]", d).addEventListener("click", () => {
    S.islemler = H.islemEkle(S.islemler, { id: H.kimlik(), op: "ay_sonu", ay: f.ay.value, toplam: null, tarih: H.bugunIso() });
    sayfaKapat();
    degisti();
  });
}

function varlikFormu(id) {
  const v = D.varliklar.find((x) => String(x.id) === String(id));
  if (!v) return;
  const masaustu = v.fiyat_elle ? v.birim_fiyat_masaustu : v.birim_fiyat;
  const d = sayfa(`<h2>${esc(v.ad)}</h2><p class="not">${H.sayi(Number(v.miktar || 0), 4)} ${esc(v.birim)}${v.sepet ? ` · sepet: ${esc(sepetAdi(v.sepet))}` : ""}. Masaüstündeki birim fiyatı: ${masaustu == null ? "yok" : H.tl(masaustu)}.</p>
    <form id="fiyat-form"><label class="alan"><span>Birim fiyatı (1 ${esc(v.birim)}, TL)</span><input name="fiyat" inputmode="decimal" value="${v.fiyat_elle ? H.sayi(v.birim_fiyat, 4) : ""}" placeholder="${masaustu == null ? "" : esc(H.sayi(masaustu, 2))}"></label>
    <p class="kucuk">Yalnızca bu telefonda kullanılır (masaüstüne gönderilmez); yeni dosya yüklenince masaüstü fiyatına döner.</p>
    <div class="dugmeler tam"><button type="submit" class="ana">Kaydet</button>${v.fiyat_elle ? `<button type="button" data-is="fiyat-sil">Masaüstü fiyatına dön</button>` : ""}<button type="button" data-is="kapat">Vazgeç</button></div></form>`);
  $("#fiyat-form", d).addEventListener("submit", (e) => {
    e.preventDefault();
    const x = sayiOku(e.target.fiyat.value);
    if (x === null) delete S.fiyatElle[v.id];
    else if (!(x >= 0)) return toast("Fiyat sayı olmalı.");
    else S.fiyatElle[v.id] = x;
    sayfaKapat();
    degisti();
  });
  $("[data-is=fiyat-sil]", d)?.addEventListener("click", () => {
    delete S.fiyatElle[v.id];
    sayfaKapat();
    degisti();
  });
}

// ------------------------------------------------------------------------------------------ dosyalar
async function dosyaYukle(file) {
  let metin;
  try {
    metin = await file.text();
  } catch {
    return toast("Dosya okunamadı.");
  }
  let c;
  try {
    c = H.dosyaCozumle(metin);
    if (c.sifreli) {
      for (;;) {
        const parola = await parolaSor("Parolalı dosya", "Masaüstünde dosyayı oluştururken yazdığınız parolayı girin.");
        if (parola === null) return;
        try {
          c = H.dosyaCozumle(await H.coz(c.zarf, parola));
          break;
        } catch (e) {
          toast(e.message);
        }
      }
    }
  } catch (e) {
    return toast(e.message, 6000);
  }
  const p = c.veri;
  if (p.tur === H.TUR_DEGISIKLIK) return toast("Bu, telefonun masaüstüne gönderdiği değişiklik dosyası. Masaüstünde içe aktarın.", 7000);
  if (S.paket && !S.ornek && S.paket.olusturma && p.olusturma < S.paket.olusturma) {
    const ok = await soru("Daha eski dosya", `Seçtiğiniz dosya (${esc(tarihTr(p.olusturma))}) telefondakinden (${esc(tarihTr(S.paket.olusturma))}) daha eski. Yine de yüklensin mi?`,
      [{ ad: "Yükle", deger: true }, { ad: "Vazgeç", deger: null }]);
    if (!ok) return;
  }
  const onceki = S.islemler.length;
  if (S.ornek) {
    S.islemler = [];
    S.ayar = {};
  }
  const kalan = S.ornek ? [] : H.bekleyenler(S.islemler, p);
  S.paket = p;
  S.islemler = kalan;
  S.ornek = false;
  S.fiyatElle = {};
  delete S.ayar.kasaElle;
  delete S.ayar.birakElle;
  S.sonuc = null;
  S.karsilastirma = null;
  degisti();
  depo.kaliciIste();
  const islenen = onceki - kalan.length;
  toast(`Veriler yüklendi (${tarihTr(p.olusturma)}).` + (islenen > 0 ? ` ${islenen} değişiklik masaüstüne işlenmiş.` : "")
    + (kalan.length ? ` ${kalan.length} değişiklik hâlâ bekliyor.` : ""), 6000);
}

async function ornekYukle() {
  if (S.paket && !S.ornek) {
    const ok = await soru("Örnek veriler", "Telefondaki verileriniz silinip yerine uydurma örnek veriler yüklenecek." + (S.islemler.length ? " <b>Masaüstüne gönderilmemiş değişiklikler de silinir.</b>" : ""),
      [{ ad: "Örnekleri yükle", deger: true, tur: "tehlike" }, { ad: "Vazgeç", deger: null }]);
    if (!ok) return;
  }
  try {
    const r = await fetch("ornek.json", { cache: "no-cache" });
    const p = await r.json();
    S.paket = H.ornegiKaydir(p, simdi());
    S.islemler = [];
    S.ayar = {};
    S.fiyatElle = {};
    S.ornek = true;
    S.sonuc = null;
    degisti();
    toast("Örnek veriler yüklendi.");
  } catch {
    toast("Örnek veriler yüklenemedi (internet bağlantısı gerekebilir).");
  }
}

async function gonder() {
  if (!S.islemler.length) return toast("Gönderilecek değişiklik yok.");
  const d = sayfa(`<h2>Değişiklik dosyası</h2><p class="not">${S.islemler.length} değişiklik tek dosyada toplanır. Dosyayı masaüstüne aktarıp <b>Dosya → Telefondaki değişiklikleri içe aktar</b> deyin.</p>
    <form id="gonder-form"><label class="alan"><span>Parola (isteğe bağlı, önerilir)</span><input type="password" name="parola" autocomplete="new-password"></label>
    <div class="dugmeler tam"><button type="submit" class="ana">Oluştur ve paylaş</button><button type="button" data-is="kapat">Vazgeç</button></div></form>`);
  $("#gonder-form", d).addEventListener("submit", async (e) => {
    e.preventDefault();
    const parola = e.target.parola.value;
    const nesne = { tur: H.TUR_DEGISIKLIK, bicim: 1, surum: SURUM, olusturma: new Date().toISOString().slice(0, 19),
      kaynak_paket: S.paket.paket_id, islemler: S.islemler };
    let metin = JSON.stringify(nesne);
    if (parola) metin = JSON.stringify(await H.sifrele(metin, parola));
    const z = new Date();
    const ad = `telefon-degisiklikleri-${z.getFullYear()}${String(z.getMonth() + 1).padStart(2, "0")}${String(z.getDate()).padStart(2, "0")}-${String(z.getHours()).padStart(2, "0")}${String(z.getMinutes()).padStart(2, "0")}.json`;
    const file = new File([metin], ad, { type: "application/json" });
    sayfaKapat();
    let paylasildi = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Bütçe Planlayıcı değişiklikleri" });
        paylasildi = true;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    if (!paylasildi) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = ad;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    S.sonGonderim = new Date().toISOString().slice(0, 16);
    kaydet();
    ciz();
    toast("Dosya hazır. Masaüstünde içe aktardıktan sonra yeni telefon dosyası gönderin.", 6000);
  });
}

// ------------------------------------------------------------------------------------------ olaylar
const ISLER = {
  ekran: (b) => {
    S.ekran = b.dataset.ekran;
    ciz();
    window.scrollTo(0, 0);
  },
  "dosya-sec": () => $("#dosya").click(),
  ornek: ornekYukle,
  simule: simuleEt,
  karsilastir: karisimlariKarsilastir,
  kaynak: (b) => {
    S.ayar.kaynak = b.dataset.deger;
    S.sonuc = null;
    kaydet();
    ciz();
  },
  dagilimim: () => {
    const { tablo } = H.aracVeTablo(S.paket, simAyar().ay);
    const p = {};
    for (const [k, v] of Object.entries(H.KULLANICI_DAGILIMI)) if (tablo[k]) p[k] = v;
    S.ayar.paylar = p;
    kaydet();
    ciz();
    if (!tablo.piyasa) toast("Piyasa adayları masaüstünden gönderilmemiş: o %20'yi isterseniz Agresif satırına yazın.", 7000);
  },
  "paylar-sifir": () => {
    S.ayar.paylar = {};
    kaydet();
    ciz();
  },
  "ayar-sifirla": () => {
    S.ayar = {};
    S.sonuc = null;
    kaydet();
    ciz();
  },
  "plan-kaydet": async () => {
    const ks = S.sonuc;
    if (!ks) return;
    if (D.plan) {
      const ok = await soru("Planı kaydet", esc(H.planMetni(D.plan, simdi(), S.paket)) + "<br><br>Bu plan yenisiyle değiştirilsin mi? Yatırım kayıtlarınız silinmez.",
        [{ ad: "Değiştir", deger: true }, { ad: "Vazgeç", deger: null }]);
      if (!ok) return;
    }
    const plan = H.planOzeti(ks.sonuc, ks.ilkAy, ks.paylar, H.bugunIso());
    S.islemler = H.islemEkle(S.islemler, { id: H.kimlik(), op: "plan", plan });
    degisti();
    toast("Plan kaydedildi; Yatırımlar ekranında gerçekleşenle karşılaştırılır.");
  },
  "kayit-yeni": () => kayitFormu(),
  "kayit-ac": (b) => kayitFormu(D.kayitlar.find((k) => String(k.id) === b.dataset.id)),
  "kayit-sil": (b) => kayitSil(b.dataset.id),
  "ay-sonu": aySonuFormu,
  "varlik-ac": (b) => varlikFormu(b.dataset.id),
  gonder,
  "islem-geri": async (b) => {
    const op = S.islemler.find((x) => x.id === b.dataset.id);
    if (!op) return;
    const bagli = op.op === "varlik_ekle" && S.islemler.some((x) => x.kayit && x.kayit.varlik_id === op.mobil_id);
    const ok = await soru("Değişikliği geri al", esc(islemMetni(op)) + (bagli ? "<br><br>Bu varlığa bağlı kayıtlar varlıksız kalır." : ""),
      [{ ad: "Geri al", deger: true, tur: "tehlike" }, { ad: "Vazgeç", deger: null }]);
    if (!ok) return;
    S.islemler = S.islemler.filter((x) => x.id !== op.id);
    degisti();
  },
  sil: async () => {
    const ok = await soru("Telefondaki verileri sil", "Bu telefondaki tüm Bütçe Planlayıcı verileri silinecek. Masaüstündeki veriler değişmez."
      + (S.islemler.length ? ` <b>Masaüstüne gönderilmemiş ${S.islemler.length} değişiklik kaybolur.</b>` : ""),
    [{ ad: "Sil", deger: true, tur: "tehlike" }, { ad: "Vazgeç", deger: null }]);
    if (!ok) return;
    Object.assign(S, { paket: null, islemler: [], ayar: {}, fiyatElle: {}, ornek: false, sonGonderim: null, sonuc: null, karsilastirma: null });
    await depo.sil("durum");
    turet();
    S.ekran = "ozet";
    ciz();
    toast("Telefondaki veriler silindi.");
  },
  kur: async () => {
    if (!kurulumIstemi) return;
    kurulumIstemi.prompt();
    await kurulumIstemi.userChoice.catch(() => null);
    kurulumIstemi = null;
    ciz();
  },
  kapat: sayfaKapat,
};

function ayarDegisti(inp) {
  const k = inp.dataset.ayar;
  if (k === "artsin") S.ayar.artsin = inp.checked;
  else if (k === "senaryo") S.ayar.senaryo = Number(inp.value);
  else if (k === "model") S.ayar.model = inp.value;
  else {
    const v = sayiOku(inp.value);
    if (k === "kasaElle" || k === "birakElle") {
      if (v === null) S.ayar[k] = null;
      else if (!Number.isNaN(v)) S.ayar[k] = v;
    } else if (v !== null && !Number.isNaN(v)) {
      if (k === "ay") S.ayar.ay = Math.min(600, Math.max(1, Math.round(v)));
      else if (k === "pay") S.ayar.pay = Math.min(1, Math.max(0, v / 100));
      else S.ayar[k] = Math.max(0, v);
    }
  }
  kaydet();
  ciz();
}

function olaylariBagla() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-is]");
    if (!b || b.disabled) return;
    const f = ISLER[b.dataset.is];
    if (f) {
      e.preventDefault();
      f(b);
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.ayar) ayarDegisti(t);
    else if (t.dataset.pay !== undefined) {
      const v = sayiOku(t.value);
      const p = { ...simAyar().paylar };
      if (v === null || v <= 0) delete p[t.dataset.pay];
      else if (!Number.isNaN(v)) p[t.dataset.pay] = v / 100;
      S.ayar.paylar = p;
      kaydet();
      ciz();
    } else if (t.dataset.hedef) {
      const h = { ...(simAyar().hedef || {}) };
      if (t.dataset.hedef === "tutar") h.tutar = sayiOku(t.value) || 0;
      else if (t.dataset.hedef === "ay") h.ay = t.value;
      else h.reel = t.checked;
      S.ayar.hedef = h;
      kaydet();
      ciz();
    }
  });
  $("#dosya").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) dosyaYukle(f);
  });
  $("#sayfa").addEventListener("click", (e) => {
    if (e.target === $("#sayfa")) sayfaKapat();
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    kurulumIstemi = e;
    if (S.ekran === "veri" || !S.paket) ciz();
  });
  let w = window.innerWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - w) > 40) {
      w = window.innerWidth;
      ciz();
    }
  });
}

function swKaydet() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const yeni = reg.installing;
      yeni?.addEventListener("statechange", () => {
        if (yeni.state === "installed" && navigator.serviceWorker.controller) {
          const t = document.createElement("div");
          t.className = "toast";
          t.innerHTML = `Yeni sürüm hazır. <button class="ince" style="margin-left:8px">Yenile</button>`;
          t.querySelector("button").addEventListener("click", () => yeni.postMessage("hemen"));
          document.body.appendChild(t);
        }
      });
    });
  }).catch(() => { /* çevrimdışı çalışma olmadan da uygulama açılır */ });
  let yenilendi = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!yenilendi) {
      yenilendi = true;
      location.reload();
    }
  });
}

async function basla() {
  olaylariBagla();
  const d = await depo.oku("durum");
  if (d) Object.assign(S, d);
  turet();
  ciz();
  swKaydet();
}

basla();
