/* popup.css – PriceWatch PH v2.0 */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:         #0f1117;
  --bg-2:       #181c25;
  --bg-3:       #1e2330;
  --border:     #2a3045;
  --border-2:   #374060;
  --text:       #e8eaf0;
  --text-2:     #9aa0b8;
  --text-3:     #636b88;
  --accent:     #4f7ef8;
  --accent-dim: #2c4a9e;
  --green:      #22c55e;
  --green-dim:  #14532d;
  --red:        #f43f5e;
  --red-dim:    #881337;
  --amber:      #f59e0b;
  --shopee:     #ee4d2d;
  --shopee-dim: #7a2010;
  --lazada:     #ef5350;
  --lazada-dim: #7a1f1e;
  --radius:     10px;
  --radius-sm:  6px;
  --tr:         0.18s ease;
}

html { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 13px; background: var(--bg); color: var(--text); }
body { width: 360px; min-height: 200px; max-height: 600px; overflow-y: auto; overflow-x: hidden; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 4px; }

/* ── Header ───────────────────────────────────────────────────────── */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 13px; background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 10;
}
.header-brand { display: flex; align-items: center; gap: 8px; }
.header-logo {
  width: 30px; height: 30px; background: var(--accent);
  border-radius: var(--radius-sm); display: grid; place-items: center; color: #fff; flex-shrink: 0;
}
.header-title { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
.header-ph { color: var(--accent); }
.header-actions { display: flex; gap: 5px; }

/* ── Icon Button ─────────────────────────────────────────────────── */
.icon-btn {
  width: 28px; height: 28px; background: var(--bg-3);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text-2); cursor: pointer; display: grid;
  place-items: center; transition: var(--tr);
}
.icon-btn:hover { background: var(--border); color: var(--text); }

/* ── Tab Nav ─────────────────────────────────────────────────────── */
.tab-nav {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  background: var(--bg-2); border-bottom: 1px solid var(--border);
}
.tab-btn {
  padding: 9px 6px; background: none; border: none;
  color: var(--text-3); font-size: 12px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center;
  justify-content: center; gap: 5px; transition: var(--tr);
  border-bottom: 2px solid transparent; position: relative; bottom: -1px;
}
.tab-btn:hover { color: var(--text-2); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
.badge {
  background: var(--accent-dim); color: var(--accent);
  font-size: 10px; font-weight: 700; padding: 1px 5px;
  border-radius: 10px; min-width: 18px; text-align: center;
}
.badge-red { background: rgba(244,63,94,0.15); color: var(--red); }

/* ── Tab Panels ──────────────────────────────────────────────────── */
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* ── States ──────────────────────────────────────────────────────── */
.empty-state, .error-state {
  text-align: center; padding: 28px 16px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.empty-icon { font-size: 32px; margin-bottom: 4px; }
.empty-title { font-size: 14px; font-weight: 600; }
.empty-sub { font-size: 12px; color: var(--text-2); line-height: 1.5; max-width: 240px; }
.loading-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 36px 16px; color: var(--text-2); font-size: 12px;
}
.spinner {
  width: 24px; height: 24px; border: 2px solid var(--border-2);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Platform Headliner ──────────────────────────────────────────── */
.platform-headliner {
  display: flex; align-items: center; padding: 7px 14px;
  background: var(--shopee-dim); border-bottom: 2px solid var(--shopee);
  transition: background .2s, border-color .2s;
}
.platform-headliner.lazada { background: var(--lazada-dim); border-bottom-color: var(--lazada); }
.platform-headliner-inner { display: flex; align-items: center; gap: 7px; }
.platform-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--shopee); flex-shrink: 0;
}
.platform-headliner.lazada .platform-dot { background: var(--lazada); }
#platform-headliner-text { font-size: 11px; font-weight: 800; letter-spacing: 1.2px; color: #fff; text-transform: uppercase; }

/* ── Product Card ────────────────────────────────────────────────── */
.product-card { background: var(--bg-2); border-bottom: 1px solid var(--border); padding: 12px 14px; }
.product-layout { display: flex; gap: 11px; }
.product-img-wrap {
  flex-shrink: 0; width: 76px; height: 76px; background: var(--bg-3);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow: hidden; display: grid; place-items: center;
}
.product-img-wrap img { width: 100%; height: 100%; object-fit: contain; }
.no-img { font-size: 26px; }
.product-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
.product-name {
  font-size: 12.5px; font-weight: 500; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; margin-bottom: 8px;
}
.price-label { font-size: 9.5px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: .5px; display: block; }
.price-value { font-size: 20px; font-weight: 700; color: var(--green); letter-spacing: -.3px; word-break: break-word; line-height: 1.2; }

/* ── Notices ─────────────────────────────────────────────────────── */
.variant-notice {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 8px 14px; background: rgba(79,126,248,.07);
  border-bottom: 1px solid rgba(79,126,248,.2);
  font-size: 11.5px; color: var(--accent); line-height: 1.45;
}
.variant-notice svg { flex-shrink: 0; margin-top: 1px; }
.vn-text { flex: 1; }
.already-tracked {
  display: flex; align-items: center; gap: 6px;
  background: rgba(34,197,94,.07); border-bottom: 1px solid rgba(34,197,94,.15);
  padding: 8px 14px; font-size: 11.5px; color: var(--green); font-weight: 500;
}

/* ── Target Section ──────────────────────────────────────────────── */
.target-section { padding: 13px 14px; background: var(--bg); border-top: 1px solid var(--border); }
.section-label { font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-3); margin-bottom: 8px; }
.alert-hint { font-size: 11.5px; color: var(--text-2); line-height: 1.45; margin-bottom: 10px; }
.target-input-row {
  display: flex; align-items: center; background: var(--bg-2);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow: hidden; margin-bottom: 10px; transition: border-color var(--tr);
}
.target-input-row:focus-within { border-color: var(--accent); }
.peso-prefix {
  padding: 0 10px; color: var(--text-2); font-size: 15px; font-weight: 600;
  background: var(--bg-3); border-right: 1px solid var(--border);
  height: 40px; display: flex; align-items: center;
}
.target-input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text); font-size: 15px; font-weight: 600;
  padding: 0 10px; height: 40px;
}
.target-input::placeholder { color: var(--text-3); font-weight: 400; font-size: 13px; }
.target-input::-webkit-outer-spin-button,
.target-input::-webkit-inner-spin-button { -webkit-appearance: none; }
.tracking-note {
  font-size: 11px; color: var(--amber);
  background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.25);
  border-radius: var(--radius-sm); padding: 7px 10px; margin-bottom: 10px; line-height: 1.45;
}
.current-target-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  padding: 7px 10px; background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.ct-label { font-size: 11px; color: var(--text-3); }
.ct-value { font-size: 13px; font-weight: 700; color: var(--accent); }

/* ── Buttons ─────────────────────────────────────────────────────── */
.btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 10px 14px; border-radius: var(--radius-sm);
  font-size: 12.5px; font-weight: 600; cursor: pointer; border: none; transition: var(--tr);
}
.btn-primary  { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.12); }
.btn-primary:disabled { opacity: .6; cursor: not-allowed; filter: none; }
.btn-secondary { background: var(--bg-3); border: 1px solid var(--border-2); color: var(--text); }
.btn-secondary:hover { background: var(--border); }
.btn-danger { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); }
.btn-danger:hover { background: var(--red); color: #fff; }
.btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn-sm { padding: 7px 12px; font-size: 12px; width: auto; flex: 1; }

/* ── Tracked List ────────────────────────────────────────────────── */
#tab-tracked { padding: 12px; }
#tracked-list { display: flex; flex-direction: column; gap: 8px; }
.tracked-item {
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; transition: border-color var(--tr);
}
.tracked-item:hover { border-color: var(--border-2); }
.ti-headliner {
  display: flex; align-items: center; gap: 6px; padding: 4px 10px;
  background: var(--shopee-dim); border-bottom: 1px solid var(--shopee);
  font-size: 9.5px; font-weight: 800; letter-spacing: 1px; color: #fff; text-transform: uppercase;
}
.ti-headliner.lazada { background: var(--lazada-dim); border-bottom-color: var(--lazada); }
.ti-headliner .ti-check { margin-left: auto; font-size: 9px; font-weight: 400; letter-spacing: 0; color: rgba(255,255,255,.6); text-transform: none; }
.ti-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--shopee); flex-shrink: 0; }
.ti-headliner.lazada .ti-dot { background: var(--lazada); }
.ti-body { display: flex; gap: 10px; align-items: flex-start; padding: 10px; }
.ti-img {
  flex-shrink: 0; width: 46px; height: 46px; background: var(--bg-3);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow: hidden; display: grid; place-items: center; font-size: 20px;
}
.ti-img img { width: 100%; height: 100%; object-fit: contain; }
.ti-info { flex: 1; min-width: 0; }
.ti-name {
  font-size: 11.5px; font-weight: 500; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; margin-bottom: 4px; line-height: 1.35;
}
.ti-prices { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 3px; }
.ti-price { font-size: 13px; font-weight: 700; color: var(--green); }
.ti-alerted {
  display: inline-flex; align-items: center; gap: 3px; font-size: 10px;
  background: rgba(34,197,94,.1); border: 1px solid var(--green);
  color: var(--green); border-radius: 4px; padding: 1px 5px; font-weight: 600;
}
.ti-target { font-size: 10.5px; color: var(--text-3); margin-bottom: 4px; }
.ti-target strong { color: var(--accent); }
.ti-no-target { color: var(--text-3); font-style: italic; }
.ti-url {
  display: block; font-size: 10px; color: var(--accent); text-decoration: none;
  opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 185px; transition: opacity var(--tr);
}
.ti-url:hover { opacity: 1; text-decoration: underline; }
.ti-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }
.ti-history-btn, .ti-remove {
  background: none; border: none; cursor: pointer;
  width: 26px; height: 26px; display: grid; place-items: center;
  border-radius: var(--radius-sm); transition: var(--tr); color: var(--text-3);
}
.ti-history-btn:hover { color: var(--accent); background: rgba(79,126,248,.1); }
.ti-remove:hover { color: var(--red); background: rgba(244,63,94,.1); }

/* ── Alerts Tab ──────────────────────────────────────────────────── */
#tab-alerts { padding: 10px 12px; }
.alerts-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
.alerts-hint {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-3); margin-bottom: 10px; line-height: 1.4;
}
#alerts-list { display: flex; flex-direction: column; gap: 7px; }
.alert-item {
  display: flex; gap: 9px; align-items: flex-start;
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px; border-left-width: 3px;
}
.alert-item--target { border-left-color: var(--accent); }
.alert-item--drop   { border-left-color: var(--green); }
.alert-item--rise   { border-left-color: var(--amber); }
.alert-item--change { border-left-color: var(--text-3); }
.alert-icon { font-size: 18px; flex-shrink: 0; line-height: 1; margin-top: 1px; }
.alert-body { flex: 1; min-width: 0; }
.alert-title { font-size: 11.5px; font-weight: 700; margin-bottom: 3px; }
.alert-msg { font-size: 11px; color: var(--text-2); line-height: 1.45; margin-bottom: 4px; word-break: break-word; }
.alert-time { font-size: 10px; color: var(--text-3); }

/* ── History Panel (slide-in from right) ────────────────────────── */
.history-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.6);
  z-index: 40; overflow: hidden;
}
.history-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 100%;
  background: var(--bg); display: flex; flex-direction: column;
  transform: translateX(100%); transition: transform .28s ease;
  overflow-y: auto;
}
.history-panel.open { transform: translateX(0); }
.history-header {
  display: flex; align-items: center; gap: 10px; padding: 11px 13px;
  background: var(--bg-2); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 5;
}
.history-title-wrap { flex: 1; min-width: 0; }
.history-title {
  display: block; font-size: 12.5px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.history-platform {
  display: inline-block; margin-top: 3px; font-size: 9.5px; font-weight: 800;
  letter-spacing: .8px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;
}
.history-platform.shopee { background: var(--shopee-dim); color: var(--shopee); }
.history-platform.lazada { background: var(--lazada-dim); color: var(--lazada); }

/* Stats row */
.history-stats {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 1px; background: var(--border); border-bottom: 1px solid var(--border);
}
.hstat {
  background: var(--bg-2); padding: 10px 8px;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
}
.hstat-label { font-size: 9.5px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.hstat-value { font-size: 12px; font-weight: 700; color: var(--text); text-align: center; word-break: break-word; }
.hstat-accent { color: var(--accent); }
.hstat-green  { color: var(--green); }
.hstat-red    { color: var(--red); }

/* Chart */
.chart-wrap {
  padding: 14px; position: relative;
  background: var(--bg); border-bottom: 1px solid var(--border);
}
#price-chart { display: block; width: 100%; }
.chart-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  text-align: center; font-size: 12px; color: var(--text-3); line-height: 1.6;
  padding: 16px;
}

/* History edit section */
.history-edit { padding: 13px 14px; }

/* ── Toast ───────────────────────────────────────────────────────── */
.toast {
  position: fixed; bottom: 12px; left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--bg-3); border: 1px solid var(--border-2);
  color: var(--text); padding: 8px 16px; border-radius: 20px;
  font-size: 12px; font-weight: 500; opacity: 0; pointer-events: none;
  transition: opacity .2s, transform .2s; z-index: 200;
  white-space: nowrap; max-width: 320px; text-align: center;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.toast.success { border-color: var(--green); color: var(--green); }
.toast.error   { border-color: var(--red);   color: var(--red);   }

/* ── Modal ───────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.7);
  z-index: 50; display: grid; place-items: center; padding: 16px;
}
.modal {
  background: var(--bg-2); border: 1px solid var(--border-2);
  border-radius: var(--radius); width: 100%; max-width: 300px; overflow: hidden;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.modal-title { font-size: 13px; font-weight: 700; }
.modal-body { padding: 14px; }
.modal-desc { font-size: 12px; color: var(--text-2); margin-bottom: 12px; line-height: 1.5; }
.export-options { display: flex; flex-direction: column; gap: 8px; }
