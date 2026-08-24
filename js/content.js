(function () {
  "use strict";
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
    } catch (_) {
      return false;
    }
    if (platform === "shopee") {
      const isHome = /shopee\.ph\/?$/.test(url) || /shopee\.ph\/\?/.test(url);
      const isSearch = url.includes("/search") || url.includes("keyword=");
      const isCatList =
        /shopee\.ph\/(category|mall|collections|brand|shop)\/[^/]+\/?$/.test(
          url,
        );
      if (isHome || isSearch || isCatList) return false;
    }
    if (platform === "lazada") {
      const isHome =
        /lazada\.com\.ph\/?$/.test(url) || /lazada\.com\.ph\/\?/.test(url);
      const isSearch =
        url.includes("/catalog/") ||
        url.includes("?q=") ||
        url.includes("/tag/");
      if (isHome || isSearch) return false;
    }
    return true;
  }
  function normalizePrice(raw) {
    if (!raw) return null;
    const text = raw.trim();
    const rangeSplit = text.split(/\s*[-–—]\s*/);
    if (rangeSplit.length >= 2) {
      const a = parseFloat(rangeSplit[0].replace(/[^\d.]/g, ""));
      const b = parseFloat(
        rangeSplit[rangeSplit.length - 1].replace(/[^\d.]/g, ""),
      );
      if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return {
          price: lo,
          priceMin: lo,
          priceMax: hi,
          isRange: true,
          displayPrice: `₱${lo.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
          })} – ₱${hi.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
          })}`,
        };
      }
    }
    const cleaned = text.replace(/[₱\s,]/g, "").replace(/[^\d.]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num === 0) return null;
    return {
      price: num,
      priceMin: num,
      priceMax: num,
      isRange: false,
      displayPrice: `₱${num.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
      })}`,
    };
  }
  function extractWithSelectors(selectors, excludeStyles) {
    for (const sel of selectors)
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (excludeStyles && excludeStyles.length) {
          const cs = window.getComputedStyle(el);
          const td = cs.textDecoration || "";
          const color = cs.color || "";
          if (td.includes("line-through")) continue;
          if (excludeStyles.some((s) => color.includes(s) || td.includes(s)))
            continue;
        }
        const raw = el.textContent;
        const result = normalizePrice(raw);
        if (result) return result;
      } catch (_) {}
    return null;
  }
  function extractNameWithSelectors(selectors) {
    for (const sel of selectors)
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3)
          return el.textContent.trim();
      } catch (_) {}
    return null;
  }
  function extractVariantTextWithSelectors(selectors) {
    if (!selectors) return null;
    for (const sel of selectors)
      try {
        const el = document.querySelector(sel);
        const t = el && el.textContent.trim();
        if (t && t.length > 0 && t.length <= 40) return t;
      } catch (_) {}
    return null;
  }
  function detectSelectedVariantTextGeneric(containerHints) {
    try {
      const stateTokens = ["selected", "active", "chosen", "checked"];
      const candidates = document.querySelectorAll(
        "button, [role='button'], div, span, a, li",
      );
      for (const el of candidates) {
        const cls =
          typeof el.className === "string" ? el.className.toLowerCase() : "";
        if (!cls || !stateTokens.some((t) => cls.includes(t))) continue;
        if (el.children.length > 1) continue;
        const text = el.textContent.trim();
        if (!text || text.length < 1 || text.length > 30) continue;
        let node = el.parentElement,
          depth = 0,
          insideVariantContainer = false;
        while (node && depth < 6) {
          const pcls =
            typeof node.className === "string"
              ? node.className.toLowerCase()
              : "";
          if (containerHints.some((h) => pcls.includes(h))) {
            insideVariantContainer = true;
            break;
          }
          node = node.parentElement;
          depth++;
        }
        if (insideVariantContainer) return text;
      }
    } catch (_) {}
    return null;
  }
  function detectSelectedVariantLabel(platform, selectors) {
    const configured = selectors
      ? extractVariantTextWithSelectors(selectors.variant)
      : null;
    if (configured) return configured;
    const hints =
      platform === "lazada"
        ? ["sku", "variation", "prop"]
        : ["variation", "sku", "tier", "option"];
    return detectSelectedVariantTextGeneric(hints);
  }
  function normalizeOptionLabel(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }
  function readSelectedShopeeOptions() {
    try {
      const buttons = document.querySelectorAll(
        "button.selection-box-selected[aria-label]",
      );
      const labels = [];
      buttons.forEach((btn) => {
        const t = (btn.getAttribute("aria-label") || "").trim();
        if (t) labels.push(t);
      });
      return labels;
    } catch (_) {
      return [];
    }
  }
  function shopeeHasVariationButtons() {
    try {
      return (
        document.querySelectorAll(
          "button.selection-box-selected, button.selection-box-unselected",
        ).length > 0
      );
    } catch (_) {
      return false;
    }
  }
  function readSelectedLazadaOptions() {
    try {
      const els = document.querySelectorAll(".sku-variable-img-wrap-selected");
      const labels = [];
      els.forEach((el) => {
        const t = el.textContent.trim();
        if (t) labels.push(t);
      });
      return labels;
    } catch (_) {
      return [];
    }
  }
  function lazadaHasVariationSwatches() {
    try {
      return (
        document.querySelectorAll(
          ".sku-variable-img-wrap, .sku-variable-img-wrap-selected",
        ).length > 0
      );
    } catch (_) {
      return false;
    }
  }
  function simulateRealClick(el) {
    try {
      el.scrollIntoView({
        block: "center",
        inline: "center",
      });
    } catch (_) {}
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    };
    const fire = (Ctor, type, extra) => {
      try {
        el.dispatchEvent(
          new Ctor(type, {
            ...base,
            ...extra,
          }),
        );
      } catch (_) {}
    };
    fire(PointerEvent, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
    });
    fire(MouseEvent, "mousedown");
    fire(PointerEvent, "pointerup", {
      pointerId: 1,
      pointerType: "mouse",
    });
    fire(MouseEvent, "mouseup");
    fire(MouseEvent, "click");
  }
  async function selectShopeeOptions(labels) {
    if (!Array.isArray(labels) || !labels.length)
      return {
        resolved: true,
      };
    const targets = labels.map(normalizeOptionLabel).filter(Boolean);
    if (!targets.length)
      return {
        resolved: true,
      };
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let missing = false;
      let disabled = false;
      for (const target of targets) {
        const candidates = document.querySelectorAll(
          "button.selection-box-selected[aria-label], button.selection-box-unselected[aria-label]",
        );
        let found = null;
        for (const btn of candidates)
          if (normalizeOptionLabel(btn.getAttribute("aria-label")) === target) {
            found = btn;
            break;
          }
        if (!found) {
          missing = true;
          continue;
        }
        if (found.getAttribute("aria-disabled") === "true") {
          disabled = true;
          continue;
        }
        if (!found.classList.contains("selection-box-selected"))
          simulateRealClick(found);
      }
      if (missing || disabled)
        return {
          resolved: false,
          reason: disabled ? "disabled" : "missing",
        };
      await new Promise((r) => setTimeout(r, 250));
      const nowSelected = readSelectedShopeeOptions().map(normalizeOptionLabel);
      if (targets.every((t) => nowSelected.includes(t)))
        return {
          resolved: true,
        };
    }
    return {
      resolved: false,
      reason: "click_not_registered",
    };
  }
  async function waitForShopeePriceStabilize(
    priceSelectors,
    priceExcludeStyle,
    timeoutMs,
    intervalMs,
  ) {
    timeoutMs = timeoutMs || 3e3;
    intervalMs = intervalMs || 200;
    const start = Date.now();
    let lastKey = null,
      stableHits = 0,
      lastResult = null;
    while (Date.now() - start < timeoutMs) {
      const result = priceSelectors
        ? extractWithSelectors(priceSelectors, priceExcludeStyle)
        : null;
      if (result) {
        lastResult = result;
        const key = `${result.price}|${result.isRange}`;
        if (key === lastKey) {
          stableHits++;
          if (stableHits >= 2) return result;
        } else stableHits = 0;
        lastKey = key;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return lastResult;
  }
  function matchModelByOptions(models, tierVariations, selectedLabels) {
    if (!Array.isArray(models) || !models.length) return null;
    if (!Array.isArray(tierVariations) || !tierVariations.length) return null;
    if (
      !Array.isArray(selectedLabels) ||
      selectedLabels.length !== tierVariations.length
    )
      return null;
    const tierIndex = new Array(tierVariations.length).fill(-1);
    const usedLabels = new Set();
    tierVariations.forEach((tier, tIdx) => {
      if (!Array.isArray(tier.options)) return;
      for (let lIdx = 0; lIdx < selectedLabels.length; lIdx++) {
        if (usedLabels.has(lIdx)) continue;
        const optIdx = tier.options.findIndex(
          (opt) =>
            normalizeOptionLabel(opt) ===
            normalizeOptionLabel(selectedLabels[lIdx]),
        );
        if (optIdx !== -1) {
          tierIndex[tIdx] = optIdx;
          usedLabels.add(lIdx);
          break;
        }
      }
    });
    if (tierIndex.some((idx) => idx === -1)) return null;
    let match = models.find(
      (m) =>
        Array.isArray(m.tier_index) &&
        m.tier_index.length === tierIndex.length &&
        m.tier_index.every((v, i) => v === tierIndex[i]),
    );
    if (match) return match;
    const targets = selectedLabels.map(normalizeOptionLabel);
    match = models.find((m) => {
      if (typeof m.name !== "string") return false;
      const parts = m.name.split(/[,/]/).map(normalizeOptionLabel);
      return (
        parts.length === targets.length &&
        parts.every((p, i) => p === targets[i])
      );
    });
    return match || null;
  }
  function extractImageShopee(selectors) {
    for (const sel of selectors)
      try {
        const img = document.querySelector(sel);
        if (!img) continue;
        const srcset = img.getAttribute("srcset") || "";
        const x2 = srcset
          .split(",")
          .map((s) => s.trim())
          .find((s) => s.endsWith("2x"));
        if (x2) {
          const u = x2.split(/\s+/)[0];
          if (u.startsWith("http")) return u;
        }
        if (img.src && img.src.startsWith("http")) return img.src;
      } catch (_) {}
    const scope = document.querySelector("main") || document.body;
    for (const el of scope.querySelectorAll("img")) {
      if (el.closest("header, nav")) continue;
      const src = el.src || "";
      if (
        src.includes("susercontent.com") &&
        !src.includes("icon") &&
        !src.includes("avatar") &&
        !src.includes("shop_")
      ) {
        const w = el.naturalWidth || el.width || 0;
        if (w === 0 || w >= 150) return src;
      }
    }
    return null;
  }
  function extractImageLazada(selectors) {
    for (const sel of selectors)
      try {
        const imgs = document.querySelectorAll(sel);
        for (const img of imgs) {
          const src = img.src || img.getAttribute("data-src") || "";
          if (
            src.startsWith("http") &&
            !src.includes("icon") &&
            !src.includes("logo")
          )
            return src;
        }
      } catch (_) {}
    return null;
  }
  const SHOPEE_PROMO_TEXT_DENYLIST =
    /\b(off|voucher|discount|cashback|rebate|shipping|coin|coins|promo|deal|code|arrives late|on-time delivery)\b/i;
  function shopeeStructuralPriceFallback() {
    const candidates = [];
    document.querySelectorAll("div, span").forEach((el) => {
      if (el.children.length > 2) return;
      const text = el.textContent.trim();
      if (!text.includes("₱")) return;
      if (text.length > 40) return;
      const parentText = el.parentElement ? el.parentElement.textContent : "";
      if (
        SHOPEE_PROMO_TEXT_DENYLIST.test(text) ||
        SHOPEE_PROMO_TEXT_DENYLIST.test(parentText)
      )
        return;
      const cs = window.getComputedStyle(el);
      if ((cs.textDecoration || "").includes("line-through")) return;
      if ((cs.color || "").includes("rgba(0, 0, 0, 0.26)")) return;
      const r = normalizePrice(text);
      if (!r) return;
      candidates.push({
        r: r,
        len: text.length,
      });
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.len - b.len);
    return candidates[0].r;
  }
  async function fetchShopeeApiPrice(pageUrl) {
    try {
      const match = (pageUrl || window.location.href).match(/-i\.(\d+)\.(\d+)/);
      if (!match) return null;
      const shopId = match[1];
      const itemId = match[2];
      const resp = await fetch(
        `/api/v4/item/get?itemid=${encodeURIComponent(itemId)}&shopid=${encodeURIComponent(shopId)}`,
        {
          credentials: "same-origin",
        },
      );
      if (!resp.ok) return null;
      const json = await resp.json();
      const item = json?.data;
      if (!item) return null;
      const rawMin = item.price_min ?? item.price;
      const rawMax = item.price_max ?? item.price;
      if (!rawMin || rawMin <= 0) return null;
      const priceMin = rawMin / 1e5;
      const priceMax = rawMax && rawMax > 0 ? rawMax / 1e5 : priceMin;
      if (priceMin < 1 || priceMin > 999999) return null;
      const isRange = priceMax > priceMin;
      const lo = priceMin;
      const hi = priceMax;
      const fmtPHP = (n) =>
        n.toLocaleString("en-PH", {
          minimumFractionDigits: 2,
        });
      const imageKey =
        item.image ||
        (Array.isArray(item.images) ? item.images[0] : null) ||
        null;
      const apiImage = imageKey
        ? `https://down-ph.img.susercontent.com/file/${imageKey}`
        : null;
      const models = Array.isArray(item.models) ? item.models : [];
      const tierVariations = Array.isArray(item.tier_variations)
        ? item.tier_variations
        : [];
      return {
        price: lo,
        priceMin: lo,
        priceMax: hi,
        isRange: isRange,
        displayPrice: isRange
          ? `₱${fmtPHP(lo)} – ₱${fmtPHP(hi)}`
          : `₱${fmtPHP(lo)}`,
        apiName: item.name || null,
        apiImage: apiImage,
        models: models,
        tierVariations: tierVariations,
      };
    } catch (_) {
      return null;
    }
  }
  function buildPriceResultFromModel(model) {
    if (!model) return null;
    const raw = model.price ?? model.price_min ?? model.price_max;
    if (raw == null) return null;
    const price = raw / 1e5;
    if (!(price > 0) || price > 999999) return null;
    return {
      price: price,
      priceMin: price,
      priceMax: price,
      isRange: false,
      displayPrice: `₱${price.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
      })}`,
    };
  }
  function findModelById(models, variantId) {
    if (!Array.isArray(models) || variantId == null) return null;
    return models.find((m) => String(m.modelid) === String(variantId)) || null;
  }
  function matchModelByPrice(models, domPrice) {
    if (!Array.isArray(models) || !models.length || domPrice == null)
      return null;
    const target = Math.round(domPrice * 100);
    const matches = models.filter((m) => {
      const raw = m.price ?? m.price_min ?? m.price_max;
      if (raw == null) return false;
      return Math.round((raw / 1e5) * 100) === target;
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function buildVariantLabel(model, tierVariations) {
    if (!model) return null;
    if (typeof model.name === "string" && model.name.trim()) {
      const parts = model.name
        .split(/[,/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    if (Array.isArray(tierVariations) && Array.isArray(model.tier_index)) {
      const parts = model.tier_index
        .map((optIdx, tierIdx) => {
          const tier = tierVariations[tierIdx];
          return tier && Array.isArray(tier.options)
            ? (tier.options[optIdx] ?? null)
            : null;
        })
        .filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    return null;
  }
  function getShopeeTrustedPrice(domPriceResult, matchedModel, apiResult) {
    if (!domPriceResult || domPriceResult.isRange) return domPriceResult;
    const PRICE_EPSILON = 0.01;
    const modelPrice = matchedModel
      ? buildPriceResultFromModel(matchedModel)
      : null;
    if (modelPrice)
      return Math.abs(modelPrice.price - domPriceResult.price) > PRICE_EPSILON
        ? modelPrice
        : domPriceResult;
    if (apiResult && apiResult.priceMin != null && apiResult.priceMax != null) {
      const withinRange =
        domPriceResult.price >= apiResult.priceMin - PRICE_EPSILON &&
        domPriceResult.price <= apiResult.priceMax + PRICE_EPSILON;
      if (!withinRange) return apiResult;
    }
    return domPriceResult;
  }
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
  async function extractProductData(opts) {
    opts = opts || {};
    const requestedVariantId = opts.variantId != null ? opts.variantId : null;
    const requestedVariantOptions =
      Array.isArray(opts.variantOptions) && opts.variantOptions.length
        ? opts.variantOptions
        : null;
    const platform = detectPlatform();
    if (!platform) return null;
    const config = await loadConfig();
    const platformConfig = config ? config[platform] : null;
    if (!isProductPage(platform, platformConfig))
      return {
        platform: platform,
        url: window.location.href,
        name: null,
        price: null,
        priceMin: null,
        priceMax: null,
        isRange: false,
        displayPrice: null,
        image: null,
        variantId: null,
        variantLabel: null,
        variantOptions: null,
        hasVariants: false,
        extractedAt: new Date().toISOString(),
        error: "not_a_product_page",
      };
    const sel = platformConfig ? platformConfig.selectors : null;
    let priceResult = null;
    let name = null;
    let image = null;
    let variantId = null;
    let variantLabel = null;
    let variantOptions = null;
    let hasVariants = false;
    if (platform === "shopee") {
      const apiResult = await fetchShopeeApiPrice(window.location.href);
      const models = apiResult && apiResult.models ? apiResult.models : [];
      const tierVariations =
        apiResult && apiResult.tierVariations ? apiResult.tierVariations : [];
      hasVariants = models.length > 1 || shopeeHasVariationButtons();
      let matchedModel = null;
      let resolvedOptions = null;
      if (requestedVariantOptions) {
        const clickResult = await selectShopeeOptions(requestedVariantOptions);
        if (!clickResult.resolved) {
          const message =
            clickResult.reason === "click_not_registered"
              ? "Could not automatically re-select this variant on Shopee's page for this refresh. The price shown may be from a different variant — please open the product page, reselect it manually, and try again."
              : "This specific variant could not be found anymore — it may be out of stock or have been removed/renamed by the seller. Open the product page and re-track the variant you want.";
          return {
            platform: platform,
            url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null,
            priceMin: null,
            priceMax: null,
            isRange: false,
            displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId,
            variantLabel: null,
            variantOptions: requestedVariantOptions,
            hasVariants: true,
            variantNotFound: true,
            extractedAt: new Date().toISOString(),
            error: message,
          };
        }
        const domResult = await waitForShopeePriceStabilize(
          sel ? sel.price : null,
          sel ? sel.priceExcludeStyle : null,
        );
        resolvedOptions = readSelectedShopeeOptions();
        if (domResult && !domResult.isRange) priceResult = domResult;
        else
          return {
            platform: platform,
            url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null,
            priceMin: null,
            priceMax: null,
            isRange: false,
            displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId,
            variantLabel: resolvedOptions.join(", ") || null,
            variantOptions: requestedVariantOptions,
            hasVariants: true,
            extractedAt: new Date().toISOString(),
            error:
              "Re-selected the tracked variant but couldn't read its price cleanly afterward. Please try refreshing again.",
          };
      } else if (requestedVariantId != null && models.length) {
        matchedModel = findModelById(models, requestedVariantId);
        if (matchedModel) {
          priceResult = buildPriceResultFromModel(matchedModel);
          variantId = matchedModel.modelid ?? requestedVariantId;
          variantLabel = buildVariantLabel(matchedModel, tierVariations);
        } else
          return {
            platform: platform,
            url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null,
            priceMin: null,
            priceMax: null,
            isRange: false,
            displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId,
            variantLabel: null,
            variantOptions: null,
            hasVariants: true,
            variantNotFound: true,
            extractedAt: new Date().toISOString(),
            error:
              "This specific variant could not be found anymore — it may have been removed or renamed by the seller. Open the product page and re-track the variant you want.",
          };
      } else {
        resolvedOptions = readSelectedShopeeOptions();
        const domResult = sel
          ? extractWithSelectors(sel.price, sel.priceExcludeStyle)
          : null;
        if (domResult) priceResult = domResult;
      }
      if (
        !matchedModel &&
        resolvedOptions &&
        resolvedOptions.length &&
        models.length > 1
      )
        matchedModel = matchModelByOptions(
          models,
          tierVariations,
          resolvedOptions,
        );
      if (
        !matchedModel &&
        priceResult &&
        !priceResult.isRange &&
        models.length > 1
      )
        matchedModel = matchModelByPrice(models, priceResult.price);
      if (matchedModel && variantId == null)
        variantId = matchedModel.modelid ?? null;
      if (matchedModel && !variantLabel)
        variantLabel = buildVariantLabel(matchedModel, tierVariations);
      priceResult = getShopeeTrustedPrice(priceResult, matchedModel, apiResult);
      if (resolvedOptions && resolvedOptions.length) {
        variantOptions = resolvedOptions;
        if (!variantLabel) variantLabel = resolvedOptions.join(", ");
      } else if (requestedVariantOptions)
        variantOptions = requestedVariantOptions;
      if (!variantLabel)
        variantLabel = detectSelectedVariantLabel(platform, sel);
      if (!priceResult)
        if (apiResult) priceResult = apiResult;
        else priceResult = shopeeStructuralPriceFallback();
      if (apiResult && apiResult.apiName) name = apiResult.apiName;
      if (apiResult && apiResult.apiImage) image = apiResult.apiImage;
      if (!name) name = sel ? extractNameWithSelectors(sel.name) : null;
      if (!image) image = sel ? extractImageShopee(sel.image) : null;
    } else {
      priceResult = sel ? extractWithSelectors(sel.price, null) : null;
      if (!priceResult && sel && sel.priceFallback)
        priceResult = extractWithSelectors(sel.priceFallback, null);
      name = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageLazada(sel.image) : null;
      const selectedLazadaOptions = readSelectedLazadaOptions();
      if (selectedLazadaOptions.length)
        variantLabel = selectedLazadaOptions.join(", ");
      else variantLabel = detectSelectedVariantLabel(platform, sel);
      hasVariants =
        !!(priceResult && priceResult.isRange) ||
        !!variantLabel ||
        lazadaHasVariationSwatches();
    }
    const finalName = name || document.title || "Unknown Product";
    if (!priceResult)
      return {
        platform: platform,
        url: window.location.href,
        name: finalName,
        price: null,
        priceMin: null,
        priceMax: null,
        isRange: false,
        displayPrice: null,
        image: image,
        variantId: variantId,
        variantLabel: variantLabel,
        variantOptions: variantOptions,
        hasVariants: hasVariants,
        extractedAt: new Date().toISOString(),
        error:
          "Could not read the price. If this product has variants, select one first then click the extension again.",
      };
    return {
      platform: platform,
      url: window.location.href,
      name: finalName,
      price: priceResult.price,
      priceMin: priceResult.priceMin,
      priceMax: priceResult.priceMax,
      isRange: priceResult.isRange,
      displayPrice: priceResult.displayPrice,
      image: image,
      variantId: variantId,
      variantLabel: variantLabel,
      variantOptions: variantOptions,
      hasVariants: hasVariants,
      extractedAt: new Date().toISOString(),
      error: null,
    };
  }
  let watcherTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(watcherTimeout);
    watcherTimeout = setTimeout(async () => {
      const data = await extractProductData();
      if (data && data.error !== "not_a_product_page")
        try {
          chrome.runtime.sendMessage({
            action: "productUpdated",
            data: data,
          });
        } catch (_) {}
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
      const p =
        document.querySelector(".jRlVo0") ||
        document.querySelector("[class*='product-price']");
      const i =
        document.querySelector(".UdI7e2") ||
        document.querySelector("picture.UkIsx8");
      const v =
        document
          .querySelector(
            "button.selection-box-selected, button.selection-box-unselected",
          )
          ?.closest("section") || null;
      if (p) targets.push(p);
      if (i) targets.push(i);
      if (v) targets.push(v);
    } else {
      const p = document.querySelector("[class*='pdp-v2-product-price']");
      const g = document.querySelector("[class*='gallery-preview-panel']");
      if (p) targets.push(p);
      if (g) targets.push(g);
    }
    if (!targets.length) targets.push(document.body);
    targets.forEach((t) =>
      observer.observe(t, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "class"],
        characterData: true,
      }),
    );
  }
  if (document.readyState === "complete") startWatcher();
  else
    window.addEventListener("load", startWatcher, {
      once: true,
    });
  setTimeout(startWatcher, 2e3);
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "extractProduct" && msg.action !== "checkPrice") return;
    extractProductData({
      variantId: msg.variantId,
      variantOptions: msg.variantOptions,
    }).then((data) =>
      sendResponse({
        success: true,
        data: data,
      }),
    );
    return true;
  });
})();
