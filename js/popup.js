// popup.js – Controls the extension popup UI
"use strict";

let currentProductData = null;
let currentTrackedProduct = null;
let editingProductId = null;

const $ = (id) => document.getElementById(id);

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatPrice(num) {
  if (num == null || isNaN(num)) return "—";
  return "₱" + Number(num).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDisplayPrice(data) {
  if (data && data.displayPrice) return data.displayPrice;
  return formatPrice(data && data.price);
}
function timeAgo(iso) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function showToast(msg, type = "") {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => { toast.className = "toast"; }, 3200);
}
function showState(which) {
  [$("state-unsupported"), $("state-loading"), $("state-error"), $("state-product")]
    .forEach(el => { if (el) el.style.display = "none"; });
  if (which) which.style.display = "";
}
function setHeadliner(platform) {
  const h = $("platform-headliner");
  const t = $("platform-headliner-text");
  if (platform === "lazada") { h.classList.add("lazada"); t.textContent = "LAZADA PH"; }
  else { h.classList.remove("lazada"); t.textContent = "SHOPEE PH"; }
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
    if (tab === "alerts") renderAlertsList();
  });
});

// ─── Live updates from content script (variant changes) ──────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "productUpdated" && msg.data) {
    const data = msg.data;
    // Only update if we're on the Current tab and it's the same URL
    if (currentProductData && data.url === currentProductData.url && data.price !== null) {
      currentProductData = data;
      renderProductCard(data);
    }
  }
});

// ─── Load Current Product ────────────────────────────────────────────────────
async function loadCurrentProduct() {
  showState($("state-loading"));

  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch (_) { showState($("state-unsupported")); return; }

  if (!tab) { showState($("state-unsupported")); return; }

  const url = tab.url || "";
  if (!url.includes("shopee.ph") && !url.includes("lazada.com.ph")) {
    showState($("state-unsupported")); return;
  }

  const ask = () => new Promise((res, rej) => {
    chrome.tabs.sendMessage(tab.id, { action: "extractProduct" }, r => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError); else res(r);
    });
  });

  const inject = async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["js/content.js"] });
    await new Promise(r => setTimeout(r, 600));
    return ask();
  };

  try {
    let response;
    try { response = await ask(); } catch (_) { response = await inject(); }
    if (!response?.data) throw new Error("No response.");

    const data = response.data;
    currentProductData = data;

    // Not a product page
    if (data.error === "not_a_product_page") {
      $("error-title").textContent = "Not a product page";
      $("error-msg").textContent = "Open a specific product listing on Shopee PH or Lazada PH to use the tracker.";
      showState($("state-error")); return;
    }

    if (data.error || data.price === null) {
      $("error-title").textContent = "Couldn't read product";
      $("error-msg").textContent = data.error || "Could not read the price. If this product has variants, select one first then click Try Again.";
      showState($("state-error")); return;
    }

    renderProductCard(data);
    await checkIfTracked(data.url);
    showState($("state-product"));

  } catch (err) {
    try {
      const r = await inject();
      if (r?.data?.price !== null && r?.data?.error !== "not_a_product_page") {
        currentProductData = r.data;
        renderProductCard(r.data);
        await checkIfTracked(r.data.url);
        showState($("state-product"));
      } else {
        $("error-title").textContent = r?.data?.error === "not_a_product_page" ? "Not a product page" : "Couldn't read product";
        $("error-msg").textContent = r?.data?.error === "not_a_product_page"
          ? "Open a specific product listing on Shopee PH or Lazada PH."
          : (r?.data?.error || "Could not read this page. Make sure it's fully loaded.");
        showState($("state-error"));
      }
    } catch (_) {
      $("error-title").textContent = "Couldn't connect";
      $("error-msg").textContent = "Make sure you are on a Shopee PH or Lazada PH product page and the page has fully loaded.";
      showState($("state-error"));
    }
  }
}

// ─── Render Product Card ─────────────────────────────────────────────────────
function renderProductCard(data) {
  setHeadliner(data.platform);

  // Image
  const imgEl = $("product-img");
  const imgWrap = imgEl.parentElement;
  if (data.image) {
    imgEl.src = data.image;
    imgEl.alt = data.name;
    imgEl.style.display = "";
    imgEl.onerror = () => {
      imgEl.style.display = "none";
      if (!imgWrap.querySelector(".no-img")) imgWrap.innerHTML = '<span class="no-img">🛍️</span>';
    };
  } else {
    imgEl.style.display = "none";
    imgWrap.innerHTML = '<span class="no-img">🛍️</span>';
  }

  $("product-name").textContent = data.name;
  $("product-price").textContent = formatDisplayPrice(data);

  // Variant notice
  if (data.isRange) {
    $("variant-notice").style.display = "flex";
    $("variant-notice").querySelector(".vn-text").textContent =
      "Price range detected. Select a variant on the page for an exact price, then click refresh.";
  } else {
    $("variant-notice").style.display = "none";
  }
}

// ─── Check if tracked ────────────────────────────────────────────────────────
async function checkIfTracked(url) {
  const products = await DB.getAllProducts();
  currentTrackedProduct = products.find(p => p.url === url) || null;

  if (currentTrackedProduct) {
    $("already-tracked").style.display = "flex";
    $("target-section").style.display = "none";
    $("update-section").style.display = "";
    const tp = currentTrackedProduct.targetPrice;
    $("current-target-display").textContent = tp ? formatPrice(tp) : "Not set";
    $("update-price-input").value = tp || "";
  } else {
    $("already-tracked").style.display = "none";
    $("target-section").style.display = "";
    $("update-section").style.display = "none";
    $("target-price-input").value = "";
    const tn = $("tracking-note");
    if (currentProductData?.isRange) {
      tn.style.display = "";
      tn.textContent = `⚠ Range detected. The lower bound (${formatPrice(currentProductData.priceMin)}) will be used for tracking. Select a variant for exact tracking.`;
    } else {
      tn.style.display = "none";
    }
  }
}

// ─── Track ────────────────────────────────────────────────────────────────────
$("btn-track").addEventListener("click", async () => {
  if (!currentProductData) return;
  const v = parseFloat($("target-price-input").value);
  if (!$("target-price-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error");
    $("target-price-input").focus(); return;
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
    await updateTrackedBadge();
  } else {
    showToast(r.error || "Could not add product.", "error");
  }
});

// ─── Update target (from Current tab) ────────────────────────────────────────
$("btn-update-target").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;
  const v = parseFloat($("update-price-input").value);
  if (!$("update-price-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error");
    $("update-price-input").focus(); return;
  }
  await DB.updateProduct(currentTrackedProduct.id, { targetPrice: v, alerted: false });
  currentTrackedProduct.targetPrice = v;
  $("current-target-display").textContent = formatPrice(v);
  showToast("✓ Target price updated!", "success");
});

// ─── Remove (from Current tab) ────────────────────────────────────────────────
$("btn-remove").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;
  if (!confirm(`Remove "${currentTrackedProduct.name}" from tracking?`)) return;
  await DB.removeProduct(currentTrackedProduct.id);
  currentTrackedProduct = null;
  showToast("Product removed.", "");
  await checkIfTracked(currentProductData.url);
  await updateTrackedBadge();
});

$("btn-retry").addEventListener("click", () => loadCurrentProduct());
$("btn-refresh").addEventListener("click", () => loadCurrentProduct());

// ─── Render Tracked List ─────────────────────────────────────────────────────
async function renderTrackedList() {
  const products = await DB.getAllProducts();
  const list = $("tracked-list");
  list.innerHTML = "";

  if (!products.length) { $("tracked-empty").style.display = ""; return; }
  $("tracked-empty").style.display = "none";

  products.forEach(p => {
    const isLazada = p.platform === "lazada";
    const imgHtml = p.image
      ? `<img src="${p.image}" alt="" onerror="this.style.display='none'">`
      : `🛍️`;

    const priceDisplay = p.isRange && p.priceMin && p.priceMax
      ? `${formatPrice(p.priceMin)} – ${formatPrice(p.priceMax)}`
      : formatPrice(p.lastPrice ?? p.price);

    const alertBadge = p.alerted ? `<span class="ti-alerted">✓ Alerted</span>` : "";
    const targetText = p.targetPrice
      ? `Alert: <strong>${formatPrice(p.targetPrice)}</strong>`
      : `<span class="ti-no-target">No target set</span>`;
    const lastCheck = p.lastChecked ? `${timeAgo(p.lastChecked)}` : "Not checked";

    // Truncate URL for display
    let displayUrl = "";
    try {
      const u = new URL(p.url);
      displayUrl = u.hostname.replace("www.", "") + u.pathname.slice(0, 30) + "…";
    } catch (_) { displayUrl = p.url.slice(0, 40) + "…"; }

    const el = document.createElement("div");
    el.className = "tracked-item";
    el.innerHTML = `
      <div class="ti-headliner ${isLazada ? "lazada" : ""}">
        <span class="ti-dot"></span>
        <span>${isLazada ? "LAZADA PH" : "SHOPEE PH"}</span>
        <span class="ti-check">${lastCheck}</span>
      </div>
      <div class="ti-body">
        <div class="ti-img">${imgHtml}</div>
        <div class="ti-info">
          <div class="ti-name">${p.name}</div>
          <div class="ti-prices">
            <span class="ti-price">${priceDisplay}</span>
            ${alertBadge}
          </div>
          <div class="ti-target">${targetText}</div>
          <a class="ti-url" href="${p.url}" target="_blank" title="${p.url}">${displayUrl}</a>
        </div>
        <div class="ti-actions">
          <button class="ti-edit" data-id="${p.id}" title="Edit target price">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="ti-remove" data-id="${p.id}" title="Remove">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    `;
    list.appendChild(el);
  });

  // Edit buttons → open modal
  list.querySelectorAll(".ti-edit").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const prod = products.find(p => p.id === id);
      if (!prod) return;
      openEditModal(prod);
    });
  });

  // Remove buttons
  list.querySelectorAll(".ti-remove").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const prod = products.find(p => p.id === id);
      if (!prod) return;
      if (!confirm(`Remove "${prod.name}"?`)) return;
      await DB.removeProduct(id);
      showToast("Product removed.", "");
      await updateTrackedBadge();
      renderTrackedList();
    });
  });

  // URL links — open in new tab via chrome.tabs.create (popup context)
  list.querySelectorAll(".ti-url").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
  });
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function openEditModal(prod) {
  editingProductId = prod.id;
  $("edit-product-name").textContent = prod.name;
  $("edit-current-target").textContent = prod.targetPrice ? formatPrice(prod.targetPrice) : "Not set";
  $("edit-target-input").value = prod.targetPrice || "";
  $("edit-modal").style.display = "";
  setTimeout(() => $("edit-target-input").focus(), 50);
}

$("btn-edit-save").addEventListener("click", async () => {
  if (!editingProductId) return;
  const v = parseFloat($("edit-target-input").value);
  if (!$("edit-target-input").value || isNaN(v) || v <= 0) {
    showToast("Please enter a valid target price.", "error"); return;
  }
  await DB.updateProduct(editingProductId, { targetPrice: v, alerted: false });
  showToast("✓ Target updated!", "success");
  $("edit-modal").style.display = "none";
  editingProductId = null;
  renderTrackedList();
});

$("btn-edit-remove").addEventListener("click", async () => {
  if (!editingProductId) return;
  const products = await DB.getAllProducts();
  const prod = products.find(p => p.id === editingProductId);
  if (!prod) return;
  if (!confirm(`Remove "${prod.name}"?`)) return;
  await DB.removeProduct(editingProductId);
  showToast("Product removed.", "");
  $("edit-modal").style.display = "none";
  editingProductId = null;
  await updateTrackedBadge();
  renderTrackedList();
});

$("btn-edit-modal-close").addEventListener("click", () => {
  $("edit-modal").style.display = "none"; editingProductId = null;
});
$("edit-modal").addEventListener("click", e => {
  if (e.target === $("edit-modal")) { $("edit-modal").style.display = "none"; editingProductId = null; }
});
// Save on Enter key
$("edit-target-input").addEventListener("keydown", e => {
  if (e.key === "Enter") $("btn-edit-save").click();
});

// ─── Test Notification ────────────────────────────────────────────────────────
$("btn-test-notif").addEventListener("click", () => {
  chrome.notifications.create(`test-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "🎯 PriceWatch PH — Test",
    message: "Notifications are working! You'll be alerted here when a tracked price is met.",
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `pricewatch-ph-${new Date().toISOString().slice(0, 10)}.json`;
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
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `pricewatch-ph-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  $("export-modal").style.display = "none";
  showToast("✓ CSV exported!", "success");
});

// ─── Badge ────────────────────────────────────────────────────────────────────
async function updateTrackedBadge() {
  const p = await DB.getAllProducts();
  $("tracked-count").textContent = p.length;
}

async function updateAlertsBadge() {
  const { notif_log: logs = [] } = await chrome.storage.local.get("notif_log");
  const count = logs.length;
  const el = $("alerts-count");
  el.textContent = count;
  el.style.display = count > 0 ? "" : "none";
}

// ─── Alerts List ──────────────────────────────────────────────────────────────
async function renderAlertsList() {
  const { notif_log: logs = [] } = await chrome.storage.local.get("notif_log");
  const list = $("alerts-list");
  list.innerHTML = "";

  if (!logs.length) { $("alerts-empty").style.display = ""; return; }
  $("alerts-empty").style.display = "none";

  // Show newest first
  [...logs].reverse().forEach(log => {
    const el = document.createElement("div");
    el.className = "alert-item alert-item--" + (log.type || "change");

    const icons = {
      target: "🎯", drop: "📉", rise: "📈", change: "🔄",
    };
    const icon = icons[log.type] || "🔔";

    const time = new Date(log.timestamp).toLocaleString("en-PH", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    el.innerHTML = `
      <div class="alert-icon">${icon}</div>
      <div class="alert-body">
        <div class="alert-title">${log.title}</div>
        <div class="alert-msg">${log.message.replace(/\n/g, " • ")}</div>
        <div class="alert-time">${time}</div>
      </div>
    `;
    list.appendChild(el);
  });
}

// ─── Force Check Now ──────────────────────────────────────────────────────────
$("btn-force-check").addEventListener("click", async () => {
  const btn = $("btn-force-check");
  const products = await DB.getAllProducts();
  if (!products.length) { showToast("No products being tracked yet.", ""); return; }

  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action: "triggerCheck" }, r => {
        if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
        else res(r);
      });
    });
    showToast("✓ Price check complete!", "success");
    await renderAlertsList();
    await updateAlertsBadge();
    await renderTrackedList();
  } catch (_) {
    showToast("Check ran in background.", "success");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Check Prices Now`;
  }
});

// ─── Clear Alerts Log ─────────────────────────────────────────────────────────
$("btn-clear-alerts").addEventListener("click", async () => {
  if (!confirm("Clear all alert history?")) return;
  await chrome.storage.local.remove("notif_log");
  showToast("Alert log cleared.", "");
  renderAlertsList();
  updateAlertsBadge();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  await updateTrackedBadge();
  await updateAlertsBadge();
  await loadCurrentProduct();
})();
