// What a diff from git says, as rows to draw: one under the other, or side by side, with the
// words that changed inside a changed line.
//
// Nothing here touches the app, so it runs under `node`: test a change to it there, against
// what a real `git diff` prints.

// The most lines of one file's diff that are kept, and the longest line.
export const MOST = 6000, LONG = 2000;

// Text draws a tab as nothing: each is padded to the next 4-column stop.
export const untab = (text) => (text.includes("\t") ? text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4)) : text);
export const showLine = (text) => untab(text.length > LONG ? `${text.slice(0, LONG)}…` : text);

// A file's diff as git prints it: { hunks, binary, cut }. A hunk is { old, next (the line
// numbers it starts at), note (what git says after the @@), lines: [{ kind: " " | "+" | "-",
// text }] }. `cut`: the diff was longer than MOST lines.
export function parse(text, originals = false, capture = false) {
  const out = { hunks: [], binary: false, cut: false, conflict: false, oldBlob: null, header: [] };
  let hunk = null, count = 0;
  for (const line of text.split("\n")) {
    // A file with Windows line ends: the \r is not something to show.
    const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
    // A file in conflict is compared with both sides at once: not a diff this can draw.
    if (raw.startsWith("@@@")) { out.conflict = true; continue; }
    if (raw.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(raw);
      if (!m) continue;
      hunk = { old: Number(m[1]), oldCount: Number(m[2] ?? 1), next: Number(m[3]), nextCount: Number(m[4] ?? 1), note: m[5], lines: [] };
      if (capture) hunk.patch = [line];
      out.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("Binary files ") || raw.startsWith("GIT binary patch")) out.binary = true;
      const index = /^index ([a-f0-9]+)\.\.[a-f0-9]+/.exec(raw);
      if (index && /[1-9a-f]/.test(index[1])) out.oldBlob = index[1];
      if (capture && line) out.header.push(line);
      continue;
    }
    const kind = raw[0];
    // "\ No newline at end of file" is about the line before it, and is not a line.
    if (line === "\\ No newline at end of file") hunk.patch?.push(line);
    if (kind !== " " && kind !== "+" && kind !== "-") continue;
    if (++count > MOST) { out.cut = true; break; }
    const body = raw.slice(1);
    hunk.patch?.push(line);
    hunk.lines.push({ kind, text: showLine(body), ...(originals && body.length <= LONG ? { original: body } : {}) });
  }
  return out;
}

// A file git doesn't have yet, as one hunk of added lines.
export function added(text) {
  const all = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const lines = all.slice(0, MOST).map((l) => ({ kind: "+", text: showLine(l) }));
  return { hunks: text ? [{ old: 0, oldCount: 0, next: 1, nextCount: all.length, note: "", lines }] : [], binary: false, cut: all.length > MOST };
}

// Use the patch Git printed, including tabs, CRLF and the missing-newline marker.
// For a modification, carry only the text headers so chmod stays a separate change.
export function hunkPatch(parsed, index) {
  const { hunks, cut, binary, conflict, header } = parsed;
  const hunk = hunks[index];
  if (cut || binary || conflict || !hunk?.patch?.length || !header[0]?.startsWith("diff --git ")) return null;
  const modes = header.flatMap((line) => /^(?:(?:old|new|new file|deleted file) mode |index [a-f0-9]+\.\.[a-f0-9]+ )(\d{6})$/.exec(line)?.slice(1) ?? []);
  if (!modes.length || modes.some((mode) => mode !== "100644" && mode !== "100755")) return null;
  const fileMode = header.find((line) => /^(new|deleted) file mode /.test(line));
  if (fileMode && (hunks.length !== 1 || (hunk.oldCount && hunk.nextCount))) return null;
  const paths = header.filter((line) => line.startsWith("--- ") || line.startsWith("+++ "));
  if (paths.length !== 2) return null;
  const patch = [header[0], ...(fileMode ? [fileMode] : []), ...paths, ...hunk.patch].join("\n") + "\n";
  // exec has no stdin. A shell on the checkout's machine pipes this one argument to Git.
  return patch.length <= 20000 && !/[\0\ufffd]/.test(patch) ? patch : null;
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

// A range of unchanged lines immediately before a hunk, in both revisions.
function gap(hunks, i) {
  const hunk = hunks[i], before = hunks[i - 1];
  const old = before ? before.old + Math.max(1, before.oldCount) : 1;
  const next = before ? before.next + Math.max(1, before.nextCount) : 1;
  const count = Math.min(hunk.old + Number(hunk.oldCount === 0) - old, hunk.next + Number(hunk.nextCount === 0) - next);
  return count > 0 ? { kind: "gap", hunk: i, old, next, count } : null;
}

function heading(rows, hunks, i, expanded, same) {
  const area = gap(hunks, i);
  if (area) {
    const lines = expanded?.get(i) ?? [];
    if (lines.length < area.count) rows.push({ ...area, action: "show", showing: lines.length });
    if (lines.length) rows.push({ ...area, action: "hide", showing: lines.length });
    const skipped = area.count - lines.length;
    lines.forEach((text, j) => rows.push(same({ text, old: area.old + skipped + j, next: area.next + skipped + j })));
  }
  const { old, next, note } = hunks[i];
  rows.push({ kind: "hunk", hunk: i, old, next, note });
}

const unifiedSame = (line) => ({ kind: " ", ...line });
const splitSame = (line) => ({ left: { n: line.old, text: line.text, kind: " " }, right: { n: line.next, text: line.text, kind: " " } });

// Rows, one under the other: hunk and gap headers, and { kind: " " |
// "+" | "-", old?, next?, text, pair? }. `pair` is the text of the line this one replaced or
// was replaced by: what words() compares it with.
export function unified(d, expanded) {
  const rows = [];
  d.hunks.forEach((hunk, i) => {
    heading(rows, d.hunks, i, expanded, unifiedSame);
    for (const g of groups(hunk)) {
      if (g.same) { rows.push(unifiedSame(g.same)); continue; }
      g.del.forEach((l, k) => rows.push({ kind: "-", old: l.n, text: l.text, pair: g.add[k]?.text ?? null }));
      g.add.forEach((l, k) => rows.push({ kind: "+", next: l.n, text: l.text, pair: g.del[k]?.text ?? null }));
    }
  });
  return rows;
}

// Rows, side by side: hunk and gap headers, and { left, right }, each { n, text, kind,
// pair } or null where that side has no line.
export function split(d, expanded) {
  const rows = [];
  d.hunks.forEach((hunk, i) => {
    heading(rows, d.hunks, i, expanded, splitSame);
    for (const g of groups(hunk)) {
      if (g.same) { rows.push(splitSame(g.same)); continue; }
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
