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

  // Strips currency symbols and separators, returns a plain number (or a
  // {min, max} pair for variant products showing a price range).
  function normalizePrice(raw) {
    if (!raw) return null;
    const text = raw.trim();

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

    const cleaned = text.replace(/[₱\s,]/g, "").replace(/[^\d.]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num === 0) return null;
    return {
      price: num, priceMin: num, priceMax: num, isRange: false,
      displayPrice: `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    };
  }

  function extractWithSelectors(selectors, excludeStyles) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;

        // Skip struck-through / greyed-out original prices next to a sale price
        if (excludeStyles && excludeStyles.length) {
          const cs = window.getComputedStyle(el);
          const td = cs.textDecoration || "";
          const color = cs.color || "";
          if (td.includes("line-through")) continue;
          if (excludeStyles.some(s => color.includes(s) || td.includes(s))) continue;
        }

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

  // Reads the currently-selected variation option's visible text straight
  // from config/selectors.json's "variant" list, same lookup pattern as
  // extractNameWithSelectors above. This is the preferred path when it
  // matches, since it's just one more entry in the same JSON file the rest
  // of the extraction already relies on — no separate logic to maintain.
  function extractVariantTextWithSelectors(selectors) {
    if (!selectors) return null;
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const t  = el && el.textContent.trim();
        if (t && t.length > 0 && t.length <= 40) return t;
      } catch (_) {}
    }
    return null;
  }

  // Last-resort, best-effort fallback for when the configured "variant"
  // selectors above don't match (e.g. Shopee/Lazada renamed their classes
  // again). Looks for a short, simple, clickable-looking element whose own
  // class name contains a "selected/active/chosen/checked" style token,
  // sitting inside a container whose class name hints at variation/SKU
  // pickers. Deliberately conservative — a wrong guess here would mislabel
  // what the user is tracking, so this only returns a value when both the
  // element's own state class AND its container hint line up; otherwise it
  // returns null and the UI simply shows no variant label (same as today).
  function detectSelectedVariantTextGeneric(containerHints) {
    try {
      const stateTokens = ["selected", "active", "chosen", "checked"];
      const candidates = document.querySelectorAll("button, [role='button'], div, span, a, li");
      for (const el of candidates) {
        const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
        if (!cls || !stateTokens.some(t => cls.includes(t))) continue;
        if (el.children.length > 1) continue; // skip composite blocks, not a single option chip

        const text = el.textContent.trim();
        if (!text || text.length < 1 || text.length > 30) continue;

        let node = el.parentElement, depth = 0, insideVariantContainer = false;
        while (node && depth < 6) {
          const pcls = typeof node.className === "string" ? node.className.toLowerCase() : "";
          if (containerHints.some(h => pcls.includes(h))) { insideVariantContainer = true; break; }
          node = node.parentElement; depth++;
        }
        if (insideVariantContainer) return text;
      }
    } catch (_) {}
    return null;
  }

  function detectSelectedVariantLabel(platform, selectors) {
    const configured = selectors ? extractVariantTextWithSelectors(selectors.variant) : null;
    if (configured) return configured;
    const hints = platform === "lazada"
      ? ["sku", "variation", "prop"]
      : ["variation", "sku", "tier", "option"];
    return detectSelectedVariantTextGeneric(hints);
  }

  function normalizeOptionLabel(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Shopee marks the chosen option within each variation group (Colour,
  // Size, etc.) with the "selection-box-selected" class, and always puts
  // that option's exact display text in its aria-label attribute — e.g.
  // aria-label="grey", aria-label="1 Black + 1 Blue ". This is Shopee's
  // own accessibility markup (confirmed against live product pages), so
  // it's far more durable than guessing from generated CSS class hashes
  // or visual styling. Returns one label per variation group, in DOM
  // order (e.g. ["grey", "M"] for Colour then Size).
  function readSelectedShopeeOptions() {
    try {
      const buttons = document.querySelectorAll("button.selection-box-selected[aria-label]");
      const labels = [];
      buttons.forEach(btn => {
        const t = (btn.getAttribute("aria-label") || "").trim();
        if (t) labels.push(t);
      });
      return labels;
    } catch (_) {
      return [];
    }
  }

  // True as soon as the page has rendered ANY variation picker at all
  // (selected or not), independent of whatever the item API happens to
  // return — used so the "select a variant" prompt and tracking behaviour
  // stay correct even if the API's models/tier_variations fields are
  // ever missing or shaped differently than expected.
  function shopeeHasVariationButtons() {
    try {
      return document.querySelectorAll(
        "button.selection-box-selected, button.selection-box-unselected"
      ).length > 0;
    } catch (_) {
      return false;
    }
  }

  // Lazada marks the chosen option in each SKU property group (Colour
  // Family, Size, etc.) with the "sku-variable-img-wrap-selected" class,
  // as opposed to plain "sku-variable-img-wrap" for the rest — confirmed
  // against live product pages via DevTools inspection, the same way
  // Shopee's selection-box-selected/-unselected pair was. Returns one
  // label per property group, in DOM order (e.g. ["sliver"] for a
  // single-property item, or ["Red","XL"] for a two-property one).
  function readSelectedLazadaOptions() {
    try {
      const els = document.querySelectorAll(".sku-variable-img-wrap-selected");
      const labels = [];
      els.forEach(el => {
        const t = el.textContent.trim();
        if (t) labels.push(t);
      });
      return labels;
    } catch (_) {
      return [];
    }
  }

  // Same purpose as shopeeHasVariationButtons() above, for Lazada.
  function lazadaHasVariationSwatches() {
    try {
      return document.querySelectorAll(".sku-variable-img-wrap, .sku-variable-img-wrap-selected").length > 0;
    } catch (_) {
      return false;
    }
  }

  // Re-selects a previously tracked variant by clicking the same option
  // button(s) a shopper would click by hand, matched by their aria-label
  // Dispatches a fuller pointer/mouse event sequence rather than a bare
  // .click() — a single synthetic click() is sometimes not enough to
  // trigger a React click handler the same way a real user interaction
  // does. This mirrors what a real click actually fires (pointerdown,
  // mousedown, pointerup, mouseup, click, in that order).
  function simulateRealClick(el) {
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    const fire = (Ctor, type, extra) => {
      try { el.dispatchEvent(new Ctor(type, { ...base, ...extra })); } catch (_) {}
    };
    fire(PointerEvent, "pointerdown", { pointerId: 1, pointerType: "mouse" });
    fire(MouseEvent, "mousedown");
    fire(PointerEvent, "pointerup", { pointerId: 1, pointerType: "mouse" });
    fire(MouseEvent, "mouseup");
    fire(MouseEvent, "click");
  }

  // Re-selects a previously tracked variant by clicking the same option
  // button(s) a shopper would click by hand, matched by their aria-label
  // text. Used on refresh, where a freshly-opened tab shows Shopee's own
  // default selection rather than whatever was originally tracked.
  //
  // Critically, this VERIFIES the click(s) actually changed the page's
  // selection — by re-reading readSelectedShopeeOptions() afterward and
  // comparing against what was requested — rather than assuming a
  // dispatched click always registers, retrying a few times if it hasn't
  // taken effect yet. This is what catches a click that was dispatched
  // but silently ignored by the page, instead of quietly reading
  // whatever (wrong) price happens to be showing afterward.
  async function selectShopeeOptions(labels) {
    if (!Array.isArray(labels) || !labels.length) return { resolved: true };
    const targets = labels.map(normalizeOptionLabel).filter(Boolean);
    if (!targets.length) return { resolved: true };

    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let missing = false;
      let disabled = false;

      for (const target of targets) {
        // Re-query every attempt/tier — clicking one tier's option can
        // change which buttons exist/are enabled for the next tier.
        const candidates = document.querySelectorAll(
          "button.selection-box-selected[aria-label], button.selection-box-unselected[aria-label]"
        );
        let found = null;
        for (const btn of candidates) {
          if (normalizeOptionLabel(btn.getAttribute("aria-label")) === target) { found = btn; break; }
        }
        if (!found) { missing = true; continue; }
        if (found.getAttribute("aria-disabled") === "true") { disabled = true; continue; }
        if (!found.classList.contains("selection-box-selected")) {
          simulateRealClick(found);
        }
      }

      // Missing/disabled options won't be fixed by retrying.
      if (missing || disabled) return { resolved: false, reason: disabled ? "disabled" : "missing" };

      // Give React a moment to process the click(s), then check whether
      // the page's selection actually changed to match what we clicked —
      // this is the part that used to be assumed rather than confirmed.
      await new Promise(r => setTimeout(r, 250));
      const nowSelected = readSelectedShopeeOptions().map(normalizeOptionLabel);
      if (targets.every(t => nowSelected.includes(t))) return { resolved: true };
    }
    return { resolved: false, reason: "click_not_registered" };
  }

  // After clicking a variation option, Shopee's React state updates the
  // displayed price asynchronously. Rather than guessing a fixed delay,
  // this polls the price element and waits for two consecutive identical
  // readings (a simple settle/debounce check) before trusting it, up to
  // a short timeout — then returns whatever the last reading was either way.
  async function waitForShopeePriceStabilize(priceSelectors, priceExcludeStyle, timeoutMs, intervalMs) {
    timeoutMs = timeoutMs || 3000;
    intervalMs = intervalMs || 200;
    const start = Date.now();
    let lastKey = null, stableHits = 0, lastResult = null;
    while (Date.now() - start < timeoutMs) {
      const result = priceSelectors ? extractWithSelectors(priceSelectors, priceExcludeStyle) : null;
      if (result) {
        lastResult = result;
        const key = `${result.price}|${result.isRange}`;
        if (key === lastKey) {
          stableHits++;
          if (stableHits >= 2) return result;
        } else {
          stableHits = 0;
        }
        lastKey = key;
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return lastResult;
  }

  // Matches the currently-selected DOM options (from readSelectedShopeeOptions)
  // against the item API's tier_variations option lists to build a
  // tier_index array, independent of DOM/API ordering — then finds the
  // model in item.models with a matching tier_index (or, failing that,
  // a matching comma-joined name). This is a nice-to-have cross-check
  // that yields a stable modelid, useful mainly for the silent automatic
  // hourly check where clicking through the DOM isn't reliable (Chrome
  // pauses hidden-tab rendering) — the click-based refresh above doesn't
  // depend on this at all.
  function matchModelByOptions(models, tierVariations, selectedLabels) {
    if (!Array.isArray(models) || !models.length) return null;
    if (!Array.isArray(tierVariations) || !tierVariations.length) return null;
    if (!Array.isArray(selectedLabels) || selectedLabels.length !== tierVariations.length) return null;

    const tierIndex = new Array(tierVariations.length).fill(-1);
    const usedLabels = new Set();
    tierVariations.forEach((tier, tIdx) => {
      if (!Array.isArray(tier.options)) return;
      for (let lIdx = 0; lIdx < selectedLabels.length; lIdx++) {
        if (usedLabels.has(lIdx)) continue;
        const optIdx = tier.options.findIndex(opt => normalizeOptionLabel(opt) === normalizeOptionLabel(selectedLabels[lIdx]));
        if (optIdx !== -1) { tierIndex[tIdx] = optIdx; usedLabels.add(lIdx); break; }
      }
    });
    if (tierIndex.some(idx => idx === -1)) return null;

    let match = models.find(m => Array.isArray(m.tier_index) &&
      m.tier_index.length === tierIndex.length &&
      m.tier_index.every((v, i) => v === tierIndex[i]));
    if (match) return match;

    const targets = selectedLabels.map(normalizeOptionLabel);
    match = models.find(m => {
      if (typeof m.name !== "string") return false;
      const parts = m.name.split(/[,/]/).map(normalizeOptionLabel);
      return parts.length === targets.length && parts.every((p, i) => p === targets[i]);
    });
    return match || null;
  }

  // Last-resort fallback only — reached when both the item API call and
  // the named CSS selectors above have failed. Scoped to <main> (Shopee's
  // page content root) rather than the whole document, so it can't reach
  // into the header/nav where the logged-in user's profile picture lives.
  // A higher width floor also helps: nav avatars render small (~40px),
  // product gallery images render large.
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
    const scope = document.querySelector("main") || document.body;
    for (const el of scope.querySelectorAll("img")) {
      if (el.closest("header, nav")) continue;
      const src = el.src || "";
      if (src.includes("susercontent.com") && !src.includes("icon") && !src.includes("avatar") && !src.includes("shop_")) {
        const w = el.naturalWidth || el.width || 0;
        if (w === 0 || w >= 150) return src;
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

  // Text that marks an element as a voucher/discount/shipping/delivery
  // badge rather than the actual price — these commonly render as their
  // own short "₱" amount elsewhere on a Shopee product page (e.g. "₱40
  // off", "Get up to ₱40 if order arrives late"), which is exactly the
  // kind of text this last-resort scan would otherwise happily accept as
  // a price.
  const SHOPEE_PROMO_TEXT_DENYLIST = /\b(off|voucher|discount|cashback|rebate|shipping|coin|coins|promo|deal|code|arrives late|on-time delivery)\b/i;

  function shopeeStructuralPriceFallback() {
    const candidates = [];
    document.querySelectorAll("div, span").forEach(el => {
      if (el.children.length > 2) return;
      const text = el.textContent.trim();
      if (!text.includes("₱")) return;
      if (text.length > 40) return;
      // Shopee sometimes splits a promo/guarantee sentence like "Get up
      // to ₱40 if order arrives late" across sibling <span> elements —
      // the middle span holding just "₱40" wouldn't match a denylist
      // word on its own, so its parent's full sentence is checked too.
      const parentText = el.parentElement ? el.parentElement.textContent : "";
      if (SHOPEE_PROMO_TEXT_DENYLIST.test(text) || SHOPEE_PROMO_TEXT_DENYLIST.test(parentText)) return;
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

  // Shopee's product page is a React SPA that only finishes rendering via
  // requestAnimationFrame, which Chrome pauses on hidden/background tabs.
  // So a background price check has nothing in the DOM to read. Calling
  // Shopee's own item API directly sidesteps that — same-origin fetch()
  // isn't tied to rAF, so it works in a hidden tab too. DOM selectors
  // remain as the fallback if this call ever fails.
  //
  // This same API response also carries the item's own image key, which
  // this function now returns as apiImage. Reading the picture from here
  // instead of scanning the page's <img> tags is what keeps the popup
  // from ever picking up an unrelated photo (e.g. the logged-in user's
  // own profile picture in the nav bar) instead of the product photo —
  // the API only ever returns data for the item itself.
  async function fetchShopeeApiPrice(pageUrl) {
    try {
      const match = (pageUrl || window.location.href).match(/-i\.(\d+)\.(\d+)/);
      if (!match) return null;

      const shopId = match[1];
      const itemId = match[2];

      const resp = await fetch(
        `/api/v4/item/get?itemid=${encodeURIComponent(itemId)}&shopid=${encodeURIComponent(shopId)}`,
        { credentials: "same-origin" }
      );
      if (!resp.ok) return null;

      const json = await resp.json();
      const item = json?.data;
      if (!item) return null;

      // prices are in micro-units (1 PHP = 100,000). both 0 if out of stock.
      const rawMin = item.price_min ?? item.price;
      const rawMax = item.price_max ?? item.price;
      if (!rawMin || rawMin <= 0) return null;

      const priceMin = rawMin / 100000;
      const priceMax = (rawMax && rawMax > 0) ? rawMax / 100000 : priceMin;

      if (priceMin < 1 || priceMin > 999999) return null;

      const isRange = priceMax > priceMin;
      const lo = priceMin;
      const hi = priceMax;
      const fmtPHP = n => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

      // item.image is the product's own cover image key (a hash, not a
      // full URL). item.images[0] is the same thing as a fallback for
      // any response shape where "image" is missing. Neither of these
      // can ever resolve to the user's profile picture — that data
      // simply isn't part of an item's own API response.
      const imageKey = item.image || (Array.isArray(item.images) ? item.images[0] : null) || null;
      const apiImage = imageKey ? `https://down-ph.img.susercontent.com/file/${imageKey}` : null;

      // item.models is the per-variant breakdown of the SAME item response
      // above (one entry per size/colour/etc. combination), each carrying
      // its own price and a stable modelid. item.tier_variations names each
      // variation group and lists its option labels (e.g. "Colour Family":
      // ["Red","Blue"]), with each model's tier_index pointing into those
      // option lists. Reading these from the response we already fetched
      // (rather than aggregating into a single min/max) is what lets a
      // specific variant's price be looked up directly further down,
      // instead of guessing from whichever option happens to be selected
      // on screen.
      const models         = Array.isArray(item.models) ? item.models : [];
      const tierVariations = Array.isArray(item.tier_variations) ? item.tier_variations : [];

      return {
        price:    lo,
        priceMin: lo,
        priceMax: hi,
        isRange,
        displayPrice: isRange
          ? `₱${fmtPHP(lo)} – ₱${fmtPHP(hi)}`
          : `₱${fmtPHP(lo)}`,
        apiName: item.name || null,
        apiImage,
        models,
        tierVariations,
      };
    } catch (_) {
      return null;
    }
  }

  // Turns one entry from item.models into the same {price, priceMin,
  // priceMax, isRange, displayPrice} shape normalizePrice()/the API-level
  // result above produce, so downstream code doesn't need to care whether
  // a price came from the aggregate item or one specific model.
  function buildPriceResultFromModel(model) {
    if (!model) return null;
    const raw = model.price ?? model.price_min ?? model.price_max;
    if (raw == null) return null;
    const price = raw / 100000;
    if (!(price > 0) || price > 999999) return null;
    return {
      price, priceMin: price, priceMax: price, isRange: false,
      displayPrice: `₱${price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    };
  }

  // Looks up one variant by Shopee's own modelid — used on refresh, once
  // we already know (from when the product was first tracked) exactly
  // which variant to price-check, so there's no need to guess anything
  // from the page's current on-screen selection.
  function findModelById(models, variantId) {
    if (!Array.isArray(models) || variantId == null) return null;
    return models.find(m => String(m.modelid) === String(variantId)) || null;
  }

  // Used only when we don't yet have a modelid (the moment the user is
  // choosing a variant and about to track it). If the page is currently
  // showing one specific, non-range price, and exactly one model in the
  // item's list has that same price, that's a solid signal that model is
  // the one currently selected on screen. If more than one model shares
  // that exact price, this deliberately returns nothing rather than
  // guessing — an unresolved match still uses the correct on-screen price
  // (see extractProductData), it just won't be re-selectable by modelid
  // on a later refresh.
  function matchModelByPrice(models, domPrice) {
    if (!Array.isArray(models) || !models.length || domPrice == null) return null;
    const target = Math.round(domPrice * 100);
    const matches = models.filter(m => {
      const raw = m.price ?? m.price_min ?? m.price_max;
      if (raw == null) return false;
      return Math.round((raw / 100000) * 100) === target;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // Builds a human-readable "Red, XL" style label for one model. Shopee's
  // own model entries sometimes carry a ready-made comma-joined name; when
  // that's missing this falls back to combining tier_variations' option
  // labels using the model's own tier_index, which is the same data the
  // page itself uses to render each variation button's text.
  function buildVariantLabel(model, tierVariations) {
    if (!model) return null;
    if (typeof model.name === "string" && model.name.trim()) {
      const parts = model.name.split(/[,/]/).map(s => s.trim()).filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    if (Array.isArray(tierVariations) && Array.isArray(model.tier_index)) {
      const parts = model.tier_index
        .map((optIdx, tierIdx) => {
          const tier = tierVariations[tierIdx];
          return tier && Array.isArray(tier.options) ? (tier.options[optIdx] ?? null) : null;
        })
        .filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    return null;
  }

  // Sanity-checks a single (non-range) DOM-read price against Shopee's own
  // item API data before it's trusted. Shopee's product page is a
  // fast-changing React SPA: if the price selectors above fire a moment
  // before the true price has finished rendering (e.g. right after the
  // popup opens, or right after a variant click), they can end up matching
  // a leftover voucher, shop discount, or shipping-fee badge instead of
  // the actual price — those render the same way (a short "₱"-prefixed
  // number in a similar spot on the page) as a genuine price. The item API
  // response fetched above is Shopee's own authoritative number for this
  // item and isn't subject to that rendering race, so it's used here to
  // catch (and correct) a DOM reading that couldn't actually be right,
  // while leaving an already-correct DOM reading — including a genuine
  // price range, which this deliberately leaves untouched — untouched.
  //
  // - When the exact selected variant is independently known (matchedModel,
  //   resolved from the page's own selected-option labels — not from the
  //   price being checked here), that model's own API price is the most
  //   precise ground truth available, and is used whenever it disagrees
  //   with the DOM reading.
  // - Otherwise, the item's overall [priceMin, priceMax] from the API is
  //   used as a looser but still reliable bound: whatever variant is
  //   actually selected, its true price can never fall outside that
  //   range, so a DOM reading outside it is not a real price.
  function getShopeeTrustedPrice(domPriceResult, matchedModel, apiResult) {
    if (!domPriceResult || domPriceResult.isRange) return domPriceResult;

    const PRICE_EPSILON = 0.01; // 1 centavo — covers float rounding from the /100000 conversion

    const modelPrice = matchedModel ? buildPriceResultFromModel(matchedModel) : null;
    if (modelPrice) {
      return Math.abs(modelPrice.price - domPriceResult.price) > PRICE_EPSILON ? modelPrice : domPriceResult;
    }

    if (apiResult && apiResult.priceMin != null && apiResult.priceMax != null) {
      const withinRange = domPriceResult.price >= apiResult.priceMin - PRICE_EPSILON &&
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

  // opts.variantOptions: array of exact aria-label option texts (e.g.
  // ["grey","M"]) captured when the product was first tracked — passed by
  // background.js on a refresh so the same options get re-clicked before
  // reading the price, regardless of whatever Shopee shows selected by
  // default on a freshly-opened tab. opts.variantId: Shopee's own modelid,
  // used as a secondary cross-check/fallback when clicking isn't possible
  // (e.g. a hidden background tab during the silent hourly check). Both
  // are left unset for a normal popup reading, where we want whatever is
  // currently on screen.
  async function extractProductData(opts) {
    opts = opts || {};
    const requestedVariantId      = opts.variantId != null ? opts.variantId : null;
    const requestedVariantOptions = Array.isArray(opts.variantOptions) && opts.variantOptions.length
      ? opts.variantOptions : null;

    const platform = detectPlatform();
    if (!platform) return null;

    const config = await loadConfig();
    const platformConfig = config ? config[platform] : null;

    if (!isProductPage(platform, platformConfig)) {
      return {
        platform, url: window.location.href,
        name: null, price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image: null,
        variantId: null, variantLabel: null, variantOptions: null, hasVariants: false,
        extractedAt: new Date().toISOString(),
        error: "not_a_product_page",
      };
    }

    const sel = platformConfig ? platformConfig.selectors : null;
    let priceResult     = null;
    let name             = null;
    let image            = null;
    let variantId        = null;
    let variantLabel     = null;
    let variantOptions   = null;
    let hasVariants      = false;

    if (platform === "shopee") {
      const apiResult = await fetchShopeeApiPrice(window.location.href);
      const models         = apiResult && apiResult.models ? apiResult.models : [];
      const tierVariations = apiResult && apiResult.tierVariations ? apiResult.tierVariations : [];
      hasVariants = models.length > 1 || shopeeHasVariationButtons();

      let matchedModel     = null;
      let resolvedOptions  = null;

      if (requestedVariantOptions) {
        // Refresh path (primary mechanism): re-click the exact option
        // button(s) that were selected when this variant was tracked —
        // the same buttons a shopper would click by hand — then read
        // whatever price the page shows afterward. This is what fixes
        // prices coming back as the cheapest/default variant instead of
        // the one actually tracked, and it works regardless of the shape
        // of Shopee's item API response. selectShopeeOptions() confirms
        // the click(s) actually changed the page's selection before this
        // trusts any price read afterward.
        const clickResult = await selectShopeeOptions(requestedVariantOptions);
        if (!clickResult.resolved) {
          const message = clickResult.reason === "click_not_registered"
            ? "Could not automatically re-select this variant on Shopee's page for this refresh. The price shown may be from a different variant — please open the product page, reselect it manually, and try again."
            : "This specific variant could not be found anymore — it may be out of stock or have been removed/renamed by the seller. Open the product page and re-track the variant you want.";
          return {
            platform, url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null, priceMin: null, priceMax: null, isRange: false, displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId, variantLabel: null,
            variantOptions: requestedVariantOptions, hasVariants: true,
            variantNotFound: true,
            extractedAt: new Date().toISOString(),
            error: message,
          };
        }
        const domResult = await waitForShopeePriceStabilize(sel ? sel.price : null, sel ? sel.priceExcludeStyle : null);
        resolvedOptions = readSelectedShopeeOptions();
        if (domResult && !domResult.isRange) {
          priceResult = domResult;
        } else {
          // The variant is confirmed selected (selectShopeeOptions()
          // already verified that), but the price couldn't be read
          // cleanly afterward — report this rather than silently falling
          // back to the item's aggregate min/max, which would produce a
          // plausible-looking but wrong number.
          return {
            platform, url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null, priceMin: null, priceMax: null, isRange: false, displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId, variantLabel: resolvedOptions.join(", ") || null,
            variantOptions: requestedVariantOptions, hasVariants: true,
            extractedAt: new Date().toISOString(),
            error: "Re-selected the tracked variant but couldn't read its price cleanly afterward. Please try refreshing again.",
          };
        }
      } else if (requestedVariantId != null && models.length) {
        // Secondary refresh path — used only when we don't have option
        // labels to click (e.g. an item tracked before this DOM-click
        // mechanism existed) or when clicking isn't possible (a hidden
        // background tab during the silent automatic check): look the
        // tracked model up by id straight from the API response.
        matchedModel = findModelById(models, requestedVariantId);
        if (matchedModel) {
          priceResult  = buildPriceResultFromModel(matchedModel);
          variantId    = matchedModel.modelid ?? requestedVariantId;
          variantLabel = buildVariantLabel(matchedModel, tierVariations);
        } else {
          return {
            platform, url: window.location.href,
            name: apiResult?.apiName || document.title || "Unknown Product",
            price: null, priceMin: null, priceMax: null, isRange: false, displayPrice: null,
            image: apiResult?.apiImage || null,
            variantId: requestedVariantId, variantLabel: null, variantOptions: null, hasVariants: true,
            variantNotFound: true,
            extractedAt: new Date().toISOString(),
            error: "This specific variant could not be found anymore — it may have been removed or renamed by the seller. Open the product page and re-track the variant you want.",
          };
        }
      } else {
        // Fresh-detection path: a live popup reading — read whatever the
        // shopper currently has selected on screen. This includes a
        // genuine range (e.g. "₱1,000 - ₱2,000" shown before any variant
        // is picked): the Current tab should mirror what's actually on
        // the page rather than discard it, since a shopper who hasn't
        // selected a variant yet still sees a real, meaningful number.
        resolvedOptions = readSelectedShopeeOptions();
        const domResult = sel ? extractWithSelectors(sel.price, sel.priceExcludeStyle) : null;
        if (domResult) priceResult = domResult;
      }

      // Cross-check against the item API's model list when we have both
      // a full set of selected option labels and API tier data — gives a
      // stable modelid as a bonus (mainly useful for automatic hidden-tab
      // checks, see the secondary refresh path above), on top of whatever
      // price/label the DOM already gave us.
      if (!matchedModel && resolvedOptions && resolvedOptions.length && models.length > 1) {
        matchedModel = matchModelByOptions(models, tierVariations, resolvedOptions);
      }
      if (!matchedModel && priceResult && !priceResult.isRange && models.length > 1) {
        matchedModel = matchModelByPrice(models, priceResult.price);
      }
      if (matchedModel && variantId == null) variantId = matchedModel.modelid ?? null;
      if (matchedModel && !variantLabel) variantLabel = buildVariantLabel(matchedModel, tierVariations);

      // Guard against a stray promo/voucher/discount reading (see
      // getShopeeTrustedPrice above) before this price is used for
      // anything else below. Leaves a genuine range untouched.
      priceResult = getShopeeTrustedPrice(priceResult, matchedModel, apiResult);

      if (resolvedOptions && resolvedOptions.length) {
        variantOptions = resolvedOptions;
        if (!variantLabel) variantLabel = resolvedOptions.join(", ");
      } else if (requestedVariantOptions) {
        variantOptions = requestedVariantOptions;
      }

      if (!variantLabel) {
        // Neither the reliable aria-label reading nor the API cross-check
        // produced anything (e.g. this particular page doesn't use the
        // selection-box markup) — fall back to the best-effort generic
        // heuristic as a last resort.
        variantLabel = detectSelectedVariantLabel(platform, sel);
      }

      if (!priceResult) {
        if (apiResult) priceResult = apiResult; // aggregate range, or the item's single price
        else priceResult = shopeeStructuralPriceFallback();
      }

      if (apiResult && apiResult.apiName) name = apiResult.apiName;
      if (apiResult && apiResult.apiImage) image = apiResult.apiImage;
      if (!name) name  = sel ? extractNameWithSelectors(sel.name) : null;
      // Only fall back to scanning the page's <img> tags if the API call
      // above didn't give us an image (e.g. it failed, or the URL didn't
      // match the expected shop-id/item-id pattern). This keeps the DOM
      // scan as a last resort rather than the default path.
      if (!image) image = sel ? extractImageShopee(sel.image) : null;
    } else {
      priceResult = sel ? extractWithSelectors(sel.price, null) : null;
      if (!priceResult && sel && sel.priceFallback) {
        priceResult = extractWithSelectors(sel.priceFallback, null);
      }
      name  = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageLazada(sel.image) : null;

      // Lazada bakes the chosen variant into the product URL itself (a
      // different colour/size is a different URL), so the price above
      // already belongs to the right variant with no extra matching
      // needed. The label is read straight from Lazada's own
      // "sku-variable-img-wrap-selected" marker (confirmed via DevTools
      // inspection — the same class Lazada itself applies to whichever
      // swatch/chip is currently chosen), covering products with more
      // than one property group (e.g. Colour AND Size) by collecting one
      // label per group.
      const selectedLazadaOptions = readSelectedLazadaOptions();
      if (selectedLazadaOptions.length) {
        variantLabel = selectedLazadaOptions.join(", ");
      } else {
        variantLabel = detectSelectedVariantLabel(platform, sel);
      }
      hasVariants = !!(priceResult && priceResult.isRange) || !!variantLabel || lazadaHasVariationSwatches();
    }

    const finalName = name || document.title || "Unknown Product";

    if (!priceResult) {
      return {
        platform, url: window.location.href, name: finalName,
        price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image,
        variantId, variantLabel, variantOptions, hasVariants,
        extractedAt: new Date().toISOString(),
        error: "Could not read the price. If this product has variants, select one first then click the extension again.",
      };
    }

    return {
      platform, url: window.location.href, name: finalName,
      price: priceResult.price, priceMin: priceResult.priceMin,
      priceMax: priceResult.priceMax, isRange: priceResult.isRange,
      displayPrice: priceResult.displayPrice, image,
      variantId, variantLabel, variantOptions, hasVariants,
      extractedAt: new Date().toISOString(), error: null,
    };
  }

  // Pushes a live update to the popup when the price or image changes on
  // the page (e.g. the shopper picks a different variant while browsing).
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
      // Also watch the variation picker directly (if present) so a
      // selection click is picked up immediately rather than waiting on
      // the price element to finish re-rendering.
      const v = document.querySelector("button.selection-box-selected, button.selection-box-unselected")?.closest("section") || null;
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
    targets.forEach(t => observer.observe(t, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "srcset", "class"], characterData: true,
    }));
  }

  if (document.readyState === "complete") startWatcher();
  else window.addEventListener("load", startWatcher, { once: true });
  setTimeout(startWatcher, 2000);

  // Answers immediately with whatever's currently readable — retry timing
  // for slow-rendering pages lives in background.js/popup.js instead,
  // since each retry there is a fresh message that also keeps the service
  // worker alive.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "extractProduct" && msg.action !== "checkPrice") return;
    // background.js includes variantOptions/variantId on a tracked-product
    // refresh so the exact tracked variant gets re-selected (by clicking
    // the same option buttons) or re-priced by id, instead of whatever
    // this freshly-opened tab shows selected by default (see
    // extractProductData).
    extractProductData({ variantId: msg.variantId, variantOptions: msg.variantOptions })
      .then(data => sendResponse({ success: true, data }));
    return true;
  });
})();
