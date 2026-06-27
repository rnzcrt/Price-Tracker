// content.js – Runs on Shopee PH and Lazada PH product pages
(function () {
  "use strict";

  function detectPlatform() {
    const url = window.location.href;
    if (url.includes("shopee.ph")) return "shopee";
    if (url.includes("lazada.com.ph")) return "lazada";
    return null;
  }

  // ─── Is this actually a product detail page? ─────────────────────
  // Reject: Shopee home, search results, category pages
  // Accept: only /product/ or /<shop>/<item-id> style URLs
  function isProductPage(platform) {
    const url = window.location.href;
    if (platform === "shopee") {
      // Valid:   shopee.ph/shop-name/product-name-i.SELLER.ITEM
      //          shopee.ph/product/SELLER/ITEM
      // Invalid: shopee.ph/  (home)
      //          shopee.ph/search?keyword=...
      //          shopee.ph/category/...
      //          shopee.ph/mall/...  (category listing)
      const isHome = /shopee\.ph\/?$/.test(url) || /shopee\.ph\/\?/.test(url);
      const isSearch = url.includes("/search") || url.includes("keyword=");
      const isCategoryList = /shopee\.ph\/(category|mall|collections|brand|shop)\/[^/]+\/?$/.test(url);
      if (isHome || isSearch || isCategoryList) return false;
      // Must have the item ID pattern: -i.digits.digits  OR  /product/digits/digits
      const hasItemId = /\-i\.\d+\.\d+/.test(url) || /\/product\/\d+\/\d+/.test(url);
      return hasItemId;
    }
    if (platform === "lazada") {
      // Valid:   lazada.com.ph/products/...html  or  lazada.com.ph/...i424...s25...html
      // Invalid: lazada.com.ph/  (home), /catalog/, /tag/, search
      const isHome = /lazada\.com\.ph\/?$/.test(url) || /lazada\.com\.ph\/\?/.test(url);
      const isSearch = url.includes("/catalog/") || url.includes("?q=") || url.includes("/tag/");
      if (isHome || isSearch) return false;
      return url.includes("/products/") || /i\d{5,}/.test(url);
    }
    return false;
  }

  // ─── Price Normalization ──────────────────────────────────────────
  function normalizePrice(raw) {
    if (!raw) return null;
    const text = raw.trim();
    // Detect range
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
    const num = parseFloat(text.replace(/[^\d.]/g, ""));
    if (isNaN(num) || num === 0) return null;
    return {
      price: num, priceMin: num, priceMax: num, isRange: false,
      displayPrice: `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    };
  }

  // ─── Shopee: get the CURRENT (discounted/selling) price only ─────
  // Shopee shows discounted price in a specific container.
  // The original/crossed-out price is in a separate element with
  // class containing "origin" or "before-discount" or similar.
  // We must grab ONLY the current selling price.
  function getShopeePrice() {
    // Strategy: find the price section, then get the FIRST/main price
    // (not the strikethrough original price)

    // Approach 1: known exact classes (June 2026)
    // .IZPeQz.B67UQ0 is the current price div
    // The original price is usually in a separate div with lower opacity
    // or a line-through style — we check for that and skip it
    const knownSelectors = [
      ".IZPeQz.B67UQ0",
      ".jRlVo0 .IZPeQz",
      ".jRlVo0 > div",
      ".jRlVo0 > span",
    ];
    for (const sel of knownSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          // Skip if it has line-through styling (original/crossed-out price)
          const style = window.getComputedStyle(el);
          if (style.textDecoration && style.textDecoration.includes("line-through")) continue;
          if (style.opacity && parseFloat(style.opacity) < 0.6) continue;
          const text = el.textContent.trim();
          if (text.includes("₱") || /\d/.test(text)) {
            const r = normalizePrice(text);
            if (r) return r;
          }
        }
      } catch (_) {}
    }

    // Approach 2: structural scan
    // Collect all short ₱-containing elements, filter out line-through ones
    const candidates = [];
    document.querySelectorAll("div, span").forEach((el) => {
      if (el.children.length > 2) return;
      const text = el.textContent.trim();
      if (!text.includes("₱")) return;
      if (text.length > 40) return;
      // Skip crossed-out original prices
      const style = window.getComputedStyle(el);
      if (style.textDecoration && style.textDecoration.includes("line-through")) return;
      if (style.color && style.color.includes("rgba(0, 0, 0, 0.26)")) return; // faded original price
      const r = normalizePrice(text);
      if (!r) return;
      candidates.push({ r, len: text.length, el });
    });
    if (candidates.length) {
      candidates.sort((a, b) => a.len - b.len);
      return candidates[0].r;
    }
    return null;
  }

  // ─── Shopee: get main product image ──────────────────────────────
  // Confirmed structure: div.UdI7e2 > picture.UkIsx8 > img.uXN1L5
  function getShopeeImage() {
    // Primary: exact confirmed selectors
    const img = document.querySelector(".UdI7e2 img.uXN1L5") ||
                document.querySelector(".UdI7e2 picture img") ||
                document.querySelector(".UdI7e2 img");
    if (img) {
      // Prefer 2x srcset for quality
      const srcset = img.getAttribute("srcset") || "";
      const parts = srcset.split(",").map(s => s.trim());
      const x2 = parts.find(s => s.endsWith("2x"));
      if (x2) {
        const url = x2.split(/\s+/)[0];
        if (url && url.startsWith("http")) return url;
      }
      if (img.src && img.src.startsWith("http")) return img.src;
    }

    // Fallback: picture.UkIsx8
    const picture = document.querySelector("picture.UkIsx8");
    if (picture) {
      const src = picture.querySelector("source[type='image/webp']");
      if (src) {
        const ss = src.getAttribute("srcset") || "";
        const x2 = ss.split(",").map(s => s.trim()).find(s => s.endsWith("2x"));
        if (x2) { const u = x2.split(/\s+/)[0]; if (u.startsWith("http")) return u; }
      }
      const fi = picture.querySelector("img");
      if (fi && fi.src && fi.src.startsWith("http")) return fi.src;
    }

    // Last resort: any susercontent image large enough
    for (const el of document.querySelectorAll("img")) {
      const src = el.src || "";
      if (src.includes("susercontent.com") && !src.includes("icon") && !src.includes("avatar") && !src.includes("shop_")) {
        const w = el.naturalWidth || el.width || 0;
        if (w === 0 || w >= 100) return src;
      }
    }
    return null;
  }

  // ─── Shopee: get product name ────────────────────────────────────
  function getShopeeName() {
    const selectors = [
      "[class*='product-name'] span",
      "[class*='product-name']",
      "[class*='pdp-product-title']",
      ".page-product h1",
      "main h1",
      "h1",
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3) return el.textContent.trim();
      } catch (_) {}
    }
    return null;
  }

  // ─── Lazada Extraction ────────────────────────────────────────────
  function extractLazada() {
    let priceResult = null;
    const salePriceEl = document.querySelector(".pdp-v2-product-price-content-salePrice-amount");
    if (salePriceEl) priceResult = normalizePrice(salePriceEl.textContent);
    if (!priceResult) {
      const els = document.querySelectorAll("[class*='pdp-v2-product-price-content'][class*='amount']:not([class*='originalPrice'])");
      for (const el of els) { priceResult = normalizePrice(el.textContent); if (priceResult) break; }
    }

    let name = null;
    for (const sel of [".pdp-product-title","[class*='pdp-product-title']","h1.pdp-mod-product-badge-title","[class*='title--wrap'] span","h1"]) {
      try { const el = document.querySelector(sel); if (el && el.textContent.trim().length > 3) { name = el.textContent.trim(); break; } } catch (_) {}
    }

    let image = null;
    for (const sel of [".gallery-preview-panel__image img","[class*='gallery-preview-panel'] img","[class*='image-view__image'] img","[class*='module-pdp-image'] img","main img"]) {
      try {
        const imgs = document.querySelectorAll(sel);
        for (const img of imgs) {
          const src = img.src || img.getAttribute("data-src") || "";
          if (src.startsWith("http") && !src.includes("icon") && !src.includes("logo")) { image = src; break; }
        }
        if (image) break;
      } catch (_) {}
    }

    return { name, priceResult, image };
  }

  // ─── Main Extraction ──────────────────────────────────────────────
  function extractProductData() {
    const platform = detectPlatform();
    if (!platform) return null;

    // Hard-stop: don't run on non-product pages
    if (!isProductPage(platform)) {
      return {
        platform, url: window.location.href,
        name: null, price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image: null,
        extractedAt: new Date().toISOString(),
        error: "not_a_product_page",
      };
    }

    const { name, priceResult, image } =
      platform === "shopee"
        ? { name: getShopeeName(), priceResult: getShopeePrice(), image: getShopeeImage() }
        : extractLazada();

    const finalName = name || document.title || "Unknown Product";

    if (!priceResult) {
      return {
        platform, url: window.location.href, name: finalName,
        price: null, priceMin: null, priceMax: null, isRange: false, displayPrice: null, image,
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

  // ─── Live watcher: push updates when variant/image changes ───────
  let watcherTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(watcherTimeout);
    watcherTimeout = setTimeout(() => {
      const data = extractProductData();
      if (data && data.error !== "not_a_product_page") {
        try { chrome.runtime.sendMessage({ action: "productUpdated", data }); } catch (_) {}
      }
    }, 400);
  });

  function startWatcher() {
    const platform = detectPlatform();
    if (!platform || !isProductPage(platform)) return;
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
      const first = extractProductData();
      if (first && first.price !== null) { sendResponse({ success: true, data: first }); return true; }
      setTimeout(() => { sendResponse({ success: true, data: extractProductData() }); }, 2000);
      return true;
    }
  });
})();
