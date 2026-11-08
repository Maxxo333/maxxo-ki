// Kleiner, XSS-sicherer Markdown-Renderer.
// Er baut ausschließlich DOM-Knoten mit createElement/textContent – es wird nie
// fremder Text als HTML interpretiert. Erlaubt sind nur bekannte Tags; Links nur
// mit http(s)/mailto. Unvollständiges Markdown (z. B. offener Codeblock während
// des Streamings) wird toleriert.

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/**
 * @param {string} text Markdown-Text
 * @param {{sources?: Map<number,{title:string,url:string}>, anchorPrefix?: string}} [opts]
 * @returns {DocumentFragment}
 */
export function renderMarkdown(text, opts = {}) {
  const ctx = {
    sources: opts.sources instanceof Map ? opts.sources : new Map(),
    anchorPrefix: opts.anchorPrefix || "src-",
  };
  const frag = document.createDocumentFragment();
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  renderBlocks(lines, frag, ctx, 0);
  return frag;
}

/* ---------------------------------------------------------------- Blöcke */

const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w#+.\-]*)?.*$/;
const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function isBlockStart(line, next) {
  return (
    RE_FENCE.test(line) ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_LIST.test(line) ||
    (line.includes("|") && next !== undefined && RE_TABLE_SEP.test(next) && next.includes("-"))
  );
}

function renderBlocks(lines, parent, ctx, depth) {
  if (depth > 8) {
    // Schutz vor extremer Verschachtelung
    const p = el("p");
    p.textContent = lines.join("\n");
    parent.appendChild(p);
    return;
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Codeblock
    const fence = line.match(RE_FENCE);
    if (fence) {
      const marker = fence[1];
      const lang = (fence[2] || "").slice(0, 30);
      const body = [];
      i++;
      while (i < lines.length && !new RegExp("^\\s{0,3}" + marker[0] + "{" + marker.length + ",}\\s*$").test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // schließende Zeile (falls vorhanden) überspringen
      parent.appendChild(codeBlock(body.join("\n"), lang));
      continue;
    }

    // Überschrift
    const h = line.match(RE_HEADING);
    if (h) {
      const node = el("h" + h[1].length);
      renderInline(h[2], node, ctx);
      parent.appendChild(node);
      i++;
      continue;
    }

    // Trennlinie
    if (RE_HR.test(line)) {
      parent.appendChild(el("hr"));
      i++;
      continue;
    }

    // Zitat
    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        inner.push(lines[i].match(RE_QUOTE)[1]);
        i++;
      }
      const bq = el("blockquote");
      renderBlocks(inner, bq, ctx, depth + 1);
      parent.appendChild(bq);
      continue;
    }

    // Tabelle
    if (line.includes("|") && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const rows = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      parent.appendChild(table(rows, ctx));
      continue;
    }

    // Liste
    if (RE_LIST.test(line)) {
      const block = [];
      while (i < lines.length) {
        const l = lines[i];
        if (RE_LIST.test(l)) {
          block.push(l);
          i++;
        } else if (/^\s*$/.test(l)) {
          // Leerzeile: Liste geht weiter, wenn danach wieder ein Listenpunkt
          // oder eine eingerückte Fortsetzung folgt.
          const n = lines[i + 1];
          if (n !== undefined && (RE_LIST.test(n) || /^\s{2,}\S/.test(n))) {
            i++;
          } else break;
        } else if (/^\s{2,}\S/.test(l) && !RE_FENCE.test(l)) {
          block.push(l); // Fortsetzungszeile
          i++;
        } else break;
      }
      parent.appendChild(list(block, ctx));
      continue;
    }

    // Absatz
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i])) {
      if (para.length && isBlockStart(lines[i], lines[i + 1])) break;
      para.push(lines[i].trim());
      i++;
    }
    const p = el("p");
    para.forEach((t, idx) => {
      if (idx > 0) p.appendChild(el("br"));
      renderInline(t, p, ctx);
    });
    parent.appendChild(p);
  }
}

function codeBlock(code, lang) {
  const wrap = el("div", "codeblock");
  const head = el("div", "codeblock-head");
  const label = el("span", "codeblock-lang");
  label.textContent = lang || "Code";
  const btn = el("button", "code-copy");
  btn.type = "button";
  btn.textContent = "Kopieren";
  btn.setAttribute("aria-label", "Code kopieren");
  head.append(label, btn);
  const pre = el("pre");
  const c = el("code");
  if (lang) c.className = "language-" + lang.replace(/[^\w-]/g, "");
  c.textContent = code;
  pre.appendChild(c);
  wrap.append(head, pre);
  return wrap;
}

function splitRow(row) {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  // "\|" als literales Pipe-Zeichen erlauben
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function table(rows, ctx) {
  const header = splitRow(rows[0]);
  const aligns = splitRow(rows[1]).map((s) => {
    const l = s.startsWith(":");
    const r = s.endsWith(":");
    return l && r ? "align-center" : r ? "align-right" : l ? "align-left" : "";
  });
  const wrap = el("div", "table-wrap");
  const t = el("table");
  const thead = el("thead");
  const trh = el("tr");
  header.forEach((cell, idx) => {
    const th = el("th", aligns[idx] || "");
    renderInline(cell, th, ctx);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  t.appendChild(thead);
  const tbody = el("tbody");
  rows.slice(2).forEach((row) => {
    const tr = el("tr");
    const cells = splitRow(row);
    for (let idx = 0; idx < header.length; idx++) {
      const td = el("td", aligns[idx] || "");
      renderInline(cells[idx] || "", td, ctx);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

function list(blockLines, ctx) {
  // Einträge mit Einrückung sammeln; Fortsetzungszeilen an vorherigen Eintrag hängen
  const items = [];
  for (const l of blockLines) {
    const m = l.match(RE_LIST);
    if (m) {
      const indent = m[1].replace(/\t/g, "    ").length;
      const ordered = /\d/.test(m[2]);
      items.push({ indent, ordered, start: ordered ? parseInt(m[2], 10) : 1, text: m[3] });
    } else if (items.length) {
      items[items.length - 1].text += "\n" + l.trim();
    }
  }
  let pos = 0;
  function build(baseIndent) {
    const first = items[pos];
    const listEl = el(first.ordered ? "ol" : "ul");
    if (first.ordered && first.start !== 1) listEl.start = first.start;
    while (pos < items.length) {
      const it = items[pos];
      if (it.indent < baseIndent) break;
      if (it.indent > baseIndent + 1 && listEl.lastElementChild) {
        // Unterliste zum letzten Eintrag
        listEl.lastElementChild.appendChild(build(it.indent));
        continue;
      }
      const li = el("li");
      // Aufgabenlisten: [ ] / [x]
      let txt = it.text;
      const task = txt.match(/^\[([ xX])\]\s+(.*)$/s);
      if (task) {
        const box = el("span", "task-box" + (task[1].trim() ? " done" : ""));
        box.textContent = task[1].trim() ? "☑" : "☐";
        box.setAttribute("aria-hidden", "true");
        li.appendChild(box);
        txt = task[2];
      }
      txt.split("\n").forEach((part, idx) => {
        if (idx > 0) li.appendChild(el("br"));
        renderInline(part, li, ctx);
      });
      listEl.appendChild(li);
      pos++;
    }
    return listEl;
  }
  const frag = document.createDocumentFragment();
  while (pos < items.length) frag.appendChild(build(items[pos].indent));
  // Mehrere Top-Level-Listen in einem Container zurückgeben
  if (frag.childNodes.length === 1) return frag.firstChild;
  const div = el("div");
  div.appendChild(frag);
  return div;
}

/* ---------------------------------------------------------------- Inline */

// Reihenfolge der Gruppen ist wichtig.
const INLINE = new RegExp(
  [
    "(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)", // 1,2 Inline-Code
    "\\*\\*(?=\\S)([\\s\\S]+?)\\*\\*", // 3 fett
    "__(?=\\S)([\\s\\S]+?)__", // 4 fett
    "~~(?=\\S)([\\s\\S]+?)~~", // 5 durchgestrichen
    "\\*(?=[^\\s*])([^*]+?)\\*", // 6 kursiv
    "(?<![\\w])_(?=[^\\s_])([^_]+?)_(?![\\w])", // 7 kursiv
    "\\[([^\\]\\n]+)\\]\\(\\s*<?([^\\s)>]+)>?(?:\\s+\"[^\"]*\")?\\s*\\)", // 8,9 Link
    "\\[(\\d{1,3}(?:\\s*[,;]\\s*\\d{1,3})*)\\]", // 10 Quellenverweis
    "(https?:\\/\\/[^\\s<>()\\[\\]]*[^\\s<>()\\[\\].,;:!?'\"])", // 11 nackte URL
  ].join("|"),
  "g"
);

// Sehr lange Absätze nicht formatieren: schützt vor Verlangsamung durch bösartige Muster (z. B. tausende "[")
const MAX_INLINE_CHARS = 8000;

function renderInline(text, parent, ctx, depth = 0) {
  if (!text) return;
  if (depth > 6 || text.length > MAX_INLINE_CHARS) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    last = re.lastIndex;

    if (m[1] !== undefined) {
      const c = el("code");
      c.textContent = m[2].replace(/^ (.*) $/, "$1");
      parent.appendChild(c);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const s = el("strong");
      renderInline(m[3] ?? m[4], s, ctx, depth + 1);
      parent.appendChild(s);
    } else if (m[5] !== undefined) {
      const s = el("del");
      renderInline(m[5], s, ctx, depth + 1);
      parent.appendChild(s);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const s = el("em");
      renderInline(m[6] ?? m[7], s, ctx, depth + 1);
      parent.appendChild(s);
    } else if (m[8] !== undefined) {
      const url = m[9];
      if (SAFE_URL.test(url)) {
        const a = externalLink(url);
        renderInline(m[8], a, ctx, depth + 1);
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
    } else if (m[10] !== undefined) {
      const ids = m[10].split(/[,;]/).map((s) => parseInt(s.trim(), 10));
      if (ids.length && ids.every((id) => ctx.sources.has(id))) {
        ids.forEach((id) => parent.appendChild(citation(id, ctx)));
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
    } else if (m[11] !== undefined) {
      const a = externalLink(m[11]);
      a.textContent = m[11];
      parent.appendChild(a);
    }
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function externalLink(url) {
  const a = el("a");
  a.href = url;
  if (!/^mailto:/i.test(url)) {
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
  }
  return a;
}

function citation(id, ctx) {
  const src = ctx.sources.get(id);
  const sup = el("sup", "cite");
  const a = el("a", "cite-link");
  a.href = "#" + ctx.anchorPrefix + id;
  a.dataset.sourceId = String(id);
  a.textContent = String(id);
  a.title = src && src.title ? src.title : "Quelle " + id;
  a.setAttribute("aria-label", "Quelle " + id + (src && src.title ? ": " + src.title : ""));
  sup.appendChild(a);
  return sup;
}

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}
