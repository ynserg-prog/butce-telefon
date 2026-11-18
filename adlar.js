// Kalem adlarını karşılaştırma: aynı ödemeyi anlatan adlar ('Kuvety Turk K.K' / 'Kuveyt Türk kart') ve banka adları.
// Masaüstündeki butce/adlar.py ile birebir aynı kurallar (tests/test_adlar.py iki tarafı karşılaştırır): bir ödeme
// masaüstünde neyle eşleşiyorsa telefonda da onunla eşleşir. Ekran (DOM) kullanmaz.

export const BENZERLIK = 0.85;

export const BANKALAR = [   // [görünen ad, adlar, kart markaları, kalem adlarında geçebilecek diğer adlar] (sade, sözcük)
  ["Garanti BBVA", ["garanti bbva", "garanti bankasi", "garanti"], ["bonus card", "bonus kart", "bonus kredi karti"], ["bonus"]],
  ["Yapı Kredi", ["yapi kredi", "yapikredi", "yapi ve kredi"], ["worldcard", "world card", "world kart"], ["ykb", "world"]],
  ["Akbank", ["akbank"], ["axess"], ["wings"]],
  ["İş Bankası", ["is bankasi", "isbank"], ["maximiles", "maximum kart", "maximum card"], ["is bank", "maximum"]],
  ["Ziraat Bankası", ["ziraat"], ["bankkart"], []],
  ["Halkbank", ["halkbank", "halk bankasi"], ["paraf"], []],
  ["VakıfBank", ["vakifbank", "vakif bank", "vakiflar bankasi"], [], ["vakif"]],
  ["QNB", ["qnb", "finansbank"], ["cardfinans"], ["finans"]],
  ["DenizBank", ["denizbank"], [], ["deniz"]],
  ["TEB", ["teb", "turk ekonomi bankasi"], [], []],
  ["ING", ["ing bank", "ing"], [], []],
  ["Enpara", ["enpara"], [], []],
  ["Kuveyt Türk", ["kuveyt turk"], ["saglam kart"], []],
  ["Türkiye Finans", ["turkiye finans"], ["happy card"], []],
  ["Şekerbank", ["sekerbank"], [], []],
  ["Odeabank", ["odeabank"], [], []],
  ["Fibabanka", ["fibabanka"], [], []],
  ["HSBC", ["hsbc"], ["advantage kart", "advantage card"], ["advantage"]],
  ["Albaraka", ["albaraka"], [], []],
  ["Burgan Bank", ["burgan"], [], []],
];

/** Ayırt edici sayılmayan sözcükler ('Garanti kart' ile 'Garanti B. K.K' bankadan eşleşir). */
export const GENEL_SOZCUKLER = new Set(["kart", "karti", "card", "kk", "odeme", "odemesi", "odemeleri", "taksit", "taksiti",
  "fatura", "faturasi", "ekstre", "asgari", "borc", "borcu", "aylik", "miles", "bank", "banka", "bankasi"]);

/** adBenzer sonuçlarının güç sırası (küçük daha kesin). */
export const DERECE = { ad: 0, icerir: 1, sozcuk: 2, banka: 3 };

/** Türkçe harfler sadeleşir, büyük/küçük harf farkı kalkar: 'İŞ Bankası' -> 'is bankasi' (adlar.py sade). */
export function sade(ad) {
  return String(ad ?? "").replace(/ı/g, "i").replace(/İ/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/ß/g, "ss");
}

export function adAnahtari(ad) {
  return sade(ad).replace(/[^0-9a-z]/g, "");
}

export function sozcukler(ad) {
  return sade(ad).split(/[^0-9a-z]+/).filter(Boolean);
}

export function kelimeler(ad) {
  return sozcukler(ad).filter((w) => w.length >= 2);
}

export function cekirdek(ad) {
  return kelimeler(ad).filter((w) => !GENEL_SOZCUKLER.has(w)).join("");
}

function ustSinir(a, b) {
  const kalan = new Map();
  for (const c of b) kalan.set(c, (kalan.get(c) || 0) + 1);
  let ortak = 0;
  for (const c of a) {
    const n = kalan.get(c) || 0;
    if (n > 0) {
      kalan.set(c, n - 1);
      ortak++;
    }
  }
  return a.length + b.length ? (2 * ortak) / (a.length + b.length) : 1;
}

/** Python difflib.SequenceMatcher(None, a, b).ratio() ile aynı (junk yok; 200+ karakterde 'autojunk' kuralı dahil). */
export function oran(a0, b0) {
  const a = Array.from(String(a0)), b = Array.from(String(b0));
  const la = a.length, lb = b.length;
  if (!la && !lb) return 1;
  const b2j = new Map();
  b.forEach((c, j) => {
    if (!b2j.has(c)) b2j.set(c, []);
    b2j.get(c).push(j);
  });
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [c, l] of [...b2j]) if (l.length > ntest) b2j.delete(c);
  }
  const enUzun = (alo, ahi, blo, bhi) => {
    let bi = alo, bj = blo, bk = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const yeni = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        yeni.set(j, k);
        if (k > bk) {
          bi = i - k + 1;
          bj = j - k + 1;
          bk = k;
        }
      }
      j2len = yeni;
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) {
      bi--;
      bj--;
      bk++;
    }
    while (bi + bk < ahi && bj + bk < bhi && a[bi + bk] === b[bj + bk]) bk++;
    return [bi, bj, bk];
  };
  let m = 0;
  const kuyruk = [[0, la, 0, lb]];
  while (kuyruk.length) {
    const [alo, ahi, blo, bhi] = kuyruk.pop();
    const [i, j, k] = enUzun(alo, ahi, blo, bhi);
    if (!k) continue;
    m += k;
    if (alo < i && blo < j) kuyruk.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) kuyruk.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * m) / (la + lb);
}

function yakin(a, b) {
  if (!a || !b || (2 * Math.min(a.length, b.length)) / (a.length + b.length) < BENZERLIK || ustSinir(a, b) < BENZERLIK) return false;
  return oran(a, b) >= BENZERLIK;
}

const bankaOnbellek = new Map();

/** Adın andığı bankalar (Set): banka adı ya da kart markası; yoksa harf hatalı banka adı ('Kuvety Turk' -> Kuveyt Türk). */
export function bankaAdlari(ad) {
  const anahtar = String(ad ?? "");
  if (bankaOnbellek.has(anahtar)) return bankaOnbellek.get(anahtar);
  const w = sozcukler(anahtar);
  const out = new Set();
  if (w.length) {
    const metin = ` ${w.join(" ")} `;
    for (const [b, adlar, markalar] of BANKALAR) if ([...adlar, ...markalar].some((a) => metin.includes(` ${a} `))) out.add(b);
    if (!out.size) {
      for (const [b, adlar] of BANKALAR) {
        let bulundu = false;
        for (const a of adlar) {
          const hedef = a.replace(/ /g, ""), n = a.split(" ").length;
          if (hedef.length < 6) continue;
          for (const k of [n - 1, n, n + 1]) {
            if (k < 1) continue;
            for (let i = 0; i + k <= w.length && !bulundu; i++) if (yakin(w.slice(i, i + k).join(""), hedef)) bulundu = true;
          }
          if (bulundu) break;
        }
        if (bulundu) out.add(b);
      }
    }
  }
  if (bankaOnbellek.size > 8192) bankaOnbellek.clear();
  bankaOnbellek.set(anahtar, out);
  return out;
}

/** İki ad farklı bankaları anıyor ('Halkbank K.K' / 'Akbank K.K'): aynı ödeme olamaz (adlar.py farkli_banka). */
export function farkliBanka(a, b) {
  const ba = bankaAdlari(a), bb = bankaAdlari(b);
  return ba.size > 0 && bb.size > 0 && ![...ba].some((x) => bb.has(x));
}

/** İki kalem adı aynı ödemeyi mi anlatıyor: 'ad' | 'icerir' | 'sozcuk' | 'banka' | '' (adlar.py ad_benzer). */
export function adBenzer(a, b) {
  const ka = adAnahtari(a), kb = adAnahtari(b);
  if (!ka || !kb) return "";
  if (farkliBanka(a, b)) return "";
  const ba = bankaAdlari(a), bb = bankaAdlari(b);
  if (ka === kb || (Math.min(ka.length, kb.length) >= 5 && yakin(ka, kb))) return "ad";
  const [kisa, uzun] = kb.length < ka.length ? [kb, ka] : [ka, kb];
  if (kisa.length >= 5 && uzun.includes(kisa)) return "icerir";
  const wa = new Set(kelimeler(a)), wb = new Set(kelimeler(b));
  if (wa.size && wb.size && ([...wa].every((x) => wb.has(x)) || [...wb].every((x) => wa.has(x)))) return "sozcuk";
  const ca = cekirdek(a), cb = cekirdek(b);
  if (ca && cb && (ca === cb || (Math.min(ca.length, cb.length) >= 4 && (ca.includes(cb) || cb.includes(ca)))
    || (Math.min(ca.length, cb.length) >= 5 && yakin(ca, cb)))) return "sozcuk";
  if (ba.size && bb.size) return "banka";
  return "";
}

/** adaylar [[ad, kategori]] arasında `ad` ile aynı ödemeyi anlatan (adlar.py benzer_ad_bul). Yoksa null. */
export function benzerAdBul(ad, kategori, adaylar) {
  const k = adAnahtari(ad);
  if (!k) return null;
  let en = null, enPuan = null;
  const kucuk = (x, y) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
  for (const [i, [a, kat]] of (adaylar || []).entries()) {
    if (adAnahtari(a) === k) return a;
    const b = adBenzer(ad, a);
    if (!b || b === "banka" || (b === "sozcuk" && kat !== kategori)) continue;
    const puan = [DERECE[b], b === "ad" ? -oran(k, adAnahtari(a)) : 0, kat === kategori ? 0 : 1, i];
    if (enPuan === null || kucuk(puan, enPuan)) {
      en = a;
      enPuan = puan;
    }
  }
  return en;
}
