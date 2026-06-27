# PriceWatch PH – Chrome & Edge Extension

A privacy-first price monitoring browser extension for **Shopee Philippines** and **Lazada Philippines**. Built as part of the Holy Angel University Computer Science thesis project.

---

## Features

- **Automatic platform detection** – Detects whether you're on Shopee PH or Lazada PH
- **Product extraction** – Reads the product name, image, and current price from the page using DOM parsing
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
├── css/
│   └── popup.css          # Popup styles
├── js/
│   ├── popup.js           # Popup controller
│   ├── content.js         # DOM extraction (runs on product pages)
│   ├── background.js      # Service worker (alarms, notifications)
│   └── db.js              # Storage helper
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
