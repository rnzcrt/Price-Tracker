// background.js – Service Worker
// Handles: periodic background price checks, notifications, alarm scheduling
"use strict";

const ALARM_NAME = "pricecheck";
const CHECK_INTERVAL_MINUTES = 60;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
  scheduleAlarm();
});

function scheduleAlarm() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: CHECK_INTERVAL_MINUTES,
        periodInMinutes: CHECK_INTERVAL_MINUTES,
      });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runBackgroundPriceChecks();
});

async function runBackgroundPriceChecks() {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  if (!trackedProducts.length) return;

  for (const product of trackedProducts) {
    if (!product.targetPrice) continue;
    try {
      const tab = await chrome.tabs.create({ url: product.url, active: false });

      await new Promise((resolve) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 15000);
      });

      await new Promise((r) => setTimeout(r, 2500));

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["js/content.js"],
      });

      const response = await chrome.tabs.sendMessage(tab.id, { action: "checkPrice" });

      if (response?.data?.price != null) {
        const currentPrice = response.data.price;
        await saveToHistory(product.id, currentPrice);
        await evaluateThreshold(product, currentPrice);
        await updateProductPrice(product.id, currentPrice);
      }

      await chrome.tabs.remove(tab.id);
    } catch (err) {
      console.error(`Background check failed for ${product.name}:`, err);
    }
  }
}

// Notify if the price reaches the user's target (either direction)
async function evaluateThreshold(product, currentPrice) {
  const { targetPrice, name, platform, alerted } = product;
  if (!targetPrice || alerted) return;

  const originalPrice = product.price;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";

  // Check if price has moved to or past the target in either direction
  const hitTarget =
    // Target was set lower than original → price dropped to or below target
    (targetPrice <= originalPrice && currentPrice <= targetPrice) ||
    // Target was set higher than original → price rose to or above target
    (targetPrice >= originalPrice && currentPrice >= targetPrice) ||
    // Target equals current price exactly
    currentPrice === targetPrice;

  if (hitTarget) {
    const priceStr = `₱${currentPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
    const targetStr = `₱${targetPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

    chrome.notifications.create(`alert-${product.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `🎯 Price Alert — ${platformLabel}`,
      message: `${name}\nPrice is now ${priceStr} — your target was ${targetStr}!`,
      priority: 2,
    });

    await markAlerted(product.id);
  }
}

async function saveToHistory(productId, price) {
  const key = `history_${productId}`;
  const { [key]: existing = [] } = await chrome.storage.local.get(key);
  const updated = [...existing, { price, timestamp: new Date().toISOString() }].slice(-720);
  await chrome.storage.local.set({ [key]: updated });
}

async function updateProductPrice(productId, newPrice) {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  const updated = trackedProducts.map((p) =>
    p.id === productId ? { ...p, lastPrice: newPrice, lastChecked: new Date().toISOString() } : p
  );
  await chrome.storage.local.set({ trackedProducts: updated });
}

async function markAlerted(productId) {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  const updated = trackedProducts.map((p) =>
    p.id === productId ? { ...p, alerted: true, alertedAt: new Date().toISOString() } : p
  );
  await chrome.storage.local.set({ trackedProducts: updated });
}

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
