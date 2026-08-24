"use strict";

const ALARM_NAME               = "pricecheck";
const CHECK_INTERVAL_MINUTES   = 60;
const SIGNIFICANT_DROP_PERCENT = 5;
const MIN_PLAUSIBLE_PRICE      = 100; // pesos, filters out promo badge prices

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
  if (alarm.name === ALARM_NAME) runBackgroundPriceChecks(/* interactive */ false);
});

// Plausibility guard
function isPlausiblePriceReading(newPrice, referencePrice) {
  if (referencePrice == null) return true;
  if (newPrice >= referencePrice * 0.5) return true;
  if (newPrice < 150 && referencePrice >= 300) return false;
  return true;
}

// Shopee only reads reliably when its tab is visible — Chrome pauses
// rendering on background tabs, so the DOM never gets the price element.
// Lazada isn't affected. So Shopee switches to an active tab only for
// checks the user directly triggered (refresh button, "Check Prices
// Now"), never for the silent hourly alarm, and switches back to
// whatever tab was open right after. The automatic background check can
// still miss a Shopee update as a result — a real limitation, not a bug.
// variantOptions (the exact option labels selected when this product was
// tracked, e.g. ["grey","M"]) is forwarded to content.js so it can
// re-click those same options before reading the price, instead of
// trusting whatever variant the freshly-opened tab shows selected by
// default. variantId (Shopee's own modelid) is sent too as a secondary
// fallback for when clicking isn't possible (a hidden background tab).
// Both are ignored on Lazada, which doesn't need them — the variant is
// already baked into the product URL itself.
async function extractPriceViaTab(url, platform, interactive, variantId, variantOptions) {
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

    // retry a few times — tab can report "complete" before content.js is
    // ready, and re-clicking variant options (when useActiveTab is true)
    // takes a moment to settle, so each attempt may take a few seconds
    const RETRY_INTERVAL_MS = 1500;
    const RETRY_BUDGET_MS   = 20000;
    const retryStart = Date.now();
    let lastSeen = { price: null, variantId: null, variantLabel: null, variantOptions: null, error: null };

    while (Date.now() - retryStart < RETRY_BUDGET_MS) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action: "checkPrice", variantId, variantOptions });
        const data = resp?.data;
        if (data?.error === "not_a_product_page") break;

        // The tracked variant genuinely couldn't be found anymore (the
        // seller likely removed/renamed it, or it's out of stock) — this
        // won't change on a retry, so stop early and surface the specific
        // reason instead of burning the rest of the retry budget.
        if (data?.variantNotFound) {
          lastSeen = {
            price: null, variantId: data.variantId ?? variantId ?? null,
            variantLabel: null, variantOptions: data.variantOptions ?? variantOptions ?? null,
            error: data.error,
          };
          break;
        }

        if (data?.price != null) {
          lastSeen = {
            price: data.price,
            variantId: data.variantId ?? null,
            variantLabel: data.variantLabel ?? null,
            variantOptions: data.variantOptions ?? null,
            error: null,
          };
          if (data.price >= MIN_PLAUSIBLE_PRICE) return lastSeen;
        } else if (data?.error) {
          // No price this attempt, but a specific reason was given (e.g.
          // the variant was reselected but its price couldn't be read
          // cleanly) — keep it as the most recent explanation in case
          // every retry ends up the same way, so the user sees this
          // instead of a generic message.
          lastSeen = {
            price: null,
            variantId: data.variantId ?? variantId ?? null,
            variantLabel: null,
            variantOptions: data.variantOptions ?? variantOptions ?? null,
            error: data.error,
          };
        }
      } catch (_) {
        // listener not ready yet, next retry will catch it
      }
      await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }

    return lastSeen; // price may be null, a below-threshold reading, or a specific error
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

    const result = await extractPriceViaTab(
      product.url, platform, interactive,
      product.variantId ?? null, product.variantOptions ?? null
    );
    const currentPrice = result?.price ?? null;

    if (currentPrice == null) {
      // A specific, human-readable reason (e.g. the tracked variant was
      // removed by the seller) takes priority over the generic message.
      if (result?.error) {
        return { success: false, price: null, error: result.error };
      }
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

    // Keep the tracked variant's id/label/options in sync in storage. A
    // freshly detected id/options only fills in when the product didn't
    // already have one (e.g. items tracked before variant tracking
    // existed, or before this click-based mechanism existed) — a product
    // that already has confirmed options is never silently swapped to
    // different ones here, since checkPrice always re-selects by those
    // same options (see content.js), so a successful result simply
    // confirms what was already stored rather than replacing it.
    const storageUpdate = { lastPrice: currentPrice, lastChecked: new Date().toISOString() };
    if (product.variantId == null && result?.variantId != null) {
      storageUpdate.variantId = result.variantId;
    }
    if ((!product.variantOptions || !product.variantOptions.length) &&
        Array.isArray(result?.variantOptions) && result.variantOptions.length) {
      storageUpdate.variantOptions = result.variantOptions;
    }
    if (result?.variantLabel) {
      storageUpdate.variantLabel = result.variantLabel;
    }
    await updateProductInStorage(product.id, storageUpdate);

    return {
      success: true, price: currentPrice,
      variantLabel: result?.variantLabel ?? product.variantLabel ?? null,
      error: null,
    };
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

async function evaluateAndNotify(product, currentPrice) {
  const { id, name, platform, targetPrice, lastPrice, price: originalPrice, variantLabel } = product;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";
  const fmt = n => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  // Include the tracked variant in the notified product name — important
  // once more than one variant of the same listing can be tracked, so a
  // notification doesn't read as ambiguous about which one it's for.
  const displayName = variantLabel ? `${name} (${variantLabel})` : name;

  // reset alerted flag once price rises back above target
  if (targetPrice && currentPrice > targetPrice && product.alerted) {
    await updateProductInStorage(id, { alerted: false });
    product = { ...product, alerted: false };
  }

  // price at or below target → notify
  if (targetPrice && currentPrice <= targetPrice && !product.alerted) {
    const title   = `🎯 Target Price Reached — ${platformLabel}`;
    const message = `${displayName}\nPrice is now ${fmt(currentPrice)} — at or below your target of ${fmt(targetPrice)}!`;
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
        ? `${displayName}\nPrice dropped ${pctStr} to ${fmt(currentPrice)}. Target: ${fmt(targetPrice)}`
        : `${displayName}\nPrice dropped ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;
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
