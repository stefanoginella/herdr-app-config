// Which files a query finds, in what order, and what is asked of the machine when the project
// has more files than are listed. Nothing here touches the app, so it runs under `node`: test a
// change to it there, against real `rg --files` output.
//
// A query is words: a file is found when every word matches its path, in any order. A word
// matches best in the file's name in one piece, then in its folders in one piece, then as
// letters in order (in the name, then anywhere). A word with a "/" in it is looked for in the
// whole path. ":12" or ":12:5" at the end is a line, and a column, to go to.

// The most files listed, and the most shown.
export const MOST = 20000, SHOWN = 50;
// What a letter may follow to count as the start of a word.
const BREAK = "/-_. ";
// What a file opened lately is worth: it wins among equals, never over a better match.
const RECENT = 80;

// What was typed, as { terms: the words in lower case, line, column: from 1, or null }.
export function parse(text) {
  let words = String(text ?? "").trim(), line = null, column = null;
  const at = /^(.*?):(\d+)(?::(\d+))?:?$/.exec(words);
  if (at) { words = at[1]; line = Number(at[2]) || null; column = at[3] && line ? Number(at[3]) || null : null; }
  // A colon typed before its number is not part of the name.
  else words = words.replace(/:+$/, "");
  const terms = words.toLowerCase().split(/\s+/).map((w) => w.replace(/^\.\//, "")).filter(Boolean);
  return { terms, line, column };
}

// What the listing program said (ops.js): the repository's top folder and the folder asked,
// under it, then a file a line, sorted, then an empty line. `cwd` is the folder asked. Gives
// { root, repo, paths, cut }: `root` is the folder the paths are under, spelled as `cwd` is
// where it can be (git names the folder behind a link); `cut`: there are more files than the
// `most` listed.
export function read(out, cwd, most = MOST) {
  const first = out.indexOf("\n"), second = first < 0 ? -1 : out.indexOf("\n", first + 1);
  if (second < 0) return { root: cwd, repo: false, paths: [], cut: false };
  const top = out.slice(0, first), under = out.slice(first + 1, second).replace(/\/+$/, "");
  const root = !top || !under ? cwd : cwd.endsWith(`/${under}`) ? cwd.slice(0, -under.length - 1) : top;
  let body = out.slice(second + 1), cut = false;
  // Without the empty line at its end it was cut short: the last line may be half a name.
  if (!out.endsWith("\n\n")) { body = body.slice(0, body.lastIndexOf("\n") + 1); cut = true; }
  // Every line begins with "./": split there, in one step. (A pattern over a text this long,
  // or a step a line, takes the engine tens of milliseconds.)
  while (body.endsWith("\n")) body = body.slice(0, -1);
  const paths = body ? (body.startsWith("./") ? body.slice(2) : body).split("\n./") : [];
  if (paths.length > most) { paths.length = most; cut = true; }
  return { root, repo: Boolean(top), paths, cut };
}

// The files, ready to be searched: each path in lower case, where its name begins, and all of
// them as one text (`blob`, a path a line; `line`: where each begins in it). `paths` come
// sorted, and are kept, not copied.
export function index(paths) {
  let blob = paths.join("\n").toLowerCase(), lower = blob.split("\n");
  // A letter whose lower case is another length is fine; one that made a line is not.
  if (lower.length !== paths.length) { lower = paths.map((p) => p.toLowerCase().replace(/\n/g, " ")); blob = lower.join("\n"); }
  const base = new Array(paths.length), line = new Array(paths.length);
  for (let i = 0, at = 0; i < paths.length; i++) {
    base[i] = lower[i].lastIndexOf("/") + 1;
    line[i] = at;
    at += lower[i].length + 1;
  }
  return { paths, lower, base, blob, line };
}

const starts = (s, i, from) => i === from || BREAK.includes(s[i - 1]);

// The letters of `term` in order in `s`, from `from` on: how good (higher for letters close
// together and at the starts of words), or -1. `out` takes where the letters are.
function loose(s, from, term, out) {
  let end = from - 1;
  for (let c = 0; c < term.length; c++) {
    end = s.indexOf(term[c], end + 1);
    if (end < 0) return -1;
  }
  // Back from the last letter: the same letters, as close to it as they come.
  let at = end, words = starts(s, at, from) ? 1 : 0;
  out?.push(at);
  for (let c = term.length - 2; c >= 0; c--) {
    at = s.lastIndexOf(term[c], at - 1);
    if (starts(s, at, from)) words++;
    out?.push(at);
  }
  return 40 - Math.min(end - at + 1 - term.length, 40) + Math.min(words, 6) * 10;
}

// `term` in one piece in `s`, from `from` on: where, at the start of a word when it is at one
// anywhere. -1: nowhere.
function whole(s, from, term) {
  const first = s.indexOf(term, from);
  for (let k = first; k >= 0; k = s.indexOf(term, k + 1)) if (starts(s, k, from)) return k;
  return first;
}

function piece(out, k, n) {
  if (out) for (let i = 0; i < n; i++) out.push(k + i);
}

// How well `term` matches the path `s` (in lower case), whose name begins at `b`. -1: it
// doesn't. `deep`: the term names folders, so the whole path is what it is looked for in.
function score(s, b, term, deep, out) {
  if (!deep) {
    const k = whole(s, b, term);
    if (k >= 0) {
      piece(out, k, term.length);
      const rest = s.length - k - term.length;
      // The whole name, the name without its extension, the start of the name, of a word.
      const how = k !== b ? (starts(s, k, b) ? 150 : 0) : rest === 0 ? 400 : s[k + term.length] === "." ? 350 : 300;
      return 1000 + how - Math.min(s.length - b, 99);
    }
  }
  const k = whole(s, 0, term);
  if (k >= 0) {
    piece(out, k, term.length);
    return 600 + (starts(s, k, 0) ? 100 : 0);
  }
  if (!deep) {
    const v = loose(s, b, term, out);
    if (v >= 0) return 300 + v;
  }
  const v = loose(s, 0, term, out);
  return v < 0 ? -1 : 100 + v;
}

const better = (a, b) => b.v - a.v || a.i - b.i;

// The best `most` files of `ix` for the words `terms`, best first (with no words: the first
// ones), and how many match at all: { rows: [index into ix.paths], total }. `recent`: a Set of
// paths opened lately.
//
// Herdr's script engine is slow, and stops a task that runs long: a loop that looks at every
// path takes four microseconds a path, and its pattern matcher is no faster. Finding a letter
// in a text is the one fast thing (`indexOf`). So the paths are one text, and the longest word
// is looked for there, letter by letter: a line that lacks one of its letters is never looked
// at, and only a line that has them all in order is given its points.
export function rank(ix, terms, most = SHOWN, recent = null) {
  const { paths, lower, base, blob, line } = ix, deep = terms.map((t) => t.includes("/"));
  if (!terms.length) return { rows: paths.slice(0, most).map((_, i) => i), total: paths.length };
  const word = terms.reduce((a, b) => (b.length > a.length ? b : a)), n = paths.length;
  // Where each letter of the word is next. What is asked goes forward only, so an answer holds
  // until it is passed.
  const next = new Array(word.length).fill(-1);
  const find = (c, from) => {
    if (next[c] < from) { const at = blob.indexOf(word[c], from); next[c] = at < 0 ? Infinity : at; }
    return next[c];
  };
  let top = [], floor = -Infinity, total = 0, i = 0;
  while (i < n) {
    let at = find(0, line[i]);
    if (at === Infinity) break;
    while (i + 1 < n && line[i + 1] <= at) i++;
    const s = lower[i], end = line[i] + s.length;
    let c = 1;
    for (; c < word.length; c++) {
      at = find(c, at + 1);
      if (at >= end) break;
    }
    if (c < word.length) {
      // The letter that was missing is not in the lines before its next place either.
      if (at === Infinity) break;
      while (i + 1 < n && line[i + 1] <= at) i++;
      continue;
    }
    let sum = 0;
    for (let t = 0; t < terms.length; t++) {
      const v = score(s, base[i], terms[t], deep[t], null);
      if (v < 0) { sum = -1; break; }
      sum += v;
    }
    if (sum >= 0) {
      total++;
      // Among equals the shorter path, then the first by name.
      const v = (sum + (recent?.has(paths[i]) ? RECENT : 0)) * 1000 - Math.min(s.length, 999);
      if (v > floor) {
        top.push({ i, v });
        // Kept short as it goes: sorting every match of a short word would take too long.
        if (top.length >= most * 2) { top.sort(better); top.length = most; floor = top[most - 1].v; }
      }
    }
    i++;
  }
  top.sort(better);
  if (top.length > most) top.length = most;
  return { rows: top.map((o) => o.i), total };
}

// Which characters of a file's name the words matched: its text as pieces, [{ text, hit }].
export function pieces(ix, i, terms) {
  const path = ix.paths[i], s = ix.lower[i], b = ix.base[i], name = path.slice(b);
  // A letter whose lower case is longer: the places would be off.
  if (!terms.length || s.length !== path.length) return [{ text: name, hit: false }];
  const at = [];
  for (const term of terms) score(s, b, term, term.includes("/"), at);
  const hit = new Set(at.filter((k) => k >= b).map((k) => k - b)), out = [];
  for (let k = 0; k < name.length; k++) {
    const last = out[out.length - 1], is = hit.has(k);
    if (last && last.hit === is) last.text += name[k];
    else out.push({ text: name[k], hit: is });
  }
  return out;
}

// A word as a pattern for ripgrep, which is asked without regard to case: its letters in
// order, anything between them. Every character but a plain letter or digit is named by its
// number, so none of them means anything to the pattern.
export function pattern(term) {
  const out = [];
  for (const ch of term) out.push(/^[a-z0-9]$/i.test(ch) ? ch : `\\x{${ch.codePointAt(0).toString(16)}}`);
  return out.join(".*");
}
