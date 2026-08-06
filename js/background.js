// background.js – service worker
// Thesis Step 5: threshold comparison (target hit + bonus 5% drop alert)
"use strict";

const ALARM_NAME               = "pricecheck";
const CHECK_INTERVAL_MINUTES   = 60;
const SIGNIFICANT_DROP_PERCENT = 5;
const MIN_PLAUSIBLE_PRICE      = 100; // pesos, filters out promo badge prices

self.addEventListener("install", () => { self.skipWaiting(); });
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
  if (alarm.name === ALARM_NAME) runBackgroundPriceChecks(/* interactive */ false);
});

// Plausibility guard
function isPlausiblePriceReading(newPrice, referencePrice) {
  if (referencePrice == null) return true;
  if (newPrice >= referencePrice * 0.5) return true;
  if (newPrice < 150 && referencePrice >= 300) return false;
  return true;
}

// Shopee prices only read reliably when its tab is actually visible —
// tested this manually, fetch() itself works fine in a background tab but
// content.js's DOM read doesn't (Chrome pauses the page's rendering when
// the tab isn't in focus, so the price element never shows up).
// Lazada updates fine in the background, so this only applies to Shopee.
//
// So Shopee only switches to an active tab for checks the user directly
// triggered (refresh button, "Check Prices Now") — never for the silent
// hourly alarm. It switches back to whatever tab you were on right after.
// That means the automatic background check can sometimes miss a Shopee
// price update — a real platform limitation, noted in the paper.
async function extractPriceViaTab(url, platform, interactive, axisValues) {
  const useActiveTab = platform === "shopee" && interactive === true;

  // remember the tab so we can switch back to it after
  let previousActiveTab = null;
  if (useActiveTab) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      previousActiveTab = activeTab || null;
    } catch (_) { /* non-critical — if this fails we simply won't restore focus */ }
  }

  const tab = await chrome.tabs.create({ url, active: useActiveTab });

  try {
    // wait for the tab to finish loading (15s timeout covers slow connections)
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

    // retry a few times — tab can report "complete" before content.js is ready
    const RETRY_INTERVAL_MS = 1500;
    const RETRY_BUDGET_MS   = 12000;
    const retryStart = Date.now();
    let lastSeenPrice = null;

    while (Date.now() - retryStart < RETRY_BUDGET_MS) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action: "checkPrice", axisValues });
        const p = resp?.data?.price ?? null;
        if (resp?.data?.error === "not_a_product_page") break;
        if (p != null) {
          lastSeenPrice = p;
          if (p >= MIN_PLAUSIBLE_PRICE) return p;
        }
      } catch (_) {
        // listener not ready yet, next retry will catch it
      }
      await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }

    return lastSeenPrice; // may be null, or a below-threshold reading
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
    // switch back to whatever the user was on before
    if (useActiveTab && previousActiveTab && previousActiveTab.id != null) {
      try { await chrome.tabs.update(previousActiveTab.id, { active: true }); } catch (_) {}
    }
  }
}

// Checks one product end to end. Used by both the bulk background check
// and the popup's refresh button. interactive only matters for Shopee
// (see the note above extractPriceViaTab).
async function checkSingleProduct(product, interactive = false) {
  try {
    const platform = product.url.includes("shopee.ph") ? "shopee"
                    : product.url.includes("lazada.com.ph") ? "lazada"
                    : (product.platform || null);

    const currentPrice = await extractPriceViaTab(product.url, platform, interactive, product.axisValues || null);

    if (currentPrice == null) {
      const hint = platform === "shopee" && !interactive
        ? " (automatic background checks for Shopee are best-effort — try the refresh button for a reliable read)"
        : "";
      return {
        success: false, price: null,
        error: `Could not read the live price right now. Please try again.${hint}`,
      };
    }

    const reference = product.lastPrice ?? product.price;
    if (!isPlausiblePriceReading(currentPrice, reference)) {
      return { success: false, price: null, error: "Got an unreliable reading — please try again." };
    }

    await addHistoryEntryIDB(product.id, currentPrice);
    await evaluateAndNotify(product, currentPrice);
    await updateProductInStorage(product.id, {
      lastPrice:   currentPrice,
      lastChecked: new Date().toISOString(),
    });

    return { success: true, price: currentPrice, error: null };
  } catch (err) {
    return { success: false, price: null, error: err.message || "Unknown error occurred." };
  }
}

// Background Price Check Pipeline (bulk)
async function runBackgroundPriceChecks(interactive = false) {
  const raw = await getLocalStorage("pw_trackedProducts");
  const trackedProducts = raw ? JSON.parse(raw) : [];
  if (!trackedProducts.length) return;

  for (const product of trackedProducts) {
    try {
      await checkSingleProduct(product, interactive);
    } catch (err) {
      console.error(`Background check failed for ${product.name}:`, err);
    }
  }
}

// Step 5: Threshold Comparison
async function evaluateAndNotify(product, currentPrice) {
  const { id, name, platform, targetPrice, lastPrice, price: originalPrice } = product;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";
  const fmt = n => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  // reset alerted flag once price rises back above target
  if (targetPrice && currentPrice > targetPrice && product.alerted) {
    await updateProductInStorage(id, { alerted: false });
    product = { ...product, alerted: false };
  }

  // Thesis Step 5: price at or below target → notify
  if (targetPrice && currentPrice <= targetPrice && !product.alerted) {
    const title   = `🎯 Target Price Reached — ${platformLabel}`;
    const message = `${name}\nPrice is now ${fmt(currentPrice)} — at or below your target of ${fmt(targetPrice)}!`;
    const delivered = await fireNotification(id, title, message, "target");
    // only flag as alerted if the notification actually went through —
    // otherwise a blocked notif would silence this product forever
    if (delivered) {
      await updateProductInStorage(id, { alerted: true, alertedAt: new Date().toISOString() });
    }
    return;
  }

  // Bonus: significant drop (≥5% from last known price)
  const reference = lastPrice ?? originalPrice;
  if (reference && currentPrice < reference) {
    const dropPct = ((reference - currentPrice) / reference) * 100;
    if (dropPct >= SIGNIFICANT_DROP_PERCENT) {
      const pctStr = dropPct.toFixed(1) + "%";
      const msg = targetPrice
        ? `${name}\nPrice dropped ${pctStr} to ${fmt(currentPrice)}. Target: ${fmt(targetPrice)}`
        : `${name}\nPrice dropped ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;
      await fireNotification(id, `📉 Price Drop — ${platformLabel}`, msg, "drop");
    }
  }
}

async function fireNotification(productId, title, message, type) {
  const notifId = `pw-${productId}-${type}-${Date.now()}`;

  // create() can "succeed" even when the OS is silently blocking
  // notifications — check permission level to know for sure
  const permissionLevel = await new Promise(resolve => {
    chrome.notifications.getPermissionLevel(level => resolve(level));
  });

  if (permissionLevel !== "granted") {
    const raw      = await getLocalStorage("pw_notif_log");
    const existing = raw ? JSON.parse(raw) : [];
    const updated  = [...existing, {
      id: notifId, productId,
      title: `⚠️ ${title}`,
      message: `${message}\n(System notification blocked — check notification settings.)`,
      type,
      timestamp: new Date().toISOString(),
    }].slice(-50);
    await setLocalStorage("pw_notif_log", JSON.stringify(updated));
    return false; // no real system notification was shown
  }

  await new Promise(resolve => {
    chrome.notifications.create(
      notifId,
      { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title, message, priority: 2 },
      () => resolve()
    );
  });

  const raw      = await getLocalStorage("pw_notif_log");
  const existing = raw ? JSON.parse(raw) : [];
  const updated  = [...existing, {
    id: notifId, productId, title, message, type,
    timestamp: new Date().toISOString(),
  }].slice(-50);
  await setLocalStorage("pw_notif_log", JSON.stringify(updated));
  return true; // real system notification was created
}

// IndexedDB helpers
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

// Storage helpers
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

// Message Handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "triggerCheck") {
    // "Check Prices Now" — interactive=true so Shopee tabs get switched to.
    // returning true keeps the message channel (and the service worker)
    // alive until the whole check finishes, so notifications still fire
    // even if the popup closes right after (it usually does once a tab
    // switch happens).
    runBackgroundPriceChecks(/* interactive */ true)
      .then(() => { try { sendResponse({ success: true }); } catch (_) {} })
      .catch(() => { try { sendResponse({ success: false }); } catch (_) {} });
    return true;
  }

  if (msg.action === "refreshProduct") {
    // Refresh button on a single product — always interactive=true.
    // Runs in the service worker so it keeps going even if the popup
    // closes; sendResponse just won't reach anyone, price still gets saved.
    (async () => {
      try {
        const raw      = await getLocalStorage("pw_trackedProducts");
        const products = raw ? JSON.parse(raw) : [];
        const product  = products.find(p => p.id === msg.productId);
        if (!product) { sendResponse({ success: false, price: null, error: "Product not found." }); return; }

        const result = await checkSingleProduct(product, /* interactive */ true);
        try { sendResponse(result); } catch (_) {} // popup may already be gone — ignore
      } catch (err) {
        try { sendResponse({ success: false, price: null, error: err.message }); } catch (_) {}
      }
    })();
    return true;
  }

  if (msg.action === "rescheduleAlarm") {
    chrome.alarms.clear(ALARM_NAME, () => scheduleAlarm());
    sendResponse({ success: true });
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => scheduleAlarm());
