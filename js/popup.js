// popup.js – Extension popup controller
"use strict";

let currentProductData    = null;
let currentTrackedProduct = null;
let historyProductId      = null; // which product the history panel is showing

const $ = id => document.getElementById(id);

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt = n => n == null || isNaN(n) ? "—"
  : "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDisplay(data) {
  return data?.displayPrice || fmt(data?.price);
}

function timeAgo(iso) {
  if (!iso) return "Never";
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function showToast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  setTimeout(() => { t.className = "toast"; }, 3200);
}

function showState(id) {
  ["state-unsupported","state-loading","state-error","state-product"]
    .forEach(s => { const el = $(s); if (el) el.style.display = "none"; });
  if (id) $(id).style.display = "";
}

function setHeadliner(platform) {
  const h = $("platform-headliner");
  const t = $("platform-headliner-text");
  h.classList.toggle("lazada", platform === "lazada");
  t.textContent = platform === "lazada" ? "LAZADA PH" : "SHOPEE PH";
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + tab).classList.add("active");
    if (tab === "tracked") renderTrackedList();
    if (tab === "alerts")  renderAlertsList();
  });
});

// ─── Live updates from content script ────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === "productUpdated" && msg.data?.url === currentProductData?.url && msg.data.price !== null) {
    currentProductData = msg.data;
    renderProductCard(msg.data);
  }
});

// ─── Load Current Product ────────────────────────────────────────────────────
async function loadCurrentProduct() {
  showState("state-loading");
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch (_) { showState("state-unsupported"); return; }

  if (!tab?.url?.match(/shopee\.ph|lazada\.com\.ph/)) {
    showState("state-unsupported"); return;
  }

  const ask = () => new Promise((res, rej) => {
    chrome.tabs.sendMessage(tab.id, { action: "extractProduct" }, r =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r));
  });
  const inject = async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["js/content.js"] });
    await new Promise(r => setTimeout(r, 700));
    return ask();
  };

  try {
    let res;
    try { res = await ask(); } catch (_) { res = await inject(); }
    if (!res?.data) throw new Error("No data");
    handleExtractedData(res.data);
  } catch (_) {
    try {
      const res = await inject();
      handleExtractedData(res?.data);
    } catch (_2) {
      $("error-title").textContent = "Couldn't connect";
      $("error-msg").textContent   = "Make sure you are on a Shopee PH or Lazada PH product page and the page is fully loaded.";
      showState("state-error");
    }
  }
}

async function handleExtractedData(data) {
  if (!data) {
    $("error-title").textContent = "No data received";
    $("error-msg").textContent   = "Try refreshing the product page.";
    showState("state-error"); return;
  }
  currentProductData = data;
  if (data.error === "not_a_product_page") {
    $("error-title").textContent = "Not a product page";
    $("error-msg").textContent   = "Open a specific product listing on Shopee PH or Lazada PH.";
    showState("state-error"); return;
  }
  if (data.error || data.price === null) {
    $("error-title").textContent = "Couldn't read product";
    $("error-msg").textContent   = data.error || "Could not read the price. Select a variant first if available.";
    showState("state-error"); return;
  }
  renderProductCard(data);
  await checkIfTracked(data.url);
  showState("state-product");
}

function renderProductCard(data) {
  setHeadliner(data.platform);
  const imgEl  = $("product-img");
  const imgWrap = imgEl.parentElement;
  if (data.image) {
    imgEl.src = data.image; imgEl.style.display = "";
    imgEl.onerror = () => { imgEl.style.display = "none"; if (!imgWrap.querySelector(".no-img")) imgWrap.innerHTML = '<span class="no-img">🛍️</span>'; };
  } else { imgEl.style.display = "none"; imgWrap.innerHTML = '<span class="no-img">🛍️</span>'; }
  $("product-name").textContent  = data.name;
  $("product-price").textContent = fmtDisplay(data);
  const vn = $("variant-notice");
  if (data.isRange) {
    vn.style.display = "flex";
    vn.querySelector(".vn-text").textContent = "Price range detected. Select a variant for an exact price, then click refresh.";
  } else { vn.style.display = "none"; }
}

async function checkIfTracked(url) {
  const products = await DB.getAllProducts();
  currentTrackedProduct = products.find(p => p.url === url) || null;
  if (currentTrackedProduct) {
    $("already-tracked").style.display = "flex";
    $("target-section").style.display  = "none";
    $("update-section").style.display  = "";
    $("current-target-display").textContent = currentTrackedProduct.targetPrice ? fmt(currentTrackedProduct.targetPrice) : "Not set";
    $("update-price-input").value = currentTrackedProduct.targetPrice || "";
  } else {
    $("already-tracked").style.display = "none";
    $("target-section").style.display  = "";
    $("update-section").style.display  = "none";
    $("target-price-input").value = "";
    const tn = $("tracking-note");
    if (currentProductData?.isRange) {
      tn.style.display  = "";
      tn.textContent = `⚠ Range detected. Lower bound (${fmt(currentProductData.priceMin)}) will be used for tracking. Select a variant for exact tracking.`;
    } else { tn.style.display = "none"; }
  }
}

// ─── Track ────────────────────────────────────────────────────────────────────
$("btn-track").addEventListener("click", async () => {
  if (!currentProductData) return;
  const v = parseFloat($("target-price-input").value);
  if (!$("target-price-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error"); return;
  }
  const r = await DB.saveProduct({
    name: currentProductData.name, url: currentProductData.url,
    platform: currentProductData.platform, image: currentProductData.image,
    price: currentProductData.price, priceMin: currentProductData.priceMin,
    priceMax: currentProductData.priceMax, isRange: currentProductData.isRange,
    displayPrice: currentProductData.displayPrice, targetPrice: v,
  });
  if (r.success) {
    await DB.addHistoryEntry(r.product.id, currentProductData.price);
    currentTrackedProduct = r.product;
    showToast("✓ Product is now being tracked!", "success");
    await checkIfTracked(currentProductData.url);
    await updateBadges();
  } else { showToast(r.error || "Could not add product.", "error"); }
});

$("btn-update-target").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;
  const v = parseFloat($("update-price-input").value);
  if (!$("update-price-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error"); return;
  }
  await DB.updateProduct(currentTrackedProduct.id, { targetPrice: v, alerted: false });
  currentTrackedProduct.targetPrice = v;
  $("current-target-display").textContent = fmt(v);
  showToast("✓ Target updated!", "success");
});

$("btn-remove").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;
  if (!confirm(`Remove "${currentTrackedProduct.name}" from tracking?`)) return;
  await DB.removeProduct(currentTrackedProduct.id);
  currentTrackedProduct = null;
  showToast("Product removed.", "");
  await checkIfTracked(currentProductData.url);
  await updateBadges();
});

$("btn-retry").addEventListener("click",   () => loadCurrentProduct());
$("btn-refresh").addEventListener("click", () => loadCurrentProduct());

// ─── Tracked List ─────────────────────────────────────────────────────────────
async function renderTrackedList() {
  const products = await DB.getAllProducts();
  const list = $("tracked-list");
  list.innerHTML = "";
  if (!products.length) { $("tracked-empty").style.display = ""; return; }
  $("tracked-empty").style.display = "none";

  products.forEach(p => {
    const isLazada = p.platform === "lazada";
    const imgHtml  = p.image ? `<img src="${p.image}" alt="" onerror="this.style.display='none'">` : "🛍️";
    const priceDisp = p.isRange && p.priceMin && p.priceMax
      ? `${fmt(p.priceMin)} – ${fmt(p.priceMax)}`
      : fmt(p.lastPrice ?? p.price);
    const targetTxt = p.targetPrice
      ? `Alert: <strong>${fmt(p.targetPrice)}</strong>`
      : `<span class="ti-no-target">No target set</span>`;
    const alertBadge = p.alerted ? `<span class="ti-alerted">✓ Alerted</span>` : "";
    let displayUrl = "";
    try { const u = new URL(p.url); displayUrl = u.hostname.replace("www.","") + u.pathname.slice(0,28) + "…"; }
    catch (_) { displayUrl = p.url.slice(0, 36) + "…"; }

    const el = document.createElement("div");
    el.className = "tracked-item";
    el.innerHTML = `
      <div class="ti-headliner ${isLazada?"lazada":""}">
        <span class="ti-dot"></span>
        <span>${isLazada?"LAZADA PH":"SHOPEE PH"}</span>
        <span class="ti-check">${timeAgo(p.lastChecked)}</span>
      </div>
      <div class="ti-body">
        <div class="ti-img">${imgHtml}</div>
        <div class="ti-info">
          <div class="ti-name">${p.name}</div>
          <div class="ti-prices"><span class="ti-price">${priceDisp}</span>${alertBadge}</div>
          <div class="ti-target">${targetTxt}</div>
          <a class="ti-url" href="${p.url}" data-url="${p.url}" title="${p.url}">${displayUrl}</a>
        </div>
        <div class="ti-actions">
          <button class="ti-history-btn" data-id="${p.id}" title="View price history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </button>
          <button class="ti-remove" data-id="${p.id}" title="Remove">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
    list.appendChild(el);
  });

  // History button
  list.querySelectorAll(".ti-history-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const p = products.find(x => x.id === btn.dataset.id);
      if (p) await openHistoryPanel(p);
    });
  });

  // Remove button
  list.querySelectorAll(".ti-remove").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const p = products.find(x => x.id === btn.dataset.id);
      if (!p || !confirm(`Remove "${p.name}"?`)) return;
      await DB.removeProduct(p.id);
      showToast("Product removed.", "");
      await updateBadges();
      renderTrackedList();
    });
  });

  // URL links
  list.querySelectorAll(".ti-url").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      chrome.tabs.create({ url: a.dataset.url });
    });
  });
}

// ─── History Panel ────────────────────────────────────────────────────────────
async function openHistoryPanel(product) {
  historyProductId = product.id;
  const history    = await DB.getHistory(product.id);

  // Header
  $("history-product-name").textContent = product.name;
  const pb = $("history-platform-badge");
  pb.textContent  = product.platform === "lazada" ? "LAZADA PH" : "SHOPEE PH";
  pb.className    = "history-platform " + (product.platform === "lazada" ? "lazada" : "shopee");

  // Stats
  const prices    = history.map(e => e.price);
  const current   = product.lastPrice ?? product.price;
  const lo        = prices.length ? Math.min(...prices) : null;
  const hi        = prices.length ? Math.max(...prices) : null;

  $("hstat-current").textContent = fmt(current);
  $("hstat-target").textContent  = product.targetPrice ? fmt(product.targetPrice) : "Not set";
  $("hstat-low").textContent     = fmt(lo);
  $("hstat-high").textContent    = fmt(hi);

  // Target input
  $("history-target-input").value = product.targetPrice || "";

  // Chart
  const chartEmpty = $("chart-empty");
  if (history.length < 2) {
    chartEmpty.style.display = "";
    const canvas = $("price-chart");
    const ctx    = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    chartEmpty.style.display = "none";
    PriceChart.render("price-chart", history, product.targetPrice);
  }

  // Show panel
  $("history-overlay").style.display = "";
  requestAnimationFrame(() => $("history-panel").classList.add("open"));
}

function closeHistoryPanel() {
  $("history-panel").classList.remove("open");
  setTimeout(() => { $("history-overlay").style.display = "none"; }, 280);
  historyProductId = null;
}

$("btn-history-close").addEventListener("click", closeHistoryPanel);
$("history-overlay").addEventListener("click", e => { if (e.target === $("history-overlay")) closeHistoryPanel(); });

$("btn-history-save-target").addEventListener("click", async () => {
  if (!historyProductId) return;
  const v = parseFloat($("history-target-input").value);
  if (!$("history-target-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error"); return;
  }
  await DB.updateProduct(historyProductId, { targetPrice: v, alerted: false });
  showToast("✓ Target updated!", "success");
  // Re-render chart with new target line
  const products = await DB.getAllProducts();
  const p        = products.find(x => x.id === historyProductId);
  if (p) { p.targetPrice = v; await openHistoryPanel(p); }
  renderTrackedList();
});

$("btn-history-remove").addEventListener("click", async () => {
  if (!historyProductId) return;
  const products = await DB.getAllProducts();
  const p        = products.find(x => x.id === historyProductId);
  if (!p || !confirm(`Remove "${p.name}"?`)) return;
  await DB.removeProduct(historyProductId);
  closeHistoryPanel();
  showToast("Product removed.", "");
  await updateBadges();
  renderTrackedList();
});

// ─── Alerts ───────────────────────────────────────────────────────────────────
async function renderAlertsList() {
  const raw  = null // use chrome.storage below;
  const logs = raw ? JSON.parse(raw) : [];
  const list = $("alerts-list");
  list.innerHTML = "";
  if (!logs.length) { $("alerts-empty").style.display = ""; return; }
  $("alerts-empty").style.display = "none";
  const icons = { target: "🎯", drop: "📉", rise: "📈", change: "🔄" };
  [...logs].reverse().forEach(log => {
    const el = document.createElement("div");
    el.className = `alert-item alert-item--${log.type || "change"}`;
    const time = new Date(log.timestamp).toLocaleString("en-PH", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    el.innerHTML = `
      <div class="alert-icon">${icons[log.type] || "🔔"}</div>
      <div class="alert-body">
        <div class="alert-title">${log.title}</div>
        <div class="alert-msg">${log.message.replace(/\n/g, " • ")}</div>
        <div class="alert-time">${time}</div>
      </div>`;
    list.appendChild(el);
  });
}

$("btn-force-check").addEventListener("click", async () => {
  const products = await DB.getAllProducts();
  if (!products.length) { showToast("No products being tracked yet.", ""); return; }
  const btn = $("btn-force-check");
  btn.disabled    = true;
  btn.textContent = "Checking…";
  try {
    await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action: "triggerCheck" }, r =>
        chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r));
    });
    showToast("✓ Price check complete!", "success");
  } catch (_) { showToast("Check running in background.", "success"); }
  finally {
    btn.disabled  = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Check Prices Now`;
    await renderAlertsList();
    await updateBadges();
    await renderTrackedList();
  }
});

$("btn-clear-alerts").addEventListener("click", async () => {
  if (!confirm("Clear all alert history?")) return;
  null // handled below;
  showToast("Alert log cleared.", "");
  renderAlertsList();
  updateBadges();
});

// ─── Test Notification ────────────────────────────────────────────────────────
$("btn-test-notif").addEventListener("click", () => {
  chrome.notifications.create(`test-${Date.now()}`, {
    type: "basic", iconUrl: "icons/icon128.png",
    title: "🎯 PriceWatch PH — Test",
    message: "Notifications are working! You'll be alerted when a tracked price is met.",
    priority: 2,
  });
  showToast("Test notification sent!", "success");
});

// ─── Export ───────────────────────────────────────────────────────────────────
$("btn-export").addEventListener("click", () => { $("export-modal").style.display = ""; });
$("btn-modal-close").addEventListener("click", () => { $("export-modal").style.display = "none"; });
$("export-modal").addEventListener("click", e => { if (e.target === $("export-modal")) $("export-modal").style.display = "none"; });

$("btn-export-json").addEventListener("click", async () => {
  const data = await DB.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pricewatch-ph-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  $("export-modal").style.display = "none";
  showToast("✓ JSON exported!", "success");
});

$("btn-export-csv").addEventListener("click", async () => {
  const data = await DB.exportData();
  const rows = [["Product Name","Platform","URL","Current Price","Price Min","Price Max","Is Range","Target Price","Added At","Last Checked","Alerted"]];
  data.products.forEach(p => rows.push([
    `"${(p.name||"").replace(/"/g,'""')}"`,
    p.platform === "lazada" ? "Lazada PH" : "Shopee PH",
    p.url, p.lastPrice??p.price??"", p.priceMin??"", p.priceMax??"",
    p.isRange?"Yes":"No", p.targetPrice??"", p.addedAt??"", p.lastChecked??"", p.alerted?"Yes":"No",
  ]));
  const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pricewatch-ph-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  $("export-modal").style.display = "none";
  showToast("✓ CSV exported!", "success");
});

// ─── Import ───────────────────────────────────────────────────────────────────
$("btn-import").addEventListener("click", () => $("import-file-input").click());

$("import-file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text   = await file.text();
    const result = await DB.importData(text);
    if (result.success) {
      showToast(`✓ Imported ${result.imported} product(s). Skipped ${result.skipped} duplicates.`, "success");
      await updateBadges();
      renderTrackedList();
    } else { showToast(result.error || "Import failed.", "error"); }
  } catch (_) { showToast("Invalid file. Please use a PriceWatch PH JSON export.", "error"); }
  e.target.value = ""; // reset so same file can be re-imported
});

// ─── Badge counts ─────────────────────────────────────────────────────────────
async function updateBadges() {
  const products = await DB.getAllProducts();
  $("tracked-count").textContent = products.length;

  const raw  = null // use chrome.storage below;
  const logs = raw ? JSON.parse(raw) : [];
  const ac   = $("alerts-count");
  ac.textContent    = logs.length;
  ac.style.display  = logs.length > 0 ? "" : "none";
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  await updateBadges();
  await loadCurrentProduct();
})();

// ── Override notif log to use chrome.storage.local (shared with service worker)
async function getNotifLog() {
  return new Promise(res => chrome.storage.local.get("pw_notif_log", r => {
    const raw = r["pw_notif_log"];
    res(raw ? JSON.parse(raw) : []);
  }));
}

// Re-define renderAlertsList and updateBadges to use chrome.storage
const _renderAlertsList = async function() {
  const logs = await getNotifLog();
  const list = document.getElementById("alerts-list");
  list.innerHTML = "";
  if (!logs.length) { document.getElementById("alerts-empty").style.display = ""; return; }
  document.getElementById("alerts-empty").style.display = "none";
  const icons = { target: "🎯", drop: "📉", rise: "📈", change: "🔄" };
  [...logs].reverse().forEach(log => {
    const el = document.createElement("div");
    el.className = `alert-item alert-item--${log.type||"change"}`;
    const time = new Date(log.timestamp).toLocaleString("en-PH",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    el.innerHTML = `<div class="alert-icon">${icons[log.type]||"🔔"}</div><div class="alert-body"><div class="alert-title">${log.title}</div><div class="alert-msg">${log.message.replace(/\n/g," • ")}</div><div class="alert-time">${time}</div></div>`;
    list.appendChild(el);
  });
};

document.getElementById("btn-clear-alerts").addEventListener("click", async () => {
  if (!confirm("Clear all alert history?")) return;
  await new Promise(res => chrome.storage.local.remove("pw_notif_log", res));
  showToast("Alert log cleared.", "");
  await _renderAlertsList();
  await _updateBadges();
}, { once: false });

async function _updateBadges() {
  const p = await DB.getAllProducts();
  document.getElementById("tracked-count").textContent = p.length;
  const logs = await getNotifLog();
  const ac = document.getElementById("alerts-count");
  ac.textContent   = logs.length;
  ac.style.display = logs.length > 0 ? "" : "none";
}

// Patch tab click for alerts to use new fn
document.querySelectorAll(".tab-btn").forEach(btn => {
  if (btn.dataset.tab === "alerts") {
    btn.addEventListener("click", () => _renderAlertsList());
  }
});
