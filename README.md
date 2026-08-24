# PriceWatch PH – Chrome & Edge Extension

A privacy-first price monitoring browser extension for **Shopee Philippines** and **Lazada Philippines**. Built as part of the Holy Angel University Computer Science thesis project.

---

## Features

- **Automatic platform detection** – Detects whether you're on Shopee PH or Lazada PH
- **Product extraction** – Reads the product name, image, and current price from the page using DOM parsing
- **Variant-aware tracking** – Tracks a specific size/colour/bundle variant (not just the product as a whole), and shows which variant is being tracked in both the Current and Tracked views
- **Price alerts** – Set a target price and choose to be notified when the price drops to OR rises to that level
- **Background monitoring** – Checks prices hourly even when you're not on the product page
- **Price history** – Stores up to 30 days of price records per product
- **Export** – Download all tracked products and history as JSON or CSV
- **100% private** – All data stored locally on your device; nothing is sent to any server

---

## Installation

### Chrome
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `price-tracker-extension` folder
5. The PriceWatch PH icon will appear in your toolbar

### Microsoft Edge
1. Open Edge and go to `edge://extensions`
2. Enable **Developer mode** (left sidebar)
3. Click **Load unpacked**
4. Select the `price-tracker-extension` folder

---

## How to Use

1. Navigate to any product page on **shopee.ph** or **lazada.com.ph**
2. Click the PriceWatch PH extension icon in your toolbar
3. The extension reads the product name, image, and price automatically
4. Enter your target price and choose:
   - **Notify when price drops to** – get alerted when the price goes down to your target
   - **Notify when price rises to** – get alerted when the price goes up to your target
5. Click **Start Tracking**
6. You'll receive a browser notification when your target is met

### Managing Tracked Products
- Click the **Tracked** tab to see all products you're monitoring
- Click ✕ on any product to stop tracking it
- Use the **export button** (↓ icon in the header) to download your data

### Variant Tracking
Many Shopee and Lazada products come in several sizes, colours, or bundles, each with its own price. PriceWatch PH tracks a *specific* variant rather than the product as a whole:

- **Lazada** already encodes the chosen variant in the product URL, so opening a product page with a variant selected and tracking it just works — the exact URL is what gets re-checked later.
- **Shopee** does not put the variant in the URL, so the extension instead remembers exactly which option(s) were selected when the product was tracked (e.g. "grey", "M") by reading Shopee's own selection markup. On every later refresh, it re-selects those same options — the same buttons a shopper would click by hand — before reading the price, rather than trusting whichever variant the page shows by default. Shopee's item data (the same internal request already used to read the price — see *Ethical Considerations* in the thesis) is also cross-checked as a secondary source for the variant's internal ID.
- An optional **variant label** field (e.g. "Red, XL") is auto-filled when detectable and shown in both the **Current** and **Tracked** views; it can be edited freely, since automatic detection of the on-page label is best-effort and depends on each platform's current page layout.
- Two different variants of the same Shopee product (same URL) can be tracked as separate items, consistent with treating each product variation as its own tracked entry.

---

## Technical Architecture

| Component | Technology |
|-----------|-----------|
| Platform detection | URL pattern matching |
| Price extraction | Tree-based DOM parsing with CSS selectors |
| Price cleaning | Rule-based normalization (strips ₱, commas) |
| Alert logic | Threshold comparison algorithm |
| Data storage | `chrome.storage.local` (IndexedDB-backed) |
| Background checks | Chrome Alarms API + Service Workers |
| Notifications | Chrome Notifications API |

---

## Limitations

- Only works on **Shopee PH** (shopee.ph) and **Lazada PH** (lazada.com.ph)
- Requires the browser to be open for background checks to run
- If Shopee or Lazada updates their page layout, the CSS selectors may need to be updated
- Cannot read prices hidden behind login walls or captchas
- Does **not** track shipping fees, stock availability, or seller ratings
- Data is device-specific and does not sync across browsers/devices
- Auto-detected variant labels are best-effort; if a platform's page layout changes, the label may need to be entered manually (the tracked price itself is not affected by this)
- Shopee products tracked *before* variant tracking was added won't automatically become variant-specific — remove and re-track them while viewing the desired variant to pick up the fix
- If two variants of the same Shopee item happen to share the exact same price at the moment it's tracked, the extension can't tell them apart by price alone; it still tracks the correct price shown on screen, but re-checks may default to whichever variant the page shows first
- On the **Current** tab, Shopee prices mirror exactly what's shown on the page: if no variant is selected yet and the page shows a price range (e.g. "₱1,000 – ₱2,000"), the Current tab shows that same range rather than picking one number for you — track a specific variant first if you want a single tracked price
- On Shopee, a single (non-range) price read from the page's DOM is cross-checked against the same item API call already used elsewhere (see *Ethical Considerations*) before it's trusted: if the DOM briefly picked up a voucher, shop discount, or delivery-guarantee badge instead of the real price — which can happen if the price is read a moment before Shopee's page finishes re-rendering — the API's own number for that item (or that exact variant, when known) is used instead

---

## Privacy

- No data is transmitted to any external server
- All prices, product URLs, and settings are stored only on your local device
- No personal information is collected
- You can export and delete all your data at any time

---

## Files

```
price-tracker-extension/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup.html             # Extension popup UI
├── config/
│   └── selectors.json     # Platform-specific CSS selector profiles
├── css/
│   └── popup.css          # Popup styles
├── js/
│   ├── popup.js           # Popup controller
│   ├── content.js         # DOM extraction (runs on product pages)
│   ├── background.js      # Service worker (alarms, notifications)
│   ├── db.js              # Storage helper
│   └── chart.js           # Price history line chart renderer
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
