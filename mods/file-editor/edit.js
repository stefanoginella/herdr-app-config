// What the editor's commands do to text. Nothing here touches the app: every function takes the
// text and the selection ({ start, end }, UTF-16 offsets) and returns an edit, or null when there
// is nothing to do:
//   { range, insert, select }   replace `range` with `insert`, then select `select`
//   { select }                  only move the selection
// main.js applies an edit as one change, so one undo takes it back.

const WORD = /[\p{L}\p{N}_]/u;

// The line comment of a language, by file extension. A pair is wrapped around each line.
const SLASH = "c h cc cpp hpp cs dart go java js jsx mjs cjs ts tsx mts cts json jsonc json5 kt kts php rs scala scss less swift zig m mm proto groovy gradle";
const HASH = "py rb sh bash zsh fish yaml yml toml conf cfg ini env r pl pm tcl nix tf hcl ex exs cr jl ps1 graphql gql properties gitignore dockerignore editorconfig";
const DASH = "sql lua hs elm ada";
const TAGS = "html htm xml svg vue svelte md markdown mdx";
const COMMENT = {};
for (const ext of SLASH.split(" ")) COMMENT[ext] = "//";
for (const ext of HASH.split(" ")) COMMENT[ext] = "#";
for (const ext of DASH.split(" ")) COMMENT[ext] = "--";
for (const ext of TAGS.split(" ")) COMMENT[ext] = ["<!--", "-->"];
Object.assign(COMMENT, { css: ["/*", "*/"], tex: "%", erl: "%", vim: '"', clj: ";", lisp: ";", el: ";", scm: ";", bat: "REM" });
const NAMED = { dockerfile: "#", makefile: "#", gemfile: "#", rakefile: "#", justfile: "#", brewfile: "#" };

export function commentOf(name) {
  const lower = name.toLowerCase(), dot = lower.lastIndexOf(".");
  return NAMED[lower] ?? COMMENT[dot >= 0 ? lower.slice(dot + 1) : ""] ?? null;
}

// The lines the selection touches: from the first one's start to the last one's end, without its
// line break. A selection that ends at the start of a line doesn't take that line.
export function lines(text, sel) {
  const start = text.lastIndexOf("\n", sel.start - 1) + 1;
  const last = sel.end > sel.start && text[sel.end - 1] === "\n" ? sel.end - 1 : sel.end;
  let end = text.indexOf("\n", last);
  if (end < 0) end = text.length;
  return { start, end };
}

// The word the cursor is in or beside, or null.
export function wordAt(text, at) {
  let start = at, end = at;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;
  return end > start ? { start, end } : null;
}

// Puts `mark` on both sides of the selection, or takes it off when it is there already: around
// the selection or just inside it. With nothing selected it is the word under the cursor, and
// with no word there an empty pair with the cursor in it.
export function wrap(text, sel, mark) {
  const n = mark.length;
  let { start, end } = sel;
  const around = (s, e) => s >= n && text.slice(s - n, s) === mark && text.slice(e, e + n) === mark;
  if (start === end) {
    if (around(start, end)) return { range: { start: start - n, end: end + n }, insert: "", select: { start: start - n, end: start - n } };
    const word = wordAt(text, start);
    if (!word) return { range: sel, insert: mark + mark, select: { start: start + n, end: start + n } };
    ({ start, end } = word);
  }
  const inner = text.slice(start, end);
  if (around(start, end)) return { range: { start: start - n, end: end + n }, insert: inner, select: { start: start - n, end: end - n } };
  if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
    return { range: { start, end }, insert: inner.slice(n, -n), select: { start, end: end - 2 * n } };
  }
  return { range: { start, end }, insert: mark + inner + mark, select: { start: start + n, end: end + n } };
}

// A character typed over a selection puts the selection in a pair instead of replacing it.
const PAIRS = { '"': '"', "'": "'", "`": "`", "(": ")", "[": "]", "{": "}", "<": ">", "~": "~" };
// In Markdown also the two that make emphasis: typed twice, bold.
const MARKDOWN_PAIRS = { "*": "*", _: "_" };

// The edit for `typed` over a selection: the selection between the pair, still selected, so
// that typing the character again wraps it once more (`**bold**`, `~~struck~~`). null when the
// character opens no pair, or nothing is selected.
export function surround(text, sel, typed, markdown) {
  const close = PAIRS[typed] ?? (markdown ? MARKDOWN_PAIRS[typed] : undefined);
  if (close === undefined || sel.start === sel.end) return null;
  return { range: sel, insert: typed + text.slice(sel.start, sel.end) + close, select: { start: sel.start + 1, end: sel.end + 1 } };
}

// A Markdown link from the selection. A selected address becomes the target and the cursor waits
// for the text; anything else becomes the text and "url" is selected, ready to be typed over.
export function link(text, sel) {
  let { start, end } = sel;
  if (start === end) ({ start, end } = wordAt(text, start) ?? sel);
  const inner = text.slice(start, end);
  if (/^(https?:\/\/|www\.)\S+$/.test(inner)) return { range: { start, end }, insert: `[](${inner})`, select: { start: start + 1, end: start + 1 } };
  const at = start + inner.length + 3;
  return { range: { start, end }, insert: `[${inner}](url)`, select: { start: at, end: at + 3 } };
}

// Keep matched offsets in UTF-16, just like EditorState's selection. Do not pass
// file paths or other schemes from file contents to the system opener.
function* urls(text) {
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let url = match[0].replace(/[.,:;!?*]+$/, "");
    const balance = { ")": 0, "]": 0, "}": 0 };
    const closes = { "(": ")", "[": "]", "{": "}" };
    if (/[)\]}]/.test(url)) {
      for (const ch of url) {
        if (Object.hasOwn(balance, ch)) balance[ch]--;
        else if (Object.hasOwn(closes, ch)) balance[closes[ch]]++;
      }
      while (balance[url.at(-1)] < 0) {
        balance[url.at(-1)]++;
        url = url.slice(0, -1).replace(/[.,:;!?*]+$/, "");
      }
    }
    if (!/^https?:\/\/(?:\[[0-9a-f:.]+\]|[^/?#()[\]{}\\]+)/i.test(url)) continue;
    yield { url, start: match.index, end: match.index + url.length };
  }
}

export function firstUrl(text) { return urls(text).next().value?.url ?? null; }

export function sourceUrls(text, limit = 12) {
  const found = new Set();
  for (const { url } of urls(text)) {
    if (url === "http://www.w3.org/2000/svg" || url === "http://www.w3.org/1999/xlink") continue;
    found.add(url);
    if (found.size >= limit) break;
  }
  return [...found];
}

export function urlAt(text, selection) {
  const { start, end } = selection;
  const before = start > 0 ? Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1 : 0;
  const line = text.slice(before, Math.min(...["\n", "\r"].map(ch => {
    const at = text.indexOf(ch, start);
    return at < 0 ? text.length : at;
  })));
  for (const link of urls(line)) {
    if (start >= before + link.start && end <= before + link.end) return link.url;
  }
  return null;
}

// Give TextView native autolinks for bare Markdown URLs. The only insertions are
// angle brackets, so selections and search marks can still use source offsets.
export function markdownLinks(text) {
  if (!/https?:\/\//i.test(text)) return null;
  const positions = [];
  let fence = null, offset = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const mark = marker[1];
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
    } else if (!fence && !/^(?: {4}|\t|\s*\[[^\]]+\]:)/.test(line)) {
      // Keep code spans, explicit links/images and already-marked autolinks unchanged.
      const protectedText = /`+[^`]*`+|<[^<>]*>|\[[^[\]]*\](?:\((?:[^()]|\([^()]*\))*\)|\[[^[\]]*\])?/g;
      let span = protectedText.exec(line);
      for (const { url, start, end } of urls(line)) {
        while (span && span.index + span[0].length <= start) span = protectedText.exec(line);
        if (span && span.index < end && span.index + span[0].length > start) continue;
        // Multiline link destinations and syntax-sensitive URLs stay literal.
        let prior = start;
        while (prior && /\s/.test(line[prior - 1])) prior--;
        if (line.slice(prior - 2, prior) === "](" || url.includes("\\")) continue;
        positions.push(offset + start, offset + end);
      }
    }
    offset += line.length;
  }
  if (!positions.length) return null;
  const chunks = [];
  let at = 0;
  const inserted = positions.map((position, i) => {
    chunks.push(text.slice(at, position), i % 2 ? ">" : "<");
    at = position;
    return position + i;
  });
  chunks.push(text.slice(at));
  const countBefore = (array, target) => {
    let lo = 0, hi = array.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (array[m] < target) lo = m + 1; else hi = m;
    }
    return lo;
  };
  return { text: chunks.join(""),
    source: pos => pos - countBefore(inserted, pos),
    start: pos => pos + countBefore(positions, pos + 1),
    end: pos => pos + countBefore(positions, pos) };
}

const ITEM = /^([ \t]*)(?:([-*+]|\d+[.)])[ \t]+(?:(\[[ xX]\])[ \t]+)?)?(.*)$/;

// Makes the selected lines a list of `kind`: "bullet", "number" or "task". Lines that all are
// one already become plain text again, except tasks, which are ticked or unticked. Blank lines
// are left alone unless there is nothing else.
export function list(text, sel, kind) {
  const span = lines(text, sel), rows = text.slice(span.start, span.end).split("\n");
  const parsed = rows.map(row => {
    const cr = row.endsWith("\r"), m = ITEM.exec(cr ? row.slice(0, -1) : row);
    return { indent: m[1], marker: m[2] ?? null, box: m[3] ?? null, rest: m[4], cr, blank: !m[2] && !m[4].trim() };
  });
  const used = parsed.filter(p => !p.blank), on = used.length ? used : parsed;
  const is = p => (kind === "task" ? Boolean(p.box) : kind === "number" ? /^\d/.test(p.marker ?? "") && !p.box : /^[-*+]$/.test(p.marker ?? "") && !p.box);
  const all = on.every(is), ticked = on.every(p => p.box && p.box !== "[ ]");
  let count = 0;
  const out = parsed.map(p => {
    if (!on.includes(p)) return p.indent + p.rest + (p.cr ? "\r" : "");
    let lead = "";
    if (kind === "task") lead = all ? `${p.marker} ${ticked ? "[ ]" : "[x]"} ` : `${/^[-*+]$/.test(p.marker ?? "") ? p.marker : "-"} [ ] `;
    else if (!all) lead = kind === "number" ? `${++count}. ` : "- ";
    return p.indent + lead + p.rest + (p.cr ? "\r" : "");
  }).join("\n");
  const grew = out.length - (span.end - span.start);
  const select = rows.length > 1 ? { start: span.start, end: span.start + out.length }
    : { start: Math.max(span.start, sel.start + grew), end: Math.max(span.start, sel.end + grew) };
  return { range: span, insert: out, select };
}

// Enter was pressed in a list: `before` is the text it was pressed in, `text` what it left, with
// the cursor at `cursor`. Returns the edit that goes on with the list (the next number, an empty
// box), or that ends it when the item was empty; null when the line was not a list item.
export function continued(before, text, cursor) {
  const typed = text.length - before.length;
  if (typed < 1 || cursor < typed) return null;
  const at = cursor - typed;
  const broke = /^(\r?\n)([ \t]*)$/.exec(text.slice(at, cursor));
  if (!broke || text.slice(cursor) !== before.slice(at)) return null;
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const m = /^([ \t]*)([-*+]|\d+[.)])( \[[ xX]\])?(?: (.*)|)$/.exec(text.slice(start, at));
  if (!m) return null;
  const [, indent, marker, box, rest = ""] = m;
  const after = text[cursor];
  if (!rest.trim() && (after === undefined || after === "\n" || after === "\r")) {
    return { range: { start, end: cursor }, insert: "", select: { start, end: start } };
  }
  const number = /^(\d+)([.)])$/.exec(marker);
  const from = at + broke[1].length;
  const item = (label, rest) => `${indent}${label}${box ? " [ ]" : ""} ${rest}`;
  const done = (label, end, tail) => {
    const lead = item(label, "");
    return { range: { start: from, end }, insert: lead + tail, select: { start: from + lead.length, end: from + lead.length } };
  };
  if (!number) return done(marker, cursor, "");
  // A numbered list counts on: the items under the new one each get the next number. They are
  // the lines that follow with the same indent and a number, with what belongs to them (deeper
  // lines, and a blank line when an item comes after it). A list numbered "1." all the way
  // down is left like that.
  const n = Number(number[1]), sibling = /^(\d+)([.)])( .*|)$/;
  const lineEnd = i => { const e = text.indexOf("\n", i); return e < 0 ? text.length : e; };
  const body = i => { const row = text.slice(i, lineEnd(i)); return row.endsWith("\r") ? row.slice(0, -1) : row; };
  const own = row => row.startsWith(indent) ? row.slice(indent.length) : null;
  const first = lineEnd(cursor);
  let out = "", kept = "", upTo = first, count = n + 1, same = false;
  for (let i = first + 1, seen = 0; i <= text.length; i = lineEnd(i) + 1) {
    const row = body(i), rest = own(row), m = rest === null ? null : sibling.exec(rest);
    if (m) {
      if (!seen++ && Number(m[1]) === n) { same = true; break; }
      kept += `\n${indent}${++count}${m[2]}${m[3]}${text[lineEnd(i) - 1] === "\r" ? "\r" : ""}`;
      out += kept; kept = ""; upTo = lineEnd(i);
    } else if (!row.trim() || (rest !== null && /^[ \t]/.test(rest))) kept += "\n" + text.slice(i, lineEnd(i));
    else break;
  }
  return done(`${same ? n : n + 1}${number[2]}`, upTo, text.slice(cursor, first) + out);
}

// Comments the selected lines out, or back in when every one of them is a comment. `token` is
// the language's line comment, or a pair to put around each line. Blank lines are left alone.
export function comment(text, sel, token) {
  if (!token) return null;
  const [open, close] = Array.isArray(token) ? token : [token, null];
  const span = lines(text, sel), rows = text.slice(span.start, span.end).split("\n");
  const body = rows.map(row => (row.endsWith("\r") ? row.slice(0, -1) : row));
  const used = body.filter(row => row.trim());
  if (!used.length) return null;
  const commented = row => row.trimStart().startsWith(open) && (!close || row.trimEnd().endsWith(close));
  const all = used.every(commented);
  const depth = Math.min(...used.map(row => row.length - row.trimStart().length));
  const out = rows.map((row, i) => {
    const b = body[i], cr = row.length > b.length ? "\r" : "";
    if (!b.trim()) return row;
    if (!all) return b.slice(0, depth) + open + " " + b.slice(depth) + (close ? " " + close : "") + cr;
    const lead = b.length - b.trimStart().length;
    let rest = b.slice(lead + open.length);
    if (rest.startsWith(" ")) rest = rest.slice(1);
    if (close) { rest = rest.trimEnd().slice(0, -close.length); if (rest.endsWith(" ")) rest = rest.slice(0, -1); }
    return b.slice(0, lead) + rest + cr;
  }).join("\n");
  const grew = out.length - (span.end - span.start);
  const select = rows.length > 1 || sel.start !== sel.end ? { start: span.start, end: span.start + out.length }
    : { start: Math.max(span.start, sel.start + (all ? grew : open.length + 1)), end: Math.max(span.start, sel.start + (all ? grew : open.length + 1)) };
  return { range: span, insert: out, select };
}

// Moves the selected lines one line up (`by` -1) or down (1), with the selection.
export function move(text, sel, by) {
  const span = lines(text, sel), block = text.slice(span.start, span.end);
  if (by < 0) {
    if (span.start === 0) return null;
    const from = text.lastIndexOf("\n", span.start - 2) + 1, other = text.slice(from, span.start - 1);
    const shift = -(other.length + 1);
    return { range: { start: from, end: span.end }, insert: block + "\n" + other, select: { start: sel.start + shift, end: sel.end + shift } };
  }
  if (span.end >= text.length) return null;
  let to = text.indexOf("\n", span.end + 1);
  if (to < 0) to = text.length;
  const other = text.slice(span.end + 1, to), shift = other.length + 1;
  return { range: { start: span.start, end: to }, insert: other + "\n" + block, select: { start: sel.start + shift, end: sel.end + shift } };
}

// A copy of the selected lines under them, with the selection in the copy.
export function duplicate(text, sel) {
  const span = lines(text, sel), block = text.slice(span.start, span.end), shift = block.length + 1;
  return { range: { start: span.end, end: span.end }, insert: "\n" + block, select: { start: sel.start + shift, end: sel.end + shift } };
}

// With nothing selected, the word under the cursor; else the next place the selected text is
// found, going round to the top.
export function nextSame(text, sel) {
  if (sel.start === sel.end) { const word = wordAt(text, sel.start); return word ? { select: word } : null; }
  const needle = text.slice(sel.start, sel.end);
  let at = text.indexOf(needle, sel.end);
  if (at < 0) at = text.indexOf(needle);
  return at < 0 || at === sel.start ? null : { select: { start: at, end: at + needle.length } };
}

// Finding. `o`: { cs: match case, regex: the query is a regular expression }.
const MOST = 20000;
const pattern = (query, o, flags) => new RegExp(o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags + (o.cs ? "" : "i"));

// Every place the query is found: { matches: [{ start, end }], error }.
export function find(text, query, o) {
  if (!query) return { matches: [] };
  let re;
  try { re = pattern(query, o, "gm"); } catch (e) { return { matches: [], error: String(e.message ?? e).replace(/^Invalid regular expression: /, "") }; }
  const matches = [];
  for (let m; matches.length < MOST && (m = re.exec(text)); ) {
    if (m[0].length) matches.push({ start: m.index, end: m.index + m[0].length });
    else re.lastIndex++;
  }
  return { matches };
}

// What takes the place of the match `found` (its text): `$1` and `$&` count in a regular expression only.
export function replacement(found, query, o, to) {
  if (!o.regex) return to;
  try { return found.replace(pattern(query, o, "m"), to); } catch { return to; }
}

// The text with every match replaced: { text, count }.
export function replaceAll(text, query, o, to) {
  const { matches } = find(text, query, o);
  if (!matches.length) return { text, count: 0 };
  let out = "", from = 0;
  for (const m of matches) {
    out += text.slice(from, m.start) + replacement(text.slice(m.start, m.end), query, o, to);
    from = m.end;
  }
  return { text: out + text.slice(from), count: matches.length };
}

// How a file is indented: { size, hard }, for the editor's tab_size and hard_tabs. A Makefile,
// or a text where more lines begin with a tab than with spaces, is indented with tabs. Else the
// size is the step between the leading spaces of one line and the next that is the most common
// of 2, 4 and 8 (the smaller one on a tie). Blank lines don't count, and only the first
// INDENT_LINES lines are looked at. `fallback` when nothing says: no indented line.
const INDENT_LINES = 2000, TAB_SIZE = 4, STEPS = [2, 4, 8];
const TABBED = /^(gnu)?makefile$|\.(mk|make)$/i;
export function indent(text, name = "", fallback = { size: 2, hard: false }) {
  if (TABBED.test(name)) return { size: TAB_SIZE, hard: true };
  let tabs = 0, spaces = 0, prev = 0;
  const count = { 2: 0, 4: 0, 8: 0 };
  for (let i = 0, n = 0; i < text.length && n < INDENT_LINES; n++) {
    let end = text.indexOf("\n", i);
    if (end < 0) end = text.length;
    if (text[i] === "\t") tabs++;
    else {
      let w = 0;
      while (text[i + w] === " ") w++;
      const blank = i + w >= end || text[i + w] === "\r" || text[i + w] === "\t";
      if (!blank) {
        if (w >= 2) spaces++;
        const step = Math.abs(w - prev);
        if (step in count) count[step]++;
        prev = w;
      }
    }
    i = end + 1;
  }
  if (tabs > spaces) return { size: TAB_SIZE, hard: true };
  let best = 0;
  for (const s of STEPS) if (count[s] > (count[best] ?? 0)) best = s;
  return best ? { size: best, hard: false } : fallback;
}

// Where the cursor is, for the status line: { line, column }, both from 1.
export function position(text, at) {
  let line = 1, from = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) { line++; from = i + 1; }
  return { line, column: at - from + 1 };
}
