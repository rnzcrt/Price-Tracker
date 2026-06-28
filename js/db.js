// db.js – Storage layer
// Products + prefs + notif log → chrome.storage.local (shared with service worker)
// Price history                → true IndexedDB (per-product time-series)
"use strict";

const IDB_NAME    = "PriceWatchPH";
const IDB_VERSION = 1;
const IDB_STORE   = "priceHistory";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("productId", "productId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function idbPromise(req) {
  return new Promise((res, rej) => { req.onsuccess = e => res(e.target.result); req.onerror = e => rej(e.target.error); });
}

// ─── chrome.storage.local helpers ────────────────────────────────────────────
function csGet(key) {
  return new Promise(res => chrome.storage.local.get(key, r => res(r[key] ?? null)));
}
function csSet(key, val) {
  return new Promise(res => chrome.storage.local.set({ [key]: val }, res));
}

// ─── Public API ───────────────────────────────────────────────────────────────
const DB = {

  // ── Products (chrome.storage.local) ─────────────────────────────
  async getAllProducts() {
    const raw = await csGet("pw_trackedProducts");
    return raw ? JSON.parse(raw) : [];
  },

  async saveProduct(product) {
    const products = await this.getAllProducts();
    if (products.find(p => p.url === product.url))
      return { success: false, error: "This product is already being tracked." };

    const newProduct = {
      id: `prod_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      ...product,
      addedAt: new Date().toISOString(),
      lastChecked: null, lastPrice: product.price,
      alerted: false, alertedAt: null,
    };
    await csSet("pw_trackedProducts", JSON.stringify([...products, newProduct]));
    return { success: true, product: newProduct };
  },

  async updateProduct(id, updates) {
    const products = await this.getAllProducts();
    await csSet("pw_trackedProducts", JSON.stringify(products.map(p => p.id === id ? { ...p, ...updates } : p)));
    return { success: true };
  },

  async removeProduct(id) {
    const products = await this.getAllProducts();
    await csSet("pw_trackedProducts", JSON.stringify(products.filter(p => p.id !== id)));
    await this.clearHistory(id);
    return { success: true };
  },

  // ── Price History (IndexedDB) ────────────────────────────────────
  async addHistoryEntry(productId, price) {
    const db    = await openIDB();
    const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
    const entry = { productId, price, timestamp: new Date().toISOString() };
    await idbPromise(store.add(entry));
    await this._pruneHistory(productId, 720);
    db.close();
    return entry;
  },

  async getHistory(productId) {
    const db    = await openIDB();
    const store = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE);
    const idx   = store.index("productId");
    const all   = await idbPromise(idx.getAll(productId));
    db.close();
    return all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  async clearHistory(productId) {
    const db    = await openIDB();
    const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
    const keys  = await idbPromise(store.index("productId").getAllKeys(productId));
    const s2    = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
    await Promise.all(keys.map(k => idbPromise(s2.delete(k))));
    db.close();
  },

  async _pruneHistory(productId, max) {
    const db    = await openIDB();
    const store = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE);
    const all   = await idbPromise(store.index("productId").getAll(productId));
    if (all.length <= max) { db.close(); return; }
    const sorted = all.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    const toDel  = sorted.slice(0, sorted.length - max);
    const s2     = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
    await Promise.all(toDel.map(e => idbPromise(s2.delete(e.id))));
    db.close();
  },

  // ── Export ──────────────────────────────────────────────────────
  async exportData() {
    const products = await this.getAllProducts();
    const out = { exportedAt: new Date().toISOString(), version: "2.0", products: [] };
    for (const p of products) {
      const history = await this.getHistory(p.id);
      out.products.push({ ...p, priceHistory: history });
    }
    return out;
  },

  // ── Import ──────────────────────────────────────────────────────
  async importData(jsonData) {
    const data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
    if (!data.products || !Array.isArray(data.products))
      return { success: false, error: "Invalid import file format." };

    let imported = 0, skipped = 0;
    const existing = await this.getAllProducts();

    for (const p of data.products) {
      if (existing.find(e => e.url === p.url)) { skipped++; continue; }
      const { priceHistory, ...productData } = p;
      const all = await this.getAllProducts();
      await csSet("pw_trackedProducts", JSON.stringify([...all, productData]));

      if (priceHistory?.length) {
        const db = await openIDB();
        for (const entry of priceHistory) {
          const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
          await idbPromise(store.add({ productId: p.id, price: entry.price, timestamp: entry.timestamp }));
        }
        db.close();
      }
      imported++;
    }
    return { success: true, imported, skipped };
  },
};

window.DB = DB;
