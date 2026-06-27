// content.js – Runs on Shopee PH and Lazada PH product pages
(function () {
  "use strict";

  function detectPlatform() {
    const url = window.location.href;
    if (url.includes("shopee.ph")) return "shopee";
    if (url.includes("lazada.com.ph")) return "lazada";
    return null;
  }

  // ─── Price Normalization ──────────────────────────────────────────
  function normalizePrice(raw) {
    if (!raw) return null;
    const text = raw.trim();

    // Detect range: "₱5,400 - ₱10,000" or "5400–10000"
    const rangeSplit = text.split(/\s*[-–—]\s*/);
    if (rangeSplit.length >= 2) {
      const a = parseFloat(rangeSplit[0].replace(/[^\d.]/g, ""));
      const b = parseFloat(rangeSplit[rangeSplit.length - 1].replace(/[^\d.]/g, ""));
      if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return {
          price: lo,
          priceMin: lo,
          priceMax: hi,
          isRange: true,
          displayPrice: `₱${lo.toLocaleString("en-PH", { minimumFractionDigits: 2 })} – ₱${hi.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
        };
      }
    }

    // Single price
    const num = parseFloat(text.replace(/[^\d.]/g, ""));
    if (isNaN(num) || num === 0) return null;
    return {
      price: num,
      priceMin: num,
      priceMax: num,
      isRange: false,
      displayPrice: `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    };
  }

  // ─── Shopee Image Extraction ──────────────────────────────────────
  // Confirmed structure from inspect:
  //   div.UdI7e2 > picture.UkIsx8 > img.uXN1L5.fMm3P2
  // The img has a plain `src` (no resize suffix) which is the full image.
  // srcset has @resize_w450 and @resize_w900 variants — we prefer w900.
  function getShopeeImage() {
    // Primary: exact confirmed selector
    const img = document.querySelector(".UdI7e2 img") ||
                document.querySelector(".UdI7e2 picture img") ||
                document.querySelector("div.UdI7e2 img.uXN1L5");

    if (img) {
      // Prefer the 2x srcset (900px) for best quality
      const srcset = img.getAttribute("srcset") || "";
      const srcset2x = srcset.split(",").find((s) => s.trim().endsWith("2x"));
      if (srcset2x) {
        const url = srcset2x.trim().split(/\s+/)[0];
        if (url && url.startsWith("http")) return url;
      }
      // Fall back to plain src
      if (img.src && img.src.startsWith("http")) return img.src;
    }

    // Fallback: any img inside the picture element with UkIsx8 class
    const picture = document.querySelector("picture.UkIsx8");
    if (picture) {
      const fallbackImg = picture.querySelector("img");
      if (fallbackImg && fallbackImg.src && fallbackImg.src.startsWith("http")) {
        return fallbackImg.src;
      }
      // Try source srcset
      const source = picture.querySelector("source[type='image/webp']");
      if (source) {
        const ss = source.getAttribute("srcset") || "";
        const ss2x = ss.split(",").find((s) => s.trim().endsWith("2x"));
        if (ss2x) {
          const url = ss2x.trim().split(/\s+/)[0];
          if (url && url.startsWith("http")) return url;
        }
      }
    }

    // Last resort: find any susercontent image that isn't tiny
    const allImgs = document.querySelectorAll("img");
    for (const el of allImgs) {
      const src = el.src || "";
      if (
        src.includes("susercontent.com") &&
        !src.includes("icon") &&
        !src.includes("avatar") &&
        !src.includes("shop_") &&
        (el.naturalWidth === 0 || el.naturalWidth >= 100)
      ) {
        return src;
      }
    }

    return null;
  }

  // ─── Shopee Price Extraction ──────────────────────────────────────
  // Confirmed: <div class="IZPeQz B67UQ0">₱1,889</div>
  // Parent:    <div class="jRlVo0">
  function getShopeePrice() {
    // Approach 1: exact known obfuscated classes (current June 2026)
    const knownSelectors = [
      ".IZPeQz.B67UQ0",
      ".jRlVo0 .IZPeQz",
      ".jRlVo0 div",
      ".jRlVo0 span",
    ];
    for (const sel of knownSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text.includes("₱") || /^\d/.test(text)) {
            const r = normalizePrice(text);
            if (r) return r;
          }
        }
      } catch (_) {}
    }

    // Approach 2: structural scan — short elements with ₱
    const candidates = [];
    document.querySelectorAll("div, span").forEach((el) => {
      if (el.children.length > 2) return;
      const text = el.textContent.trim();
      if (!text.includes("₱")) return;
      if (text.length > 40) return;
      const r = normalizePrice(text);
      if (!r) return;
      candidates.push({ r, len: text.length });
    });
    if (candidates.length) {
      candidates.sort((a, b) => a.len - b.len);
      return candidates[0].r;
    }
    return null;
  }

  // ─── Shopee Name Extraction ───────────────────────────────────────
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
    let name = null;
    let image = null;

    // Price: only salePrice, never originalPrice
    const salePriceEl = document.querySelector(
      ".pdp-v2-product-price-content-salePrice-amount"
    );
    if (salePriceEl) {
      priceResult = normalizePrice(salePriceEl.textContent);
    }
    if (!priceResult) {
      const els = document.querySelectorAll(
        "[class*='pdp-v2-product-price-content'][class*='amount']:not([class*='originalPrice'])"
      );
      for (const el of els) {
        priceResult = normalizePrice(el.textContent);
        if (priceResult) break;
      }
    }

    // Name
    const nameSelectors = [
      ".pdp-product-title",
      "[class*='pdp-product-title']",
      "h1.pdp-mod-product-badge-title",
      "[class*='title--wrap'] span",
      "h1[class*='title']",
      "h1",
    ];
    for (const sel of nameSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3) { name = el.textContent.trim(); break; }
      } catch (_) {}
    }

    // Image
    const imageSelectors = [
      ".gallery-preview-panel__image img",
      "[class*='gallery-preview-panel'] img",
      "[class*='image-view__image'] img",
      "[class*='module-pdp-image'] img",
    ];
    for (const sel of imageSelectors) {
      try {
        const imgs = Array.from(document.querySelectorAll(sel));
        for (const img of imgs) {
          const src = img.src || img.getAttribute("data-src") || "";
          if (src.startsWith("http") && !src.includes("icon") && !src.includes("logo")) {
            image = src;
            break;
          }
        }
        if (image) break;
      } catch (_) {}
    }
    if (!image) {
      const fallback = document.querySelector("main img, [class*='pdp'] img");
      if (fallback) image = fallback.src || fallback.getAttribute("data-src") || null;
    }

    return { name, priceResult, image };
  }

  // ─── Shopee Extraction ────────────────────────────────────────────
  function extractShopee() {
    return {
      name: getShopeeName(),
      priceResult: getShopeePrice(),
      image: getShopeeImage(),
    };
  }

  // ─── Main Extraction ──────────────────────────────────────────────
  function extractProductData() {
    const platform = detectPlatform();
    if (!platform) return null;

    const { name, priceResult, image } =
      platform === "shopee" ? extractShopee() : extractLazada();

    const finalName = name || document.title || "Unknown Product";

    if (!priceResult) {
      return {
        platform,
        url: window.location.href,
        name: finalName,
        price: null,
        priceMin: null,
        priceMax: null,
        isRange: false,
        displayPrice: null,
        image,
        extractedAt: new Date().toISOString(),
        error: "Could not read the price. If this product has variants, select one first then click the extension again.",
      };
    }

    return {
      platform,
      url: window.location.href,
      name: finalName,
      price: priceResult.price,
      priceMin: priceResult.priceMin,
      priceMax: priceResult.priceMax,
      isRange: priceResult.isRange,
      displayPrice: priceResult.displayPrice,
      image,
      extractedAt: new Date().toISOString(),
      error: null,
    };
  }

  // ─── Live DOM Watcher (variant/image changes) ─────────────────────
  // When user clicks a variant on Shopee or Lazada, the price and image
  // update in-place via React/Vue state. We watch for those DOM changes
  // and push updated data to the popup automatically.
  let watcherTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(watcherTimeout);
    // Debounce: wait 400ms after the last mutation before re-extracting
    watcherTimeout = setTimeout(() => {
      const data = extractProductData();
      if (data) {
        // Notify popup if it's open
        try {
          chrome.runtime.sendMessage({ action: "productUpdated", data });
        } catch (_) {
          // Popup is closed — no-op
        }
      }
    }, 400);
  });

  // Watch the price and image containers for changes
  function startWatcher() {
    const platform = detectPlatform();
    if (!platform) return;

    // Target the containers that change when a variant is selected
    const targets = [];

    if (platform === "shopee") {
      // Price container
      const priceContainer = document.querySelector(".jRlVo0") ||
        document.querySelector("[class*='product-price']");
      if (priceContainer) targets.push(priceContainer);

      // Image container
      const imgContainer = document.querySelector(".UdI7e2") ||
        document.querySelector("picture.UkIsx8");
      if (imgContainer) targets.push(imgContainer);

      // Fallback: watch the whole main content area
      if (!targets.length) {
        const main = document.querySelector("main") || document.body;
        targets.push(main);
      }
    } else {
      // Lazada: watch the price block and gallery
      const priceBlock = document.querySelector("[class*='pdp-v2-product-price']") ||
        document.querySelector("[class*='pdp-price']");
      if (priceBlock) targets.push(priceBlock);

      const gallery = document.querySelector("[class*='gallery-preview-panel']");
      if (gallery) targets.push(gallery);

      if (!targets.length) {
        const main = document.querySelector("main") || document.body;
        targets.push(main);
      }
    }

    targets.forEach((target) => {
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "class"],
        characterData: true,
      });
    });
  }

  // Start watching after page settles
  if (document.readyState === "complete") {
    startWatcher();
  } else {
    window.addEventListener("load", startWatcher, { once: true });
  }
  // Also try after a delay for SPAs that mount late
  setTimeout(startWatcher, 2000);

  // ─── Message Listener ─────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "extractProduct" || msg.action === "checkPrice") {
      const first = extractProductData();
      if (first && first.price !== null) {
        sendResponse({ success: true, data: first });
        return true;
      }
      setTimeout(() => {
        sendResponse({ success: true, data: extractProductData() });
      }, 2000);
      return true;
    }
  });
})();