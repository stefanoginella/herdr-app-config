// What a diff from git says, as rows to draw: one under the other, or side by side, with the
// words that changed inside a changed line.
//
// Nothing here touches the app, so it runs under `node`: test a change to it there, against
// what a real `git diff` prints.

// The most lines of one file's diff that are kept, and the longest line.
export const MOST = 6000, LONG = 2000;

// Text draws a tab as nothing: each is padded to the next 4-column stop.
export const untab = (text) => (text.includes("\t") ? text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4)) : text);

// A file's diff as git prints it: { hunks, binary, cut }. A hunk is { old, next (the line
// numbers it starts at), note (what git says after the @@), lines: [{ kind: " " | "+" | "-",
// text }] }. `cut`: the diff was longer than MOST lines.
export function parse(text, originals = false) {
  const out = { hunks: [], binary: false, cut: false, conflict: false };
  let hunk = null, count = 0;
  for (const line of text.split("\n")) {
    // A file with Windows line ends: the \r is not something to show.
    const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
    // A file in conflict is compared with both sides at once: not a diff this can draw.
    if (raw.startsWith("@@@")) { out.conflict = true; continue; }
    if (raw.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(raw);
      if (!m) continue;
      hunk = { old: Number(m[1]), next: Number(m[2]), note: m[3], lines: [] };
      out.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("Binary files ") || raw.startsWith("GIT binary patch")) out.binary = true;
      continue;
    }
    const kind = raw[0];
    // "\ No newline at end of file" is about the line before it, and is not a line.
    if (kind !== " " && kind !== "+" && kind !== "-") continue;
    if (++count > MOST) { out.cut = true; break; }
    const body = raw.slice(1);
    hunk.lines.push({ kind, text: untab(body.length > LONG ? `${body.slice(0, LONG)}…` : body), ...(originals && body.length <= LONG ? { original: body } : {}) });
  }
  return out;
}

// A file git doesn't have yet, as one hunk of added lines.
export function added(text) {
  const all = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const lines = all.slice(0, MOST).map((l) => ({ kind: "+", text: untab(l.length > LONG ? `${l.slice(0, LONG)}…` : l) }));
  return { hunks: text ? [{ old: 0, next: 1, note: "", lines }] : [], binary: false, cut: all.length > MOST };
}

// The lines of a hunk in groups: runs of unchanged lines, and changes as the lines taken out
// with the lines put in their place.
function groups(hunk) {
  const out = [];
  let old = hunk.old, next = hunk.next, i = 0;
  const lines = hunk.lines;
  while (i < lines.length) {
    if (lines[i].kind === " ") {
      out.push({ same: { text: lines[i].text, old: old++, next: next++ } });
      i++;
      continue;
    }
    const del = [], add = [];
    while (i < lines.length && lines[i].kind === "-") del.push({ text: lines[i++].text, n: old++ });
    while (i < lines.length && lines[i].kind === "+") add.push({ text: lines[i++].text, n: next++ });
    out.push({ del, add });
  }
  return out;
}

// How many lines are left out between two hunks (or before the first one).
const skipped = (hunks, i) => (i === 0 ? hunks[0].old - 1 : hunks[i].old - (hunks[i - 1].old + hunks[i - 1].lines.filter((l) => l.kind !== "+").length));

// The row that stands for what is left out before a hunk. Not when nothing is: a new file
// starts at its first line.
function gap(rows, hunks, i) {
  const count = Math.max(0, skipped(hunks, i));
  if (count || hunks[i].note) rows.push({ kind: "gap", count, note: hunks[i].note });
}

// Rows, one under the other: { kind: "gap", count, note } between hunks, and { kind: " " |
// "+" | "-", old?, next?, text, pair? }. `pair` is the text of the line this one replaced or
// was replaced by: what words() compares it with.
export function unified(d) {
  const rows = [];
  d.hunks.forEach((hunk, i) => {
    gap(rows, d.hunks, i);
    for (const g of groups(hunk)) {
      if (g.same) { rows.push({ kind: " ", old: g.same.old, next: g.same.next, text: g.same.text }); continue; }
      g.del.forEach((l, k) => rows.push({ kind: "-", old: l.n, text: l.text, pair: g.add[k]?.text ?? null }));
      g.add.forEach((l, k) => rows.push({ kind: "+", next: l.n, text: l.text, pair: g.del[k]?.text ?? null }));
    }
  });
  return rows;
}

// Rows, side by side: { kind: "gap", count, note }, and { left, right }, each { n, text, kind,
// pair } or null where that side has no line.
export function split(d) {
  const rows = [];
  d.hunks.forEach((hunk, i) => {
    gap(rows, d.hunks, i);
    for (const g of groups(hunk)) {
      if (g.same) { rows.push({ left: { n: g.same.old, text: g.same.text, kind: " " }, right: { n: g.same.next, text: g.same.text, kind: " " } }); continue; }
      for (let k = 0; k < Math.max(g.del.length, g.add.length); k++) {
        const a = g.del[k], b = g.add[k];
        rows.push({
          left: a ? { n: a.n, text: a.text, kind: "-", pair: b?.text ?? null } : null,
          right: b ? { n: b.n, text: b.text, kind: "+", pair: a?.text ?? null } : null,
        });
      }
    }
  });
  return rows;
}

// The longest line, in characters: how wide the rows must be.
export function widest(d) {
  let n = 0;
  for (const h of d.hunks) for (const l of h.lines) if (l.text.length > n) n = l.text.length;
  return n;
}

// A line as words, the space between them, and every other character by itself (a whole
// one: `u` keeps the two halves of an emoji together).
const tokens = (text) => text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/gu) ?? [];
// Longer lines than this are not compared word by word: the table below is the square of it.
const WORDS = 300;

// Which parts of `text` are not in `other`: [[start, end]], or null when the two lines have
// too little in common for that to say anything (then the whole line changed).
export function words(text, other) {
  if (other === null || other === undefined || text === other) return null;
  const a = tokens(text), b = tokens(other);
  if (!a.length || !b.length || a.length > WORDS || b.length > WORDS) return null;
  // The longest run of tokens both lines have, in order.
  const w = b.length + 1, table = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0, at = 0, kept = 0, total = 0;
  const mark = (from, to) => {
    const last = out[out.length - 1];
    if (last && last[1] === from) last[1] = to; else out.push([from, to]);
  };
  while (i < a.length) {
    const len = a[i].length, blank = !a[i].trim();
    if (j < b.length && a[i] === b[j]) { if (!blank) { kept += len; total += len; } i++; j++; }
    else if (j < b.length && table[i * w + j + 1] >= table[(i + 1) * w + j]) { j++; continue; }
    else { mark(at, at + len); if (!blank) total += len; i++; }
    at += len;
  }
  // Too little in common: the marks would be most of the line, and say nothing.
  if (!total || kept / total < 0.3) return null;
  return out;
}

// A line cut at the marks: [{ text, marked }].
export function pieces(text, marks) {
  if (!marks?.length) return [{ text, marked: false }];
  const out = [];
  let at = 0;
  for (const [from, to] of marks) {
    if (from > at) out.push({ text: text.slice(at, from), marked: false });
    out.push({ text: text.slice(from, to), marked: true });
    at = to;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out;
}

// A number made from the lines a diff adds and removes, and not from the unchanged ones
// around them: the same whether three of those are shown or the whole file.
export function changes(d) {
  let h = 5381;
  for (const hunk of d.hunks ?? []) {
    for (const l of hunk.lines) {
      if (l.kind === " ") continue;
      h = ((h << 5) + h + l.kind.charCodeAt(0)) | 0;
      for (let i = 0; i < l.text.length; i++) h = ((h << 5) + h + l.text.charCodeAt(i)) | 0;
    }
  }
  return h;
}

// A short number that changes when the text does.
export function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

// `--numstat -z` (without renames): { path: { add, del, binary } }.
export function parseNumstat(text) {
  const out = {};
  for (const entry of text.split("\0")) {
    const [add, del, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    out[parts.join("\t")] = { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" };
  }
  return out;
}

// `--name-status -z` (without renames): [{ path, mark }], in git's order.
export function parseNameStatus(text) {
  const f = text.split("\0"), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) if (f[i]) out.push({ mark: f[i][0] === "T" ? "M" : f[i][0], path: f[i + 1] });
  return out;
}
