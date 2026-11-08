// Maxxo KI Mobil – Frontend-Logik (ES-Modul, läuft komplett im Browser, kein eigener Server)
import { renderMarkdown } from "./markdown.js";

// Schutz vor Clickjacking: in fremden Rahmen (iframe) nichts anzeigen
if (window.top !== window.self) document.documentElement.hidden = true;
import {
  loadConversations, saveConversations, clearAllConversations,
  loadSettings, saveSettings, setStorageErrorHandler, newId,
  loadKeys, saveKeys, clearKeys, validateKey,
} from "./storage.js";
import { runChat, getStatus } from "./engine.js";

const MAX_INPUT = 8000;
const MAX_HISTORY = 40;

const $ = (id) => document.getElementById(id);
const dom = {
  sidebar: $("sidebar"), backdrop: $("backdrop"), openSidebar: $("open-sidebar"), closeSidebar: $("close-sidebar"),
  newChat: $("new-chat"), convList: $("conv-list"), convEmpty: $("conv-empty"), clearHistory: $("clear-history"),
  title: $("conv-title"), statusPill: $("status-pill"), openSettings: $("open-settings"),
  banner: $("banner"), bannerText: $("banner-text"), bannerRetry: $("banner-retry"),
  messages: $("messages"), inner: $("messages-inner"),
  form: $("composer"), input: $("input"), send: $("send"), sendLabel: document.querySelector(".send-label"),
  chip: $("search-chip"), counter: $("char-counter"),
  settings: $("settings-dialog"), settingsClear: $("settings-clear"), clearEverything: $("clear-everything"),
  searchNotConfigured: $("search-not-configured"),
  serverInfo: $("server-info"), infoLlmProvider: $("info-llm-provider"), infoLlmModel: $("info-llm-model"),
  infoSearch: $("info-search-provider"), llmNotConfigured: $("llm-not-configured"),
  keyAnthropic: $("key-anthropic"), keyTavily: $("key-tavily"),
  keyAnthropicState: $("key-anthropic-state"), keyTavilyState: $("key-tavily-state"),
  keysSave: $("keys-save"), keysClear: $("keys-clear"), keysError: $("keys-error"),
  confirm: $("confirm-dialog"), confirmTitle: $("confirm-title"), confirmText: $("confirm-text"), confirmOk: $("confirm-ok"),
  toasts: $("toasts"), announcer: $("announcer"),
};

const LLM_LABELS = { anthropic: "Anthropic (Claude)" };
const SEARCH_LABELS = { tavily: "Tavily", none: "Keiner" };
const MODEL_LABEL = "Claude Haiku 5.5 (fest eingestellt)";
const ONION_TITLE = "Nur im Tor Browser erreichbar";
const WEB_LABELS = { auto: "Automatisch", always: "Immer", off: "Aus" };

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M5 15a8 8 0 0 0 14 2M19 9A8 8 0 0 0 5 7"/></svg>',
};

const EXAMPLES = [
  "Was gibt es Neues zur Raumfahrt diese Woche?",
  "Erkläre mir Quantencomputer einfach",
  "Schreib mir eine Python-Funktion, die Primzahlen findet",
  "Welche Vor- und Nachteile haben Wärmepumpen?",
];

/* ---------------------------------------------------------------- Zustand */

const state = {
  conversations: [],
  activeId: null,
  settings: loadSettings(),
  status: null,
  keys: loadKeys(), // { anthropic, tavily } – nur in diesem Browser gespeichert
  online: navigator.onLine !== false,
  streaming: null, // { controller, convId, msgId }
  stickToBottom: true,
  expandedSources: new Set(),
};

setStorageErrorHandler((msg) => toast(msg));
state.conversations = loadConversations();
// Antworten, die beim Schließen/Neuladen der Seite unterbrochen wurden, als solche kennzeichnen
for (const c of state.conversations) {
  for (const m of c.messages || []) {
    if (m.role === "assistant" && !m.error && !m.aborted && !(m.content || "").trim()) {
      m.error = { code: "interrupted", message: "Diese Antwort wurde unterbrochen (Seite geschlossen oder neu geladen)." };
    }
  }
}

/* ---------------------------------------------------------------- Hilfen */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function toast(text, ms = 3200) {
  const t = el("div", "toast", text);
  dom.toasts.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function announce(text) {
  dom.announcer.textContent = "";
  setTimeout(() => { dom.announcer.textContent = text; }, 50);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "sr-only";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* ignorieren */ }
    ta.remove();
  }
  toast("Kopiert");
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 40);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relativeDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Heute, " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function safeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

function confirmDialog(title, text, okLabel = "Löschen") {
  return new Promise((resolve) => {
    dom.confirmTitle.textContent = title;
    dom.confirmText.textContent = text;
    dom.confirmOk.textContent = okLabel;
    const onClose = () => {
      dom.confirm.removeEventListener("close", onClose);
      resolve(dom.confirm.returnValue === "ok");
    };
    dom.confirm.returnValue = "";
    dom.confirm.addEventListener("close", onClose);
    dom.confirm.showModal();
  });
}

/* ---------------------------------------------------------------- Speicher */

function persist() {
  // Flüchtige Felder (pending, statusText) nicht speichern
  const clean = state.conversations.map((c) => ({
    ...c,
    messages: c.messages.map(({ pending, statusText, ...rest }) => rest),
  }));
  saveConversations(clean);
}

function activeConversation() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function makeTitle(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 57) + "…" : t || "Neue Unterhaltung";
}

/* ---------------------------------------------------------------- Seitenleiste */

function renderSidebar() {
  const list = [...state.conversations]
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  dom.convList.replaceChildren();
  dom.convEmpty.hidden = list.length > 0;
  for (const c of list) {
    const li = el("li", "conv-item" + (c.id === state.activeId ? " active" : ""));
    const open = el("button", "conv-open");
    open.type = "button";
    open.dataset.id = c.id;
    if (c.id === state.activeId) open.setAttribute("aria-current", "true");
    open.append(el("span", "conv-title", c.title || "Neue Unterhaltung"), el("span", "conv-date", relativeDay(c.updatedAt || c.createdAt)));
    const del = el("button", "conv-del");
    del.type = "button";
    del.dataset.del = c.id;
    del.setAttribute("aria-label", "Unterhaltung löschen: " + (c.title || ""));
    del.innerHTML = ICONS.trash;
    li.append(open, del);
    dom.convList.appendChild(li);
  }
}

function setSidebar(open) {
  dom.sidebar.classList.toggle("open", open);
  dom.backdrop.hidden = !open;
  dom.openSidebar.setAttribute("aria-expanded", String(open));
  if (open) dom.newChat.focus();
}

function selectConversation(id) {
  state.activeId = id;
  state.stickToBottom = true;
  renderAll();
  setSidebar(false);
  dom.input.focus();
}

function newConversation() {
  state.activeId = null;
  renderAll();
  setSidebar(false);
  dom.input.focus();
}

async function deleteConversation(id) {
  const c = state.conversations.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmDialog("Unterhaltung löschen?", `„${c.title}“ wird aus diesem Browser gelöscht. Das kann nicht rückgängig gemacht werden.`);
  if (!ok) return;
  if (state.streaming && state.streaming.convId === id) state.streaming.controller.abort();
  state.conversations = state.conversations.filter((x) => x.id !== id);
  if (state.activeId === id) state.activeId = null;
  persist();
  renderAll();
  toast("Unterhaltung gelöscht");
}

async function deleteAll() {
  const ok = await confirmDialog("Gesamten Verlauf löschen?", "Alle Unterhaltungen werden aus diesem Browser gelöscht. Das kann nicht rückgängig gemacht werden.", "Alles löschen");
  if (!ok) return;
  if (state.streaming) state.streaming.controller.abort();
  state.conversations = [];
  state.activeId = null;
  clearAllConversations();
  renderAll();
  toast("Verlauf gelöscht");
}

/* ---------------------------------------------------------------- Nachrichten */

function renderAll() {
  renderSidebar();
  renderMessages();
  updateComposer();
}

function renderMessages() {
  const conv = activeConversation();
  dom.title.textContent = conv ? conv.title : "Maxxo KI";
  dom.inner.replaceChildren();
  if (!conv || conv.messages.length === 0) {
    dom.inner.appendChild(renderEmpty());
    return;
  }
  conv.messages.forEach((m, idx) => dom.inner.appendChild(buildMessage(m, conv, idx === conv.messages.length - 1)));
  scrollToBottom(true);
}

function renderEmpty() {
  const wrap = el("div", "empty");
  const logo = el("img", "empty-logo");
  logo.src = "favicon.svg";
  logo.alt = "";
  if (!state.keys.anthropic) {
    // Erster Start: ohne Claude-Schlüssel geht nichts – freundlich hinführen
    const card = el("div", "onboarding");
    card.append(
      el("h2", "", "Willkommen bei Maxxo KI Mobil"),
      el("p", "", "Trage zuerst deinen Claude-Schlüssel ein. Er wird nur in diesem Browser auf diesem Gerät gespeichert."),
    );
    const b = el("button", "btn btn-primary", "Schlüssel eintragen");
    b.type = "button";
    b.dataset.openSettings = "1";
    card.appendChild(b);
    wrap.append(logo, card);
    return wrap;
  }
  wrap.append(logo, el("h2", "", "Hallo! Ich bin Maxxo KI."), el("p", "", "Stell mir eine Frage – bei Bedarf recherchiere ich aktuelle Informationen im Web."));
  const ex = el("div", "examples");
  for (const e of EXAMPLES) {
    const b = el("button", "example", e);
    b.type = "button";
    b.dataset.example = e;
    ex.appendChild(b);
  }
  wrap.appendChild(ex);
  return wrap;
}

function buildMessage(m, conv, isLast) {
  if (m.role === "user") {
    const row = el("div", "msg msg-user");
    row.dataset.id = m.id;
    const bubble = el("div", "bubble", m.content);
    bubble.setAttribute("aria-label", "Deine Nachricht");
    row.appendChild(bubble);
    return row;
  }

  const row = el("div", "msg msg-assistant");
  row.dataset.id = m.id;
  const avatar = el("div", "avatar", "M");
  avatar.setAttribute("aria-hidden", "true");
  const body = el("div", "msg-body");
  body.appendChild(el("div", "msg-name", "Maxxo KI"));

  // Recherche-Hinweise
  const r = m.research;
  if (r && r.performed) {
    const badges = el("div", "badges");
    const b = el("span", "badge");
    b.innerHTML = ICONS.globe;
    b.append("Mit Web-Recherche");
    badges.appendChild(b);
    if (r.via === "tor") {
      const t = el("span", "badge tor");
      t.innerHTML = ICONS.shield;
      t.append("über Tor");
      badges.appendChild(t);
    }
    if (r.query) badges.appendChild(el("span", "research-query", "Suche: „" + r.query + "“"));
    body.appendChild(badges);
  }
  if (r && r.notice) body.appendChild(el("p", "notice", r.notice));
  const on = r && r.onion;
  if (on && on.requested) {
    let line = ".onion: " + (on.found > 0 ? on.found + (on.found === 1 ? " Treffer" : " Treffer") : "keine Treffer");
    if (on.filtered > 0) line += ` · ${on.filtered} aus Sicherheitsgründen ausgeblendet`;
    body.appendChild(el("p", "onion-summary", line));
    if (on.notice) body.appendChild(el("p", "notice", on.notice));
  }

  // Inhalt
  const sources = Array.isArray(m.sources) ? m.sources : [];
  const srcMap = new Map(sources.map((s) => [Number(s.id), s]));
  if (m.content) {
    const content = el("div", "content");
    content.appendChild(renderMarkdown(m.content, { sources: srcMap, anchorPrefix: "src-" + m.id + "-" }));
    body.appendChild(content);
  }

  // Ladezustand
  if (m.pending) {
    const typing = el("div", "typing");
    const dots = el("span", "dots");
    dots.append(el("span"), el("span"), el("span"));
    dots.setAttribute("aria-hidden", "true");
    typing.append(dots, el("span", "", m.statusText || "Denke nach…"));
    body.appendChild(typing);
  }

  if (m.aborted) body.appendChild(el("p", "aborted-note", "Antwort abgebrochen."));

  if (m.error) {
    const box = el("div", "error-box");
    box.setAttribute("role", "alert");
    box.appendChild(el("span", "", m.error.message || "Es ist ein Fehler aufgetreten."));
    if (isLast && !state.streaming) {
      const retry = el("button", "btn btn-small");
      retry.type = "button";
      retry.dataset.retry = m.id;
      retry.innerHTML = ICONS.retry;
      retry.append("Erneut versuchen");
      box.appendChild(retry);
    }
    body.appendChild(box);
  }

  if (sources.length) body.appendChild(buildSources(m, sources));

  if (m.content && !m.pending) {
    const actions = el("div", "msg-actions");
    const copy = el("button", "action-btn");
    copy.type = "button";
    copy.dataset.copy = m.id;
    copy.innerHTML = ICONS.copy;
    copy.append("Kopieren");
    copy.setAttribute("aria-label", "Antwort kopieren");
    actions.appendChild(copy);
    body.appendChild(actions);
  }

  row.append(avatar, body);
  return row;
}

function buildSources(m, sources) {
  const box = el("section", "sources" + (state.expandedSources.has(m.id) ? " expanded" : ""));
  box.setAttribute("aria-label", "Quellen");
  box.appendChild(el("h3", "sources-title", sources.length === 1 ? "Quelle" : `Quellen (${sources.length})`));
  const ol = el("ol");
  sources.forEach((s, idx) => {
    const li = el("li", "source" + (idx >= 3 ? " extra" : ""));
    li.id = "src-" + m.id + "-" + s.id;
    const num = el("span", "source-num", String(s.id));
    num.setAttribute("aria-hidden", "true");
    const main = el("div", "source-main");
    if (s.onion) {
      li.classList.add("onion");
      const badge = el("span", "onion-badge", ".onion");
      badge.title = ONION_TITLE;
      main.appendChild(badge);
    }
    const url = safeHttpUrl(s.url);
    const title = s.title || hostname(s.url) || "Quelle " + s.id;
    if (url) {
      const a = el("a", "source-title", title);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.setAttribute("aria-label", `Quelle ${s.id}: ${title} (öffnet in neuem Tab)` + (s.onion ? " – " + ONION_TITLE : ""));
      if (s.onion) a.title = ONION_TITLE;
      main.appendChild(a);
    } else {
      main.appendChild(el("span", "source-title", title));
    }
    const meta = [s.site || hostname(s.url)];
    if (s.published) meta.push(formatDate(s.published));
    if (s.fetched) meta.push("Seite gelesen");
    main.appendChild(el("span", "source-meta", meta.filter(Boolean).join(" · ")));
    if (s.onion) main.appendChild(el("code", "source-address", s.url));
    if (s.note) main.appendChild(el("span", "source-note", s.note));
    li.append(num, main);
    ol.appendChild(li);
  });
  box.appendChild(ol);
  if (sources.some((s) => s.onion)) box.appendChild(el("p", "onion-legend", ".onion-Adressen sind nur im Tor Browser erreichbar."));
  if (sources.length > 3) {
    const t = el("button", "sources-toggle", state.expandedSources.has(m.id) ? "Weniger anzeigen" : `Alle ${sources.length} Quellen anzeigen`);
    t.type = "button";
    t.dataset.toggleSources = m.id;
    t.setAttribute("aria-expanded", String(state.expandedSources.has(m.id)));
    box.appendChild(t);
  }
  return box;
}

// Nur die betroffene Nachricht neu zeichnen (gedrosselt per requestAnimationFrame)
const pendingRenders = new Set();
let rafScheduled = false;
function scheduleMessageRender(convId, msgId) {
  if (convId !== state.activeId) return;
  pendingRenders.add(msgId);
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const conv = activeConversation();
    if (!conv) { pendingRenders.clear(); return; }
    for (const id of pendingRenders) {
      const idx = conv.messages.findIndex((x) => x.id === id);
      if (idx < 0) continue;
      const old = dom.inner.querySelector(`[data-id="${CSS.escape(id)}"]`);
      const fresh = buildMessage(conv.messages[idx], conv, idx === conv.messages.length - 1);
      if (old) old.replaceWith(fresh); else dom.inner.appendChild(fresh);
    }
    pendingRenders.clear();
    scrollToBottom();
  });
}

function scrollToBottom(force = false) {
  if (force || state.stickToBottom) dom.messages.scrollTop = dom.messages.scrollHeight;
}

/* ---------------------------------------------------------------- Senden */

function buildPayloadMessages(conv) {
  const out = [];
  for (const m of conv.messages) {
    if (m.pending) continue;
    if (m.role === "assistant" && (m.error || !m.content || !m.content.trim())) continue;
    const content = (m.content || "").trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      // Zwei Nutzernachrichten hintereinander (vorherige Antwort fehlgeschlagen/leer): die verwaiste
      // ältere Frage verwerfen statt anhängen – sonst kann das Längenlimit dauerhaft überschritten werden.
      if (m.role === "user") last.content = content;
      else last.content += "\n\n" + content;
    } else out.push({ role: m.role, content });
  }
  let trimmed = out.slice(-MAX_HISTORY);
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || state.streaming) return;
  if (!state.online) { toast("Du bist offline."); return; }
  if (!state.keys.anthropic) { toast("Bitte zuerst den Claude-Schlüssel eintragen."); openSettings(); return; }
  if (content.length > MAX_INPUT) { toast(`Die Nachricht ist zu lang (max. ${MAX_INPUT} Zeichen).`); return; }

  let conv = activeConversation();
  const now = Date.now();
  if (!conv) {
    conv = { id: newId(), title: makeTitle(content), createdAt: now, updatedAt: now, messages: [] };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
  }
  conv.messages.push({ id: newId(), role: "user", content, createdAt: now });
  conv.updatedAt = now;
  dom.input.value = "";
  autoGrow();
  state.stickToBottom = true;
  await startRequest(conv);
}

async function retry(msgId) {
  const conv = activeConversation();
  if (!conv || state.streaming) return;
  const last = conv.messages[conv.messages.length - 1];
  if (!last || last.id !== msgId) return;
  conv.messages.pop();
  state.stickToBottom = true;
  await startRequest(conv);
}

async function startRequest(conv) {
  const messages = buildPayloadMessages(conv);
  const settings = { webSearch: state.settings.webSearch };
  const msg = { id: newId(), role: "assistant", content: "", createdAt: Date.now(), pending: true, statusText: "Denke nach…" };
  conv.messages.push(msg);
  conv.updatedAt = Date.now();
  persist();

  const controller = new AbortController();
  state.streaming = { controller, convId: conv.id, msgId: msg.id };
  renderAll();

  let gotDone = false;
  const update = () => scheduleMessageRender(conv.id, msg.id);

  try {
    // Die Engine liefert dieselben Ereignisse wie früher der Server (status, research, sources, delta, error, done)
    for await (const evt of runChat({ messages, settings, keys: state.keys, signal: controller.signal })) {
      if (evt && typeof evt.event === "string" && evt.data && typeof evt.data === "object") {
        if (handleEvent(evt, msg)) gotDone = true;
        update();
      }
    }
    if (!gotDone && !msg.error) {
      msg.error = { code: "stream_incomplete", message: "Die Antwort wurde unterbrochen, bevor sie vollständig war." };
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      msg.aborted = true;
    } else if (!state.online) {
      msg.error = { code: "offline", message: "Keine Internetverbindung. Bitte versuche es erneut, sobald du wieder online bist." };
    } else {
      msg.error = { code: "internal", message: "Unerwarteter Fehler. Bitte versuche es erneut." };
    }
  } finally {
    delete msg.pending;
    delete msg.statusText;
    conv.updatedAt = Date.now();
    state.streaming = null;
    persist();
    if (conv.id === state.activeId) {
      const node = dom.inner.querySelector(`[data-id="${CSS.escape(msg.id)}"]`);
      const fresh = buildMessage(msg, conv, true);
      if (node) node.replaceWith(fresh); else dom.inner.appendChild(fresh);
      scrollToBottom();
    }
    renderSidebar();
    updateComposer();
    announce(msg.error ? "Fehler: " + msg.error.message : msg.aborted ? "Antwort abgebrochen" : "Antwort fertig");
  }
}

function isOnionUrl(url) {
  try { return /\.onion$/i.test(new URL(url).hostname); } catch { return false; }
}

function parseOnion(o) {
  if (!o || typeof o !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  return {
    requested: !!o.requested, searched: !!o.searched, found: n(o.found), filtered: n(o.filtered),
    notice: typeof o.notice === "string" && o.notice ? o.notice : null,
  };
}

/** Verarbeitet ein Server-Ereignis. Gibt true zurück, wenn der Stream fertig ist. */
function handleEvent({ event, data }, msg) {
  switch (event) {
    case "status":
      msg.statusText = typeof data.message === "string" ? data.message : msg.statusText;
      return false;
    case "research":
      msg.research = {
        performed: !!data.performed,
        query: typeof data.query === "string" ? data.query : null,
        via: data.via === "tor" || data.via === "direct" ? data.via : null,
        notice: typeof data.notice === "string" && data.notice ? data.notice : null,
        onion: parseOnion(data.onion),
      };
      return false;
    case "sources":
      msg.sources = Array.isArray(data.items)
        ? data.items.slice(0, 20).map((s) => ({
            id: Number(s.id), title: String(s.title || ""), site: String(s.site || ""), url: String(s.url || ""),
            published: s.published ? String(s.published) : null, snippet: String(s.snippet || "").slice(0, 500), fetched: !!s.fetched,
            onion: !!s.onion || isOnionUrl(s.url),
            origin: ["web", "onion-location", "onion-search"].includes(s.origin) ? s.origin : "web",
            note: typeof s.note === "string" && s.note ? s.note.slice(0, 500) : null,
          }))
        : [];
      return false;
    case "delta":
      if (typeof data.text === "string") {
        msg.content += data.text;
        msg.statusText = "Schreibe Antwort…";
      }
      return false;
    case "error":
      msg.error = { code: String(data.code || "error"), message: String(data.message || "Es ist ein Fehler aufgetreten.") };
      return false;
    case "done":
      if (data && data.stopReason === "max_tokens") {
        msg.research = msg.research || { performed: false, query: null, via: null, notice: null };
        msg.research.notice = (msg.research.notice ? msg.research.notice + " " : "") + "Die Antwort wurde wegen der Längenbegrenzung abgeschnitten.";
      }
      return true;
    default:
      return false;
  }
}

/* ---------------------------------------------------------------- Eingabe */

function autoGrow() {
  dom.input.style.height = "auto";
  dom.input.style.height = Math.min(dom.input.scrollHeight, 220) + "px";
  const len = dom.input.value.length;
  if (len > MAX_INPUT * 0.85) {
    dom.counter.hidden = false;
    dom.counter.textContent = `${len.toLocaleString("de-DE")} / ${MAX_INPUT.toLocaleString("de-DE")}`;
    dom.counter.classList.toggle("limit", len >= MAX_INPUT);
  } else {
    dom.counter.hidden = true;
  }
  updateComposer();
}

function updateComposer() {
  const streaming = !!state.streaming;
  dom.send.classList.toggle("stop", streaming);
  dom.send.setAttribute("aria-label", streaming ? "Antwort stoppen" : "Senden");
  dom.sendLabel.textContent = streaming ? "Stopp" : "Senden";
  const hasKey = !!state.keys.anthropic;
  dom.send.disabled = !streaming && (!state.online || !hasKey || !dom.input.value.trim());
  dom.input.disabled = !hasKey && !streaming;
  dom.input.placeholder = hasKey ? "Frag Maxxo KI etwas …" : "Erst Schlüssel eintragen (⚙︎)";

  const s = state.settings;
  dom.chip.textContent = "Web-Recherche: " + WEB_LABELS[s.webSearch] + (s.webSearch !== "off" && !state.keys.tavily ? " (kein Tavily-Schlüssel)" : "");
}

/* ---------------------------------------------------------------- Status / Banner */

function updateBanner() {
  if (!state.online) {
    dom.banner.hidden = false;
    dom.banner.classList.remove("error");
    dom.bannerText.textContent = "Du bist offline – Nachrichten können erst gesendet werden, wenn die Verbindung zurück ist.";
    dom.bannerRetry.hidden = true;
  } else {
    dom.banner.hidden = true;
  }
}

/** Status kommt jetzt lokal aus der Engine (kein Server). */
function refreshStatus() {
  state.status = getStatus(state.keys);
  renderStatus();
  updateBanner();
}

function renderStatus() {
  const st = state.status;
  const pill = dom.statusPill;
  pill.classList.remove("ok", "warn", "error");
  if (!st) { pill.textContent = "…"; return; }
  const llm = st.llm || {};
  const search = st.search || {};
  const searchOk = !!search.configured;
  if (!llm.configured) {
    pill.textContent = "Haiku 5.5 · kein Schlüssel";
    pill.classList.add("error");
  } else {
    pill.textContent = "Haiku 5.5 · " + (searchOk ? "Websuche an" : "Websuche aus");
    pill.classList.add(searchOk ? "ok" : "warn");
  }
  pill.title = `Modell: Claude Haiku 5.5 (${llm.model || "?"})${llm.configured ? "" : " – Schlüssel fehlt"}\nSuche: ${searchOk ? "Tavily" : "keine (kein Tavily-Schlüssel)"}`;

  // Einstellungsdialog
  dom.infoLlmProvider.textContent = LLM_LABELS[llm.provider] || "Anthropic (Claude)";
  dom.infoLlmModel.textContent = MODEL_LABEL;
  dom.infoSearch.textContent = SEARCH_LABELS[search.provider] || "Keiner";
  dom.llmNotConfigured.hidden = !!llm.configured;
  dom.searchNotConfigured.hidden = searchOk;
  dom.serverInfo.textContent = `${st.app || "Maxxo KI Mobil"} ${st.version ? "v" + st.version : ""}`.trim();
}

/** Zeigt nur einen maskierten Zustand an – der Schlüssel selbst wird nie wieder ins Feld geschrieben. */
function maskedState(value) {
  return value ? `gespeichert – endet auf …${value.slice(-4)}` : "nicht gespeichert";
}

function renderKeyStates() {
  dom.keyAnthropicState.textContent = maskedState(state.keys.anthropic);
  dom.keyAnthropicState.dataset.state = state.keys.anthropic ? "ok" : "missing";
  dom.keyTavilyState.textContent = maskedState(state.keys.tavily);
  dom.keyTavilyState.dataset.state = state.keys.tavily ? "ok" : "missing";
  dom.keysClear.disabled = !state.keys.anthropic && !state.keys.tavily;
}

function showKeysError(text) {
  dom.keysError.textContent = text || "";
  dom.keysError.hidden = !text;
}

function onKeysChanged() {
  dom.keyAnthropic.value = "";
  dom.keyTavily.value = "";
  renderKeyStates();
  refreshStatus();
  updateComposer();
  if (!activeConversation()) renderMessages();
}

function saveKeyInputs() {
  const a = validateKey("anthropic", dom.keyAnthropic.value);
  const t = validateKey("tavily", dom.keyTavily.value);
  if (!a.ok) { showKeysError("Claude: " + a.message); dom.keyAnthropic.focus(); return; }
  if (!t.ok) { showKeysError("Tavily: " + t.message); dom.keyTavily.focus(); return; }
  if (a.empty && t.empty) { showKeysError("Bitte mindestens einen Schlüssel eingeben."); return; }
  // Leere Felder lassen gespeicherte Schlüssel unverändert
  const next = {
    anthropic: a.empty ? state.keys.anthropic : a.value,
    tavily: t.empty ? state.keys.tavily : t.value,
  };
  if (!saveKeys(next)) return;
  state.keys = loadKeys();
  showKeysError("");
  onKeysChanged();
  toast("Schlüssel gespeichert");
}

async function deleteKeys() {
  const ok = await confirmDialog("Schlüssel löschen?", "Claude- und Tavily-Schlüssel werden aus diesem Browser entfernt. Der Verlauf bleibt erhalten.", "Schlüssel löschen");
  if (!ok) return;
  if (state.streaming) state.streaming.controller.abort();
  clearKeys();
  state.keys = loadKeys();
  onKeysChanged();
  toast("Schlüssel gelöscht");
}

async function deleteEverything() {
  const ok = await confirmDialog("Alles löschen?", "Alle Unterhaltungen und beide Schlüssel werden aus diesem Browser gelöscht. Das kann nicht rückgängig gemacht werden.", "Alles löschen");
  if (!ok) return;
  if (state.streaming) state.streaming.controller.abort();
  state.conversations = [];
  state.activeId = null;
  clearAllConversations();
  clearKeys();
  state.keys = loadKeys();
  onKeysChanged();
  renderAll();
  toast("Verlauf und Schlüssel gelöscht");
}

/* ---------------------------------------------------------------- Einstellungen */

function openSettings() {
  const s = state.settings;
  dom.settings.querySelectorAll('input[name="webSearch"]').forEach((r) => { r.checked = r.value === s.webSearch; });
  dom.keyAnthropic.value = "";
  dom.keyTavily.value = "";
  showKeysError("");
  renderKeyStates();
  renderStatus();
  if (!dom.settings.open) dom.settings.showModal();
  if (!state.keys.anthropic) dom.keyAnthropic.focus();
}

function updateSetting(patch) {
  state.settings = { ...state.settings, ...patch };
  saveSettings(state.settings);
  updateComposer();
}

/* ---------------------------------------------------------------- Ereignisse */

dom.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.streaming) { state.streaming.controller.abort(); return; }
  sendMessage(dom.input.value);
});

dom.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!state.streaming) sendMessage(dom.input.value);
  }
});
dom.input.addEventListener("input", autoGrow);

dom.messages.addEventListener("scroll", () => {
  const el = dom.messages;
  state.stickToBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
}, { passive: true });

dom.inner.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;

  const example = target.closest("[data-example]");
  if (example) { sendMessage(example.dataset.example); return; }

  if (target.closest("[data-open-settings]")) { openSettings(); return; }

  const codeCopy = target.closest(".code-copy");
  if (codeCopy) {
    const code = codeCopy.closest(".codeblock")?.querySelector("code");
    if (code) copyText(code.textContent || "");
    return;
  }

  const copy = target.closest("[data-copy]");
  if (copy) {
    const m = activeConversation()?.messages.find((x) => x.id === copy.dataset.copy);
    if (m) copyText(m.content);
    return;
  }

  const retryBtn = target.closest("[data-retry]");
  if (retryBtn) { retry(retryBtn.dataset.retry); return; }

  const toggle = target.closest("[data-toggle-sources]");
  if (toggle) {
    const id = toggle.dataset.toggleSources;
    if (state.expandedSources.has(id)) state.expandedSources.delete(id); else state.expandedSources.add(id);
    const box = toggle.closest(".sources");
    const expanded = state.expandedSources.has(id);
    box.classList.toggle("expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    const count = box.querySelectorAll(".source").length;
    toggle.textContent = expanded ? "Weniger anzeigen" : `Alle ${count} Quellen anzeigen`;
    return;
  }

  const cite = target.closest(".cite-link");
  if (cite) {
    e.preventDefault();
    const id = cite.getAttribute("href").slice(1);
    const node = document.getElementById(id);
    if (!node) return;
    const box = node.closest(".sources");
    if (box && node.classList.contains("extra") && !box.classList.contains("expanded")) {
      box.querySelector("[data-toggle-sources]")?.click();
    }
    node.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    node.classList.add("flash");
    setTimeout(() => node.classList.remove("flash"), 1400);
    node.querySelector("a")?.focus({ preventScroll: true });
  }
});

dom.convList.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const del = target?.closest("[data-del]");
  if (del) { deleteConversation(del.dataset.del); return; }
  const open = target?.closest(".conv-open");
  if (open) selectConversation(open.dataset.id);
});

dom.newChat.addEventListener("click", newConversation);
dom.clearHistory.addEventListener("click", deleteAll);
dom.settingsClear.addEventListener("click", async () => {
  dom.settings.close();
  await deleteAll();
});
dom.clearEverything.addEventListener("click", async () => {
  dom.settings.close();
  await deleteEverything();
});
dom.keysSave.addEventListener("click", saveKeyInputs);
dom.keysClear.addEventListener("click", async () => {
  dom.settings.close();
  await deleteKeys();
});
[dom.keyAnthropic, dom.keyTavily].forEach((inp) => inp.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveKeyInputs(); }
}));
dom.openSidebar.addEventListener("click", () => setSidebar(true));
dom.closeSidebar.addEventListener("click", () => setSidebar(false));
dom.backdrop.addEventListener("click", () => setSidebar(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dom.sidebar.classList.contains("open")) setSidebar(false);
});

dom.openSettings.addEventListener("click", openSettings);
dom.chip.addEventListener("click", openSettings);
dom.settings.querySelectorAll('input[name="webSearch"]').forEach((r) =>
  r.addEventListener("change", () => { if (r.checked) updateSetting({ webSearch: r.value }); })
);
window.addEventListener("online", () => { state.online = true; updateBanner(); updateComposer(); });
window.addEventListener("offline", () => { state.online = false; updateBanner(); updateComposer(); });

// Andere Tabs: Verlauf synchron halten
window.addEventListener("storage", (e) => {
  if (e.key === "maxxo.keys.v1" || e.key === null) {
    state.keys = loadKeys();
    refreshStatus();
    updateComposer();
  }
  if (e.key && e.key.startsWith("maxxo.conversations") && !state.streaming) {
    state.conversations = loadConversations();
    if (state.activeId && !activeConversation()) state.activeId = null;
    renderAll();
  }
});

/* ---------------------------------------------------------------- Start */

refreshStatus();
renderAll();
updateBanner();
if (state.keys.anthropic) dom.input.focus();

// Service Worker: App-Dateien offline verfügbar machen (API-Anfragen werden nie zwischengespeichert)
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => { /* optional */ });
}
