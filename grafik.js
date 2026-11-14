// SVG grafikler: simülasyon yelpazesi (P10–P90 aralığı, tipik değer, toplam yatırılan) ve aylık gelir − gider farkı.
// Dokununca/üzerine gelince en yakın ayın değerleri ipucunda görünür.
import { ay, ayEkle, ayKisa, kisaTl, tl } from "./hesap.js";

const NS = "http://www.w3.org/2000/svg";

function el(ad, attrs = {}, ebeveyn) {
  const e = document.createElementNS(NS, ad);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (ebeveyn) ebeveyn.appendChild(e);
  return e;
}

function guzelAdim(aralik, hedef = 4) {
  const ham = aralik / hedef;
  const us = Math.pow(10, Math.floor(Math.log10(ham || 1)));
  const k = ham / us;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * us;
}

function eksen(min, max) {
  if (max === min) max = min + 1;
  const adim = guzelAdim(max - min);
  const lo = Math.floor(min / adim) * adim, hi = Math.ceil(max / adim) * adim;
  const out = [];
  for (let v = lo; v <= hi + adim / 2; v += adim) out.push(v);
  return { lo, hi, cizgiler: out };
}

function etiketAdimi(n, genislik) {
  const sigar = Math.max(2, Math.floor(genislik / 56));
  const adaylar = [1, 2, 3, 4, 6, 12, 24, 36, 60];
  return adaylar.find((a) => Math.ceil(n / a) <= sigar) || Math.ceil(n / sigar);
}

function ipucuKonumla(ip, kap, x, y) {
  const w = ip.offsetWidth, h = ip.offsetHeight, W = kap.clientWidth;
  let left = x + 12;
  if (left + w > W) left = x - w - 12;
  left = Math.max(0, Math.min(left, W - w));
  ip.style.left = `${left}px`;
  ip.style.top = `${Math.max(0, y - h - 8)}px`;
}

/**
 * Yelpaze grafiği. d: {ilkAy, p10[], p50[], p90[], yatirilan[] (kümülatif nominal)}
 */
export function yelpaze(kap, d) {
  kap.innerHTML = "";
  kap.classList.add("grafik");
  const W = Math.max(280, kap.clientWidth || 340), H = Math.round(Math.min(260, Math.max(200, W * 0.62)));
  const sol = 48, sag = 8, ust = 10, alt = 26;
  const n = d.p50.length;
  const tum = [...d.p10, ...d.p90, ...d.yatirilan, 0];
  const { lo, hi, cizgiler } = eksen(Math.min(...tum), Math.max(...tum));
  const x = (t) => sol + (n === 1 ? (W - sol - sag) / 2 : (t * (W - sol - sag)) / (n - 1));
  const y = (v) => ust + (1 - (v - lo) / (hi - lo)) * (H - ust - alt);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Simülasyon: ay ay tipik değer, kötü-iyi senaryo aralığı ve toplam yatırılan" }, kap);
  for (const v of cizgiler) {
    el("line", { x1: sol, x2: W - sag, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)",
      "stroke-width": 1 }, svg);
    const t = el("text", { x: sol - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, svg);
    t.textContent = kisaTl(v);
  }
  const adim = etiketAdimi(n, W - sol - sag);
  for (let t = 0; t < n; t += adim) {
    const tx = el("text", { x: x(t), y: H - 8, "text-anchor": t === 0 ? "start" : "middle", "font-size": 11,
      fill: "var(--muted)" }, svg);
    tx.textContent = ayKisa(ayEkle(d.ilkAy, t));
  }
  let alan = `M${x(0)},${y(d.p90[0])}`;
  for (let t = 1; t < n; t++) alan += `L${x(t)},${y(d.p90[t])}`;
  for (let t = n - 1; t >= 0; t--) alan += `L${x(t)},${y(d.p10[t])}`;
  el("path", { d: alan + "Z", fill: "var(--band-1)", stroke: "none" }, svg);
  const cizgi = (dizi, renk) => {
    let p = `M${x(0)},${y(dizi[0])}`;
    for (let t = 1; t < n; t++) p += `L${x(t)},${y(dizi[t])}`;
    el("path", { d: p, fill: "none", stroke: renk, "stroke-width": 2, "stroke-linejoin": "round",
      "stroke-linecap": "round" }, svg);
  };
  cizgi(d.yatirilan, "var(--series-2)");
  cizgi(d.p50, "var(--series-1)");
  // doğrudan etiket: son noktada tipik değer
  const son = el("text", { x: W - sag, y: Math.max(12, y(d.p50[n - 1]) - 8), "text-anchor": "end", "font-size": 11.5,
    "font-weight": 650, fill: "var(--ink)" }, svg);
  son.textContent = kisaTl(d.p50[n - 1]) + " TL";

  const imlec = el("line", { y1: ust, y2: H - alt, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" }, svg);
  const nokta = (renk) => el("circle", { r: 4, fill: renk, stroke: "var(--surface)", "stroke-width": 2,
    visibility: "hidden" }, svg);
  const n50 = nokta("var(--series-1)"), nY = nokta("var(--series-2)");
  const ip = document.createElement("div");
  ip.className = "ipucu gizli";
  kap.appendChild(ip);
  const goster = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = Math.max(0, Math.min(n - 1, Math.round(((px - sol) / (W - sol - sag)) * (n - 1))));
    const cx = x(t);
    imlec.setAttribute("x1", cx); imlec.setAttribute("x2", cx); imlec.setAttribute("visibility", "visible");
    n50.setAttribute("cx", cx); n50.setAttribute("cy", y(d.p50[t])); n50.setAttribute("visibility", "visible");
    nY.setAttribute("cx", cx); nY.setAttribute("cy", y(d.yatirilan[t])); nY.setAttribute("visibility", "visible");
    ip.innerHTML = `<b>${ay(ayEkle(d.ilkAy, t))} sonu</b>`
      + `<div class="s"><span>İyi senaryo (P90)</span><span>${tl(d.p90[t])}</span></div>`
      + `<div class="s"><span><i style="background:var(--series-1)"></i>Tipik (P50)</span><span>${tl(d.p50[t])}</span></div>`
      + `<div class="s"><span>Kötü senaryo (P10)</span><span>${tl(d.p10[t])}</span></div>`
      + `<div class="s"><span><i style="background:var(--series-2)"></i>Toplam yatırılan</span><span>${tl(d.yatirilan[t])}</span></div>`;
    ip.classList.remove("gizli");
    ipucuKonumla(ip, kap, (cx / W) * r.width, (y(d.p90[t]) / H) * r.height);
  };
  const gizle = () => {
    for (const e of [imlec, n50, nY]) e.setAttribute("visibility", "hidden");
    ip.classList.add("gizli");
  };
  const hedef = el("rect", { x: sol, y: 0, width: W - sol - sag, height: H, fill: "transparent" }, svg);
  hedef.addEventListener("pointermove", goster);
  hedef.addEventListener("pointerdown", goster);
  hedef.addEventListener("pointerleave", gizle);
  return svg;
}

function cubukYolu(x, w, y0, y1, r) {
  // Uç kısmı yuvarlatılmış, tabana oturan çubuk
  const yukari = y1 < y0;
  const h = Math.abs(y1 - y0);
  r = Math.min(r, h, w / 2);
  if (h < 0.5) return "";
  if (yukari) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/** Aylık gelir − gider farkı. aylar: [{ay, gelir, gider, net, plan}] */
export function netCubuk(kap, aylar) {
  kap.innerHTML = "";
  kap.classList.add("grafik");
  const W = Math.max(280, kap.clientWidth || 340), H = 190;
  const sol = 44, sag = 6, ust = 8, alt = 24;
  const n = aylar.length;
  const { lo, hi, cizgiler } = eksen(Math.min(0, ...aylar.map((a) => a.net)), Math.max(0, ...aylar.map((a) => a.net)));
  const y = (v) => ust + (1 - (v - lo) / (hi - lo)) * (H - ust - alt);
  const bant = (W - sol - sag) / n;
  const bw = Math.max(3, bant - 2);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Aylık gelir eksi gider farkı" }, kap);
  for (const v of cizgiler) {
    el("line", { x1: sol, x2: W - sag, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)",
      "stroke-width": 1 }, svg);
    const t = el("text", { x: sol - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, svg);
    t.textContent = kisaTl(v);
  }
  const ilkPlan = aylar.findIndex((a) => a.plan);
  if (ilkPlan > 0) {
    el("line", { x1: sol + ilkPlan * bant, x2: sol + ilkPlan * bant, y1: ust, y2: H - alt, stroke: "var(--axis)",
      "stroke-dasharray": "3 3" }, svg);
    const t = el("text", { x: sol + ilkPlan * bant + 4, y: ust + 10, "font-size": 11, fill: "var(--muted)" }, svg);
    t.textContent = "projeksiyon";
  }
  const adim = etiketAdimi(n, W - sol - sag);
  aylar.forEach((a, i) => {
    const x = sol + i * bant + (bant - bw) / 2;
    const p = cubukYolu(x, bw, y(0), y(a.net), 4);
    if (p) {
      el("path", { d: p, fill: a.net >= 0 ? "var(--pos)" : "var(--neg)", opacity: a.plan ? 0.5 : 1 }, svg);
    }
    if (i % adim === 0) {
      const t = el("text", { x: sol + i * bant + bant / 2, y: H - 8, "text-anchor": "middle", "font-size": 11,
        fill: "var(--muted)" }, svg);
      t.textContent = ayKisa(a.ay);
    }
  });
  const ip = document.createElement("div");
  ip.className = "ipucu gizli";
  kap.appendChild(ip);
  const vurgu = el("rect", { y: ust, height: H - ust - alt, width: bant, fill: "var(--ink)", opacity: 0.06,
    visibility: "hidden" }, svg);
  const goster = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - sol) / bant)));
    const a = aylar[i];
    vurgu.setAttribute("x", sol + i * bant);
    vurgu.setAttribute("visibility", "visible");
    ip.innerHTML = `<b>${ay(a.ay)}${a.plan ? " (projeksiyon)" : ""}</b>`
      + `<div class="s"><span>Gelir</span><span>${tl(a.gelir)}</span></div>`
      + `<div class="s"><span>Gider</span><span>${tl(a.gider)}</span></div>`
      + `<div class="s"><span>${a.net >= 0 ? "Fazla" : "Açık"}</span><span>${tl(a.net)}</span></div>`;
    ip.classList.remove("gizli");
    ipucuKonumla(ip, kap, ((sol + i * bant + bant / 2) / W) * r.width, (y(Math.max(a.net, 0)) / H) * r.height);
  };
  const hedef = el("rect", { x: sol, y: 0, width: W - sol - sag, height: H, fill: "transparent" }, svg);
  hedef.addEventListener("pointermove", goster);
  hedef.addEventListener("pointerdown", goster);
  hedef.addEventListener("pointerleave", () => {
    ip.classList.add("gizli");
    vurgu.setAttribute("visibility", "hidden");
  });
  return svg;
}
