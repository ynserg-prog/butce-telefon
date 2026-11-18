// Bankadan indirilen hesap dökümü ve kredi kartı ekstresi okuma (CSV, Excel .xlsx / .xls, HTML/XML tablo, PDF metni).
// Ekran (DOM) kullanmaz: telefonda ve testlerde (node) aynı kod çalışır. PDF'in metnini app.js pdf.js ile çıkarır,
// satır ve sütunlara ayırma burada yapılır. Dosyalar güvenilmeyen veridir: boyut sınırları vardır, hiçbir içerik
// çalıştırılmaz (formüllerin yalnızca kayıtlı sonucu okunur, makrolar okunmaz).

export const EN_BUYUK_DOSYA = 25 * 1024 * 1024;
const EN_BUYUK_ACIK = 80 * 1024 * 1024;      // sıkıştırılmış dosyanın açılmış hali (zip bombasına karşı)
const EN_COK_SATIR = 20000;

// ------------------------------------------------------------------------------------------ metin yardımcıları
/** Türkçe harfleri ve büyük/küçük harfi eşitler: 'MİGROS', 'MIGROS', 'migros' -> 'migros'; 'Şok' -> 'sok'. */
export function sade(x) {
  return String(x ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
}

export function metinCoz(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    try {
      return new TextDecoder("windows-1254").decode(bytes);   // bankalar sık sık Windows-Türkçe kodlama kullanır
    } catch {
      return new TextDecoder("latin1").decode(bytes);
    }
  }
}

const VARLIK = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function varlikCoz(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === "#") {
      const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return VARLIK[k.toLowerCase()] ?? m;
  });
}

function nitelikler(s) {
  const o = {};
  for (const m of String(s).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) o[m[1]] = varlikCoz(m[2] ?? m[3] ?? m[4] ?? "");
  return o;
}

// ------------------------------------------------------------------------------------------ inflate (RFC 1951)
const UZ_TABAN = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const UZ_BIT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const UZK_TABAN = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const UZK_BIT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const KL_SIRA = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function agac(uzunluklar, n) {
  const t = new Uint16Array(16), s = new Uint16Array(n);
  for (let i = 0; i < n; i++) t[uzunluklar[i]]++;
  t[0] = 0;
  const off = new Uint16Array(16);
  for (let i = 1, top = 0; i < 16; i++) {
    off[i] = top;
    top += t[i];
  }
  for (let i = 0; i < n; i++) if (uzunluklar[i]) s[off[uzunluklar[i]]++] = i;
  return { t, s };
}

let SABIT = null;
function sabitAgaclar() {
  if (!SABIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    SABIT = [agac(l, 288), agac(new Uint8Array(30).fill(5), 30)];
  }
  return SABIT;
}

/** Ham deflate verisini açar (zip içindeki dosyalar). beklenen: biliniyorsa açılmış boyut. */
export function inflateRaw(src, beklenen = 0) {
  let pos = 0, tag = 0, bitSay = 0;
  let out = new Uint8Array(Math.max(1024, beklenen || src.length * 4)), n = 0;
  const yer = (k) => {
    if (n + k <= out.length) return;
    let yeni = out.length * 2;
    while (yeni < n + k) yeni *= 2;
    if (yeni > EN_BUYUK_ACIK * 2) throw new Error("Dosyanın içi çok büyük.");
    const o = new Uint8Array(yeni);
    o.set(out.subarray(0, n));
    out = o;
  };
  const bit = () => {
    if (!bitSay) {
      if (pos >= src.length) throw new Error("Sıkıştırılmış veri eksik.");
      tag = src[pos++];
      bitSay = 8;
    }
    const b = tag & 1;
    tag >>>= 1;
    bitSay--;
    return b;
  };
  const bitler = (k, taban = 0) => {
    let v = 0;
    for (let i = 0; i < k; i++) v |= bit() << i;
    return v + taban;
  };
  const sembol = (a) => {
    let top = 0, cur = 0, uz = 0;
    do {
      cur = 2 * cur + bit();
      if (++uz > 15) throw new Error("Sıkıştırılmış veri bozuk.");
      top += a.t[uz];
      cur -= a.t[uz];
    } while (cur >= 0);
    return a.s[top + cur];
  };
  const blok = (lt, dt) => {
    for (;;) {
      let s = sembol(lt);
      if (s === 256) return;
      if (s < 256) {
        yer(1);
        out[n++] = s;
        continue;
      }
      s -= 257;
      if (s >= 29) throw new Error("Sıkıştırılmış veri bozuk.");
      const uz = bitler(UZ_BIT[s], UZ_TABAN[s]);
      const d = sembol(dt);
      if (d >= 30) throw new Error("Sıkıştırılmış veri bozuk.");
      const uzk = bitler(UZK_BIT[d], UZK_TABAN[d]);
      if (uzk > n) throw new Error("Sıkıştırılmış veri bozuk.");
      yer(uz);
      for (let i = 0; i < uz; i++, n++) out[n] = out[n - uzk];
    }
  };
  let son;
  do {
    son = bit();
    const tip = bitler(2);
    if (tip === 0) {
      bitSay = 0;
      if (pos + 4 > src.length) throw new Error("Sıkıştırılmış veri eksik.");
      const uz = src[pos] | (src[pos + 1] << 8);
      const nuz = src[pos + 2] | (src[pos + 3] << 8);
      if (uz !== (~nuz & 0xffff)) throw new Error("Sıkıştırılmış veri bozuk.");
      pos += 4;
      if (pos + uz > src.length) throw new Error("Sıkıştırılmış veri eksik.");
      yer(uz);
      out.set(src.subarray(pos, pos + uz), n);
      n += uz;
      pos += uz;
    } else if (tip === 1) {
      const [lt, dt] = sabitAgaclar();
      blok(lt, dt);
    } else if (tip === 2) {
      const hlit = bitler(5, 257), hdist = bitler(5, 1), hclen = bitler(4, 4);
      const kl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) kl[KL_SIRA[i]] = bitler(3);
      const kla = agac(kl, 19);
      const uzl = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const s = sembol(kla);
        if (s < 16) uzl[i++] = s;
        else {
          let tekrar, deger = 0;
          if (s === 16) {
            if (!i) throw new Error("Sıkıştırılmış veri bozuk.");
            deger = uzl[i - 1];
            tekrar = bitler(2, 3);
          } else if (s === 17) tekrar = bitler(3, 3);
          else tekrar = bitler(7, 11);
          if (i + tekrar > hlit + hdist) throw new Error("Sıkıştırılmış veri bozuk.");
          uzl.fill(deger, i, i + tekrar);
          i += tekrar;
        }
      }
      blok(agac(uzl.subarray(0, hlit), hlit), agac(uzl.subarray(hlit), hdist));
    } else {
      throw new Error("Sıkıştırılmış veri bozuk.");
    }
  } while (!son);
  return out.subarray(0, n);
}

// ------------------------------------------------------------------------------------------ zip
export function zipAc(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error("Excel dosyası (zip) okunamadı.");
  const adet = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dosyalar = {};
  let toplam = 0;
  for (let k = 0; k < adet; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("Excel dosyası (zip) bozuk.");
    const yontem = dv.getUint16(p + 10, true);
    const boy = dv.getUint32(p + 20, true), acik = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const yerel = dv.getUint32(p + 42, true);
    const ad = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (ad.endsWith("/")) continue;
    toplam += acik;
    if (toplam > EN_BUYUK_ACIK) throw new Error("Dosyanın içi çok büyük.");
    dosyalar[ad] = () => {
      if (dv.getUint32(yerel, true) !== 0x04034b50) throw new Error("Excel dosyası (zip) bozuk.");
      const bas = yerel + 30 + dv.getUint16(yerel + 26, true) + dv.getUint16(yerel + 28, true);
      const veri = b.subarray(bas, bas + boy);
      if (yontem === 0) return veri;
      if (yontem === 8) return inflateRaw(veri, acik);
      throw new Error("Excel dosyasında desteklenmeyen sıkıştırma.");
    };
  }
  return dosyalar;
}

// ------------------------------------------------------------------------------------------ tarih ve sayı
const AY_ADLARI = { oca: 1, sub: 2, mar: 3, nis: 4, may: 5, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
  jan: 1, feb: 2, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function iso(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function excelTarihi(seri, ms1904 = false) {
  const gun = Math.floor(Number(seri)) + (ms1904 ? 1462 : 0);
  if (!(gun > 20000 && gun < 80000)) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + gun * 86400000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** '15.10.2026', '15/10/2026 14:32', '2026-10-15', '15 Ekim 2026', '15.10.26'; yıl yoksa (15.10) varsayilanYil. */
export function tarihOku(x, varsayilanYil = null) {
  if (x === null || x === undefined || x === "") return null;
  if (typeof x === "number") return excelTarihi(x);
  const s = String(x).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[\sT])/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:$|[\s,;])/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s.-]+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\.?[\s.-]*(\d{4})?(?:$|[\s,;])/);
  if (m) {
    const a = AY_ADLARI[sade(m[2]).slice(0, 3)];
    const y = m[3] ? +m[3] : varsayilanYil;
    if (a && y) return iso(y, a, +m[1]);
  }
  if (varsayilanYil) {
    m = s.match(/^(\d{1,2})[./](\d{1,2})(?:$|\s)/);
    if (m) return iso(varsayilanYil, +m[2], +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelTarihi(Number(s));
  return null;
}

const SAYI_RE = /^[+-]?\(?[+-]?(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,4})?\)?-?$/;

/** '1.234,56', '-1.234,56 TL', '1.234,56-', '(1.234,56)', '1,234.56', 1234.56 -> sayı; okunamazsa null. */
export function tutarOku(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  let s = String(x).replace(/ /g, " ").replace(/\s*(TL|TRY|₺|YTL)\s*/gi, "").trim();
  if (!s) return null;
  if (!SAYI_RE.test(s)) return null;
  const eksi = /^-|^\(|-$/.test(s) || /^\+?\(?-/.test(s);
  s = s.replace(/[()+\-\s]/g, "");
  const v = s.lastIndexOf(","), n = s.lastIndexOf(".");
  if (v >= 0 && n >= 0) s = v > n ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (v >= 0) s = (s.match(/,/g).length > 1) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (n >= 0 && (s.match(/\./g).length > 1 || /^\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, "");
  const r = Number(s);
  if (!Number.isFinite(r)) return null;
  return eksi ? -r : r;
}

// ------------------------------------------------------------------------------------------ CSV
function csvAyir(metin, ayrac) {
  const satirlar = [];
  let satir = [], hucre = "", tirnak = false;
  for (let i = 0; i < metin.length; i++) {
    const c = metin[i];
    if (tirnak) {
      if (c === '"') {
        if (metin[i + 1] === '"') {
          hucre += '"';
          i++;
        } else tirnak = false;
      } else hucre += c;
    } else if (c === '"' && !hucre.trim()) {
      tirnak = true;
      hucre = "";
    } else if (c === ayrac) {
      satir.push(hucre);
      hucre = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && metin[i + 1] === "\n") i++;
      satir.push(hucre);
      satirlar.push(satir);
      if (satirlar.length > EN_COK_SATIR) break;
      satir = [];
      hucre = "";
    } else hucre += c;
  }
  if (hucre || satir.length) {
    satir.push(hucre);
    satirlar.push(satir);
  }
  return satirlar.map((r) => r.map((h) => h.trim()));
}

export function csvOku(metin) {
  const ornek = metin.slice(0, 8000);
  let enIyi = [";", 0];
  for (const a of [";", "\t", ",", "|"]) {
    const sayilar = csvAyir(ornek, a).filter((r) => r.length > 1).map((r) => r.length);
    if (!sayilar.length) continue;
    const sik = {};
    for (const x of sayilar) sik[x] = (sik[x] || 0) + 1;
    const [genislik, adet] = Object.entries(sik).sort((x, y) => y[1] - x[1])[0];
    const puan = adet * Math.min(Number(genislik), 12);
    if (puan > enIyi[1]) enIyi = [a, puan];
  }
  return csvAyir(metin, enIyi[0]);
}

// ------------------------------------------------------------------------------------------ HTML ve XML tablolar
/** Bankaların '.xls' diye verdiği HTML tablolar ve Excel 2003 XML (SpreadsheetML). Her tablo bir sayfa. */
export function htmlTablolar(metin) {
  const temiz = (h) => varlikCoz(h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (/<Workbook[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(metin) || /<ss:Workbook/i.test(metin)) {
    const sayfalar = [];
    for (const ws of metin.matchAll(/<(?:ss:)?Worksheet\b[\s\S]*?<\/(?:ss:)?Worksheet>/gi)) {
      const rows = [];
      for (const r of ws[0].matchAll(/<(?:ss:)?Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)) {
        const row = [];
        for (const c of (r[1] || "").matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
          const n = nitelikler(c[1]);
          const idx = Number(n["ss:Index"] || n.Index || 0);
          while (idx && row.length < idx - 1) row.push("");
          const d = (c[2] || "").match(/<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/i);
          if (!d) {
            row.push("");
            continue;
          }
          const tip = nitelikler(d[1])["ss:Type"] || "String";
          const v = temiz(d[2]);
          row.push(tip === "Number" ? Number(v) : tip === "DateTime" ? v.slice(0, 10) : v);
        }
        rows.push(row);
        if (rows.length > EN_COK_SATIR) break;
      }
      sayfalar.push(rows);
    }
    return sayfalar;
  }
  const sayfalar = [];
  const govde = metin.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  for (const t of govde.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const r of t[0].matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>)/gi)) {
      const row = [];
      for (const c of r[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
        row.push(temiz(c[3].replace(/<\/t[dh]>[\s\S]*$/i, "")));
        const span = Math.min(20, Number(nitelikler(c[2]).colspan || 1));
        for (let i = 1; i < span; i++) row.push("");
      }
      if (row.length) rows.push(row);
      if (rows.length > EN_COK_SATIR) break;
    }
    if (rows.length) sayfalar.push(rows);
  }
  return sayfalar;
}

// ------------------------------------------------------------------------------------------ xlsx
const TARIH_BICIMLERI = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function tarihBicimiMi(kod) {
  const k = String(kod || "").replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "").toLowerCase();
  if (!k || k.includes("general")) return false;
  return /[dy]/.test(k) || (/m/.test(k) && !/[hs0#]/.test(k));
}

function sutunNo(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const c of m[1]) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

export function xlsxTablolar(bytes) {
  const z = zipAc(bytes);
  const oku = (ad) => (z[ad] ? new TextDecoder().decode(z[ad]()) : "");
  const paylasilan = [];
  for (const si of oku("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parcalar = [...si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => varlikCoz(m[1]));
    paylasilan.push(parcalar.join(""));
  }
  const stil = oku("xl/styles.xml");
  const ozel = {};
  for (const m of stil.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const n = nitelikler(m[1]);
    ozel[Number(n.numFmtId)] = n.formatCode;
  }
  const tarihStil = [];
  const xfs = (stil.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [""])[0];
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(nitelikler(m[1]).numFmtId || 0);
    tarihStil.push(TARIH_BICIMLERI.has(id) || (id >= 164 && tarihBicimiMi(ozel[id])));
  }
  const ms1904 = /date1904="(1|true)"/.test(oku("xl/workbook.xml"));
  const iliskiler = {};
  for (const m of oku("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const n = nitelikler(m[1]);
    iliskiler[n.Id] = n.Target;
  }
  const yollar = [];
  for (const m of oku("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const n = nitelikler(m[1]);
    let t = iliskiler[n["r:id"]] || "";
    if (!t) continue;
    t = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    yollar.push(t);
  }
  if (!yollar.length) yollar.push(...Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort());
  const sayfalar = [];
  for (const y of yollar) {
    const xml = oku(y);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const no = Number(nitelikler(r[1]).r || rows.length + 1) - 1;
      if (no > EN_COK_SATIR) break;
      while (rows.length < no) rows.push([]);
      const row = [];
      for (const c of (r[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const n = nitelikler(c[1]);
        const k = sutunNo(n.r);
        const col = k >= 0 ? k : row.length;
        if (col > 200) continue;
        const ic = c[2] || "";
        const v = (ic.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let deger = "";
        if (n.t === "s") deger = paylasilan[Number(v)] ?? "";
        else if (n.t === "inlineStr") deger = [...ic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => varlikCoz(m[1])).join("");
        else if (n.t === "str" || n.t === "e") deger = varlikCoz(v ?? "");
        else if (n.t === "b") deger = v === "1" ? "DOĞRU" : "YANLIŞ";
        else if (v !== undefined && v !== "") {
          const x = Number(v);
          deger = tarihStil[Number(n.s || 0)] ? (excelTarihi(x, ms1904) ?? x) : x;
        }
        while (row.length < col) row.push("");
        row[col] = deger;
      }
      rows[no] = row;
    }
    sayfalar.push(rows);
  }
  return sayfalar;
}

// ------------------------------------------------------------------------------------------ xls (BIFF8 / BIFF5)
function cfbAkis(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ss = 1 << dv.getUint16(0x1e, true), mss = 1 << dv.getUint16(0x20, true);
  if (ss !== 512 && ss !== 4096) throw new Error("Excel dosyası (xls) bozuk.");
  const sektor = (n) => b.subarray((n + 1) * ss, (n + 2) * ss);
  const fatSektorleri = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(0x4c + i * 4, true);
    if (s >= 0xfffffffa) break;
    fatSektorleri.push(s);
  }
  let difat = dv.getUint32(0x44, true), guvenlik = 0;
  while (difat < 0xfffffffa && guvenlik++ < 1000) {
    const d = sektor(difat), ddv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let i = 0; i < ss / 4 - 1; i++) {
      const s = ddv.getUint32(i * 4, true);
      if (s < 0xfffffffa) fatSektorleri.push(s);
    }
    difat = ddv.getUint32(ss - 4, true);
  }
  const fat = [];
  for (const s of fatSektorleri) {
    const d = sektor(s), ddv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let i = 0; i < ss / 4; i++) fat.push(ddv.getUint32(i * 4, true));
  }
  const zincir = (ilk, tablo, oku, boy) => {
    const parcalar = [];
    let s = ilk, say = 0;
    while (s < 0xfffffffa && say++ < 2000000) {
      if (s >= tablo.length && tablo !== null) break;
      parcalar.push(oku(s));
      s = tablo[s];
    }
    const out = new Uint8Array(parcalar.reduce((t, p) => t + p.length, 0));
    let o = 0;
    for (const p of parcalar) {
      out.set(p, o);
      o += p.length;
    }
    return boy !== undefined ? out.subarray(0, boy) : out;
  };
  const dizin = zincir(dv.getUint32(0x30, true), fat, sektor);
  const ddv = new DataView(dizin.buffer, dizin.byteOffset, dizin.byteLength);
  const girdiler = [];
  for (let o = 0; o + 128 <= dizin.length; o += 128) {
    const nl = ddv.getUint16(o + 64, true);
    const ad = new TextDecoder("utf-16le").decode(dizin.subarray(o, o + Math.max(0, nl - 2)));
    girdiler.push({ ad, tip: dizin[o + 66], bas: ddv.getUint32(o + 116, true), boy: ddv.getUint32(o + 120, true) });
  }
  const kok = girdiler.find((g) => g.tip === 5);
  const kesim = dv.getUint32(0x38, true) || 4096;
  return (ad) => {
    const g = girdiler.find((x) => x.tip === 2 && x.ad.toLowerCase() === ad.toLowerCase());
    if (!g) return null;
    if (g.boy > EN_BUYUK_ACIK) throw new Error("Dosyanın içi çok büyük.");
    if (g.boy >= kesim || !kok) return zincir(g.bas, fat, sektor, g.boy);
    const mini = zincir(kok.bas, fat, sektor, kok.boy);
    const mfat = [];
    const mf = zincir(dv.getUint32(0x3c, true), fat, sektor);
    const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    for (let i = 0; i + 4 <= mf.length; i += 4) mfat.push(mdv.getUint32(i, true));
    return zincir(g.bas, mfat, (n) => mini.subarray(n * mss, (n + 1) * mss), g.boy);
  };
}

function rkCoz(v) {
  let x;
  if (v & 2) x = v >> 2;
  else {
    const d = new DataView(new ArrayBuffer(8));
    d.setUint32(4, v & 0xfffffffc, true);
    x = d.getFloat64(0, true);
  }
  return v & 1 ? x / 100 : x;
}

export function xlsTablolar(bytes) {
  const akis = cfbAkis(bytes);
  const wb = akis("Workbook") || akis("Book");
  if (!wb) throw new Error("Excel dosyasında çalışma kitabı bulunamadı.");
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  let biff8 = true, kodSayfasi = "windows-1254", ms1904 = false;
  const sst = [], bicimler = {}, xfBicim = [], sayfalar = [];
  let rows = null, formulDizgi = null;
  const dec = (u8) => {
    try {
      return new TextDecoder(kodSayfasi).decode(u8);
    } catch {
      return new TextDecoder("latin1").decode(u8);
    }
  };
  // BIFF8 dizgisi (XLUnicodeString): karakter sayısı, seçenek baytı, karakterler
  const dizgi8 = (p, uzBayt = 2) => {
    const cch = uzBayt === 2 ? dv.getUint16(p, true) : wb[p];
    p += uzBayt;
    const f = wb[p++];
    let s = "";
    let rt = 0, ext = 0;
    if (f & 8) {
      rt = dv.getUint16(p, true);
      p += 2;
    }
    if (f & 4) {
      ext = dv.getUint32(p, true);
      p += 4;
    }
    if (f & 1) {
      s = new TextDecoder("utf-16le").decode(wb.subarray(p, p + cch * 2));
      p += cch * 2;
    } else {
      s = new TextDecoder("latin1").decode(wb.subarray(p, p + cch));
      p += cch;
    }
    return [s, p + rt * 4 + ext];
  };
  const dizgi5 = (p, uzBayt = 2) => {
    const cch = uzBayt === 2 ? dv.getUint16(p, true) : wb[p];
    return dec(wb.subarray(p + uzBayt, p + uzBayt + cch));
  };
  const hucre = (r, c, xf, deger) => {
    if (!rows || r > EN_COK_SATIR || c > 200) return;
    while (rows.length <= r) rows.push([]);
    const row = rows[r];
    while (row.length < c) row.push("");
    if (typeof deger === "number") {
      const bi = xfBicim[xf];
      if (bi !== undefined && (TARIH_BICIMLERI.has(bi) || (bi >= 164 && tarihBicimiMi(bicimler[bi])))) {
        deger = excelTarihi(deger, ms1904) ?? deger;
      }
    }
    row[c] = deger;
  };
  // SST: dizgiler CONTINUE kayıtlarına bölünebilir; her CONTINUE'da karakterlerin devamı yeni bir seçenek baytıyla başlar
  const sstOku = (parcalar) => {
    let pi = 0, p = parcalar[0][0];
    const sinir = () => parcalar[pi][1];
    const bayt = () => {
      if (p >= sinir()) {
        pi++;
        if (pi >= parcalar.length) throw new Error("SST");
        p = parcalar[pi][0];
      }
      return wb[p++];
    };
    const u16 = () => bayt() | (bayt() << 8);
    const u32 = () => (u16() | (u16() << 16)) >>> 0;
    u32();
    const essiz = u32();
    for (let i = 0; i < essiz && i < 2000000; i++) {
      if (p >= sinir() && pi + 1 >= parcalar.length) break;
      let cch = u16();
      let f = bayt();
      const rt = f & 8 ? u16() : 0;
      const ext = f & 4 ? u32() : 0;
      let s = "";
      while (cch > 0) {
        if (p >= sinir()) {
          pi++;
          if (pi >= parcalar.length) break;
          p = parcalar[pi][0];
          f = wb[p++];
        }
        const genis = f & 1;
        const kalanBayt = sinir() - p;
        const n = Math.min(cch, genis ? Math.floor(kalanBayt / 2) : kalanBayt);
        if (n <= 0) {
          p = sinir();
          continue;
        }
        s += genis ? new TextDecoder("utf-16le").decode(wb.subarray(p, p + n * 2)) : new TextDecoder("latin1").decode(wb.subarray(p, p + n));
        p += genis ? n * 2 : n;
        cch -= n;
      }
      for (let k = 0; k < rt * 4 + ext; k++) bayt();
      sst.push(s);
    }
  };
  let p = 0, sstParca = null;
  while (p + 4 <= wb.length) {
    const tip = dv.getUint16(p, true), uz = dv.getUint16(p + 2, true);
    const d = p + 4;
    if (d + uz > wb.length) break;
    if (sstParca && tip !== 0x003c) {
      try {
        sstOku(sstParca);
      } catch { /* bozuk SST: okunabilen dizgilerle devam */ }
      sstParca = null;
    }
    switch (tip) {
      case 0x0809: {     // BOF
        biff8 = dv.getUint16(d, true) === 0x0600;
        const tur = dv.getUint16(d + 2, true);
        if (tur === 0x0010) {
          rows = [];
          sayfalar.push(rows);
        }
        break;
      }
      case 0x000a: rows = null; break;      // EOF
      case 0x0042: {
        const cp = dv.getUint16(d, true);
        kodSayfasi = { 1254: "windows-1254", 1252: "windows-1252", 1200: "utf-16le", 28599: "iso-8859-9", 65001: "utf-8" }[cp] || "windows-1254";
        break;
      }
      case 0x0022: ms1904 = dv.getUint16(d, true) === 1; break;
      case 0x041e:      // FORMAT
        bicimler[dv.getUint16(d, true)] = biff8 ? dizgi8(d + 2)[0] : dizgi5(d + 2, 1);
        break;
      case 0x00e0: xfBicim.push(dv.getUint16(d + 2, true)); break;      // XF
      case 0x00fc: sstParca = [[d, d + uz]]; break;
      case 0x003c: if (sstParca) sstParca.push([d, d + uz]); break;
      case 0x00fd: hucre(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getUint16(d + 4, true), sst[dv.getUint32(d + 6, true)] ?? ""); break;
      case 0x0204: hucre(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getUint16(d + 4, true), biff8 ? dizgi8(d + 6)[0] : dizgi5(d + 6)); break;
      case 0x00d6: hucre(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getUint16(d + 4, true), biff8 ? dizgi8(d + 6)[0] : dizgi5(d + 6)); break;
      case 0x0203: hucre(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getUint16(d + 4, true), dv.getFloat64(d + 6, true)); break;
      case 0x027e: hucre(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getUint16(d + 4, true), rkCoz(dv.getInt32(d + 6, true))); break;
      case 0x00bd: {     // MULRK
        const r = dv.getUint16(d, true), c0 = dv.getUint16(d + 2, true);
        const adet = (uz - 6) / 6;
        for (let i = 0; i < adet; i++) hucre(r, c0 + i, dv.getUint16(d + 4 + i * 6, true), rkCoz(dv.getInt32(d + 6 + i * 6, true)));
        break;
      }
      case 0x0006: {     // FORMULA: yalnızca kayıtlı sonuç
        const r = dv.getUint16(d, true), c = dv.getUint16(d + 2, true), xf = dv.getUint16(d + 4, true);
        if (dv.getUint16(d + 12, true) === 0xffff) {
          if (wb[d + 6] === 0) formulDizgi = [r, c, xf];
          else if (wb[d + 6] === 1) hucre(r, c, xf, wb[d + 8] ? "DOĞRU" : "YANLIŞ");
        } else hucre(r, c, xf, dv.getFloat64(d + 6, true));
        break;
      }
      case 0x0207:       // STRING (formül sonucu)
        if (formulDizgi) {
          hucre(...formulDizgi, biff8 ? dizgi8(d)[0] : dizgi5(d));
          formulDizgi = null;
        }
        break;
      default: break;
    }
    p = d + uz;
  }
  return sayfalar;
}

// ------------------------------------------------------------------------------------------ başlık bulma
const ALAN = {
  tarih: ["tarih", "islem tarihi", "date", "tarih saat", "islem tarihi saati", "islem tarih", "harcama tarihi",
    "hareket tarihi", "transaction date", "islem zamani"],
  valor: ["valor", "valor tarihi"],
  aciklama: ["aciklama", "islem aciklamasi", "description", "islem", "isyeri", "isyeri adi", "aciklama isyeri",
    "detay", "islem detayi", "hareket aciklamasi", "islem adi", "uye isyeri", "harcama aciklamasi", "islem turu",
    "aciklamalar", "merchant", "karsi taraf"],
  tutar: ["tutar", "islem tutari", "amount", "harcama tutari", "islem tutari tl", "tl tutar", "tutar tl"],
  bakiye: ["bakiye", "balance", "kalan bakiye", "islem sonrasi bakiye", "bakiye tl", "guncel bakiye"],
  borc: ["borc", "borc tutari", "cikan", "giden", "harcama", "cekilen"],
  alacak: ["alacak", "alacak tutari", "giren", "gelen", "yatan", "yatirilan"],
  diger: ["bonus", "puan", "maxipuan", "chip para", "parafpara", "worldpuan", "taksit", "kur", "doviz", "doviz tutari",
    "fis no", "dekont no", "kanal", "referans", "saat", "kart no", "mil", "milpuan"],
};

function basliknorm(h) {
  return sade(h).replace(/\((tl|try|₺)\)|\btl\b|\btry\b|₺/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function alanBul(h) {
  const b = basliknorm(h);
  if (!b || b.length > 40) return null;
  for (const [k, adlar] of Object.entries(ALAN)) if (adlar.includes(b)) return k;
  return null;
}

/** Tablo satırlarında başlığı bulur: {satir, sutun: {tarih, aciklama, tutar, bakiye, borc, alacak}} ya da null. */
export function baslikBul(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const s = {};
    (rows[i] || []).forEach((h, j) => {
      if (typeof h !== "string") return;
      const a = alanBul(h);
      if (a && s[a] === undefined) s[a] = j;
    });
    if (s.tarih === undefined && s.valor !== undefined) s.tarih = s.valor;
    if (s.tarih !== undefined && (s.tutar !== undefined || s.borc !== undefined || s.alacak !== undefined)) return { satir: i, sutun: s };
  }
  return null;
}

function belgeYili(degerler) {
  const yillar = {};
  for (const v of degerler) {
    const t = typeof v === "string" ? v.match(/\b\d{1,2}[./-]\d{1,2}[./-](20\d{2})\b/) : null;
    if (t) yillar[t[1]] = (yillar[t[1]] || 0) + 1;
  }
  const e = Object.entries(yillar).sort((a, b) => b[1] - a[1])[0];
  return e ? Number(e[0]) : null;
}

/** Tablodan hareketler: [{tarih, aciklama, tutar (işaretli), bakiye}] */
export function tablodanSatirlar(rows) {
  const b = baslikBul(rows);
  if (!b) return null;
  const s = b.sutun;
  const yil = belgeYili(rows.slice(0, 200).flat());
  const out = [];
  for (const r of rows.slice(b.satir + 1)) {
    if (!r || !r.length) continue;
    const tarih = tarihOku(r[s.tarih], yil);
    if (!tarih) continue;
    let tutar;
    if (s.tutar !== undefined) tutar = tutarOku(r[s.tutar]);
    else {
      const bo = s.borc !== undefined ? tutarOku(r[s.borc]) : null, al = s.alacak !== undefined ? tutarOku(r[s.alacak]) : null;
      tutar = bo === null && al === null ? null : Math.abs(al || 0) - Math.abs(bo || 0);
      if (tutar === 0) continue;
    }
    if (tutar === null || tutar === 0) continue;
    let aciklama = s.aciklama !== undefined ? String(r[s.aciklama] ?? "") : "";
    if (!aciklama.trim()) {
      aciklama = r.filter((x, j) => typeof x === "string" && j !== s.tarih && x.trim() && tutarOku(x) === null && !tarihOku(x)).join(" ");
    }
    aciklama = aciklama.replace(/\s+/g, " ").trim();
    if (ATLA_SATIR.test(sade(aciklama))) continue;      // devir, toplam, dönem borcu satırları
    out.push({ tarih, aciklama, tutar,
      bakiye: s.bakiye !== undefined ? tutarOku(r[s.bakiye]) : null });
  }
  return { satirlar: out, bakiyeVar: s.bakiye !== undefined };
}

// ------------------------------------------------------------------------------------------ PDF metni
/**
 * pdf.js'in getTextContent() çıktısından satırlar. sayfalar: [[{str, x, y, w, h}]] (x, y sol alt köşe, PDF birimi).
 * Aynı yükseklikteki parçalar bir satır olur; aralarında boşluk az olan parçalar bir hücre.
 */
export function pdfSatirlari(sayfalar) {
  const satirlar = [];
  for (const parcalar of sayfalar) {
    const ps = parcalar.filter((p) => p.str && p.str.trim()).map((p) => ({ ...p, h: Math.abs(p.h) || 8 }));
    ps.sort((a, b) => b.y - a.y || a.x - b.x);
    const gruplar = [];
    for (const p of ps) {
      const g = gruplar.find((x) => Math.abs(x.y - p.y) <= Math.max(2, Math.min(x.h, p.h) * 0.45));
      if (g) g.p.push(p);
      else gruplar.push({ y: p.y, h: p.h, p: [p] });
    }
    gruplar.sort((a, b) => b.y - a.y);
    for (const g of gruplar) {
      g.p.sort((a, b) => a.x - b.x);
      const hucreler = [];
      for (const p of g.p) {
        const son = hucreler[hucreler.length - 1];
        const bosluk = son ? p.x - son.x2 : Infinity;
        if (son && bosluk < Math.max(1.5, p.h * 0.6)) {
          son.metin += (bosluk > p.h * 0.15 && !/\s$/.test(son.metin) ? " " : "") + p.str;
          son.x2 = Math.max(son.x2, p.x + (p.w || 0));
        } else hucreler.push({ x: p.x, x2: p.x + (p.w || p.str.length * p.h * 0.5), metin: p.str });
      }
      for (const h of hucreler) h.metin = h.metin.replace(/\s+/g, " ").trim();
      satirlar.push(hucreler.filter((h) => h.metin));
    }
  }
  return satirlar;
}

const TARIH_BAS = /^(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,}\.?(?:\s+\d{4})?)(?=$|\s)/;
// Türkçe biçim (1.234,56); İngilizce biçim yalnızca binlik ayraçlıysa (1,234.56): '16.10' gibi yılsız tarihler tutar sanılmasın
const TUTAR_IC = /(?:^|\s)([+-]?\(?[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?-?(?:\s?(?:TL|TRY|₺))?|[+-]?\(?[+-]?\d{1,3}(?:,\d{3})+\.\d{2}\)?-?(?:\s?(?:TL|TRY|₺))?)(?=$|\s)/g;
const ATLA_SATIR = /^(toplam|ara toplam|genel toplam|donem borcu|onceki donem|devreden|devir|asgari|son odeme|hesap kesim|kalan|onceki bakiye|bakiye)\b/;

/** PDF satırlarından hareketler: başlık satırı bulunursa sütun konumlarıyla, bulunmazsa satırdaki ilk tutarla. */
export function pdfdenHareketler(satirlar) {
  const tum = satirlar.flat().map((h) => h.metin);
  const yil = belgeYili(tum) || new Date().getFullYear();
  let sutunlar = null;
  const out = [];
  let onceki = null;
  for (const satir of satirlar) {
    if (!satir.length) continue;
    // başlık satırı: hücre adlarından sütun aralıkları
    const alanlar = satir.map((h) => ({ a: alanBul(h.metin), h }));
    const tarihV = alanlar.some((x) => x.a === "tarih" || x.a === "valor");
    const tutarV = alanlar.some((x) => ["tutar", "borc", "alacak"].includes(x.a));
    if (tarihV && tutarV) {
      sutunlar = alanlar.filter((x) => x.a).map((x) => ({ a: x.a, orta: (x.h.x + x.h.x2) / 2, x: x.h.x, x2: x.h.x2 }));
      onceki = null;
      continue;
    }
    const ilk = satir[0].metin;
    const tm = ilk.match(TARIH_BAS);
    const tarih = tm ? tarihOku(tm[1], yil) : null;
    if (!tarih) {
      // açıklamanın alt satıra taşan devamı
      if (onceki && satir.length <= 2 && !satir.some((h) => [...` ${h.metin}`.matchAll(TUTAR_IC)].length) && satir[0].x >= onceki.aciklamaX - 4
          && onceki.aciklama.length < 120 && !TARIH_BAS.test(ilk)) {
        onceki.aciklama = `${onceki.aciklama} ${satir.map((h) => h.metin).join(" ")}`.trim();
      }
      continue;
    }
    // hücreleri parçalara ayır: tarih, metin, tutarlar
    const parcalar = [];
    satir.forEach((h, i) => {
      let m = h.metin;
      if (i === 0) m = m.slice(tm[0].length).trim();
      if (!m) return;
      const tutarlar = [...` ${m}`.matchAll(TUTAR_IC)];
      if (!tutarlar.length) {
        parcalar.push({ tip: "metin", metin: m, x: h.x, x2: h.x2 });
        return;
      }
      let kalan = ` ${m}`;
      for (const t of tutarlar) kalan = kalan.replace(t[1], " ");
      kalan = kalan.trim();
      if (kalan && !/^(TL|TRY|₺)$/i.test(kalan)) parcalar.push({ tip: "metin", metin: kalan, x: h.x, x2: h.x2 });
      const genislik = (h.x2 - h.x) / Math.max(1, m.length);
      for (const t of tutarlar) {
        const bas = m.indexOf(t[1].trim());
        const x = h.x + Math.max(0, bas) * genislik, x2 = x + t[1].trim().length * genislik;
        parcalar.push({ tip: "tutar", deger: tutarOku(t[1]), x: tutarlar.length === 1 && !kalan ? h.x : x, x2: tutarlar.length === 1 && !kalan ? h.x2 : x2 });
      }
    });
    const metinler = parcalar.filter((p) => p.tip === "metin" && !TARIH_BAS.test(p.metin) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(p.metin));
    const tutarlar = parcalar.filter((p) => p.tip === "tutar" && p.deger !== null);
    if (!tutarlar.length) continue;
    let tutar = null, bakiye = null;
    if (sutunlar) {
      const bul = (p) => {
        let en = null, d = Infinity;
        for (const s of sutunlar) {
          const o = (p.x + p.x2) / 2;
          const uz = o >= s.x - 2 && o <= s.x2 + 2 ? 0 : Math.min(Math.abs(o - s.orta), Math.abs(p.x2 - s.x2), Math.abs(p.x - s.x));
          if (uz < d) {
            d = uz;
            en = s.a;
          }
        }
        return en;
      };
      let bo = null, al = null;
      for (const p of tutarlar) {
        const a = bul(p);
        if (a === "tutar" && tutar === null) tutar = p.deger;
        else if (a === "bakiye" && bakiye === null) bakiye = p.deger;
        else if (a === "borc" && bo === null) bo = p.deger;
        else if (a === "alacak" && al === null) al = p.deger;
      }
      if (tutar === null && (bo !== null || al !== null)) tutar = Math.abs(al || 0) - Math.abs(bo || 0);
      if (tutar === null) {     // sütun eşleşmedi: açıklamadan sonraki ilk tutar
        const ilkT = tutarlar.find((p) => !["bakiye"].includes(bul(p)));
        tutar = ilkT ? ilkT.deger : null;
      }
    } else {
      tutar = tutarlar[0].deger;
      if (tutarlar.length >= 2) bakiye = tutarlar[tutarlar.length - 1].deger;
    }
    if (tutar === null || tutar === 0) continue;
    const aciklama = metinler.map((p) => p.metin).join(" ").replace(/\s+/g, " ").trim();
    if (ATLA_SATIR.test(sade(aciklama))) continue;
    onceki = { tarih, aciklama, tutar, bakiye, aciklamaX: metinler.length ? metinler[0].x : satir[0].x };
    out.push(onceki);
  }
  return { satirlar: out.map(({ aciklamaX, ...x }) => x), bakiyeVar: out.some((x) => x.bakiye !== null), sutunlu: !!sutunlar };
}

// ------------------------------------------------------------------------------------------ dosya türü ve okuma
export function bicimBul(bytes, ad = "") {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  const bas = metinCoz(bytes.subarray(0, 4000)).toLowerCase();
  if (/<table|<html|<\?xml|<workbook|<ss:workbook/.test(bas)) return "html";
  if (/\.pdf$/i.test(ad)) return "pdf";
  return "csv";
}

/**
 * Dosyadan ham hareketler. PDF için `pdfMetni(bytes)` verilmeli (app.js pdf.js ile çıkarır):
 * sayfalar -> [[{str, x, y, w, h}]]. Dönen: {bicim, satirlar, bakiyeVar, metin (tür tahmini için)}.
 */
export async function ekstreOku(bytes, ad = "", pdfMetni = null) {
  if (bytes.length > EN_BUYUK_DOSYA) throw new Error("Dosya çok büyük (en çok 25 MB).");
  const bicim = bicimBul(bytes, ad);
  let sayfalar, metin = "";
  if (bicim === "pdf") {
    if (!pdfMetni) throw new Error("PDF okuyucu yüklenemedi.");
    const ps = await pdfMetni(bytes);
    const sat = pdfSatirlari(ps);
    metin = sat.slice(0, 120).map((s) => s.map((h) => h.metin).join(" ")).join("\n");
    const r = pdfdenHareketler(sat);
    if (!r.satirlar.length) {
      throw new Error(ps.every((p) => !p.length) ? "PDF'te metin yok (taranmış görüntü olabilir); bankanın Excel ya da PDF ekstresini deneyin."
        : "PDF'te tarih ve tutar içeren hareket satırı bulunamadı.");
    }
    return { bicim, ...r, metin };
  }
  if (bicim === "xlsx") sayfalar = xlsxTablolar(bytes);
  else if (bicim === "xls") sayfalar = xlsTablolar(bytes);
  else if (bicim === "html") sayfalar = htmlTablolar(metinCoz(bytes));
  else sayfalar = [csvOku(metinCoz(bytes))];
  let enIyi = null;
  for (const rows of sayfalar) {
    const r = tablodanSatirlar(rows);
    if (r && (!enIyi || r.satirlar.length > enIyi.satirlar.length)) {
      enIyi = r;
      metin = rows.slice(0, 40).map((x) => (x || []).join(" ")).join("\n");
    }
  }
  if (!enIyi) throw new Error("Dosyada 'Tarih' ve 'Tutar' (ya da 'Borç' / 'Alacak') sütunlu bir tablo bulunamadı.");
  if (!enIyi.satirlar.length) throw new Error("Tabloda tarihli hareket satırı bulunamadı.");
  return { bicim, ...enIyi, metin };
}

/** Kredi kartı ekstresi mi, hesap dökümü mü (kullanıcı değiştirebilir). */
export function kartMi(metin, ad, satirlar, bakiyeVar) {
  const m = sade(`${ad} ${metin}`);
  let puan = 0;
  for (const k of ["kredi karti", "kart numarasi", "kart no", "son odeme tarihi", "donem borcu", "asgari odeme", "hesap kesim",
    "ekstre", "kart limiti", "kullanilabilir limit", "bonus", "maxipuan", "worldpuan", "taksit"]) if (m.includes(k)) puan++;
  for (const k of ["hesap hareketleri", "hesap dokumu", "hesap ozeti", "iban", "vadesiz", "musteri no", "sube"]) if (m.includes(k)) puan--;
  if (bakiyeVar) puan -= 2;
  const eksi = satirlar.filter((s) => s.tutar < 0).length;
  if (!bakiyeVar && satirlar.length && eksi / satirlar.length < 0.2) puan += 1;    // ekstrede harcamalar işaretsiz
  return puan > 0;
}

// ------------------------------------------------------------------------------------------ kategori tahmini
export const VARSAYILAN_KURALLAR = {   // masaüstündeki categories.kurallar() ile aynı (test denetler); paket kendi kurallarını taşır
  gider: [
    [["mali müşavir", "mali musavir", "mali müş", "müşavir", "musavir", "muhasebe", "smmm",
      "defter tutma"], "Mali müşavir ve muhasebe"],
    [["avukat", "hukuk", "noter", "arabulucu"], "Hukuk ve noter"],
    [["kart aidat", "kartı aidat", "kart ücreti", "kartı ücreti", "hesap işletim", "işletim ücret", "komisyon",
      "eft ücret", "havale ücret", "fast ücret", "banka masraf"], "Banka masraf ve komisyonları"],
    [["muhsgk", "muhtasar", "kdv", "geçici vergi", "gelir vergisi", "damga vergisi", "emlak vergisi", "mtv", "vergi",
      "beyanname"], "Vergiler"],
    [["sgk", "bağ-kur", "bağkur", "ssk", "sosyal güvenlik"], "SGK ve Bağ-Kur primleri"],
    [["kasko", "sigorta", "dask", "poliçe"], "Sigortalar"],
    [["okul", "okulu", "üniversite", "kreş", "anaokul", "kolej", "eğitim ücret"], "Okul ücretleri"],
    [["spor salon", "fitness", "gym", "pilates", "yoga", "macfit"], "Spor ve fitness"],
    [["spor", "hapkido", "cimnastik", "jimnastik", "yüzme", "futbol", "basketbol", "voleybol", "bale", "dans",
      "satranç", "izci"], "Çocuk aktiviteleri"],
    [["kurs", "kursu", "özel ders", "online ders", "dershane", "etüt", "ders ücret"], "Kurs ve özel ders"],
    [["terapi", "psikolog", "pisikolog", "psikiyatr", "pedagog"], "Terapi ve psikolojik destek"],
    [["veteriner", "mama", "petshop", "pet shop"], "Evcil hayvan"],
    [["eczane", "ilaç", "ilacı"], "İlaç ve eczane"],
    [["doktor", "hastane", "klinik", "diş hekim", "dişçi", "diş tedavi", "diş klinik", "ortodont", "implant",
      "tahlil", "laboratuvar", "göz", "gözlük", "optik", "sağlık"], "Doktor ve hastane"],
    [["k.k", "kredi kart", "card", "bonus", "miles", "troy", "world", "axess", "maximum", "paraf", "kk ödeme",
      "kart ödeme"], "Kredi kartı ödemeleri"],
    [["borç kapatma", "boç kapatma", "borç ödeme", "elden borç"], "Kişisel borç ödemesi"],
    [["kredi", "avans", "kmh", "taksit", "enpara", "yapılandırma"], "Kredi taksitleri"],
    [["harç", "harcı", "ceza", "cezası", "tapu"], "Harç ve cezalar"],
    [["yardımcı", "temizlik", "bakıcı", "dadı", "ütü"], "Ev yardımcısı ve temizlik"],
    [["aidat", "site yönetim", "yönetim gider", "apartman"], "Aidat ve site giderleri"],
    [["kira", "kirası"], "Kira"],
    [["tamir", "tesisat", "elektrikçi", "kombi", "çilingir", "onarım", "boya badana"], "Ev bakım ve onarım"],
    [["parke", "seramik", "tezgah", "çelik", "bahçe", "kamera", "osb", "jcb", "ardiye", "inşaat", "tadilat", "boya",
      "çit", "duvar", "plaka", "malzeme", "yapı market", "koçtaş"], "Ev yapım ve tadilat"],
    [["mobilya", "beyaz eşya", "ikea", "halı", "perde", "ev eşya"], "Ev eşyası ve mobilya"],
    [["internet", "telefon", "gsm", "turkcell", "vodafone", "türk telekom", "superonline", "turknet",
      "fiber"], "İnternet ve telefon"],
    [["elektrik", "doğalgaz", "su fatura", "iski", "aski", "igdaş", "başkentgaz", "enerjisa",
      "fatura"], "Elektrik, su, doğalgaz"],
    [["abonelik", "netflix", "spotify", "youtube", "disney", "amazon prime", "icloud", "google one", "blutv", "exxen",
      "digiturk"], "Dijital abonelikler"],
    [["market", "migros", "a101", "bim", "şok", "carrefour", "manav", "kasap", "gıda", "fırın",
      "macrocenter"], "Market ve gıda"],
    [["restoran", "restaurant", "kafe", "cafe", "kahve", "starbucks", "yemeksepeti", "lokanta", "pizza", "burger",
      "döner", "yemek"], "Restoran ve kafe"],
    [["akaryakıt", "benzin", "yakıt", "motorin", "mazot", "opet", "shell", "petrol ofisi", "aytemiz"], "Akaryakıt"],
    [["otopark", "hgs", "ogs", "köprü", "otoyol", "ispark"], "Otopark, köprü, otoyol"],
    [["taksi", "uber", "bitaksi", "istanbulkart", "ankarakart", "metro", "otobüs", "marmaray", "dolmuş",
      "vapur"], "Toplu taşıma ve taksi"],
    [["araba", "araç", "triger", "lastik", "servis bakım", "oto yıkama", "tüvtürk",
      "yağ değişim"], "Araç bakım ve servis"],
    [["tatil", "otel", "uçak", "thy", "pegasus", "seyahat", "booking", "airbnb", "pansiyon"], "Tatil ve seyahat"],
    [["sinema", "tiyatro", "konser", "biletix", "passo", "oyun", "steam", "playstation", "hobi",
      "müze"], "Eğlence ve hobi"],
    [["giyim", "ayakkabı", "lcw", "koton", "zara", "defacto", "boyner", "kıyafet"], "Giyim ve ayakkabı"],
    [["kuaför", "berber", "kozmetik", "gratis", "watsons", "rossmann", "parfüm", "manikür"], "Kişisel bakım"],
    [["kırtasiye", "kitap", "kitapyurdu", "defter"], "Kırtasiye ve kitap"],
    [["hediye", "bağış", "düğün", "doğum günü"], "Hediye ve bağış"],
    [["yatırım", "altın alım", "hisse alım", "fon alım", "birikim"], "Yatırıma aktarılan"],
    [["nakit", "atm", "para çekme"], "Nakit harcamalar"],
  ],
  gelir: [
    [["maaş", "maas", "ücret", "ucret", "salary", "payroll"], "Maaş"],
    [["danışman", "danisman", "consult"], "Danışmanlık"],
    [["kira"], "Kira geliri"],
    [["prim", "ikramiye", "bonus ödeme"], "Prim / ikramiye"],
    [["faiz", "temettü", "temettu", "getiri", "kar payı", "kâr payı", "fon satış", "fon satis"], "Yatırım geliri"],
  ],
  bankalar: [
    "akbank", "denizbank", "enpara", "fibabanka", "garanti", "halkbank", "ing", "iş bankası", "işbank",
    "kuveyt türk", "odeabank", "qnb", "teb", "vakıfbank", "yapı kredi", "yapıkredi", "ziraat"
  ],
  aktarim: [
    "virman", "hesaplar arası", "hesaplar arasi", "kendi hesab", "hesabıma", "hesabima", "kendi adına",
    "vadeliye aktarım", "vadesize aktarım", "birikim hesab"
  ],
  kart_atla: ["ödeme", "odeme", "payment", "iade", "tahsilat"],
};

const kuralOnbellek = new WeakMap();
function hazirKurallar(k) {
  const kk = k || VARSAYILAN_KURALLAR;
  if (kuralOnbellek.has(kk)) return kuralOnbellek.get(kk);
  const es = (anahtar) => {
    const a = sade(anahtar);
    // kısa sözcükler (bim, şok, diş, kira) yalnızca tam sözcük olarak: 'sokak' market değildir
    if (/^[a-z0-9]{1,4}$/.test(a)) {
      const re = new RegExp(`(^|[^a-z0-9])${a}($|[^a-z0-9])`);
      return (m) => re.test(m);
    }
    return (m) => m.includes(a);
  };
  const h = {
    gider: (kk.gider || []).map(([ks, c]) => [ks.map(es), c]),
    gelir: (kk.gelir || []).map(([ks, c]) => [ks.map(es), c]),
    bankalar: new Set((kk.bankalar || []).map(sade)),
    aktarim: (kk.aktarim || []).map(es),
    kartAtla: (kk.kart_atla || []).map(es),
  };
  kuralOnbellek.set(kk, h);
  return h;
}

/** Kart harcamasındaki taksit bilgisi ('2/6 TAKSİT') kategori tahmininde kredi taksiti sanılmasın. */
export function taksitsiz(aciklama) {
  return sade(aciklama).replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ").replace(/\btaksit\w*/g, " ").replace(/\s+/g, " ").trim();
}

/** Kullanıcı kuralı anahtarı (masaüstündeki categories.kalem_anahtari ile aynı): harf farkı, işaretler, taksit bilgisi
 *  ve tek başına sayılar yok sayılır: 'TEKNOSA 4521 2/6 TAKSİT' -> 'teknosa'. */
export function kalemAnahtari(kalem) {
  return taksitsiz(kalem).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !/^\d+$/.test(w)).join(" ");
}

/** Masaüstünde "Kategoriyi değiştir" ile verilmiş karar (kurallar.ozel), yoksa null. */
export function kuralKategori(kalem, kurallar = null) {
  const oz = kurallar && kurallar.ozel;
  if (!oz) return null;
  const a = kalemAnahtari(kalem);
  return (a && Object.prototype.hasOwnProperty.call(oz, a) && oz[a]) || null;
}

/** v0.11 ve öncesinin bölünen kategorileri: geçmişten öğrenilirken yeni önerilmezler. */
export const ESKI_KATEGORILER = new Set(["Konut (aidat, bakım, yardımcı)", "Faturalar", "Eğitim", "Sağlık ve terapi",
  "Ulaşım ve araç", "Sigorta, vergi, resmi", "Eğlence ve kişisel"]);

export function kategoriTahmin(kalem, tur = "gider", kurallar = null) {
  const h = hazirKurallar(kurallar);
  const m = sade(kalem);
  if (tur !== "gelir") {
    const k = kuralKategori(kalem, kurallar);
    if (k) return k;
  }
  if (tur === "gelir") {
    for (const [es, c] of h.gelir) if (es.some((f) => f(m))) return c;
    return "Diğer gelir";
  }
  if (h.bankalar.has(m)) return "Kredi taksitleri";
  for (const [es, c] of h.gider) if (es.some((f) => f(m))) return c;
  return "Diğer gider";
}

export function aktarimMi(aciklama, kurallar = null) {
  const m = sade(aciklama);
  return hazirKurallar(kurallar).aktarim.some((f) => f(m));
}

export function kartAtlaMi(aciklama, kurallar = null) {
  const m = sade(aciklama);
  return hazirKurallar(kurallar).kartAtla.some((f) => f(m));
}

// ------------------------------------------------------------------------------------------ hareketlere dönüştürme
function tarihTr(iso) {
  const [y, m, g] = iso.split("-");
  return `${g}.${m}.${y}`;
}

/** Masaüstündeki importers.ekstre_kaynagi ile aynı ad: dosya adı + tarih aralığı. */
export function kaynakAdi(kart, dosya, tarihler) {
  const t = [...tarihler].sort();
  const tip = kart ? "ekstre" : "dokum";
  return t.length ? `${tip}:${dosya} (${tarihTr(t[0])}–${tarihTr(t[t.length - 1])})` : `${tip}:${dosya}`;
}

function gunFarki(a, b) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
}

function sozcukler(x) {
  return new Set(sade(x).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)));
}

/** Geçmiş hareketlerden öğrenilen kategori: aynı ad, yoksa aynı ilk sözcük (tek kategoriyle kullanılmışsa). */
function ogrenilmis(hareketler) {
  const ad = new Map(), ilk = new Map();
  const sirali = [...hareketler].sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)));
  for (const h of sirali) {
    const tur = h.tur === "kart_detay" ? "gider" : h.tur;
    if (tur !== "gider" && tur !== "gelir") continue;
    const n = sade(taksitsiz(h.kalem));
    if (!n || ESKI_KATEGORILER.has(h.kategori)) continue;
    ad.set(`${tur}|${n}`, h.kategori);
    const w = n.split(" ")[0];
    if (w && w.length >= 4 && !/^\d+$/.test(w)) {
      const k = `${tur}|${w}`;
      const e = ilk.get(k);
      ilk.set(k, e === undefined || e === h.kategori ? h.kategori : null);
    }
  }
  return (tur, kalem) => {
    const n = sade(taksitsiz(kalem));
    return ad.get(`${tur}|${n}`) || ilk.get(`${tur}|${n.split(" ")[0]}`) || null;
  };
}

/**
 * Önizleme satırları: her biri {tarih, ay, tur, kategori, kalem, tutar, plan, sec, not, mukerrer}.
 * mevcut: telefondaki hareketler (mükerrer kontrolü ve öğrenilmiş kategoriler için).
 */
export function onizleme(ham, kart, mevcut = [], kurallar = null, bugun = null) {
  const bg = bugun || new Date().toISOString().slice(0, 10);
  const ogren = ogrenilmis(mevcut);
  // kart ekstresinde harcamaların işareti çoğunluktur; ters işaretliler ödeme/iade olabilir
  const eksi = ham.filter((s) => s.tutar < 0).length;
  const harcamaEksi = eksi > ham.length / 2;
  const out = ham.map((s) => {
    const kalem = (s.aciklama || "").slice(0, 200) || (kart ? "Kart harcaması" : s.tutar >= 0 ? "Gelen" : "Giden");
    const r = { tarih: s.tarih, ay: s.tarih.slice(0, 7), kalem, tutar: Math.round(Math.abs(s.tutar) * 100) / 100,
      plan: s.tarih > bg, sec: true, not: "", isaret: Math.sign(s.tutar) };
    if (kart) {
      r.tur = "kart_detay";
      const temiz = taksitsiz(kalem);
      r.kategori = kuralKategori(kalem, kurallar) || ogren("gider", kalem) || kategoriTahmin(temiz, "gider", kurallar);
      if (kartAtlaMi(kalem, kurallar) || (s.tutar < 0) !== harcamaEksi) {
        r.sec = false;
        r.not = "Ödeme ya da iade olabilir: harcama değil.";
      }
    } else if (aktarimMi(kalem, kurallar)) {
      r.tur = s.tutar >= 0 ? "gelir" : "gider";
      r.kategori = r.tur === "gelir" ? "Diğer gelir" : "Diğer gider";
      r.sec = false;
      r.not = "Kendi hesaplarınız arası aktarım olabilir: gelir ya da gider değil.";
    } else if (s.tutar >= 0) {
      const kredi = /kredi\s*(kullan|tahsis|odenen|yatirilan)|kullandirim/.test(sade(kalem));
      r.tur = kredi ? "borc_girisi" : "gelir";
      r.kategori = kredi ? "Kredi" : ogren("gelir", kalem) || kategoriTahmin(kalem, "gelir", kurallar);
    } else {
      r.tur = "gider";
      r.kategori = kuralKategori(kalem, kurallar) || ogren("gider", kalem) || kategoriTahmin(kalem, "gider", kurallar);
    }
    return r;
  });
  mukerrerIsaretle(out, mevcut);
  return out;
}

/** Zaten kayıtlı olabilecek satırları işaretler (seçimden çıkarır): aynı hareket daha önce içe aktarılmış ya da
 *  aynı ayda aynı türde, tutarı neredeyse aynı bir kayıt var (ör. Excel'deki 'Kira'). */
export function mukerrerIsaretle(satirlar, mevcut) {
  const kullanildi = new Set();
  const aday = (mevcut || []).filter((h) => !h.plan && ["gelir", "gider", "borc_girisi", "kart_detay"].includes(h.tur));
  for (const s of satirlar) {
    const tur = s.tur === "kart_detay" ? "kart_detay" : s.tur;
    let en = null, enPuan = 0;
    for (const h of aday) {
      if (kullanildi.has(h)) continue;
      if ((h.tur === "kart_detay") !== (tur === "kart_detay")) continue;
      if (tur !== "kart_detay" && h.tur !== tur) continue;
      const fark = Math.abs(Number(h.tutar) - s.tutar);
      if (fark > Math.max(1, s.tutar * 0.005)) continue;
      const gun = gunFarki(h.tarih, s.tarih);
      const ortak = [...sozcukler(h.kalem)].filter((w) => sozcukler(s.kalem).has(w)).length;
      const icerden = /^(dokum|ekstre):/.test(h.kaynak || "") || h.telefonda;
      let puan = 0;
      if (gun <= 3) puan += 2;
      else if (h.ay === s.ay) puan += 1;
      else continue;
      if (fark < 0.01) puan += 1;
      if (ortak) puan += 2;
      if (icerden && gun <= 1) puan += 2;
      if (puan > enPuan) {
        enPuan = puan;
        en = h;
      }
    }
    if (en && enPuan >= 2) {
      kullanildi.add(en);
      s.sec = false;
      s.mukerrer = { kalem: en.kalem, tutar: Number(en.tutar), tarih: en.tarih, kaynak: en.kaynak || "" };
      s.not = `Kayıtlı olabilir: ${en.kalem} (${tarihTr(String(en.tarih).slice(0, 10))}).`;
    }
  }
  // aynı ayın maaş/kira geliri zaten varsa (tutar farklı olsa da: kur farkı) uyarı
  for (const s of satirlar) {
    if (s.tur !== "gelir" || s.mukerrer || !s.sec) continue;
    const akis = gelirAkisi(s.kategori, s.kalem);
    if (!akis) continue;
    const e = aday.find((h) => h.tur === "gelir" && h.ay === s.ay && gelirAkisi(h.kategori, h.kalem) === akis && !kullanildi.has(h));
    if (e) {
      s.sec = false;
      s.mukerrer = { kalem: e.kalem, tutar: Number(e.tutar), tarih: e.tarih, kaynak: e.kaynak || "" };
      s.not = `Bu ayın ${AKIS_ADI[akis]} geliri kayıtlı olabilir: ${e.kalem}.`;
    }
  }
  return satirlar;
}

export const AKIS_ADI = { maas: "maaş", danismanlik: "danışmanlık", kira: "kira", prim: "prim/ikramiye" };

/** Masaüstündeki db.gelir_akisi: aynı gelirin farklı kaynaklardan gelen kayıtlarını eşleştirmek için. */
export function gelirAkisi(kategori, kalem) {
  const akis = (x) => {
    const t = sade(x);
    if (t.includes("danisman")) return "danismanlik";
    if (t.includes("maas") || t.includes("ucret") || t.includes("salary")) return "maas";
    if (t.includes("kira")) return "kira";
    if (t.includes("prim") || t.includes("ikramiye")) return "prim";
    return null;
  };
  return akis(kalem) || akis(kategori);
}

// ------------------------------------------------------------------------------------------ PDF metni (pdf.js)
/**
 * pdf.js ile sayfaların metin parçaları: [[{str, x, y, w, h}]]. pdfjs: yüklenmiş pdf.js modülü.
 * parolaIste(yanlis): parolalı PDF'te parolayı döndüren (vazgeçilirse null) işlev.
 */
export async function pdfMetniCikar(pdfjs, bytes, parolaIste = null) {
  const gorev = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true,
    useSystemFonts: false, stopAtErrors: false, enableXfa: false });
  let vazgecildi = false;
  gorev.onPassword = async (guncelle, neden) => {
    const p = parolaIste ? await parolaIste(neden === 2) : null;
    if (p === null || p === undefined) {
      vazgecildi = true;
      gorev.destroy();
    } else guncelle(p);
  };
  let doc;
  try {
    doc = await gorev.promise;
  } catch (e) {
    if (vazgecildi) {
      const h = new Error("Parola girilmedi.");
      h.vazgecildi = true;
      throw h;
    }
    throw new Error(`PDF açılamadı: ${e?.message || e}`);
  }
  const sayfalar = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
      const s = await doc.getPage(i);
      const tc = await s.getTextContent();
      sayfalar.push(tc.items.filter((it) => typeof it.str === "string").map((it) => ({ str: it.str, x: it.transform[4],
        y: it.transform[5], w: it.width, h: it.height || Math.hypot(it.transform[2], it.transform[3]) })));
      s.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return sayfalar;
}
