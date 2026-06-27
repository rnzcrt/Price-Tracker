// background.js – Service Worker
"use strict";

const ALARM_NAME = "pricecheck";
const CHECK_INTERVAL_MINUTES = 60;

// Notify if price drops by this % even without hitting target
const SIGNIFICANT_DROP_PERCENT = 5;   // 5% drop = notify
const SIGNIFICANT_RISE_PERCENT = 5;   // 5% rise = notify

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

async function runBackgroundPriceChecks() {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  if (!trackedProducts.length) return;

  for (const product of trackedProducts) {
    try {
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

      await new Promise(r => setTimeout(r, 2500));

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["js/content.js"],
      });

      const response = await chrome.tabs.sendMessage(tab.id, { action: "checkPrice" });

      if (response?.data?.price != null) {
        const currentPrice = response.data.price;
        await saveToHistory(product.id, currentPrice);
        await evaluateAndNotify(product, currentPrice);
        await updateProductPrice(product.id, currentPrice);
      }

      await chrome.tabs.remove(tab.id);
    } catch (err) {
      console.error(`Background check failed for ${product.name}:`, err);
    }
  }
}

// ─── Notification Logic ───────────────────────────────────────────────────────
// Fires a notification in ANY of these cases:
//   1. Price meets or beats the user's target (main alert)
//   2. Price dropped significantly (≥5%) from the last known price
//   3. Price rose significantly (≥5%) from the last known price
//   4. Price changed at all and no target was set (always notify on any change)
async function evaluateAndNotify(product, currentPrice) {
  const { name, platform, targetPrice, lastPrice, price: originalPrice } = product;
  const platformLabel = platform === "lazada" ? "Lazada PH" : "Shopee PH";

  // Reference price: use last known price if available, else original price at time of adding
  const reference = lastPrice ?? originalPrice;
  if (!reference || reference === currentPrice) return; // no change, skip

  const priceDiff = currentPrice - reference;
  const changePercent = Math.abs(priceDiff / reference) * 100;
  const dropped = priceDiff < 0;
  const rose = priceDiff > 0;

  const fmt = n => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const pctStr = changePercent.toFixed(1) + "%";

  // ── Case 1: Target price met or beaten ──────────────────────────
  if (targetPrice) {
    const hitTarget =
      (currentPrice <= targetPrice) ||   // price dropped to/below target
      (currentPrice >= targetPrice && targetPrice > originalPrice); // price rose to/above target (if target was set higher)

    if (hitTarget && !product.alerted) {
      await sendNotification(
        product.id,
        `🎯 Target Price Reached — ${platformLabel}`,
        `${name}\nPrice is now ${fmt(currentPrice)} — your target was ${fmt(targetPrice)}!`,
        "target"
      );
      await markAlerted(product.id);
      return; // target hit takes priority, don't double-notify
    }
  }

  // ── Case 2: Significant drop (even without a target, or target not yet met) ─
  if (dropped && changePercent >= SIGNIFICANT_DROP_PERCENT) {
    const msg = targetPrice
      ? `${name}\nPrice dropped ${pctStr} to ${fmt(currentPrice)} (target: ${fmt(targetPrice)})`
      : `${name}\nPrice dropped ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;

    await sendNotification(
      product.id,
      `📉 Price Drop — ${platformLabel}`,
      msg,
      "drop"
    );
    return;
  }

  // ── Case 3: Significant rise ────────────────────────────────────
  if (rose && changePercent >= SIGNIFICANT_RISE_PERCENT) {
    const msg = targetPrice
      ? `${name}\nPrice rose ${pctStr} to ${fmt(currentPrice)} (target: ${fmt(targetPrice)})`
      : `${name}\nPrice rose ${pctStr} — from ${fmt(reference)} to ${fmt(currentPrice)}`;

    await sendNotification(
      product.id,
      `📈 Price Increase — ${platformLabel}`,
      msg,
      "rise"
    );
    return;
  }

  // ── Case 4: No target set + any price change (even small) ───────
  if (!targetPrice && currentPrice !== reference) {
    const arrow = dropped ? "↓" : "↑";
    await sendNotification(
      product.id,
      `${arrow} Price Changed — ${platformLabel}`,
      `${name}\n${dropped ? "Down" : "Up"} ${pctStr}: ${fmt(reference)} → ${fmt(currentPrice)}`,
      "change"
    );
  }
}

async function sendNotification(productId, title, message, type) {
  const notifId = `pw-${productId}-${type}-${Date.now()}`;
  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 2,
  });

  // Log the notification into storage so popup can show it
  const key = "notif_log";
  const { [key]: existing = [] } = await chrome.storage.local.get(key);
  const updated = [...existing, {
    id: notifId,
    productId,
    title,
    message,
    type,
    timestamp: new Date().toISOString(),
  }].slice(-50); // keep last 50
  await chrome.storage.local.set({ [key]: updated });
}

async function saveToHistory(productId, price) {
  const key = `history_${productId}`;
  const { [key]: existing = [] } = await chrome.storage.local.get(key);
  const updated = [...existing, { price, timestamp: new Date().toISOString() }].slice(-720);
  await chrome.storage.local.set({ [key]: updated });
}

async function updateProductPrice(productId, newPrice) {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  const updated = trackedProducts.map(p =>
    p.id === productId
      ? { ...p, lastPrice: newPrice, lastChecked: new Date().toISOString() }
      : p
  );
  await chrome.storage.local.set({ trackedProducts: updated });
}

async function markAlerted(productId) {
  const { trackedProducts = [] } = await chrome.storage.local.get("trackedProducts");
  const updated = trackedProducts.map(p =>
    p.id === productId
      ? { ...p, alerted: true, alertedAt: new Date().toISOString() }
      : p
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
