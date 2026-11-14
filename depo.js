// Telefonda kalıcı saklama: IndexedDB (yoksa localStorage). Veriler yalnızca bu cihazda, bu uygulamanın adresinde durur.
const DB = "butce-mobil", ST = "kv";
let dbVaad = null;

function ac() {
  if (!dbVaad) {
    dbVaad = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(ST);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) {
        rej(e);
      }
    });
  }
  return dbVaad;
}

async function islem(kip, f) {
  const db = await ac();
  return new Promise((res, rej) => {
    const tx = db.transaction(ST, kip);
    const r = f(tx.objectStore(ST));
    tx.oncomplete = () => res(r && "result" in r ? r.result : undefined);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export async function oku(k) {
  try {
    return await islem("readonly", (s) => s.get(k));
  } catch {
    try {
      const v = localStorage.getItem("butce:" + k);
      return v === null ? undefined : JSON.parse(v);
    } catch {
      return undefined;
    }
  }
}

export async function yaz(k, v) {
  try {
    await islem("readwrite", (s) => s.put(v, k));
  } catch {
    localStorage.setItem("butce:" + k, JSON.stringify(v));
  }
}

export async function sil(k) {
  try {
    await islem("readwrite", (s) => s.delete(k));
  } catch { /* yok */ }
  try {
    localStorage.removeItem("butce:" + k);
  } catch { /* yok */ }
}

/** Tarayıcıdan verileri kalıcı saklamasını ister (iPhone'da ana ekrana eklenmiş uygulamada zaten kalıcıdır). */
export async function kaliciIste() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* yok */ }
  return false;
}
