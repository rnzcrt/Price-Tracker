// popup.js – Controls the extension popup UI
"use strict";

// ─── State ────────────────────────────────────────────────────────────────────
let currentProductData = null;
let currentTrackedProduct = null;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const stateUnsupported      = $("state-unsupported");
const stateLoading          = $("state-loading");
const stateError            = $("state-error");
const stateProduct          = $("state-product");
const errorMsg              = $("error-msg");

const platformHeadliner     = $("platform-headliner");
const platformHeadlinerText = $("platform-headliner-text");

const productImg             = $("product-img");
const productName            = $("product-name");
const productPrice           = $("product-price");
const variantNotice          = $("variant-notice");

const alreadyTracked         = $("already-tracked");
const targetSection          = $("target-section");
const updateSection          = $("update-section");
const targetInput            = $("target-price-input");
const updateInput            = $("update-price-input");
const currentTargetDisplay   = $("current-target-display");
const trackingNote           = $("tracking-note");

const trackedCount  = $("tracked-count");
const trackedList   = $("tracked-list");
const trackedEmpty  = $("tracked-empty");
const exportModal   = $("export-modal");
const toast         = $("toast");

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatPrice(num) {
  if (num == null || isNaN(num)) return "—";
  return "₱" + Number(num).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDisplayPrice(data) {
  // If we have a pre-built displayPrice string from the extractor, use it
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
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => { toast.className = "toast"; }, 3000);
}

function showState(which) {
  [stateUnsupported, stateLoading, stateError, stateProduct].forEach((el) => {
    if (el) el.style.display = "none";
  });
  if (which) which.style.display = "";
}

// ─── Platform Headliner ───────────────────────────────────────────────────────
function setHeadliner(platform) {
  if (platform === "lazada") {
    platformHeadliner.classList.add("lazada");
    platformHeadlinerText.textContent = "LAZADA PH";
  } else {
    platformHeadliner.classList.remove("lazada");
    platformHeadlinerText.textContent = "SHOPEE PH";
  }
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + tab).classList.add("active");
    if (tab === "tracked") renderTrackedList();
  });
});

// ─── Load Current Page Product ───────────────────────────────────────────────
async function loadCurrentProduct() {
  showState(stateLoading);

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {
    showState(stateUnsupported);
    return;
  }

  if (!tab) { showState(stateUnsupported); return; }

  const url = tab.url || "";
  const isShopee = url.includes("shopee.ph");
  const isLazada = url.includes("lazada.com.ph");

  if (!isShopee && !isLazada) {
    showState(stateUnsupported);
    return;
  }

  function askContentScript() {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: "extractProduct" }, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });
  }

  async function injectAndAsk() {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["js/content.js"],
    });
    await new Promise((r) => setTimeout(r, 600));
    return askContentScript();
  }

  try {
    let response;
    try {
      response = await askContentScript();
    } catch (_) {
      response = await injectAndAsk();
    }

    if (!response || !response.data) throw new Error("No response.");

    const data = response.data;
    currentProductData = data;

    if (data.error || data.price === null) {
      showState(stateError);
      errorMsg.textContent = data.error ||
        "Could not read the price. If this product has variants, select one first then click Try Again.";
      return;
    }

    renderProductCard(data);
    await checkIfTracked(data.url);
    showState(stateProduct);

  } catch (err) {
    try {
      const response = await injectAndAsk();
      if (response && response.data && response.data.price !== null) {
        currentProductData = response.data;
        renderProductCard(response.data);
        await checkIfTracked(response.data.url);
        showState(stateProduct);
      } else {
        showState(stateError);
        errorMsg.textContent = response?.data?.error ||
          "Could not read this product page. Make sure the page is fully loaded, then click Try Again.";
      }
    } catch (_) {
      showState(stateError);
      errorMsg.textContent =
        "Could not connect to the page. Make sure you are on a Shopee PH or Lazada PH product page.";
    }
  }
}

// ─── Render Product Card ─────────────────────────────────────────────────────
function renderProductCard(data) {
  setHeadliner(data.platform);

  // ── Image
  const imgWrap = productImg.parentElement;
  if (data.image) {
    productImg.src = data.image;
    productImg.alt = data.name;
    productImg.style.display = "";
    productImg.onerror = () => {
      productImg.style.display = "none";
      if (!imgWrap.querySelector(".no-img")) {
        imgWrap.innerHTML = '<span class="no-img">🛍️</span>';
      }
    };
  } else {
    productImg.style.display = "none";
    imgWrap.innerHTML = '<span class="no-img">🛍️</span>';
  }

  // ── Name
  productName.textContent = data.name;

  // ── Price — show range if applicable
  productPrice.textContent = formatDisplayPrice(data);

  // ── Variant notice: show if price is a range (no variant selected yet)
  if (data.isRange) {
    variantNotice.style.display = "flex";
    variantNotice.querySelector(".vn-text").textContent =
      "Price range shown. Select a variant on the page for an exact price, then click refresh.";
  } else {
    variantNotice.style.display = "none";
  }
}

// ─── Check If Already Tracked ─────────────────────────────────────────────────
async function checkIfTracked(url) {
  const products = await DB.getAllProducts();
  currentTrackedProduct = products.find((p) => p.url === url) || null;

  if (currentTrackedProduct) {
    alreadyTracked.style.display = "flex";
    targetSection.style.display = "none";
    updateSection.style.display = "";

    const tp = currentTrackedProduct.targetPrice;
    currentTargetDisplay.textContent = tp ? formatPrice(tp) : "Not set";
    updateInput.value = tp || "";
  } else {
    alreadyTracked.style.display = "none";
    targetSection.style.display = "";
    updateSection.style.display = "none";
    targetInput.value = "";

    // Show note if it's a range price
    if (currentProductData && currentProductData.isRange) {
      trackingNote.style.display = "";
      trackingNote.textContent = `⚠ Range price detected. The lower bound (${formatPrice(currentProductData.priceMin)}) will be used for tracking. Select a variant for exact tracking.`;
    } else {
      trackingNote.style.display = "none";
    }
  }
}

// ─── Track Product ────────────────────────────────────────────────────────────
$("btn-track").addEventListener("click", async () => {
  if (!currentProductData) return;

  const targetVal = parseFloat(targetInput.value);
  if (!targetInput.value || isNaN(targetVal) || targetVal <= 0) {
    showToast("Please enter a valid target price.", "error");
    targetInput.focus();
    return;
  }

  const result = await DB.saveProduct({
    name: currentProductData.name,
    url: currentProductData.url,
    platform: currentProductData.platform,
    image: currentProductData.image,
    price: currentProductData.price,
    priceMin: currentProductData.priceMin,
    priceMax: currentProductData.priceMax,
    isRange: currentProductData.isRange,
    displayPrice: currentProductData.displayPrice,
    targetPrice: targetVal,
  });

  if (result.success) {
    await DB.addHistoryEntry(result.product.id, currentProductData.price);
    currentTrackedProduct = result.product;
    showToast("✓ Product is now being tracked!", "success");
    await checkIfTracked(currentProductData.url);
    await updateTrackedBadge();
  } else {
    showToast(result.error || "Could not add product.", "error");
  }
});

// ─── Update Target ────────────────────────────────────────────────────────────
$("btn-update-target").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;

  const targetVal = parseFloat(updateInput.value);
  if (!updateInput.value || isNaN(targetVal) || targetVal <= 0) {
    showToast("Please enter a valid target price.", "error");
    updateInput.focus();
    return;
  }

  await DB.updateProduct(currentTrackedProduct.id, {
    targetPrice: targetVal,
    alerted: false,
  });

  currentTrackedProduct.targetPrice = targetVal;
  currentTargetDisplay.textContent = formatPrice(targetVal);
  showToast("✓ Target price updated!", "success");
});

// ─── Remove ───────────────────────────────────────────────────────────────────
$("btn-remove").addEventListener("click", async () => {
  if (!currentTrackedProduct) return;
  if (!confirm(`Remove "${currentTrackedProduct.name}" from tracking?`)) return;

  await DB.removeProduct(currentTrackedProduct.id);
  currentTrackedProduct = null;
  showToast("Product removed from tracking.", "");
  await checkIfTracked(currentProductData.url);
  await updateTrackedBadge();
});

$("btn-retry").addEventListener("click", () => loadCurrentProduct());
$("btn-refresh").addEventListener("click", () => loadCurrentProduct());

// ─── Render Tracked List ─────────────────────────────────────────────────────
async function renderTrackedList() {
  const products = await DB.getAllProducts();
  trackedList.innerHTML = "";

  if (!products.length) {
    trackedEmpty.style.display = "";
    return;
  }
  trackedEmpty.style.display = "none";

  products.forEach((p) => {
    const isLazada = p.platform === "lazada";
    const platformLabel = isLazada ? "LAZADA PH" : "SHOPEE PH";
    const imgHtml = p.image
      ? `<img src="${p.image}" alt="" onerror="this.style.display='none'">`
      : `🛍️`;

    // Show range if it was a range product
    const priceDisplay = p.isRange && p.priceMin && p.priceMax
      ? `${formatPrice(p.priceMin)} – ${formatPrice(p.priceMax)}`
      : formatPrice(p.lastPrice ?? p.price);

    const targetText = p.targetPrice
      ? `Alert at <strong>${formatPrice(p.targetPrice)}</strong>`
      : "No target set";

    const alertBadge = p.alerted
      ? `<span class="ti-alerted">✓ Alerted</span>`
      : "";

    const lastCheck = p.lastChecked
      ? `Checked ${timeAgo(p.lastChecked)}`
      : "Not yet checked";

    const el = document.createElement("div");
    el.className = "tracked-item";
    el.innerHTML = `
      <div class="ti-headliner ${isLazada ? "lazada" : ""}">
        <span class="ti-dot"></span>
        ${platformLabel}
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
        </div>
        <div class="ti-actions">
          <button class="ti-remove" data-id="${p.id}" title="Remove">✕</button>
          <span class="ti-check">${lastCheck}</span>
        </div>
      </div>
    `;
    trackedList.appendChild(el);
  });

  trackedList.querySelectorAll(".ti-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const prod = products.find((p) => p.id === id);
      if (!prod) return;
      if (!confirm(`Remove "${prod.name}"?`)) return;
      await DB.removeProduct(id);
      showToast("Product removed.", "");
      await updateTrackedBadge();
      renderTrackedList();
    });
  });
}

// ─── Badge Count ──────────────────────────────────────────────────────────────
async function updateTrackedBadge() {
  const products = await DB.getAllProducts();
  trackedCount.textContent = products.length;
}

// ─── Export ───────────────────────────────────────────────────────────────────
$("btn-export").addEventListener("click", () => { exportModal.style.display = ""; });
$("btn-modal-close").addEventListener("click", () => { exportModal.style.display = "none"; });
exportModal.addEventListener("click", (e) => {
  if (e.target === exportModal) exportModal.style.display = "none";
});

$("btn-export-json").addEventListener("click", async () => {
  const data = await DB.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pricewatch-ph-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  exportModal.style.display = "none";
  showToast("✓ JSON exported!", "success");
});

$("btn-export-csv").addEventListener("click", async () => {
  const data = await DB.exportData();
  const rows = [["Product Name", "Platform", "URL", "Current Price", "Price Min", "Price Max", "Is Range", "Target Price", "Added At", "Last Checked", "Alerted"]];
  data.products.forEach((p) => {
    rows.push([
      `"${(p.name || "").replace(/"/g, '""')}"`,
      p.platform === "lazada" ? "Lazada PH" : "Shopee PH",
      p.url,
      p.lastPrice ?? p.price ?? "",
      p.priceMin ?? "",
      p.priceMax ?? "",
      p.isRange ? "Yes" : "No",
      p.targetPrice ?? "",
      p.addedAt ?? "",
      p.lastChecked ?? "",
      p.alerted ? "Yes" : "No",
    ]);
  });
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pricewatch-ph-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  exportModal.style.display = "none";
  showToast("✓ CSV exported!", "success");
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  await updateTrackedBadge();
  await loadCurrentProduct();
})();
