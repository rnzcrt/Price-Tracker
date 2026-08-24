"use strict";

const ALARM_NAME = "pricecheck";

const CHECK_INTERVAL_MINUTES = 60;

const SIGNIFICANT_DROP_PERCENT = 5;

const MIN_PLAUSIBLE_PRICE = 100;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
  scheduleAlarm();
});

function scheduleAlarm() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm)
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: CHECK_INTERVAL_MINUTES,
        periodInMinutes: CHECK_INTERVAL_MINUTES,
      });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runBackgroundPriceChecks(false);
});

function isPlausiblePriceReading(newPrice, referencePrice) {
  if (referencePrice == null) return true;
  if (newPrice >= referencePrice * 0.5) return true;
  if (newPrice < 150 && referencePrice >= 300) return false;
  return true;
}

async function extractPriceViaTab(
  url,
  platform,
  interactive,
  variantId,
  variantOptions,
) {
  const useActiveTab = platform === "shopee" && interactive === true;
  let previousActiveTab = null;
  if (useActiveTab)
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      previousActiveTab = activeTab || null;
    } catch (_) {}
  const tab = await chrome.tabs.create({
    url: url,
    active: useActiveTab,
  });
  try {
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 15e3);
    });
    const RETRY_INTERVAL_MS = 1500;
    const RETRY_BUDGET_MS = 2e4;
    const retryStart = Date.now();
    let lastSeen = {
      price: null,
      variantId: null,
      variantLabel: null,
      variantOptions: null,
      error: null,
    };
    while (Date.now() - retryStart < RETRY_BUDGET_MS) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, {
          action: "checkPrice",
          variantId: variantId,
          variantOptions: variantOptions,
        });
        const data = resp?.data;
        if (data?.error === "not_a_product_page") break;
        if (data?.variantNotFound) {
          lastSeen = {
            price: null,
            variantId: data.variantId ?? variantId ?? null,
            variantLabel: null,
            variantOptions: data.variantOptions ?? variantOptions ?? null,
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
        } else if (data?.error)
          lastSeen = {
            price: null,
            variantId: data.variantId ?? variantId ?? null,
            variantLabel: null,
            variantOptions: data.variantOptions ?? variantOptions ?? null,
            error: data.error,
          };
      } catch (_) {}
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
    return lastSeen;
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {}
    if (useActiveTab && previousActiveTab && previousActiveTab.id != null)
      try {
        await chrome.tabs.update(previousActiveTab.id, {
          active: true,
        });
      } catch (_) {}
  }
}

async function checkSingleProduct(product, interactive = false) {
  try {
    const platform = product.url.includes("shopee.ph")
      ? "shopee"
      : product.url.includes("lazada.com.ph")
        ? "lazada"
        : product.platform || null;
    const result = await extractPriceViaTab(
      product.url,
      platform,
      interactive,
      product.variantId ?? null,
      product.variantOptions ?? null,
    );
    const currentPrice = result?.price ?? null;
    if (currentPrice == null) {
      if (result?.error)
        return {
          success: false,
          price: null,
          error: result.error,
        };
      const hint =
        platform === "shopee" && !interactive
          ? " (automatic background checks for Shopee are best-effort — try the refresh button for a reliable read)"
          : "";
      return {
        success: false,
        price: null,
        error: `Could not read the live price right now. Please try again.${hint}`,
      };
    }
    const reference = product.lastPrice ?? product.price;
    if (!isPlausiblePriceReading(currentPrice, reference))
      return {
        success: false,
        price: null,
        error: "Got an unreliable reading — please try again.",
      };
    await addHistoryEntryIDB(product.id, currentPrice);
    await evaluateAndNotify(product, currentPrice);
    const storageUpdate = {
      lastPrice: currentPrice,
      lastChecked: new Date().toISOString(),
    };
    if (product.variantId == null && result?.variantId != null)
      storageUpdate.variantId = result.variantId;
    if (
      (!product.variantOptions || !product.variantOptions.length) &&
      Array.isArray(result?.variantOptions) &&
      result.variantOptions.length
    )
      storageUpdate.variantOptions = result.variantOptions;
    if (result?.variantLabel) storageUpdate.variantLabel = result.variantLabel;
    await updateProductInStorage(product.id, storageUpdate);
    return {
      success: true,
      price: currentPrice,
      variantLabel: result?.variantLabel ?? product.variantLabel ?? null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      price: null,
      error: err.message || "Unknown error occurred.",
    };
  }
}

async function runBackgroundPriceChecks(interactive = false) {
  const raw = await getLocalStorage("pw_trackedProducts");
  const trackedProducts = raw ? JSON.parse(raw) : [];
  if (!trackedProducts.length) return;
  for (const product of trackedProducts)
    try {
      await checkSingleProduct(product, interactive);
    } catch (err) {
      console.error(`Background check failed for ${product.name}:`, err);
    }
}

async function evaluateAndNotify(product, currentPrice) {
  const {
    id: id,
    name: name,
    platform: platform,
    targetPrice: targetPrice,
    lastPrice: lastPrice,
    price: originalPrice,
    variantLabel: variantLabel,
  } = product;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";
  const fmt = (n) =>
    `₱${Number(n).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
    })}`;
  const displayName = variantLabel ? `${name} (${variantLabel})` : name;
  if (targetPrice && currentPrice > targetPrice && product.alerted) {
    await updateProductInStorage(id, {
      alerted: false,
    });
    product = {
      ...product,
      alerted: false,
    };
  }
  if (targetPrice && currentPrice <= targetPrice && !product.alerted) {
    const title = `🎯 Target Price Reached — ${platformLabel}`;
    const message = `${displayName}\nPrice is now ${fmt(currentPrice)} — at or below your target of ${fmt(targetPrice)}!`;
    const delivered = await fireNotification(id, title, message, "target");
    if (delivered)
      await updateProductInStorage(id, {
        alerted: true,
        alertedAt: new Date().toISOString(),
      });
    return;
  }
  const reference = lastPrice ?? originalPrice;
  if (reference && currentPrice < reference) {
    const dropPct = ((reference - currentPrice) / reference) * 100;
    if (dropPct >= SIGNIFICANT_DROP_PERCENT) {
      const pctStr = dropPct.toFixed(1) + "%";
      const msg = targetPrice
        ? `${displayName}\nPrice dropped ${pctStr} to ${fmt(currentPrice)}. Target: ${fmt(targetPrice)}`
        : `${displayName}\nPrice dropped ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;
      await fireNotification(
        id,
        `📉 Price Drop — ${platformLabel}`,
        msg,
        "drop",
      );
    }
  }
}

async function fireNotification(productId, title, message, type) {
  const notifId = `pw-${productId}-${type}-${Date.now()}`;
  const permissionLevel = await new Promise((resolve) => {
    chrome.notifications.getPermissionLevel((level) => resolve(level));
  });
  if (permissionLevel !== "granted") {
    const raw = await getLocalStorage("pw_notif_log");
    const existing = raw ? JSON.parse(raw) : [];
    const updated = [
      ...existing,
      {
        id: notifId,
        productId: productId,
        title: `⚠️ ${title}`,
        message: `${message}\n(System notification blocked — check notification settings.)`,
        type: type,
        timestamp: new Date().toISOString(),
      },
    ].slice(-50);
    await setLocalStorage("pw_notif_log", JSON.stringify(updated));
    return false;
  }
  await new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: title,
        message: message,
        priority: 2,
      },
      () => resolve(),
    );
  });
  const raw = await getLocalStorage("pw_notif_log");
  const existing = raw ? JSON.parse(raw) : [];
  const updated = [
    ...existing,
    {
      id: notifId,
      productId: productId,
      title: title,
      message: message,
      type: type,
      timestamp: new Date().toISOString(),
    },
  ].slice(-50);
  await setLocalStorage("pw_notif_log", JSON.stringify(updated));
  return true;
}

const IDB_NAME = "PriceWatchPH";

const IDB_VERSION = 1;

const IDB_STORE = "priceHistory";

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("productId", "productId", {
          unique: false,
        });
        store.createIndex("timestamp", "timestamp", {
          unique: false,
        });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function addHistoryEntryIDB(productId, price) {
  const db = await openIDB();
  const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
  await new Promise((res, rej) => {
    const req = store.add({
      productId: productId,
      price: price,
      timestamp: new Date().toISOString(),
    });
    req.onsuccess = res;
    req.onerror = rej;
  });
  db.close();
}

function getLocalStorage(key) {
  return new Promise((res) => {
    chrome.storage.local.get(key, (r) => res(r[key] ?? null));
  });
}

function setLocalStorage(key, value) {
  return new Promise((res) => {
    chrome.storage.local.set(
      {
        [key]: value,
      },
      res,
    );
  });
}

async function updateProductInStorage(productId, updates) {
  const raw = await getLocalStorage("pw_trackedProducts");
  const products = raw ? JSON.parse(raw) : [];
  const updated = products.map((p) =>
    p.id === productId
      ? {
          ...p,
          ...updates,
        }
      : p,
  );
  await setLocalStorage("pw_trackedProducts", JSON.stringify(updated));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "triggerCheck") {
    runBackgroundPriceChecks(true)
      .then(() => {
        try {
          sendResponse({
            success: true,
          });
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({
            success: false,
          });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === "refreshProduct") {
    (async () => {
      try {
        const raw = await getLocalStorage("pw_trackedProducts");
        const products = raw ? JSON.parse(raw) : [];
        const product = products.find((p) => p.id === msg.productId);
        if (!product) {
          sendResponse({
            success: false,
            price: null,
            error: "Product not found.",
          });
          return;
        }
        const result = await checkSingleProduct(product, true);
        try {
          sendResponse(result);
        } catch (_) {}
      } catch (err) {
        try {
          sendResponse({
            success: false,
            price: null,
            error: err.message,
          });
        } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === "rescheduleAlarm") {
    chrome.alarms.clear(ALARM_NAME, () => scheduleAlarm());
    sendResponse({
      success: true,
    });
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => scheduleAlarm());
