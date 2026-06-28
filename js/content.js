// content.js
// Step 1: Platform Detection via URL pattern matching
// Step 2: DOM Tree Navigation via CSS selector profiles loaded from selectors.json
// Step 3: Raw Price Extraction via textContent
// Step 4: Price Normalization via string replacement + parseFloat()
// Step 5: Threshold Comparison handled in background.js
// Step 6: Storage handled in db.js / background.js
(function () {
  "use strict";

  // ─── Step 1: Platform Detection ──────────────────────────────────
  function detectPlatform() {
    const url = window.location.href;
    if (url.includes("shopee.ph")) return "shopee";
    if (url.includes("lazada.com.ph")) return "lazada";
    return null;
  }

  function isProductPage(platform, config) {
    const url = window.location.href;
    if (!config) return false;
    try {
      const re = new RegExp(config.productPagePattern);
      if (!re.test(url)) return false;
    } catch (_) { return false; }

    if (platform === "shopee") {
      const isHome    = /shopee\.ph\/?$/.test(url) || /shopee\.ph\/\?/.test(url);
      const isSearch  = url.includes("/search") || url.includes("keyword=");
      const isCatList = /shopee\.ph\/(category|mall|collections|brand|shop)\/[^/]+\/?$/.test(url);
      if (isHome || isSearch || isCatList) return false;
    }
    if (platform === "lazada") {
      const isHome   = /lazada\.com\.ph\/?$/.test(url) || /lazada\.com\.ph\/\?/.test(url);
      const isSearch = url.includes("/catalog/") || url.includes("?q=") || url.includes("/tag/");
      if (isHome || isSearch) return false;
    }
    return true;
  }

  // ─── Step 4: Price Normalization ─────────────────────────────────
  // Removes ₱, commas, spaces → parseFloat()
  function normalizePrice(raw) {
    if (!raw) return null;
    const text = raw.trim();

    // Handle range: "₱5,400 - ₱10,000"
    const rangeSplit = text.split(/\s*[-–—]\s*/);
    if (rangeSplit.length >= 2) {
      const a = parseFloat(rangeSplit[0].replace(/[^\d.]/g, ""));
      const b = parseFloat(rangeSplit[rangeSplit.length - 1].replace(/[^\d.]/g, ""));
      if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return {
          price: lo, priceMin: lo, priceMax: hi, isRange: true,
          displayPrice: `₱${lo.toLocaleString("en-PH", { minimumFractionDigits: 2 })} – ₱${hi.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
        };
      }
    }

    // Single price: strip ₱, commas, spaces → parseFloat
    const cleaned = text.replace(/[₱\s,]/g, "").replace(/[^\d.]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num === 0) return null;
    return {
      price: num, priceMin: num, priceMax: num, isRange: false,
      displayPrice: `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    };
  }

  // ─── Step 2 & 3: DOM Navigation + Raw Price Extraction ───────────
  function extractWithSelectors(selectors, excludeStyles) {
    // Step 2: Use document.querySelector() with loaded CSS selector profile
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        // Check exclude styles (skip line-through / faded original prices)
        if (excludeStyles && excludeStyles.length) {
          const cs = window.getComputedStyle(el);
          const td = cs.textDecoration || "";
          const color = cs.color || "";
          if (td.includes("line-through")) continue;
          if (excludeStyles.some(s => color.includes(s) || td.includes(s))) continue;
        }
        // Step 3: Read textContent
        const raw = el.textContent;
        const result = normalizePrice(raw);
        if (result) return result;
      } catch (_) {}
    }
    return null;
  }

  function extractNameWithSelectors(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3) return el.textContent.trim();
      } catch (_) {}
    }
    return null;
  }

  function extractImageShopee(selectors) {
    for (const sel of selectors) {
      try {
        const img = document.querySelector(sel);
        if (!img) continue;
        const srcset = img.getAttribute("srcset") || "";
        const x2 = srcset.split(",").map(s => s.trim()).find(s => s.endsWith("2x"));
        if (x2) { const u = x2.split(/\s+/)[0]; if (u.startsWith("http")) return u; }
        if (img.src && img.src.startsWith("http")) return img.src;
      } catch (_) {}
    }
    // Fallback: susercontent CDN
    for (const el of document.querySelectorAll("img")) {
      const src = el.src || "";
      if (src.includes("susercontent.com") && !src.includes("icon") && !src.includes("avatar") && !src.includes("shop_")) {
        const w = el.naturalWidth || el.width || 0;
        if (w === 0 || w >= 100) return src;
      }
    }
    return null;
  }

  function extractImageLazada(selectors) {
    for (const sel of selectors) {
      try {
        const imgs = document.querySelectorAll(sel);
        for (const img of imgs) {
          const src = img.src || img.getAttribute("data-src") || "";
          if (src.startsWith("http") && !src.includes("icon") && !src.includes("logo")) return src;
        }
      } catch (_) {}
    }
    return null;
  }

  // ─── Shopee structural price fallback ────────────────────────────
  function shopeeStructuralPriceFallback() {
    const candidates = [];
    document.querySelectorAll("div, span").forEach(el => {
      if (el.children.length > 2) return;
      const text = el.textContent.trim();
      if (!text.includes("₱")) return;
      if (text.length > 40) return;
      const cs = window.getComputedStyle(el);
      if ((cs.textDecoration || "").includes("line-through")) return;
      if ((cs.color || "").includes("rgba(0, 0, 0, 0.26)")) return;
      const r = normalizePrice(text);
      if (!r) return;
      candidates.push({ r, len: text.length });
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.len - b.len);
    return candidates[0].r;
  }

  // ─── Main Extraction ──────────────────────────────────────────────
  // Uses config loaded from selectors.json
  let _config = null;

  async function loadConfig() {
    if (_config) return _config;
    try {
      const url = chrome.runtime.getURL("config/selectors.json");
      const res = await fetch(url);
      _config = await res.json();
      return _config;
    } catch (_) {
      return null;
    }
  }

  async function extractProductData() {
    const platform = detectPlatform();
    if (!platform) return null;

    const config = await loadConfig();
    const platformConfig = config ? config[platform] : null;

    if (!isProductPage(platform, platformConfig)) {
      return {
        platform, url: window.location.href,
        name: null, price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image: null,
        extractedAt: new Date().toISOString(),
        error: "not_a_product_page",
      };
    }

    const sel = platformConfig ? platformConfig.selectors : null;
    let priceResult = null;
    let name = null;
    let image = null;

    if (platform === "shopee") {
      // Step 2+3: DOM navigation + raw extraction using loaded selector profile
      priceResult = sel ? extractWithSelectors(sel.price, sel.priceExcludeStyle) : null;
      // Structural fallback if config selectors miss
      if (!priceResult) priceResult = shopeeStructuralPriceFallback();
      name  = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageShopee(sel.image) : null;
    } else {
      // Lazada
      priceResult = sel ? extractWithSelectors(sel.price, null) : null;
      // Fallback selectors
      if (!priceResult && sel && sel.priceFallback) {
        priceResult = extractWithSelectors(sel.priceFallback, null);
      }
      name  = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageLazada(sel.image) : null;
    }

    const finalName = name || document.title || "Unknown Product";

    if (!priceResult) {
      return {
        platform, url: window.location.href, name: finalName,
        price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image,
        extractedAt: new Date().toISOString(),
        error: "Could not read the price. If this product has variants, select one first then click the extension again.",
      };
    }

    return {
      platform, url: window.location.href, name: finalName,
      price: priceResult.price, priceMin: priceResult.priceMin,
      priceMax: priceResult.priceMax, isRange: priceResult.isRange,
      displayPrice: priceResult.displayPrice, image,
      extractedAt: new Date().toISOString(), error: null,
    };
  }

  // ─── Live watcher: push updates on variant/image changes ─────────
  let watcherTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(watcherTimeout);
    watcherTimeout = setTimeout(async () => {
      const data = await extractProductData();
      if (data && data.error !== "not_a_product_page") {
        try { chrome.runtime.sendMessage({ action: "productUpdated", data }); } catch (_) {}
      }
    }, 400);
  });

  async function startWatcher() {
    const platform = detectPlatform();
    if (!platform) return;
    const config = await loadConfig();
    const platformConfig = config ? config[platform] : null;
    if (!isProductPage(platform, platformConfig)) return;

    const targets = [];
    if (platform === "shopee") {
      const p = document.querySelector(".jRlVo0") || document.querySelector("[class*='product-price']");
      const i = document.querySelector(".UdI7e2") || document.querySelector("picture.UkIsx8");
      if (p) targets.push(p);
      if (i) targets.push(i);
    } else {
      const p = document.querySelector("[class*='pdp-v2-product-price']");
      const g = document.querySelector("[class*='gallery-preview-panel']");
      if (p) targets.push(p);
      if (g) targets.push(g);
    }
    if (!targets.length) targets.push(document.body);
    targets.forEach(t => observer.observe(t, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "srcset", "class"], characterData: true,
    }));
  }

  if (document.readyState === "complete") startWatcher();
  else window.addEventListener("load", startWatcher, { once: true });
  setTimeout(startWatcher, 2000);

  // ─── Message Listener ─────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "extractProduct" || msg.action === "checkPrice") {
      extractProductData().then(data => {
        if (data && data.price !== null) { sendResponse({ success: true, data }); return; }
        setTimeout(async () => {
          sendResponse({ success: true, data: await extractProductData() });
        }, 2000);
      });
      return true;
    }
  });
})();
