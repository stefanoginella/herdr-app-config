// Which lines of a text are not as an earlier text had them: the file as the last commit has
// it, against the editor's text now. Nothing here touches the app, so it runs under `node`.
//
// A mark is { kind, line, count, gone }:
//   kind    "added" (new lines), "changed" (lines in place of others) or "deleted"
//   line    the first line it covers in the text now, from 0
//   count   how many lines of the text now it covers: 0 for "deleted", which sits before `line`
//   gone    how many of the earlier lines it replaced or removed
// Marks come in the text's order, and no two touch.

// More single-line edits than this between the two texts and the search stops: everything
// from the first difference to the last is then one mark. The search costs the square of it.
const MOST_EDITS = 800;

// The lines of a text. A line ending of Windows is not part of its line, so a checkout that
// converts the line endings is not different in every line.
function split(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) if (lines[i].endsWith("\r")) lines[i] = lines[i].slice(0, -1);
  return lines;
}

// Myers' shortest edit script from a to b (arrays of numbers). Returns, for b, which of its
// items are new (`added[y]`) and how many items of a are gone before each (`gone[y]`), or
// null when it takes more than MOST_EDITS edits.
function script(a, b) {
  const n = a.length, m = b.length, cap = Math.min(n + m, MOST_EDITS), off = cap + 1;
  const v = new Int32Array(2 * cap + 3), trace = [];
  let found = -1;
  search: for (let d = 0; d <= cap; d++) {
    // What the round reads: the furthest x on each diagonal after d - 1 edits.
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break search; }
    }
  }
  if (found < 0) return null;
  const added = new Uint8Array(m), gone = new Int32Array(m + 1);
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const was = trace[d], k = x - y, at = k + d + 1; // was[at]: diagonal k
    const from = k === -d || (k !== d && was[at - 1] < was[at + 1]) ? k + 1 : k - 1;
    const px = was[from + d + 1], py = px - from;
    while (x > px && y > py) { x--; y--; }
    if (x === px) added[--y] = 1; else { x--; gone[y]++; }
  }
  return { added, gone };
}

// The marks of `after` against `before`, and how many lines `after` has.
export function compare(before, after) {
  const a = split(before), b = split(after), lines = b.length;
  let lo = 0, ea = a.length, eb = b.length;
  while (lo < ea && lo < eb && a[lo] === b[lo]) lo++;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - lo, m = eb - lo;
  if (!n && !m) return { marks: [], lines };
  const whole = [{ kind: !n ? "added" : !m ? "deleted" : "changed", line: lo, count: m, gone: n }];
  if (!n || !m) return { marks: whole, lines };
  // Every different line is a number, so two lines are compared as two numbers.
  const ids = new Map(), id = line => { let i = ids.get(line); if (i === undefined) ids.set(line, i = ids.size); return i; };
  const an = new Int32Array(n), bn = new Int32Array(m);
  for (let i = 0; i < n; i++) an[i] = id(a[lo + i]);
  for (let i = 0; i < m; i++) bn[i] = id(b[lo + i]);
  const s = script(an, bn);
  if (!s) return { marks: whole, lines };
  const marks = [];
  for (let y = 0; y <= m; y++) {
    if (!s.gone[y] && !(y < m && s.added[y])) continue;
    // One mark: what is gone and what is new, as far as no line between them was kept.
    const start = y;
    let gone = s.gone[y];
    while (y < m && s.added[y]) { y++; gone += s.gone[y]; }
    const count = y - start;
    marks.push({ kind: !gone ? "added" : !count ? "deleted" : "changed", line: lo + start, count, gone });
  }
  return { marks, lines };
}

// The mark to go to from `line` (from 0): the next one down (`by` 1) or up (-1), going round.
export function next(marks, line, by) {
  if (!marks.length) return null;
  if (by > 0) return marks.find(m => m.line > line) ?? marks[0];
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i].line < line) return marks[i];
  return marks[marks.length - 1];
}

// Where a mark's lines are in the text ({ start, end }, UTF-16 offsets): from the first one's
// start to the last one's end, without its line break. A "deleted" mark is one place.
export function range(text, mark) {
  let start = 0;
  for (let i = 0; i < mark.line; i++) {
    const br = text.indexOf("\n", start);
    if (br < 0) return { start: text.length, end: text.length };
    start = br + 1;
  }
  let end = start;
  for (let i = 0; i < mark.count; i++) {
    const br = text.indexOf("\n", end + (i ? 1 : 0));
    if (br < 0) { end = text.length; break; }
    end = br;
  }
  return { start, end };
}

// What a mark is, in words: "Lines 12–15 changed".
export function say(mark) {
  const lines = n => `${n} ${n === 1 ? "line" : "lines"}`;
  if (mark.kind === "deleted") return `${lines(mark.gone)} deleted here`;
  const where = mark.count === 1 ? `Line ${mark.line + 1}` : `Lines ${mark.line + 1}–${mark.line + mark.count}`;
  return `${where} ${mark.kind}`;
}
