// What a search asks of ripgrep, what ripgrep answers, and what a replace does to a text.
// Nothing here touches the app, so it runs under `node`: test a change to it there.
//
// A search is `o`: { query, cs: match case, word: whole words, regex, ignored: also what git
// ignores, include, exclude: comma-separated filters, replacing, to: the replacement }.
// ripgrep answers in JSON, one record a line. A matched line comes with its text and, for each
// match in it, where it is in bytes and (asked with --replace, since ripgrep 14) what the
// replacement makes of it: so `$1` is worked out by the engine that found the match.

// The most matches listed, and the most matched lines taken from one file.
export const MOST = 2000, PER_FILE = 500;
// A line longer than this is not kept whole, and one that is not plain ASCII is not measured:
// its matches are listed, and can't be replaced.
const KEEP = 4000, LONG = 20000;
// What is shown of a line: this much before the match, and after it.
const BEFORE = 28, AFTER = 200;

// A filter field as ripgrep's globs. As in VS Code: "src" and "*.ts" count at any depth, a
// folder stands for all in it, and "./src" is the folder at the project's top.
export function globs(text, exclude) {
  const out = [];
  for (let term of String(text ?? "").split(",")) {
    term = term.trim().replace(/\/+$/, "");
    if (!term || term === ".") continue;
    const glob = term.startsWith("./") ? term.slice(1) : term.startsWith("/") || term.startsWith("**/") ? term : `**/${term}`;
    for (const one of [glob, `${glob}/**`]) out.push(exclude ? `!${one}` : one);
  }
  return out;
}

// A path as a filter that means that path only: nothing in it is a pattern. A comma would
// end the filter, so it is asked for as "any one character".
export const literal = (path) => path.replace(/[\\*?[\]{}!]/g, "\\$&").replace(/,/g, "?");

// ripgrep's arguments. The folder searched is the one it runs in, named (`./`): with no path
// it may read its input instead.
export function args(o) {
  const a = ["--json", "--no-messages", "--hidden", "--max-count", String(PER_FILE), o.cs ? "--case-sensitive" : "--ignore-case"];
  if (o.word) a.push("--word-regexp");
  if (!o.regex) a.push("--fixed-strings");
  if (o.ignored) a.push("--no-ignore");
  // Git's own folder is never searched, at any depth (a submodule, a worktree).
  for (const g of ["!.git/", ...globs(o.include, false), ...globs(o.exclude, true)]) a.push("--glob", g);
  // A `$` is a group only in a pattern: in plain text it is a dollar.
  if (o.replacing) a.push("--replace", o.regex ? o.to : o.to.replace(/\$/g, "$$$$"));
  a.push("--regexp", o.query, "--", "./");
  return a;
}

// What the replacement is when ripgrep doesn't say (an old one): the text itself, unless it
// names groups. null: it can't be known here.
export const plain = (o) => (o.replacing && !(o.regex && o.to.includes("$")) ? o.to : null);

// Where byte offsets into `text` as UTF-8 are in the string (UTF-16), for offsets going up.
export function units(text, bytes) {
  const out = [];
  let b = 0, i = 0;
  for (const want of bytes) {
    while (b < want && i < text.length) {
      const c = text.charCodeAt(i);
      if (c < 0x80) { b += 1; i += 1; }
      else if (c < 0x800) { b += 2; i += 1; }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { b += 4; i += 2; }
      else { b += 3; i += 1; }
    }
    out.push(i);
  }
  return out;
}

const ASCII = /^[\x00-\x7f]*$/;
const flat = (s) => s.replace(/[\t\r\n]/g, " ");

// ripgrep's answer as { files: [{ path, matches }], count, capped }. `path` is under the folder
// searched. A match is { id, line (from 1), start, end (in its line, UTF-16; -1: not measured),
// hit: its text, to: what replaces it or null, full: its whole line or null, before, shown,
// after: the part of the line to draw }. `capped`: there are more matches than these.
export function parse(out, fallback = null, most = MOST) {
  const files = new Map();
  let count = 0, capped = false, whole = false;
  for (let at = 0; at < out.length; ) {
    const nl = out.indexOf("\n", at);
    // A line cut short: the output was.
    if (nl < 0) break;
    const record = out.slice(at, nl);
    at = nl + 1;
    let r;
    try { r = JSON.parse(record); } catch { continue; }
    if (r?.type === "summary") { whole = true; continue; }
    if (r?.type !== "match") continue;
    const d = r.data ?? {}, text = d.lines?.text, raw = d.path?.text;
    // A line or a path that is not UTF-8 comes as bytes: not text to show or to replace.
    if (typeof text !== "string" || typeof raw !== "string" || !Array.isArray(d.submatches)) continue;
    const path = raw.startsWith("./") ? raw.slice(2) : raw;
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const subs = d.submatches.filter((s) => s.end > s.start);
    if (!subs.length) continue;
    const measured = ASCII.test(body) ? subs.flatMap((s) => [s.start, s.end])
      : body.length <= LONG ? units(body, subs.flatMap((s) => [s.start, s.end])) : null;
    let file = files.get(path);
    if (!file) files.set(path, (file = { path, matches: [], lines: 0 }));
    file.lines++;
    if (file.lines >= PER_FILE) capped = true;
    const lead = body.length - body.trimStart().length;
    for (let i = 0; i < subs.length; i++) {
      if (count >= most) { capped = true; break; }
      const start = measured ? measured[i * 2] : -1, end = measured ? measured[i * 2 + 1] : -1;
      const hit = subs[i].match?.text ?? "";
      const from = start < 0 ? 0 : Math.max(lead, start - BEFORE);
      file.matches.push({
        id: `${path}\n${d.line_number}:${subs[i].start}`, line: d.line_number, start, end, hit,
        to: typeof subs[i].replacement?.text === "string" ? subs[i].replacement.text : fallback,
        full: body.length <= KEEP ? body : null,
        before: start < 0 ? "" : flat((from > lead ? "…" : "") + body.slice(from, start)),
        shown: flat(hit.slice(0, AFTER)),
        after: start < 0 ? "" : flat(body.slice(end, end + AFTER)).trimEnd(),
      });
      count++;
    }
    if (count >= most) break;
  }
  if (!whole) capped = true;
  const list = [...files.values()].filter((f) => f.matches.length).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: list, count, capped: capped && count > 0 };
}

// What ripgrep said went wrong, in one line: its last, which for a pattern is the reason.
export function reason(stderr) {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return last.replace(/^(rg: )?(error: )?/, "");
}

// `text` with the matches `edits` replaced: { text, count }. Each edit is a match as parse()
// gives it, and must still be found where it was: the same text at the same place of the same
// line. { stale: true } when one is not: the file is no longer what was searched, and nothing
// of it is replaced.
export function apply(text, edits) {
  // ripgrep doesn't count a byte order mark as part of the first line.
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const wanted = [...new Set(edits.map((e) => e.line))].sort((a, b) => a - b);
  const starts = new Map();
  let line = 1, at = bom;
  for (const want of wanted) {
    while (line < want) {
      const nl = text.indexOf("\n", at);
      if (nl < 0) return { stale: true };
      at = nl + 1;
      line++;
    }
    starts.set(want, at);
  }
  const spans = [];
  for (const e of edits) {
    if (e.start < 0 || typeof e.to !== "string") return { stale: true };
    const from = starts.get(e.line);
    if (e.full !== null) {
      const nl = text.indexOf("\n", from);
      if (text.slice(from, nl < 0 ? text.length : nl) !== e.full) return { stale: true };
    }
    if (text.slice(from + e.start, from + e.end) !== e.hit) return { stale: true };
    spans.push({ start: from + e.start, end: from + e.end, to: e.to });
  }
  spans.sort((a, b) => a.start - b.start);
  let out = "", from = 0;
  for (const s of spans) {
    if (s.start < from) return { stale: true };
    out += text.slice(from, s.start) + s.to;
    from = s.end;
  }
  return { text: out + text.slice(from), count: spans.length };
}
