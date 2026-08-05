// content.js
// Step 1: Platform Detection via URL pattern matching
// Step 2: DOM Tree Navigation via CSS selector profiles loaded from selectors.json
// Step 3: Raw Price Extraction via textContent
// Step 4: Price Normalization via string replacement + parseFloat()
// Step 5: Threshold Comparison handled in background.js
// Step 6: Storage handled in db.js / background.js
(function () {
  "use strict";

  // Step 1: Platform Detection
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

  // Step 4: Price Normalization
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

  // Used to try detecting Shopee's "After Voucher" label and skip that price,
  // but the check was too broad — almost every PDP has "Voucher" text
  // somewhere near the price block, so it kept skipping the real price and
  // leaving only tiny promo badges. That was the actual ₱40 bug, not a
  // timing issue. Removed it — if a voucher really is auto-applied we just
  // track that price as-is, documented as a known limitation instead.

  // Step 2 & 3: DOM Navigation + Raw Price Extraction
  function extractWithSelectors(selectors, excludeStyles) {
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

  // Step 2/3 for variants: reads whichever option is currently marked
  // "selected" inside each variation group (e.g. Color: Red, Size: L) and
  // joins them into one label so two different variants of the same
  // product don't look identical in the tracked list.
  //
  // sanitizeChipText() guards against two failure modes seen in testing:
  //  - matching a hidden native <select> (its textContent concatenates
  //    ALL <option> labels, not just the selected one)
  //  - matching a wrapper that contains several sibling chips, which
  //    reads the same way (all labels glued together)
  function isVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  // Text that looks like a variant *label* ("Color Family:", "Size", ...)
  // rather than an option value — used both to find where the variant rows
  // are on the page, and to make sure we don't accidentally grab the label
  // itself as if it were the selected option.
  //
  // This used to be a fixed whitelist of words (color, size, design, ...)
  // but products list all sorts of variant types — package, shape, bundle,
  // set, combo, scent, flavor, etc. — so instead it accepts any short
  // label-looking text and relies on EXCLUDE_LABEL_RE to rule out the
  // handful of non-variant fields (quantity, rating, shipping, ...) that
  // would otherwise look the same.
  // NOTE: deliberately NOT excluding "quantity"/"qty" — some sellers use that
  // exact label for a real bundle-size variant (e.g. "Only 1PC" vs "BUY 1
  // TAKE 1 (2PCS)", or "20 PCS"/"40 PCS"/"80 PCS"), distinct from the page's
  // literal numeric quantity stepper. Excluding by word threw the real
  // variant out along with the stepper. The stepper is still filtered out
  // safely: it has no text-bearing chips (just SVG icon buttons + a bare
  // <input>), so it fails the "≥2 real chips" check in collectChipRowAxes
  // and is skipped structurally instead.
  const EXCLUDE_LABEL_WORDS_RE = /(amount|rating|review|stock|available|deliver|shipp|warrant|return|price|total|subtotal|discount|voucher|promo|seller|shop|store|sold|joined|response|categor|sku|guarantee|preferred|verified|official|\bfollow(ing|ers)?\b|favou?rite|\blike[sd]?\b|wishlist|\bshare\b|deal|sale|expir|valid\s*until|\bends?\b|material|\bage\b|recommended|weight|dimension|capacit|voltage|wattage|\borigin\b|certificat|ingredient|nutrition|model\s*(no|number)?|barcode|\bupc\b|\bean\b|net\s*weight|item\s*no|manufactur|country|manual|\bpower\b|frequency|compatib|brand)/i;
  const GENERIC_LABEL_RE = /^[A-Za-z][A-Za-z\s/&]{1,24}:?$/;

  // A real variant value is a short human phrase (a color, a size, a
  // package description). This rejects text that instead looks like page
  // metadata that happens to sit next to a colon — dates, percentages,
  // "shipped in 48 hrs", "97% ...", etc — which is what actually leaked
  // through in testing (a promo end-date, a seller shipping-speed badge).
  const BAD_VALUE_RE = /(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}|\d+\s*%|\bhrs?\b|\bhours?\b|\bdays?\b|\bshipped\b|\bsold\b|\bjoined\b|\bresponse\b|\brating\b|\breview(s)?\b|\bfollowers?\b|\bfollowing\b)/i;

  // Shopee/Lazada both show a shipping-estimate date range right in the
  // purchase panel — "6 - 8 Aug", "12 - 15 Sep", sometimes as a clickable
  // pill with a trailing chevron (">") — using the exact same short-text
  // markup as a real variant option/value. BAD_VALUE_RE's date check only
  // catches numeric dates ("6/8/2026"), not a spelled-out month, so this
  // format slipped through everywhere a chip/value gets validated and
  // ended up glued onto real variants ("6 - 8 Aug / 2Box") instead of
  // being rejected as page chrome.
  const SHIP_DATE_RE = /\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

  // Same idea as SHIP_DATE_RE: a page-chrome badge that uses the same
  // short-bordered-pill markup as a real variant chip. Seen in the wild:
  // Lazada's "Avg. 23 mins" (average chat/delivery response time) got
  // picked up as if it were the selected variant, when the real variant
  // panel hadn't resolved a selection yet (see the guard added around
  // outlierVariantFallback below) and the code fell through to a much
  // weaker page-wide search that grabbed this instead.
  const AVG_TIME_RE = /\bavg\.?\s*\d+\s*(mins?|minutes?|hrs?|hours?|secs?|seconds?)\b/i;

  // Whether an element visually reads as a clickable option chip (has a
  // border, or a pointer cursor / button-like role) rather than plain text.
  function looksLikeClickableChip(el) {
    const cs = window.getComputedStyle(el);
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const looksClickable = cs.cursor === "pointer" || el.tagName === "BUTTON" ||
      el.getAttribute("role") === "button" || el.getAttribute("role") === "radio";
    return hasBorder || looksClickable;
  }

  function isVariantLabelText(el, knownLabelClasses) {
    if (!el) return false;
    // A config-supplied class (e.g. Shopee's own "UmZuAo" heading class for
    // variant-group names) is trusted directly, bypassing the text-pattern
    // check below — needed because a label's TEXT can be broken/unhelpful
    // (seen in the wild: a variant group whose name rendered as the plain
    // digit "0" instead of "Bundle"/"Type"/etc.) while the element is still
    // structurally, unambiguously a label by its class.
    if (knownLabelClasses && knownLabelClasses.length) {
      const cls = typeof el.className === "string" ? el.className : "";
      if (cls && knownLabelClasses.some(c => cls.split(/\s+/).includes(c))) return true;
    }
    const text = el.textContent ? el.textContent.trim() : "";
    if (!text || text.length > 25) return false;
    if (EXCLUDE_LABEL_WORDS_RE.test(text)) return false;
    if (!GENERIC_LABEL_RE.test(text)) return false;
    if (text.endsWith(":")) return true; // explicit "Label:" marker — always trust this
    // No colon: only treat as a label if it doesn't itself look like a
    // clickable option chip. A real label ("Color", "Bundle") is plain,
    // inert text sitting beside its options row; each option IN that row
    // (e.g. "Single", "Twin Pack") is short colon-less text too, but is
    // individually bordered/clickable — that's the actual distinguishing
    // signal, and it holds regardless of whether the label and its chip
    // row happen to be flat siblings or sit in separate wrapper columns.
    //
    // The clickable check has to walk up a couple of ancestor levels, not
    // just the element itself: an option's visible text is often an inner
    // <span> with no styling of its own — the border/cursor/role lives on
    // the wrapping <button> — so checking only `el` let an option's own
    // text (e.g. "Upgraded/Black") pass as if it were a section label.
    let node = el;
    for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
      if (looksLikeClickableChip(node)) return false;
    }
    return true;
  }

  // Text that looks like unrelated page chrome — ratings, buttons, nav —
  // which otherwise passes the "bordered clickable short-text" chip test
  // just as easily as a real variant option does.
  const NOISE_TEXT_RE = /^(report|rating|ratings|rate|review|reviews|buy now|add to cart|shop now|follow(ing|ers)?|share|chat|compare|wishlist|favou?rite|like[sd]?|all|more|view all|see all|sold|available|qty|quantity)$/i;

  // Upper bound on how many chips a CONFIRMED, labeled variant row (e.g.
  // "Colors" listing every size×color combo) can have and still be
  // trusted. High, since real listings legitimately do this — a tumbler
  // with 4 sizes × 20 colors is 80 real options, not noise, and it's
  // scoped to a confirmed label so there's little false-positive risk.
  // pageWideVariantFallback keeps its own much tighter cap, since that
  // path has no confirmed label to anchor the search to.
  const MAX_SCOPED_AXIS_CHIPS = 300;
  const RATING_PATTERN_RE = /^\d(\.\d)?\s*\(\s*\d+\s*\)$/; // e.g. "4.9(237)"
  // Strips a trailing engagement-count like " (10K)", " (1.2K)", " (312)" so
  // "Favorite (10K)" / "Following (1.2K)" match NOISE_TEXT_RE the same way
  // the bare word does. Without this, any social/engagement control with a
  // count attached (favorite, like, follow, wishlist buttons) sailed past
  // the noise filter and got read as if it were a selected variant chip.
  function stripTrailingCount(text) {
    return text.replace(/\s*\(\s*[\d.,]+\s*[kKmM]?\s*\)\s*$/, "");
  }
  // A price or coupon amount ("₱30", "$5", "10% off") — these sit in
  // "Promotions:" rows using the exact same bordered-chip markup as a
  // real variant option, so without this they read as one. Requires a
  // currency symbol or a "% off" pattern, not the bare word "off" alone
  // — a color genuinely named "Off White" shouldn't get caught by this.
  const PRICE_LIKE_RE = /[₱$€£]\s*\d|\d\s*[₱$€£]|\d+\s*%\s*off\b/i;

  function hasMultipleLabeledChildren(el) {
    let count = 0;
    for (const child of el.children) {
      if (child.textContent.trim().length > 0) count++;
      if (count > 1) return true;
    }
    return false;
  }

  function sanitizeChipText(el) {
    if (!el) return null;
    const tag = el.tagName;
    if (tag === "SELECT" || tag === "OPTION" || tag === "SCRIPT" || tag === "STYLE") return null;
    if (!isVisible(el)) return null;
    if (hasMultipleLabeledChildren(el)) return null; // wrapper holding multiple chips, not one chip
    const text = el.textContent.trim();
    if (!text || text.length > 30) return null;
    const checkText = stripTrailingCount(text);
    if (NOISE_TEXT_RE.test(checkText) || RATING_PATTERN_RE.test(text) || PRICE_LIKE_RE.test(text) || SHIP_DATE_RE.test(text) || AVG_TIME_RE.test(text)) return null;
    return text;
  }

  function extractVariantWithSelectors(selectors) {
    if (!selectors) return null;
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        if (!els.length) continue;
        const seen = new Set();
        const parts = [];
        els.forEach(el => {
          const text = sanitizeChipText(el);
          if (!text || seen.has(text)) return;
          seen.add(text);
          parts.push(text);
        });
        if (parts.length) return parts.join(" / ");
      } catch (_) {}
    }
    return null;
  }

  // Instead of guessing class names (which are hashed/unreadable on
  // Shopee) or scanning the whole page (which false-positives on unrelated
  // button pairs — "Add to Cart" vs "Buy Now", rating pills, etc. — since
  // any two neighboring elements with different borders look like an
  // "outlier"), this anchors the search to the actual variation rows: it
  // finds label text like "Color Family:" or "Size" and only looks for
  // selected-looking chips near that label.
  function chipStyleSignature(el) {
    const cs = window.getComputedStyle(el);
    return [cs.borderTopColor, cs.borderTopWidth, cs.backgroundColor, cs.boxShadow].join("|");
  }

  function isChipCandidate(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "SELECT" || tag === "OPTION" || tag === "SCRIPT" || tag === "STYLE" || tag === "INPUT") return false;
    if (!isVisible(el)) return false;
    const text = el.textContent.trim();
    if (!text || text.length > 24) return false;
    const checkText = stripTrailingCount(text);
    if (NOISE_TEXT_RE.test(checkText) || RATING_PATTERN_RE.test(text) || PRICE_LIKE_RE.test(text) || SHIP_DATE_RE.test(text) || AVG_TIME_RE.test(text) || isVariantLabelText(el)) return false;
    if (hasMultipleLabeledChildren(el)) return false;
    return looksLikeClickableChip(el);
  }

  // Given a set of sibling chips, returns the text of whichever ONE chip
  // visually stands out from all the rest (different border/background/
  // shadow) — that's the one marked as selected.
  //
  // This only trusts a clean split: every chip but one shares an
  // identical style, and exactly one differs. If chips carry their own
  // unrelated styling (promo ribbons, per-item badges, differing
  // background images) rather than a shared unselected look, several of
  // them can each differ from whichever style happens to be most common
  // — that's not "the selected one standing out," it's just noise, and
  // guessing by picking all of them glues unrelated options together.
  // When the split isn't clean, return nothing rather than guess.
  function pickOutlierChips(chips) {
    if (chips.length < 2) return [];
    const sigCount = new Map();
    const sigs = chips.map(chip => {
      const sig = chipStyleSignature(chip);
      sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
      return sig;
    });
    let majoritySig = null, majorityCount = 0;
    for (const [sig, count] of sigCount) {
      if (count > majorityCount) { majorityCount = count; majoritySig = sig; }
    }
    // Require exactly chips.length - 1 chips sharing the majority style —
    // i.e. exactly one true outlier. Anything else (all identical, or
    // more than one style group) is too ambiguous to trust.
    if (majorityCount !== chips.length - 1) return [];
    const picked = [];
    chips.forEach((chip, i) => {
      if (sigs[i] !== majoritySig) {
        const text = chip.textContent.trim();
        if (text && text.length <= 24) picked.push(text);
      }
    });
    return picked;
  }

  // Anchors the whole variant search to the purchase panel: only text
  // that sits ABOVE the "Add to Cart"/"Buy Now" row counts. Everything
  // below that row — reviews, rating breakdowns, spec tables — reuses
  // the exact same "Label: Value" shape as a real variant summary
  // ("Color: Red", "Quality: Great", "Location: Quezon City, Metro
  // Manila"), so without this boundary those get swept in too, and since
  // every reviewer picked a different option, they all show up glued
  // together in one label instead of just the one actually selected.
  //
  // Vertical position (not DOM order) is what makes this reliable: the
  // buy buttons and the review section are siblings/cousins all over the
  // page markup, but visually the buttons always sit below the variant
  // picker and above the reviews, so comparing page-Y coordinates holds
  // even when the underlying DOM structure doesn't obviously nest one
  // inside the other.
  const BUY_BUTTON_TEXT_RE = /^(add to cart|buy now|add to bag|chat now|make offer)$/i;

  function findBuyButtonTop() {
    let top = Infinity;
    document.querySelectorAll("button, [role='button'], a").forEach(el => {
      const text = el.textContent.trim();
      if (!BUY_BUTTON_TEXT_RE.test(text)) return;
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      const pageTop = rect.top + window.scrollY;
      if (pageTop < top) top = pageTop;
    });
    return top === Infinity ? null : top;
  }

  // If the buy buttons can't be found at all, don't restrict anything —
  // better to risk the old false-positive than to blind the detector
  // entirely on a page layout we don't recognize.
  function isAboveBuyButtons(el, buyButtonTop) {
    if (buyButtonTop === null) return true;
    const rect = el.getBoundingClientRect();
    const pageTop = rect.top + window.scrollY;
    return pageTop < buyButtonTop;
  }

  // Finds elements whose own text is a variant label ("Color Family:",
  // "Size", "Design", ...).
  function findVariantLabels(buyButtonTop, knownLabelClasses) {
    const labels = [];
    document.querySelectorAll("*").forEach(el => {
      if (el.children.length > 0) return; // labels are leaf text nodes
      if (!isVariantLabelText(el, knownLabelClasses)) return;
      if (!isVisible(el)) return;
      if (!isAboveBuyButtons(el, buyButtonTop)) return;
      labels.push(el);
    });
    return labels;
  }

  // Some sites show the label and its currently-selected value as two
  // separate sibling nodes ("variation:" then "12pcs spoon only" right
  // after it) rather than combined in one node ("Color Family: Khaki").
  // This looks for that adjacent plain-text value.
  function findAdjacentValueText(label) {
    let sib = label.nextElementSibling;
    let hops = 0;
    while (sib && hops < 2) {
      if (sib.children.length === 0 && isVisible(sib)) {
        const text = sib.textContent.trim();
        if (text && text.length <= 40 && !isVariantLabelText(sib) &&
            !NOISE_TEXT_RE.test(text) && !RATING_PATTERN_RE.test(text) &&
            !BAD_VALUE_RE.test(text) && !SHIP_DATE_RE.test(text) && !AVG_TIME_RE.test(text) && !/[₱$]/.test(text)) {
          return text;
        }
      }
      sib = sib.nextElementSibling;
      hops++;
    }
    return null;
  }

  function collectChipsInScope(scope, excludeEl) {
    const chips = [];
    scope.querySelectorAll("button, [role='button'], [role='radio'], li, div, span").forEach(el => {
      if (el === excludeEl) return;
      if (isChipCandidate(el)) chips.push(el);
    });
    return chips;
  }

  // Resolves which chip in a row is selected: trusts an explicit aria/
  // class signal first (grounded in the page's real state), and only
  // falls back to visual style-diffing — and even then only if exactly
  // one chip qualifies either way. Ambiguous rows (zero or multiple
  // chips reading as selected) return null rather than guess.
  function resolveSelectedChip(chips, boundary) {
    // Prefer the chips' own shared immediate parent as the boundary, if
    // they have one — that's the tightest possible cutoff, and it's
    // usually exactly the element carrying a group-level "...-selected"
    // class ("a choice was made somewhere in here") rather than a
    // per-chip one. Falls back to the caller's coarser scope otherwise.
    const parents = chips.map(c => c.parentElement);
    const sharedParent = parents.length && parents.every(p => p === parents[0]) ? parents[0] : null;
    const effectiveBoundary = sharedParent || boundary;
    const structural = chips.filter(el => looksSelected(el, effectiveBoundary));
    if (structural.length) {
      // A single selected *option* can still produce multiple flagged
      // elements — e.g. Lazada's "sku-variable-img-wrap-selected" outer div
      // plus its inner "sku-variable-img-name" span both read as selected,
      // since looksSelected() checks ancestors too. Dedupe by the actual
      // text before treating this as ambiguous; only genuinely different
      // selected values (a real conflict) should return null.
      const texts = new Set(
        structural.map(el => sanitizeChipText(el)).filter(Boolean)
      );
      if (texts.size === 1) return [...texts][0];
      if (texts.size > 1) return null;
      // structural elements existed but none had usable text — fall through
    }
    const outliers = pickOutlierChips(chips);
    return outliers.length === 1 ? outliers[0] : null;
  }

  // Resolves every discoverable variant axis (Color, Size, Variation,
  // ...) to a Map of normalizedLabel -> value. Each label is handled
  // independently, so a product with several axes (e.g. Size AND Color)
  // doesn't lose one just because the other resolved first.
  function collectChipRowAxes(buyButtonTop, knownLabelClasses) {
    const axes = new Map();
    for (const label of findVariantLabels(buyButtonTop, knownLabelClasses)) {
      const key = normalizeLabel(label.textContent.trim());
      if (axes.has(key)) continue;
      // Prefer a plain-text echo of the selection right next to the label,
      // if the page shows one — more reliable than reading chip styles.
      const adjacentValue = findAdjacentValueText(label);
      if (adjacentValue) { axes.set(key, adjacentValue); continue; }
      // Otherwise fall back to the option row. Usually the chips sit
      // directly beside the label under the same parent — but some
      // templates put the label in its own "label column" wrapper with
      // the options row as a separate sibling column, one level up. Try
      // the immediate parent first; only step up one further level if
      // that comes up empty, to keep this from drifting into unrelated
      // page content the way a fully page-wide search would.
      let scope = label.parentElement;
      let chips = scope ? collectChipsInScope(scope, label) : [];
      const labelText = label.textContent.trim();
      if (chips.length < 2 && scope && scope.parentElement && labelText.endsWith(":")) {
        const widerScope = scope.parentElement;
        // Only trust the wider scope if it contains no OTHER real variant
        // label — otherwise this is a multi-section container (e.g. a
        // Color row sitting beside an unrelated, chip-less Quantity
        // stepper) and widening would silently borrow another axis's
        // chips instead of correctly finding none for this one.
        let hasOtherLabel = false;
        widerScope.querySelectorAll("*").forEach(el => {
          if (el === label) return;
          if (el.children.length > 0) return;
          if (isVariantLabelText(el, knownLabelClasses)) hasOtherLabel = true;
        });
        if (!hasOtherLabel) {
          scope = widerScope;
          chips = collectChipsInScope(scope, label);
        }
      }
      // Upper bound guards against a mis-scoped grab of an unrelated,
      // much bigger list of page content. But real products can legitimately
      // have dozens of options under ONE label — e.g. a tumbler listing
      // every size × color combination ("18oz - Amethyst", "22oz - Amethyst",
      // ...) as 80+ buttons under a single "Colors" heading. This row IS
      // correctly scoped (anchored to a confirmed variant label via
      // findVariantLabels), so a high count here is legitimate data, not
      // noise — unlike pageWideVariantFallback below, which has no label to
      // anchor to and keeps the tight 12-cap for that reason.
      if (chips.length < 2 || chips.length > MAX_SCOPED_AXIS_CHIPS) continue;
      const text = resolveSelectedChip(chips, scope);
      if (text) axes.set(key, text);
    }
    return axes;
  }

  // Last-resort, page-wide version of the same idea — only used if no
  // recognizable "Color:"/"Size:" label was found at all. Tightened
  // (bigger minimum group size, noise filtering already applied via
  // isChipCandidate) to keep false positives down since it isn't scoped.
  function pageWideVariantFallback(buyButtonTop) {
    const groups = new Map();
    document.querySelectorAll("button, [role='button'], [role='radio'], li, div, span").forEach(el => {
      if (!isChipCandidate(el)) return;
      if (!isAboveBuyButtons(el, buyButtonTop)) return;
      const parent = el.parentElement;
      if (!parent) return;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    });
    const results = [];
    const seen = new Set();
    for (const chips of groups.values()) {
      if (chips.length < 3 || chips.length > 12) continue; // require a real "row" of options, not just 2 stray buttons
      const text = resolveSelectedChip(chips, parent);
      if (text && !seen.has(text)) { seen.add(text); results.push(text); }
    }
    return results.length ? results.join(" / ") : null;
  }

  // Checks whether an element (or one of the few containers around it)
  // carries an explicit "this option is chosen" signal — either an
  // aria state or a class name flagging it.
  //
  // Class names on Shopee/Lazada are hashed/build-generated, but the
  // "this one is selected" flag is nearly always still spelled out in
  // English somewhere in there — just not always as a clean, separately-
  // bounded word. Names like "itemSelected" or "skuValueIsSelectedTrue"
  // have no non-letter character around "Selected", so a strict
  // \bselected\b regex silently misses them. Splitting on both
  // separators (-, _, space) AND camelCase boundaries first turns
  // "skuValueIsSelectedTrue" into ["sku","Value","Is","Selected","True"]
  // so an exact, case-insensitive token match still finds it — while
  // still correctly rejecting a look-alike like "selectable" or
  // "selector", which would slip through a plain substring search.
  const SELECTED_TOKENS = new Set(["selected", "active", "chosen", "checked", "current", "chip-active"]);
  function classTokens(cls) {
    return cls
      .split(/[^a-zA-Z0-9]+/)
      .flatMap(part => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
      .map(t => t.toLowerCase())
      .filter(Boolean);
  }
  function looksSelected(el, boundary) {
    let node = el;
    for (let i = 0; i < 4 && node && node !== boundary; i++, node = node.parentElement) {
      if (node.getAttribute) {
        if (node.getAttribute("aria-checked") === "true") return true;
        if (node.getAttribute("aria-selected") === "true") return true;
        if (node.getAttribute("aria-pressed") === "true") return true;
      }
      const cls = typeof node.className === "string" ? node.className : "";
      if (cls && classTokens(cls).some(t => SELECTED_TOKENS.has(t))) return true;
    }
    return false;
  }

  // Many product pages echo the current selection as a plain text summary
  // near the top — "Color Family: Khaki", "Package: Set of 3", "Shape:
  // Round" — independent of however the button row below is styled. This
  // is often more reliable than reading chip styles, and naturally covers
  // whatever variant types a given product actually has (package, shape,
  // bundle, scent, combo, ...) instead of needing every word enumerated.
  const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z\s/&]{1,24}):\s*(.{1,40})$/;

  // Normalizes a label ("Color:", " Color ", "COLOR") to a stable key so
  // the same axis found two different ways (a text summary vs. a chip
  // row) is recognized as the same axis rather than two different ones.
  function normalizeLabel(label) {
    return label.trim().replace(/:$/, "").toLowerCase();
  }

  // Returns a Map of normalizedLabel -> resolved value, for every plain-
  // text "Label: Value" line found above the buy buttons.
  function extractLabelValuePairsMap(buyButtonTop) {
    const byLabel = new Map();
    document.querySelectorAll("*").forEach(el => {
      if (el.children.length > 0) return; // plain text leaf only
      if (!isVisible(el)) return;
      if (!isAboveBuyButtons(el, buyButtonTop)) return;
      const text = el.textContent.trim();
      const m = LABEL_VALUE_RE.exec(text);
      if (!m) return;
      const label = m[1].trim();
      const value = m[2].trim();
      if (EXCLUDE_LABEL_WORDS_RE.test(label)) return;
      if (!value || value.length > 40) return;
      if (RATING_PATTERN_RE.test(value) || NOISE_TEXT_RE.test(value) || BAD_VALUE_RE.test(value) || SHIP_DATE_RE.test(value) || AVG_TIME_RE.test(value)) return;
      if (PRICE_LIKE_RE.test(value)) return; // a price/coupon, not a variant value
      const key = normalizeLabel(label);
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key).push({ value, el });
    });

    const resolved = new Map();
    for (const [key, entries] of byLabel) {
      const seenVals = new Set();
      const unique = entries.filter(e => {
        if (seenVals.has(e.value)) return false;
        seenVals.add(e.value);
        return true;
      });
      if (unique.length === 1) {
        // Only one "Label: Value" text under this label anywhere on the
        // page — that reads as an already-resolved summary line, safe
        // to trust directly.
        resolved.set(key, unique[0].value);
      } else {
        // The same label shows up several times with different values —
        // that's not a single resolved summary, it's one echoed line per
        // option (e.g. each chip carries its own "Variation: X" text for
        // accessibility). Joining all of them would list every option
        // instead of the one actually picked, so only trust it if
        // exactly one of them visibly reads as selected.
        const selected = unique.filter(e => looksSelected(e.el));
        if (selected.length === 1) resolved.set(key, selected[0].value);
      }
    }
    return resolved;
  }

  // Prints exactly what each stage saw and picked. Harmless for regular
  // users (nobody has the console open), but next time a product gets
  // the wrong variant — or none — opening DevTools on that page and
  // reading this log tells us the actual class names/aria state
  // involved, instead of us guessing from a screenshot of the result.
  function logVariantDebug(info) {
    try {
      console.groupCollapsed("[PriceWatch] variant detection:", info.stage, "→", info.result);
      console.log("buyButtonTop:", info.buyButtonTop);
      console.groupEnd();
    } catch (_) {}
  }

  // Resolves every discoverable variant axis to a Map of
  // normalizedLabel -> selected value, reflecting actual page state
  // (chip row style/aria, or a plain-text "Label: Value" summary).
  // Pulled out of outlierVariantFallback() so the Shopee API call can
  // consult the SAME resolved selection used for the display string,
  // instead of only ever seeing the item's overall price range.
  function resolveVariantAxesMap(sel) {
    const buyButtonTop = findBuyButtonTop();
    const knownLabelClasses = sel && sel.variantLabelClasses ? sel.variantLabelClasses : null;

    // Merge by axis (Color, Size, Variation, ...) rather than stopping
    // at the first method that returns anything — a product can have
    // several independent axes, and different axes on the same page
    // sometimes only resolve through different methods (one shows a
    // plain-text summary, another only exists as a chip row). Stopping
    // early used to mean the first-resolved axis silently ate the rest.
    const axes = collectChipRowAxes(buyButtonTop, knownLabelClasses); // most reliable: reflects actual page state
    const textPairs = extractLabelValuePairsMap(buyButtonTop);
    for (const [key, value] of textPairs) {
      if (!axes.has(key)) axes.set(key, value);
    }
    return axes;
  }

  // Retries axes resolution itself (not just the final display string) a
  // few times when a real variant label is visible but hasn't resolved a
  // selected value yet — almost always a timing race: the extension read
  // the page in the brief window before the site's own JS finished
  // marking a default option as selected. This matters beyond just the
  // display text: Shopee's price API call is pinned to this SAME axes
  // map (see extractProductData), so a stale/empty read here would leave
  // the price wrongly pinned to the item's overall range even if the
  // variant text later looked fine on a subsequent read.
  //
  // Stops retrying immediately (no wasted delay) once it's clear there's
  // no variant label on the page at all — an empty map is then the
  // correct, final answer, not a timing artifact.
  async function resolveVariantAxesMapWithRetry(sel, maxRetries = 2, delayMs = 250) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const axes = resolveVariantAxesMap(sel);
      if (axes.size) return axes;

      const buyButtonTop = findBuyButtonTop();
      const knownLabelClasses = sel && sel.variantLabelClasses ? sel.variantLabelClasses : null;
      const hasUnresolvedLabel = findVariantLabels(buyButtonTop, knownLabelClasses).length > 0;
      if (!hasUnresolvedLabel) return axes; // genuinely no variant section — empty map is correct

      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delayMs));
    }
    return new Map(); // still unresolved after retries — report honestly, don't guess
  }

  // precomputedAxes lets a caller that already ran resolveVariantAxesMap()
  // (e.g. to pin the Shopee price API to the selected model) reuse that
  // result instead of walking the DOM a second time.
  function outlierVariantFallback(sel, precomputedAxes) {
    const buyButtonTop = findBuyButtonTop();
    const knownLabelClasses = sel && sel.variantLabelClasses ? sel.variantLabelClasses : null;
    const axes = precomputedAxes || resolveVariantAxesMap(sel);

    if (axes.size) {
      const result = [...axes.values()].join(" / ");
      logVariantDebug({ stage: "axes", result });
      return result;
    }

    // A real variant label (e.g. "Color:") exists on the page, but nothing
    // resolved to a selected value from it — most likely because the page
    // was read in the brief window before the site's own JS finished
    // marking a default option as selected. In that case, don't fall
    // through to the much weaker aria/page-wide search below: those have
    // no anchor to the actual variant panel and can latch onto unrelated
    // bordered page chrome (confirmed case: a Lazada "Avg. 23 mins"
    // delivery-time badge got mistaken for the selected variant this way).
    // Better to report no reading yet than a confidently wrong one — the
    // caller can retry once the page has settled.
    if (findVariantLabels(buyButtonTop, knownLabelClasses).length > 0) {
      logVariantDebug({ stage: "unresolved-label", result: null, buyButtonTop });
      return null;
    }

    // No labeled axis found at all — fall back to standard accessible
    // selection attributes, if present.
    const ariaSelected = [];
    document.querySelectorAll("[aria-checked='true'], [aria-selected='true'], [aria-pressed='true']").forEach(el => {
      if (!isAboveBuyButtons(el, buyButtonTop)) return;
      const text = sanitizeChipText(el);
      if (text) ariaSelected.push(text);
    });
    if (ariaSelected.length) {
      const result = [...new Set(ariaSelected)].join(" / ");
      logVariantDebug({ stage: "aria", result, buyButtonTop });
      return result;
    }

    // Last resort: page-wide chip grouping with no recognizable label.
    const pageWide = pageWideVariantFallback(buyButtonTop);
    logVariantDebug({ stage: pageWide ? "page-wide" : "none", result: pageWide, buyButtonTop });
    return pageWide;
  }

  // Given the Shopee item API payload and the currently-selected axis
  // values read from the DOM (in the same order the page shows them,
  // which matches item.tier_variations order), finds the exact model
  // (specific variant combination) the user has picked and returns its
  // own price — instead of item.price_min/price_max, which is the SAME
  // for every variant of the item and can't tell "1pcs roller" apart
  // from "1pcs handle". This is the actual fix for the API price never
  // changing when a chip is selected: the API call was always item-level,
  // never variant-level.
  //
  // Deliberately conservative: only returns a price when every axis on
  // the page matches an option text on the API side AND there's exactly
  // one model with that exact tier_index combination. Any mismatch
  // (different axis count, an unrecognized option label, no matching
  // model) returns null and the caller falls back to the old item-level
  // range — wrong-but-safe beats confidently wrong.
  function findModelPriceFromVariant(item, axisValues) {
    try {
      if (!item || !Array.isArray(item.tier_variations) || !Array.isArray(item.models)) return null;
      if (!axisValues || !axisValues.length) return null;
      if (axisValues.length !== item.tier_variations.length) return null;

      const tierIndex = [];
      for (let i = 0; i < item.tier_variations.length; i++) {
        const options = item.tier_variations[i].options || [];
        const val = String(axisValues[i] || "").trim().toLowerCase();
        const idx = options.findIndex(o => String(o || "").trim().toLowerCase() === val);
        if (idx === -1) return null; // couldn't confidently match this axis — bail rather than guess
        tierIndex.push(idx);
      }

      const matches = item.models.filter(m =>
        Array.isArray(m.tier_index) &&
        m.tier_index.length === tierIndex.length &&
        m.tier_index.every((v, i) => v === tierIndex[i])
      );
      if (matches.length !== 1) return null; // no match, or an ambiguous one — don't guess

      const model = matches[0];
      const rawPrice = model.price_min || model.price;
      if (!rawPrice || rawPrice <= 0) return null; // out of stock / invalid for this exact combo

      return rawPrice / 100000; // Shopee prices are in micro-units
    } catch (_) {
      return null;
    }
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

  // Shopee structural price fallback
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

  // Shopee API fallback
  //
  // Shopee's PDP is a React SPA that renders through requestAnimationFrame,
  // which Chrome pauses on hidden/background tabs. So when background.js
  // opens a tab with active:false, the DOM never actually gets the price
  // element — both the CSS selectors and the structural fallback above
  // just find nothing to read.
  //
  // Fix: call Shopee's own /api/v4/item/get directly — the same endpoint
  // the SPA itself calls before rendering. fetch() doesn't depend on rAF
  // so it resolves fine even in a hidden tab. Runs same-origin from
  // content.js so cookies/CORS aren't an issue, and it's tried first since
  // it also sidesteps the old voucher-price bug — price_min/price_max come
  // straight from the API, not whatever happens to be showing in the DOM.
  //
  // DOM selectors stay in as a fallback for when this API call fails
  // (endpoint changes, network hiccup, etc).
  async function fetchShopeeApiPrice(pageUrl, axisValues) {
    try {
      // URL pattern: https://shopee.ph/product-name-i.{shopId}.{itemId}
      const match = (pageUrl || window.location.href).match(/-i\.(\d+)\.(\d+)/);
      if (!match) return null;

      const shopId = match[1];
      const itemId = match[2];

      // relative URL, same-origin so session cookies just work
      const resp = await fetch(
        `/api/v4/item/get?itemid=${encodeURIComponent(itemId)}&shopid=${encodeURIComponent(shopId)}`,
        { credentials: "same-origin" }
      );
      if (!resp.ok) return null;

      const json = await resp.json();
      const item = json?.data;
      console.log("SHOPEE_ITEM:", JSON.stringify(item));
      if (!item) return null;

      const fmtPHP = n => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

      // If the DOM tells us exactly which variant combo is picked, prefer
      // that model's own price over the item-wide range below — this is
      // what makes selecting "1pcs roller" vs "1pcs handle" (or any other
      // variant) actually change the tracked price instead of always
      // showing the same min–max span regardless of selection.
      const modelPrice = findModelPriceFromVariant(item, axisValues);
      if (modelPrice != null) {
        return {
          price: modelPrice, priceMin: modelPrice, priceMax: modelPrice, isRange: false,
          displayPrice: `₱${fmtPHP(modelPrice)}`,
          apiName: item.name || null,
        };
      }

      // prices are in micro-units (1 PHP = 100,000). both 0 if out of stock.
      const rawMin = item.price_min ?? item.price;
      const rawMax = item.price_max ?? item.price;
      if (!rawMin || rawMin <= 0) return null;

      const priceMin = rawMin / 100000;
      const priceMax = (rawMax && rawMax > 0) ? rawMax / 100000 : priceMin;

      // sanity check — reject anything outside a plausible price range
      if (priceMin < 1 || priceMin > 999999) return null;

      const isRange = priceMax > priceMin;
      const lo = priceMin;
      const hi = priceMax;

      return {
        price:    lo,
        priceMin: lo,
        priceMax: hi,
        isRange,
        displayPrice: isRange
          ? `₱${fmtPHP(lo)} – ₱${fmtPHP(hi)}`
          : `₱${fmtPHP(lo)}`,
        // also expose the product name in case the DOM has no h1 yet
        apiName: item.name || null,
      };
    } catch (_) {
      return null; // falls back to DOM extraction
    }
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

  async function extractProductData() {
    const platform = detectPlatform();
    if (!platform) return null;

    const config = await loadConfig();
    const platformConfig = config ? config[platform] : null;

    if (!isProductPage(platform, platformConfig)) {
      return {
        platform, url: window.location.href,
        name: null, variant: null, price: null, priceMin: null, priceMax: null,
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
      // Resolve which variant chips are selected on the page BEFORE calling
      // the price API, so the API result can be pinned to that exact
      // combination instead of the item's overall min/max price range.
      // Retries internally if a real variant panel exists but hasn't
      // resolved a selection yet (timing race on page load).
      const axesMap = sel ? await resolveVariantAxesMapWithRetry(sel) : new Map();
      const axisValues = [...axesMap.values()];

      // try the API first (see fetchShopeeApiPrice above) — works in hidden tabs too
      const apiResult = await fetchShopeeApiPrice(window.location.href, axisValues);
      if (apiResult) {
        priceResult = apiResult;
        if (apiResult.apiName) name = apiResult.apiName;
      }

      // DOM fallback if the API call failed — only reliable in a visible tab
      if (!priceResult) {
        priceResult = sel ? extractWithSelectors(sel.price, sel.priceExcludeStyle) : null;
      }
      if (!priceResult) priceResult = shopeeStructuralPriceFallback();

      if (!name) name  = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageShopee(sel.image) : null;

      var shopeeVariant = outlierVariantFallback(sel, axesMap) || (sel ? extractVariantWithSelectors(sel.variant) : null);
    } else {
      priceResult = sel ? extractWithSelectors(sel.price, null) : null;
      if (!priceResult && sel && sel.priceFallback) {
        priceResult = extractWithSelectors(sel.priceFallback, null);
      }
      name  = sel ? extractNameWithSelectors(sel.name) : null;
      image = sel ? extractImageLazada(sel.image) : null;
    }

    // Selected variant/type label (Color: Red / Size: L, etc.) — read
    // regardless of which price path was used, so the tracked list can
    // show which variant this entry actually refers to. Shopee already
    // resolved this above (reusing the same axes the API call was pinned
    // to); other platforms resolve it fresh here, with the same retry
    // treatment for a variant panel that hasn't settled yet.
    let variant;
    if (platform === "shopee") {
      variant = shopeeVariant;
    } else {
      const lazadaAxesMap = sel ? await resolveVariantAxesMapWithRetry(sel) : new Map();
      variant = outlierVariantFallback(sel, lazadaAxesMap) || (sel ? extractVariantWithSelectors(sel.variant) : null);
    }

    const finalName = name || document.title || "Unknown Product";

    if (!priceResult) {
      return {
        platform, url: window.location.href, name: finalName, variant,
        price: null, priceMin: null, priceMax: null,
        isRange: false, displayPrice: null, image,
        extractedAt: new Date().toISOString(),
        error: "Could not read the price. If this product has variants, select one first then click the extension again.",
      };
    }

    return {
      platform, url: window.location.href, name: finalName, variant,
      price: priceResult.price, priceMin: priceResult.priceMin,
      priceMax: priceResult.priceMax, isRange: priceResult.isRange,
      displayPrice: priceResult.displayPrice, image,
      extractedAt: new Date().toISOString(), error: null,
    };
  }

  // Live watcher: push updates on variant/image changes
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
    // Always also watch the whole body: some variant changes (e.g. picking
    // a different color/design with the same price) don't touch the price
    // or image elements above, so a narrower watch would miss them and the
    // variant badge would go stale until the popup is reopened.
    targets.push(document.body);
    targets.forEach(t => observer.observe(t, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "srcset", "class"], characterData: true,
    }));
  }

  if (document.readyState === "complete") startWatcher();
  else window.addEventListener("load", startWatcher, { once: true });
  setTimeout(startWatcher, 2000);

  // Message Listener
  //
  // Responds immediately with whatever's currently in the DOM.
  //
  // Used to poll for up to 16s here waiting for Shopee to render, but that
  // broke two things: throttled background tabs never got the price in
  // time, and the service worker would go idle (and get suspended by
  // Chrome) while waiting, so notifications never fired. Now content.js
  // just answers right away, and the retry loop lives in background.js /
  // popup.js instead — each retry is a fresh sendMessage call, which keeps
  // the service worker alive.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "extractProduct" && msg.action !== "checkPrice") return;
    extractProductData().then(data => sendResponse({ success: true, data }));
    return true; // keep channel open for the async response
  });
})();
