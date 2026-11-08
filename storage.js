// Lokale Speicherung im Browser (localStorage). Es gibt keinen Server – alles bleibt auf diesem Gerät.
// Alle Zugriffe sind in try/catch gekapselt, weil localStorage in privaten
// Fenstern, bei blockierten Website-Daten oder vollem Speicher fehlschlagen kann.

const CONV_KEY = "maxxo.conversations.v1";
const SETTINGS_KEY = "maxxo.settings.v1";
const KEYS_KEY = "maxxo.keys.v1";
const MAX_CONVERSATIONS = 200;

export const DEFAULT_SETTINGS = Object.freeze({
  webSearch: "auto", // "auto" | "always" | "off"
});

let onError = () => {};
/** Callback für Speicherfehler (z. B. Toast anzeigen). */
export function setStorageErrorHandler(fn) {
  onError = typeof fn === "function" ? fn : () => {};
}

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    const quota = err && (err.name === "QuotaExceededError" || err.code === 22);
    onError(
      quota
        ? "Der Speicher im Browser ist voll. Lösche ältere Unterhaltungen."
        : "Der Verlauf konnte nicht im Browser gespeichert werden."
    );
    return false;
  }
}

export function newId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
  } catch {
    /* ignorieren */
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function isValidConversation(c) {
  return c && typeof c === "object" && typeof c.id === "string" && Array.isArray(c.messages);
}

export function loadConversations() {
  const data = readJSON(CONV_KEY, []);
  if (!Array.isArray(data)) return [];
  return data.filter(isValidConversation);
}

export function saveConversations(list) {
  const sorted = [...list]
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CONVERSATIONS);
  return writeJSON(CONV_KEY, sorted);
}

export function clearAllConversations() {
  try {
    window.localStorage.removeItem(CONV_KEY);
    return true;
  } catch {
    onError("Der Verlauf konnte nicht gelöscht werden.");
    return false;
  }
}

export function loadSettings() {
  const data = readJSON(SETTINGS_KEY, {});
  const s = { ...DEFAULT_SETTINGS };
  if (data && typeof data === "object") {
    if (["auto", "always", "off"].includes(data.webSearch)) s.webSearch = data.webSearch;
  }
  return s;
}

export function saveSettings(settings) {
  return writeJSON(SETTINGS_KEY, settings);
}

/* ---------------------------------------------------------------- API-Schlüssel
 * Werden nur in diesem Browser gespeichert und von engine.js nur an
 * api.anthropic.com bzw. api.tavily.com gesendet.
 */
export const KEY_PREFIX = Object.freeze({ anthropic: "sk-ant-", tavily: "tvly-" });

function cleanKey(value, prefix) {
  const v = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  return v.startsWith(prefix) && v.length > prefix.length + 8 && v.length < 400 ? v : "";
}

export function loadKeys() {
  const data = readJSON(KEYS_KEY, {});
  return {
    anthropic: cleanKey(data && data.anthropic, KEY_PREFIX.anthropic),
    tavily: cleanKey(data && data.tavily, KEY_PREFIX.tavily),
  };
}

export function saveKeys(keys) {
  const clean = {
    anthropic: cleanKey(keys && keys.anthropic, KEY_PREFIX.anthropic),
    tavily: cleanKey(keys && keys.tavily, KEY_PREFIX.tavily),
  };
  try {
    window.localStorage.setItem(KEYS_KEY, JSON.stringify(clean));
    return true;
  } catch {
    onError("Die Schlüssel konnten nicht im Browser gespeichert werden (privates Fenster?).");
    return false;
  }
}

export function clearKeys() {
  try {
    window.localStorage.removeItem(KEYS_KEY);
    return true;
  } catch {
    onError("Die Schlüssel konnten nicht gelöscht werden.");
    return false;
  }
}

/** Normalisiert eine Eingabe; liefert {ok, value, message}. */
export function validateKey(kind, raw) {
  const prefix = KEY_PREFIX[kind];
  const v = String(raw || "").replace(/\s+/g, "");
  if (!v) return { ok: true, value: "", empty: true };
  if (!v.startsWith(prefix)) return { ok: false, message: `Der Schlüssel muss mit „${prefix}“ beginnen.` };
  if (v.length <= prefix.length + 8 || v.length >= 400) return { ok: false, message: "Der Schlüssel sieht unvollständig aus." };
  return { ok: true, value: v };
}
