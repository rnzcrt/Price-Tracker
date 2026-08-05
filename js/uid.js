// uid.js — persistent, per-device user identifier + evidence log
//
// NOTE: deliberately local-only (chrome.storage.local), not
// chrome.storage.sync. The thesis's stated scope (Delimitation #5) and
// ethical commitments explicitly rule out cross-device sync and any
// external transmission of data: "all data is saved only on the user's
// current device and does not automatically sync across different
// browsers or devices" / "storing all data locally without external
// transmission, no collection of personal user information, no tracking
// except for the product pages being viewed." chrome.storage.sync routes
// through Google's servers, which would violate both of those.
//
// So this ID is scoped to one device/install, same as the rest of the
// extension's data. It's still useful as an evidence-log tag: every
// tracked action on THIS device carries the same ID, showing a consistent
// trail of activity from one user session — just not proof of identity
// across separate devices. If cross-device identity is ever genuinely
// needed, that requires an explicit account/sign-in system and a
// corresponding update to the thesis's scope and ethics sections — not a
// silent addition here.
"use strict";

const UID = (() => {
  const ID_KEY  = "pw_user_uid";
  const LOG_KEY = "pw_evidence_log";
  const MAX_LOG_ENTRIES = 500;

  function generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for environments without crypto.randomUUID
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function chromeGet(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(result[key] ?? null);
      });
    });
  }
  function chromeSet(key, value) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, () => resolve(!chrome.runtime.lastError));
    });
  }

  // Returns the same UID every time it's called on THIS device/install.
  // Mints one on first-ever call. A reinstall, or a different device,
  // gets a fresh one — by design, matching the thesis's local-only scope.
  let cached = null;
  async function get() {
    if (cached) return cached;
    const existing = await chromeGet(ID_KEY);
    const id = existing || generateUUID();
    if (!existing) await chromeSet(ID_KEY, id);
    cached = id;
    return cached;
  }

  // Tags an action with the current UID + timestamp and appends it to a
  // local evidence log, capped so it can't grow unbounded.
  async function logEvidence(action, detail = {}) {
    const id  = await get();
    const raw = await chromeGet(LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.push({
      uid: id,
      action,
      detail,
      timestamp: new Date().toISOString(),
      userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || null,
    });
    await chromeSet(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG_ENTRIES)));
  }

  async function getEvidenceLog() {
    const raw = await chromeGet(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  async function clearEvidenceLog() {
    await chromeSet(LOG_KEY, JSON.stringify([]));
  }

  return { get, logEvidence, getEvidenceLog, clearEvidenceLog };
})();
