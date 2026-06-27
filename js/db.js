// db.js – Client-side storage helpers using chrome.storage.local
"use strict";

const DB = {
  async getAllProducts() {
    const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
    return trackedProducts;
  },

  async saveProduct(product) {
    const products = await this.getAllProducts();
    const exists = products.find((p) => p.url === product.url);
    if (exists) {
      return { success: false, error: "This product is already being tracked.", existing: exists };
    }
    const newProduct = {
      id: `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...product,
      addedAt: new Date().toISOString(),
      lastChecked: null,
      lastPrice: product.price,
      alerted: false,
      alertedAt: null,
    };
    await chrome.storage.local.set({ trackedProducts: [...products, newProduct] });
    return { success: true, product: newProduct };
  },

  async updateProduct(id, updates) {
    const products = await this.getAllProducts();
    const updated = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
    await chrome.storage.local.set({ trackedProducts: updated });
    return { success: true };
  },

  async removeProduct(id) {
    const products = await this.getAllProducts();
    const filtered = products.filter((p) => p.id !== id);
    await chrome.storage.local.set({ trackedProducts: filtered });
    await chrome.storage.local.remove(`history_${id}`);
    return { success: true };
  },

  async getHistory(productId) {
    const key = `history_${productId}`;
    const { [key]: history = [] } = await chrome.storage.local.get(key);
    return history;
  },

  async addHistoryEntry(productId, price) {
    const key = `history_${productId}`;
    const { [key]: existing = [] } = await chrome.storage.local.get(key);
    const entry = { price, timestamp: new Date().toISOString() };
    const updated = [...existing, entry].slice(-720);
    await chrome.storage.local.set({ [key]: updated });
    return entry;
  },

  async exportData() {
    const products = await this.getAllProducts();
    const exportObj = {
      exportedAt: new Date().toISOString(),
      version: "1.1",
      products: [],
    };
    for (const p of products) {
      const history = await this.getHistory(p.id);
      exportObj.products.push({ ...p, priceHistory: history });
    }
    return exportObj;
  },
};

window.DB = DB;
