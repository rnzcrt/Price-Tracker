// background.js – Service Worker
// Thesis Step 5: Threshold Comparison
// "If the current price is equal to or lower than the target → notify"
// + bonus 5% drop alert even without hitting target
"use strict";

const ALARM_NAME = "pricecheck";
const CHECK_INTERVAL_MINUTES = 60;
const SIGNIFICANT_DROP_PERCENT = 5;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => { e.waitUntil(clients.claim()); scheduleAlarm(); });

function scheduleAlarm() {
  chrome.alarms.get(ALARM_NAME, alarm => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: CHECK_INTERVAL_MINUTES,
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    });
  });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) runBackgroundPriceChecks();
});

// ─── Background Price Check Pipeline ─────────────────────────────────────────
// Runs the same 6-step pipeline for each tracked product URL
async function runBackgroundPriceChecks() {
  const raw = await getLocalStorage("pw_trackedProducts");
  const trackedProducts = raw ? JSON.parse(raw) : [];
  if (!trackedProducts.length) return;

  for (const product of trackedProducts) {
    try {
      // Step 1: Platform Detection (already in content.js) – open the URL
      const tab = await chrome.tabs.create({ url: product.url, active: false });

      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 15000);
      });

      // Wait for JS rendering
      await new Promise(r => setTimeout(r, 2500));

      // Steps 2–4: DOM parsing, raw extraction, normalization (in content.js)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["js/content.js"],
      });

      const response = await chrome.tabs.sendMessage(tab.id, { action: "checkPrice" });

      if (response?.data?.price != null) {
        const currentPrice = response.data.price;

        // Step 6: Storage – save to IndexedDB via message to active page
        await addHistoryEntryIDB(product.id, currentPrice);

        // Step 5: Threshold Comparison
        await evaluateAndNotify(product, currentPrice);

        // Update lastPrice and lastChecked in Local Storage
        await updateProductInStorage(product.id, {
          lastPrice: currentPrice,
          lastChecked: new Date().toISOString(),
        });
      }

      await chrome.tabs.remove(tab.id);
    } catch (err) {
      console.error(`Background check failed for ${product.name}:`, err);
    }
  }
}

// ─── Step 5: Threshold Comparison ────────────────────────────────────────────
// Thesis: "If current price is equal to or lower than the target → notify"
// Bonus:  Also notify on significant drop ≥5% even without hitting target
async function evaluateAndNotify(product, currentPrice) {
  const { id, name, platform, targetPrice, lastPrice, price: originalPrice } = product;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";
  const fmt = n => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  // ── Thesis Step 5: Equal to or lower than target → notify ────────
  if (targetPrice && currentPrice <= targetPrice && !product.alerted) {
    const title = `🎯 Target Price Reached — ${platformLabel}`;
    const message = `${name}\nPrice is now ${fmt(currentPrice)} — at or below your target of ${fmt(targetPrice)}!`;
    await fireNotification(id, title, message, "target");
    await updateProductInStorage(id, { alerted: true, alertedAt: new Date().toISOString() });
    return; // target hit takes priority
  }

  // ── Bonus: Significant drop alert (≥5% drop from last known price) ──
  const reference = lastPrice ?? originalPrice;
  if (reference && currentPrice < reference) {
    const dropPercent = ((reference - currentPrice) / reference) * 100;
    if (dropPercent >= SIGNIFICANT_DROP_PERCENT) {
      const pctStr = dropPercent.toFixed(1) + "%";
      const msg = targetPrice
        ? `${name}\nPrice dropped ${pctStr} to ${fmt(currentPrice)}. Target: ${fmt(targetPrice)}`
        : `${name}\nPrice dropped ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;
      await fireNotification(id, `📉 Price Drop — ${platformLabel}`, msg, "drop");
    }
  }
}

async function fireNotification(productId, title, message, type) {
  const notifId = `pw-${productId}-${type}-${Date.now()}`;
  chrome.notifications.create(notifId, {
    type: "basic", iconUrl: "icons/icon128.png",
    title, message, priority: 2,
  });
  // Log to Local Storage for popup Alerts tab
  const raw = await getLocalStorage("pw_notif_log");
  const existing = raw ? JSON.parse(raw) : [];
  const updated = [...existing, {
    id: notifId, productId, title, message, type,
    timestamp: new Date().toISOString(),
  }].slice(-50);
  await setLocalStorage("pw_notif_log", JSON.stringify(updated));
}

// ─── IndexedDB helpers (service worker context) ───────────────────────────────
const IDB_NAME    = "PriceWatchPH";
const IDB_VERSION = 1;
const IDB_STORE   = "priceHistory";

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

async function addHistoryEntryIDB(productId, price) {
  const db    = await openIDB();
  const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
  await new Promise((res, rej) => {
    const req = store.add({ productId, price, timestamp: new Date().toISOString() });
    req.onsuccess = res; req.onerror = rej;
  });
  db.close();
}

// ─── Local Storage helpers (service worker uses chrome.storage.local) ─────────
// Note: service workers can't access window.localStorage, so we use chrome.storage.local
// as the backing store; the popup reads it via its own localStorage wrapper in db.js
function getLocalStorage(key) {
  return new Promise(res => {
    chrome.storage.local.get(key, r => res(r[key] ?? null));
  });
}
function setLocalStorage(key, value) {
  return new Promise(res => {
    chrome.storage.local.set({ [key]: value }, res);
  });
}

async function updateProductInStorage(productId, updates) {
  const raw      = await getLocalStorage("pw_trackedProducts");
  const products = raw ? JSON.parse(raw) : [];
  const updated  = products.map(p => p.id === productId ? { ...p, ...updates } : p);
  await setLocalStorage("pw_trackedProducts", JSON.stringify(updated));
}

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "triggerCheck") {
    runBackgroundPriceChecks().then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === "rescheduleAlarm") {
    chrome.alarms.clear(ALARM_NAME, () => scheduleAlarm());
    sendResponse({ success: true });
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => scheduleAlarm());
