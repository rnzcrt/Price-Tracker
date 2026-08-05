// popup.js – PriceWatch PH v2.0
"use strict";

// Helpers
const $ = id => document.getElementById(id);
const fmt = n => n != null ? `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—";
const fmtShort = n => n != null ? `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";

function showToast(msg, type = "", duration = 2400) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = "toast"; }, duration);
}

// State
let currentData   = null;  // last extraction from active tab
let historyProduct = null; // product open in history panel

// Tab Navigation
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    // close history panel first, or it stays floating over the other tabs
    closeHistoryPanel(/* instant = */ true);

    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tracked") renderTrackedList();
    if (btn.dataset.tab === "alerts")  renderAlerts();
  });
});

// States
function showState(id) {
  ["state-unsupported", "state-loading", "state-error", "state-product"]
    .forEach(s => $(s).style.display = s === id ? "" : "none");
}

function showError(msg, title = "Couldn't read product") {
  showState("state-error");
  $("error-title").textContent = title;
  $("error-msg").textContent   = msg;
}

// Load Current Tab
async function loadCurrentTab() {
  showState("state-loading");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { showState("state-unsupported"); return; }

    if (!tab.url.includes("shopee.ph") && !tab.url.includes("lazada.com.ph")) {
      showState("state-unsupported"); return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "extractProduct" });
    } catch (_) {
      await new Promise(r => setTimeout(r, 1200));
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: "extractProduct" });
      } catch (e2) {
        showError("Cannot reach the page. Try refreshing it.", "Extension Error"); return;
      }
    }

    if (!response?.success) { showError("Could not read the page.", "Read Error"); return; }

    const data = response.data;
    if (data.error === "not_a_product_page") { showState("state-unsupported"); return; }
    if (data.price == null) {
      showError(
        data.error || "Could not read the price. If this product has variants, select one first then try again.",
        "Price Not Found"
      );
      return;
    }

    currentData = data;
    renderCurrentProduct(data);
  } catch (err) {
    showError("Unexpected error: " + err.message);
  }
}

// Render Current Product
async function renderCurrentProduct(data) {
  showState("state-product");

  const headliner = $("platform-headliner");
  headliner.className = "platform-headliner" + (data.platform === "lazada" ? " lazada" : "");
  $("platform-headliner-text").textContent = data.platform === "lazada" ? "LAZADA PH" : "SHOPEE PH";

  const img = $("product-img");
  const wrap = img.closest(".product-img-wrap");
  if (data.image) {
    img.src = data.image;
    img.style.display = "";
    img.onerror = () => { wrap.innerHTML = '<span class="no-img">🛍️</span>'; };
  } else {
    wrap.innerHTML = '<span class="no-img">🛍️</span>';
  }

  $("product-name").textContent  = data.name || "Unknown Product";
  $("product-price").textContent = data.displayPrice || fmt(data.price);

  const variantEl = $("product-variant");
  if (data.variant) {
    variantEl.textContent = data.variant;
    variantEl.title = data.variant;
    variantEl.style.display = "";
  } else {
    variantEl.style.display = "none";
  }

  const vn = $("variant-notice");
  if (data.isRange) {
    vn.style.display = "";
    vn.querySelector(".vn-text").textContent =
      "Price shown is the range for this product. Select a specific variant to track its exact price.";
  } else {
    vn.style.display = "none";
  }

  const products = await DB.getAllProducts();
  const tracked  = products.find(p => p.url === data.url);

  if (tracked) {
    $("already-tracked").style.display  = "";
    $("target-section").style.display   = "none";
    $("update-section").style.display   = "";
    $("current-target-display").textContent = tracked.targetPrice != null ? fmt(tracked.targetPrice) : "None set";
    $("update-price-input").value = tracked.targetPrice != null ? tracked.targetPrice : "";

    // Backfill variant on products tracked before this feature existed,
    // or if the page now reveals a variant that wasn't caught before.
    if (data.variant && tracked.variant !== data.variant) {
      await DB.updateProduct(tracked.id, { variant: data.variant });
    }
  } else {
    $("already-tracked").style.display  = "none";
    $("target-section").style.display   = "";
    $("update-section").style.display   = "none";
    $("tracking-note").style.display    = "none";
  }
}

// Track Button
$("btn-track").addEventListener("click", async () => {
  if (!currentData) return;
  const raw = parseFloat($("target-price-input").value);
  const targetPrice = isNaN(raw) || raw <= 0 ? null : raw;

  $("btn-track").disabled = true;
  const result = await DB.saveProduct({
    platform: currentData.platform, url: currentData.url,
    name: currentData.name, variant: currentData.variant, image: currentData.image,
    price: currentData.price, priceMin: currentData.priceMin,
    priceMax: currentData.priceMax, displayPrice: currentData.displayPrice,
    targetPrice,
  });
  $("btn-track").disabled = false;

  if (result.success) {
    await DB.addHistoryEntry(result.product.id, currentData.price);
    await UID.logEvidence("product_tracked", { productId: result.product.id, productName: currentData.name, platform: currentData.platform, price: currentData.price });
    showToast("Now tracking this product! ✓", "success");
    $("target-price-input").value = "";
    renderCurrentProduct(currentData);
    updateTrackedCount();
  } else {
    showToast(result.error || "Could not save.", "error");
  }
});

$("btn-update-target").addEventListener("click", async () => {
  if (!currentData) return;
  const products = await DB.getAllProducts();
  const tracked  = products.find(p => p.url === currentData.url);
  if (!tracked) return;
  const raw = parseFloat($("update-price-input").value);
  const targetPrice = isNaN(raw) || raw <= 0 ? null : raw;
  await DB.updateProduct(tracked.id, { targetPrice, alerted: false });
  showToast("Target updated!", "success");
  renderCurrentProduct(currentData);
});

$("btn-remove").addEventListener("click", async () => {
  if (!currentData) return;
  if (!confirm("Stop tracking this product and delete all its history?")) return;
  const products = await DB.getAllProducts();
  const tracked  = products.find(p => p.url === currentData.url);
  if (!tracked) return;
  await DB.removeProduct(tracked.id);
  showToast("Removed from tracking.", "");
  renderCurrentProduct(currentData);
  updateTrackedCount();
});

$("btn-retry").addEventListener("click", loadCurrentTab);
$("btn-refresh").addEventListener("click", loadCurrentTab);

// Tracked List
async function updateTrackedCount() {
  const products = await DB.getAllProducts();
  const badge = $("tracked-count");
  badge.textContent  = products.length;
  badge.style.display = products.length ? "" : "none";
}

async function renderTrackedList() {
  const products = await DB.getAllProducts();
  const list  = $("tracked-list");
  const empty = $("tracked-empty");

  if (!products.length) { empty.style.display = ""; list.innerHTML = ""; return; }
  empty.style.display = "none";

  list.innerHTML = products.map(p => buildTrackedItemHTML(p)).join("");
  attachTrackedListEvents(list);
  // no auto-refresh here on purpose — it used to open a tab per product the
  // instant this tab was opened, which stole focus. Now it only refreshes
  // via the per-item refresh button or the periodic background check.
}

function buildTrackedItemHTML(p) {
  const isLazada    = p.platform === "lazada";
  const imgHtml     = p.image
    ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy" />`
    : `<span style="font-size:20px">🛍️</span>`;

  // Price cell — starts showing the stored lastPrice; live fetch will replace it
  const priceHtml = p.lastPrice != null
    ? `<span class="ti-price" id="live-price-${escapeHtml(p.id)}">${fmt(p.lastPrice)}</span>`
    : `<span class="ti-price" id="live-price-${escapeHtml(p.id)}" style="color:var(--text-3)">—</span>`;

  const alertedBadge = p.alerted
    ? `<span class="ti-alerted">✓ Alerted</span>` : "";

  const targetHtml = p.targetPrice != null
    ? `<strong>${fmt(p.targetPrice)}</strong>`
    : `<span class="ti-no-target">No target set</span>`;

  const lastChecked = p.lastChecked
    ? new Date(p.lastChecked).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Not yet";

  let displayUrl = p.url.replace(/^https?:\/\//, "");
  if (displayUrl.length > 36) displayUrl = displayUrl.slice(0, 33) + "…";

  return `
  <div class="tracked-item" data-id="${escapeHtml(p.id)}">
    <div class="ti-headliner${isLazada ? " lazada" : ""}">
      <span class="ti-dot"></span>
      ${isLazada ? "LAZADA PH" : "SHOPEE PH"}
      <span class="ti-check" id="live-checked-${escapeHtml(p.id)}">Last checked: ${lastChecked}</span>
    </div>
    <div class="ti-body">
      <div class="ti-img">${imgHtml}</div>
      <div class="ti-info">
        <div class="ti-name">${escapeHtml(p.name || "Unknown Product")}</div>
        ${p.variant ? `<div class="ti-variant" title="${escapeHtml(p.variant)}">${escapeHtml(p.variant)}</div>` : ""}
        <div class="ti-prices">${priceHtml}${alertedBadge}</div>
        <div class="ti-target">Target: ${targetHtml}</div>
        <a class="ti-url" href="${escapeHtml(p.url)}" title="${escapeHtml(p.url)}" data-url="${escapeHtml(p.url)}">${displayUrl}</a>
      </div>
      <div class="ti-actions">
        <button class="ti-refresh" title="Refresh this product's price" data-id="${escapeHtml(p.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button class="ti-edit" title="View history &amp; edit target" data-id="${escapeHtml(p.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </button>
        <button class="ti-remove" title="Remove" data-id="${escapeHtml(p.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

function attachTrackedListEvents(list) {
  list.querySelectorAll(".ti-url").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      chrome.tabs.create({ url: a.dataset.url });
    });
  });
  list.querySelectorAll(".ti-refresh").forEach(btn => {
    btn.addEventListener("click", () => refreshSingleProduct(btn.dataset.id));
  });
  list.querySelectorAll(".ti-edit").forEach(btn => {
    btn.addEventListener("click", () => openHistoryPanel(btn.dataset.id));
  });
  list.querySelectorAll(".ti-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this product and all its price history?")) return;
      await DB.removeProduct(btn.dataset.id);
      showToast("Removed.", "");
      renderTrackedList();
      updateTrackedCount();
      if (currentData) renderCurrentProduct(currentData);
    });
  });
}

// Per-product refresh
// Doesn't fetch the price itself — just asks background.js to do it and
// updates the UI if the popup's still open when it responds. Popups get
// killed the instant they lose focus, so delegating to the service worker
// means the check (and any notification) still finishes even if this
// closes right after the button click.
async function refreshSingleProduct(productId) {
  const btn       = document.querySelector(`.ti-refresh[data-id="${cssEscape(productId)}"]`);
  const priceEl   = document.getElementById(`live-price-${productId}`);
  const checkedEl = document.getElementById(`live-checked-${productId}`);

  if (btn) { btn.disabled = true; btn.classList.add("spinning"); }
  if (priceEl) {
    priceEl.innerHTML = `<span class="ti-price-refreshing"><span class="ti-spinner"></span>Refreshing…</span>`;
  }

  // heads up before the Shopee tab briefly pops up (see background.js note)
  try {
    const products = await DB.getAllProducts();
    const product  = products.find(p => p.id === productId);
    if (product?.platform === "shopee") {
      showToast("Loading the Shopee page briefly to read the live price…", "", 3500);
    }
  } catch (_) { /* non-critical — skip the heads-up if this lookup fails */ }

  const restorePriceDisplay = price => {
    if (!priceEl) return;
    priceEl.outerHTML = price != null
      ? `<span class="ti-price" id="live-price-${productId}">${fmt(price)}</span>`
      : `<span class="ti-price" id="live-price-${productId}" style="color:var(--text-3)">—</span>`;
  };

  try {
    const response = await chrome.runtime.sendMessage({ action: "refreshProduct", productId });

    if (!response?.success || response.price == null) {
      const products = await DB.getAllProducts();
      const product  = products.find(p => p.id === productId);
      restorePriceDisplay(product?.lastPrice ?? null);
      showToast(response?.error || "Couldn't read the price this time — please try again.", "error");
      return;
    }

    restorePriceDisplay(response.price);
    if (checkedEl) {
      const now = new Date().toLocaleString("en-PH", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      checkedEl.textContent = `Last checked: ${now}`;
    }
    showToast("Price updated!", "success");
  } catch (_) {
    // popup probably closed mid-request — check still finishes in background.js
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("spinning"); }
  }
}

// escapes a product id for use in a CSS attribute selector
function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// History Panel
async function openHistoryPanel(productId) {
  const products = await DB.getAllProducts();
  const product  = products.find(p => p.id === productId);
  if (!product) return;
  historyProduct = product;

  $("history-product-name").textContent = product.name || "Product";
  const variantBadge = $("history-variant-badge");
  if (product.variant) {
    variantBadge.textContent = product.variant;
    variantBadge.title = product.variant;
    variantBadge.style.display = "";
  } else {
    variantBadge.style.display = "none";
  }
  const badge = $("history-platform-badge");
  badge.textContent = product.platform === "lazada" ? "Lazada PH" : "Shopee PH";
  badge.className   = "history-platform " + product.platform;

  const current = product.lastPrice ?? product.price;
  $("hstat-current").textContent = fmtShort(current);
  $("hstat-target").textContent  = product.targetPrice != null ? fmtShort(product.targetPrice) : "—";
  $("history-target-input").value = product.targetPrice != null ? product.targetPrice : "";

  const history = await DB.getHistory(productId);
  if (history.length >= 2) {
    const prices = history.map(e => e.price);
    $("hstat-low").textContent  = fmtShort(Math.min(...prices));
    $("hstat-high").textContent = fmtShort(Math.max(...prices));
    $("chart-empty").style.display = "none";
    PriceChart.render("price-chart", history, product.targetPrice);
  } else {
    $("hstat-low").textContent  = fmtShort(current);
    $("hstat-high").textContent = fmtShort(current);
    $("chart-empty").style.display = "";
  }

  const overlay = $("history-overlay");
  const panel   = $("history-panel");
  overlay.style.display = "";
  requestAnimationFrame(() => panel.classList.add("open"));
}

function closeHistoryPanel(instant = false) {
  const overlay = $("history-overlay");
  const panel   = $("history-panel");
  if (overlay.style.display === "none") return; // already closed, nothing to do
  historyProduct = null;
  panel.classList.remove("open");
  if (instant) {
    // Tab switch: hide immediately, skip the slide-out animation
    overlay.style.display = "none";
  } else {
    // Close button / backdrop click: play the slide-out transition then hide
    panel.addEventListener("transitionend", () => {
      overlay.style.display = "none";
    }, { once: true });
  }
}

$("btn-history-close").addEventListener("click", closeHistoryPanel);
$("history-overlay").addEventListener("click", e => {
  if (e.target === $("history-overlay")) closeHistoryPanel();
});

$("btn-history-save-target").addEventListener("click", async () => {
  if (!historyProduct) return;
  const raw = parseFloat($("history-target-input").value);
  const targetPrice = isNaN(raw) || raw <= 0 ? null : raw;
  await DB.updateProduct(historyProduct.id, { targetPrice, alerted: false });
  historyProduct = { ...historyProduct, targetPrice };
  $("hstat-target").textContent = targetPrice != null ? fmtShort(targetPrice) : "—";
  showToast("Target updated!", "success");
  renderTrackedList();
  if (currentData?.url === historyProduct.url) renderCurrentProduct(currentData);
});

$("btn-history-remove").addEventListener("click", async () => {
  if (!historyProduct) return;
  if (!confirm("Remove this product and all its price history?")) return;
  await DB.removeProduct(historyProduct.id);
  closeHistoryPanel();
  showToast("Removed.", "");
  renderTrackedList();
  updateTrackedCount();
  if (currentData?.url === historyProduct.url) renderCurrentProduct(currentData);
});

// Alerts Tab
async function getNotifLog() {
  const raw = await new Promise(r => chrome.storage.local.get("pw_notif_log", d => r(d.pw_notif_log ?? null)));
  return raw ? JSON.parse(raw) : [];
}

// Updates the red count badge on the Alerts tab. Split out from
// renderAlerts() so it can also run on popup open (see init()) — otherwise
// the badge wouldn't update until you actually clicked into Alerts.
async function updateAlertsBadge() {
  const log = await getNotifLog();
  const badge = $("alerts-count");
  if (log.length) { badge.textContent = Math.min(log.length, 99); badge.style.display = ""; }
  else badge.style.display = "none";
  return log;
}

async function renderAlerts() {
  const log = await updateAlertsBadge();

  const list  = $("alerts-list");
  const empty = $("alerts-empty");
  if (!log.length) { empty.style.display = ""; list.innerHTML = ""; return; }
  empty.style.display = "none";

  const typeIcon  = { target: "🎯", drop: "📉", rise: "📈", change: "🔔" };
  const typeClass = { target: "alert-item--target", drop: "alert-item--drop", rise: "alert-item--rise", change: "alert-item--change" };

  list.innerHTML = [...log].reverse().map(a => {
    const time = new Date(a.timestamp).toLocaleString("en-PH", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    return `
    <div class="alert-item ${typeClass[a.type] || "alert-item--change"}">
      <span class="alert-icon">${typeIcon[a.type] || "🔔"}</span>
      <div class="alert-body">
        <div class="alert-title">${escapeHtml(a.title)}</div>
        <div class="alert-msg">${escapeHtml(a.message)}</div>
        <div class="alert-time">${time}</div>
      </div>
    </div>`;
  }).join("");
}

$("btn-clear-alerts").addEventListener("click", async () => {
  await new Promise(r => chrome.storage.local.set({ pw_notif_log: null }, r));
  renderAlerts();
  showToast("Alert log cleared.");
});

$("btn-force-check").addEventListener("click", async () => {
  const btn = $("btn-force-check");
  btn.disabled = true;
  btn.textContent = "Checking…";
  showToast("Checking prices — Shopee products may briefly flash a tab to load the page, then return you here.", "", 5000);
  try {
    // resolves once every product's been checked — background.js keeps the
    // service worker alive with a pending sendResponse, so notifications
    // still fire even if this popup closes right away
    await chrome.runtime.sendMessage({ action: "triggerCheck" });
    showToast("Price check complete! Check Alerts for any notifications.", "success", 4000);
  } catch (e) {
    showToast("Check failed: " + (e.message || "unknown error"), "error");
  }
  btn.disabled = false;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Check Prices Now`;
  renderAlerts();
});

// Test Notification
$("btn-test-notif").addEventListener("click", async () => {
  const notifId = `pw-test-${Date.now()}`;

  // notifications.create() can "succeed" even when the OS is blocking it —
  // check permission level first so we can tell the user honestly
  const permissionLevel = await new Promise(resolve => {
    chrome.notifications.getPermissionLevel(level => resolve(level));
  });

  if (permissionLevel !== "granted") {
    showToast("Notifications are blocked — check Windows & browser notification settings.", "error", 6000);
    return;
  }

  const title   = "🔔 PriceWatch PH – Test";
  const message = "Real system notification test.";

  await new Promise(resolve => {
    chrome.notifications.create(
      notifId,
      { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), priority: 2, title, message },
      () => resolve()
    );
  });

  const raw      = await new Promise(r => chrome.storage.local.get("pw_notif_log", d => r(d.pw_notif_log ?? null)));
  const existing = raw ? JSON.parse(raw) : [];
  existing.push({
    id: notifId, productId: "test", type: "change", title, message,
    timestamp: new Date().toISOString(),
  });
  await new Promise(r => chrome.storage.local.set({ pw_notif_log: JSON.stringify(existing.slice(-50)) }, r));

  // this only confirms we sent the request — not that it actually appeared
  showToast("Sent — check your Windows notification area.", "success", 5000);
  renderAlerts();
});

// Export / Import
$("btn-export").addEventListener("click", async () => {
  $("export-modal").style.display = "";
  $("device-uid").textContent = await UID.get();
});
$("btn-modal-close").addEventListener("click", () => { $("export-modal").style.display = "none"; });
$("export-modal").addEventListener("click", e => { if (e.target === $("export-modal")) $("export-modal").style.display = "none"; });

$("btn-copy-uid").addEventListener("click", async () => {
  const id = await UID.get();
  await navigator.clipboard.writeText(id);
  showToast("UID copied!", "success");
});

$("btn-export-evidence").addEventListener("click", async () => {
  const uid = await UID.get();
  const log = await UID.getEvidenceLog();
  const out = { exportedAt: new Date().toISOString(), uid, entries: log };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `pricewatch-evidence-${Date.now()}.json` });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  showToast("Evidence log exported!", "success");
});

$("btn-export-json").addEventListener("click", async () => {
  const data = await DB.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `pricewatch-export-${Date.now()}.json` });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  $("export-modal").style.display = "none";
  showToast("Exported!", "success");
});

$("btn-export-csv").addEventListener("click", async () => {
  const data = await DB.exportData();
  const rows = ["Product,Variant,Platform,URL,Price,Target,Added,Last Checked"];
  for (const p of data.products) {
    rows.push([
      `"${(p.name || "").replace(/"/g, '""')}"`,
      `"${(p.variant || "").replace(/"/g, '""')}"`,
      p.platform, `"${p.url}"`,
      p.price, p.targetPrice ?? "",
      p.addedAt, p.lastChecked ?? ""
    ].join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `pricewatch-export-${Date.now()}.csv` });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  $("export-modal").style.display = "none";
  showToast("CSV exported!", "success");
});

$("btn-import").addEventListener("click", () => $("import-file-input").click());
$("import-file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text   = await file.text();
  const result = await DB.importData(text);
  e.target.value = "";
  if (result.success) {
    showToast(`Imported ${result.imported} product(s). Skipped ${result.skipped} duplicates.`, "success");
    renderTrackedList();
    updateTrackedCount();
  } else {
    showToast("Import failed: " + result.error, "error");
  }
});

// Init
async function init() {
  await loadCurrentTab();
  await updateTrackedCount();
  await updateAlertsBadge();
}

init();
