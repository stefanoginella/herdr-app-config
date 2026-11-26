// The diff pane: what the Git panel's selection changed, file by file, beside the terminals.
// One a tab (props { tab }). What it shows is asked for through shared `git-diff.open`:
//   { tab, root, on, source, path, group, at }
// `source` is { kind: "work" } (what is not committed), { kind: "commit", sha, parent, title,
// sub }, { kind: "branch", branch, base } (two full refs) or { kind: "stash", sha, title, sub }. `path` is the file to show first, and `group`
// which list it is in when there are two: "staged" or "unstaged", "untracked" in a stash.
//
//   take()      a request: reads the lists of files (lists(), read()) and shows one (open())
//   open()      reads one file's diff and makes its rows (diff.js)
//   table()     draws them, side by side or one under the other
//   mark()      a file as viewed; a mark goes when the file changes again
//
// Only the explicit hunk actions in a working-tree diff change the Git index.
//
// Keys, while the pane has the keyboard: J/K or ↓/↑ the next and the previous file, V viewed
// (and on to the next one not viewed), S side by side or not, W the whole file, O the editor.
// The mouse's back and forward buttons, over the pane: the previous and the next file.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, openOverlay, run, shared, setShared, nextCommand, checking, window as app } from "herdr";
import * as diff from "./diff.js";
import * as review from "./review.js";
import * as syntax from "./syntax.js";
import { guard } from "./git-guard.js";
import FilePicker, { FILE_PICK } from "./file-picker.js";
import ReviewNotes from "./notes.js";

const MOD = "git-diff";
// The pane's name: a mod pane's own title is its folder's name.
const TITLE = "Git Diff Viewer";
const OPEN = `${MOD}.open`;
const EDITOR = "file-editor";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
// A read writes nothing under .git: the pane watches that folder. And a path is that file and
// no other: without `--literal-pathspecs` git reads `*`, `[` and a first `:` as a pattern.
const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
const PATCH = [...DIFF, "--full-index", "--src-prefix=a/", "--dst-prefix=b/", "--line-prefix=", "--submodule=short"];
const patchArgs = (range, context, path) => [...PATCH, `-U${context}`, ...range, "--", path];
// These scripts take data as arguments on the checkout's machine.
const APPLY = 'patch=$1; shift; printf "%s" "$patch" | git -c apply.ignoreWhitespace=no apply --cached --whitespace=nowarn "$@" -';
const READ_CONTEXT = `git cat-file blob "$1" | LC_ALL=C awk -v first="$2" -v last="$3" 'NR >= first {print substr($0, 1, 8004)} NR == last {exit}'`;
const INDEX_CHANGED = "git-panel.index-changed";
const staging = new Set();
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;
// The text: its size, a character's width at that size, a row's height, a line number's room.
// The size is the terminals' (as Herdr's own Changes diff has it since 0.1.17), else BASE; the
// rest grow with it from what they were at 12 px. fit() sets them, as each draw begins.
const BASE = 12, SIGN = 16;
let SIZE = BASE, CHAR = 7.23, ROW = 20, NUMBER = 44;
function fit() {
  SIZE = Number(settings()?.font_size) || BASE;
  CHAR = SIZE * (7.23 / 12);
  ROW = Math.round(SIZE * (20 / 12));
  NUMBER = Math.round(SIZE * (44 / 12));
}
// The list of files: its width, the most files drawn, and the pane's width under which it
// is left out.
const LIST = 250, FILES = 500, NARROW = 700;
// Side by side by itself only in a pane at least this wide.
const WIDE = 900;
// Lines around a change, and "all of them" for the whole file.
const CONTEXT = 3, WHOLE = 100000;
const GAP_LINES = 80, EXPANDED_LINES = 640;
// How much comparing of words one file gets (the lengths of two lines, multiplied, summed).
const WORDS = 6000000;
const COLOR_CHARS = 18000;
// Uncommitted files are read again when the folder changes, at most this often, and on a
// timer on another machine, whose folder can't be watched.
const TICK = 2000, THERE_EVERY = 8000;
const VIEWED_MOST = 800;

const base = (path) => path.slice(path.lastIndexOf("/") + 1);
const parent = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const markColor = (t, mark) => (mark === "A" || mark === "U" ? t.ansi2 : mark === "D" || mark === "!" ? t.ansi1 : t.blocked);
const toneColor = { keyword: "ansi5", string: "ansi2", number: "ansi6", comment: "muted" };
const lineKey = (line) => line.pair == null ? line.text : `${line.text}\0${line.pair}`;
// A space the text element can't drop at the start or the end of a piece of a line.
const hard = (text) => text.replace(/ /g, " ");
const sourceKey = (s) => (s.kind === "work" ? "work" : s.sha);

export default class GitDiff extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.reviewNotes) {
      this.notes = new ReviewNotes();
      this.notes.init(p, (args) => this.gitOf(p.reviewNotes, args), cx);
      return;
    }
    if (p.filePicker) {
      this.picker = new FilePicker();
      this.picker.init(p, cx);
      return;
    }
    this.tab = p.tab ?? null;
    this.pending = {};
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.seen = 0; this.req = null; this.groups = []; this.cur = null; this.doc = null; this.whole = false;
    this.mode = ["split", "unified"].includes(localStorage.getItem("mode")) ? localStorage.getItem("mode") : "auto";
    try { this.viewed = JSON.parse(localStorage.getItem("viewed") ?? "{}") ?? {}; } catch { this.viewed = {}; }
    if (checking()) return;
    // What it showed before the app was closed.
    try {
      const last = JSON.parse(localStorage.getItem("last") ?? "null");
      if (last?.root && last?.source) this.take(last, cx);
    } catch { /* nothing to restore */ }
    cx.timer.every(TICK, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
  }

  // Something to remember, written at the next draw: after an `await`, `localStorage` may be
  // another copy's, the one that drew last.
  remember(name, value) { this.pending[name] = value; }

  async close() {
    this.watched?.cancel?.();
  }

  // Whether this pane's tab is the one on screen.
  shown() {
    return spaces().some((s) => s.active && s.tabs.some((t) => t.active && t.id === this.tab));
  }

  git(args) {
    return exec("git", [...READ, ...args], { cwd: this.req.root, on: this.req.on });
  }

  // The same for the request `req`, which may no longer be the one shown when it answers.
  gitOf(req, args) {
    return exec("git", [...READ, ...args], { cwd: req.root, on: req.on });
  }

  // A request from the Git panel, or the one kept from last time.
  take(o, cx) {
    const same = o.source.kind !== "branch" && this.req && this.req.root === o.root && (this.req.on ?? null) === (o.on ?? null) && sourceKey(this.req.source) === sourceKey(o.source);
    this.req = { root: o.root, on: o.on ?? null, source: o.source };
    this.scope = o.scope ?? "auto"; this.range = null; this.error = null;
    this.actionError = null;
    this.reviewKey = o.source.kind === "branch" ? review.storeKey(this.req) : null;
    this.want = { path: o.path ?? null, group: o.group ?? null };
    this.remember("last", JSON.stringify({ ...this.req, path: o.path ?? null, group: o.group ?? null }));
    if (!same) { this.groups = []; this.cur = null; this.doc = null; this.whole = false; this.loaded = false; }
    this.lists(cx);
    this.watch(cx);
  }

  watch(cx) {
    const root = this.req?.source.kind === "work" && !this.req.on ? this.req.root : null;
    if (this.watching === root) return;
    this.watched?.cancel?.();
    this.watching = root;
    if (root) cx.spawn(async () => {
      try {
        while (this.watching === root) {
          this.watched = watchFolder(root);
          await this.watched;
          this.stale = true;
        }
      } catch { if (this.watching === root) this.watching = null; }
    });
  }

  tick(cx) {
    if (this.req?.source.kind !== "work" || !this.shown()) return;
    // While Herdr is not the active app the lists aren't read: a watch only marks them stale,
    // and the first tick with Herdr active again reads at once. A request (`take()`) still
    // reads at once. `app` is Herdr's `window()`, as in the Git panel.
    if (app()?.active === false) { this.away = true; return; }
    if (this.away) { this.away = false; this.stale = true; }
    // A reading that took long is not started again at once: in a big repository an agent at
    // work changes files all the time, and the readings would run back to back.
    if (Date.now() - (this.listedAt ?? 0) < (this.cost ?? 0) * 4) return;
    if (this.stale || (this.req.on && Date.now() - (this.listedAt ?? 0) > THERE_EVERY)) { this.stale = false; this.lists(cx); }
  }

  // The files of what is shown, in one list or two.
  lists(cx) {
    // One at a time: asked again meanwhile, it starts over when this one ends.
    if (this.listing) { this.relist = true; return; }
    const req = this.req, s = req.source;
    this.listing = true; this.listedAt = Date.now();
    cx.spawn(async (cx) => {
      try { await this.read(cx, req, s); }
      catch (e) { if (this.req === req) this.error = String(e?.message ?? e); }
      this.cost = Date.now() - this.listedAt;
      // Whatever happened above, the next one can start: a request for another commit ends
      // this one early, and must not leave the pane waiting for ever.
      this.listing = false;
      if (this.relist) { this.relist = false; this.lists(cx); }
      cx.notify();
    });
  }

  async read(cx, req, s) {
    const files = async (label, id, args) => {
      const [names, stats] = await Promise.all([this.gitOf(req, [...DIFF, "--name-status", "-z", ...args]), this.gitOf(req, [...DIFF, "--numstat", "-z", ...args])]);
      if (names.code !== 0) throw new Error(names.stderr.trim() || "git diff failed");
      const counts = diff.parseNumstat(stats.stdout);
      // Only what `--numstat` lists too: without refreshing the index (which a read must not
      // do), `--name-status` also names files that were only touched.
      return { id, label, files: diff.parseNameStatus(names.stdout).filter((f) => counts[f.path] || f.mark === "U").map((f) => ({ ...f, mark: f.mark === "U" ? "!" : f.mark, ...(counts[f.path] ?? {}) })) };
    };
    let groups, from = null, range = null, head = null;
    if (s.kind === "work") {
      const [staged, unstaged, fresh, branch, tip] = await Promise.all([
        files("Staged", "staged", ["--cached"]), files("Not staged", "unstaged", []),
        this.gitOf(req, ["ls-files", "--others", "--exclude-standard", "-z"]),
        this.gitOf(req, ["symbolic-ref", "-q", "HEAD"]),
        this.gitOf(req, ["rev-parse", "-q", "--verify", "HEAD"]),
      ]);
      head = { branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : null,
        refs: [["HEAD", tip.code === 0 ? tip.stdout.trim() : null]] };
      for (const path of fresh.stdout.split("\0").filter(Boolean)) unstaged.files.push({ path, mark: "U" });
      if (!staged.files.length) unstaged.label = "Changes";
      groups = [staged, unstaged];
    } else if (s.kind === "branch") {
      const git = (args) => this.gitOf(req, args);
      range = await review.range(git, s, shared(review.storeKey(req))?.checkpoint ?? null, this.scope);
      from = range.from;
      const args = [from, range.tip, "--"];
      const [raw, stats, full] = await Promise.all([
        git([...DIFF, "--raw", "--no-abbrev", "-z", ...args]), git([...DIFF, "--numstat", "-z", ...args]),
        range.incremental ? git([...DIFF, "--raw", "--no-abbrev", "-z", range.fork, range.tip, "--"]) : null,
      ]);
      if (raw.code || stats.code || full?.code) throw new Error(raw.stderr.trim() || stats.stderr.trim() || full?.stderr.trim() || "Could not compare the branch.");
      const fullFiles = full ? review.rawFiles(full.stdout) : null;
      const counts = diff.parseNumstat(stats.stdout);
      groups = [{ id: "files", label: "Files", files: [...review.rawFiles(raw.stdout)].map(([path, info]) => ({ path, ...info, full: fullFiles?.get(path), ...counts[path] })) }];
    } else {
      from = s.kind === "stash" ? `${s.sha}^1` : s.parent;
      // A first commit is compared with nothing: git's empty tree.
      if (!from) from = (await this.gitOf(req, ["hash-object", "-t", "tree", "/dev/null"])).stdout.trim();
      groups = [await files("Files", "files", [from, s.sha])];
      if (s.kind === "stash") {
        // The files git didn't have yet are in a commit of their own, when there were any.
        const extra = await this.gitOf(req, ["rev-parse", "-q", "--verify", `${s.sha}^3`]);
        if (extra.code === 0) {
          const list = await this.gitOf(req, ["ls-tree", "-r", "-z", "--name-only", `${s.sha}^3`]);
          groups.push({ id: "untracked", label: "Untracked", files: list.stdout.split("\0").filter(Boolean).map((path) => ({ path, mark: "U" })) });
        }
      }
    }
    if (this.req !== req) return;
    this.from = from; this.range = range; this.workHead = head;
    groups = groups.filter((g) => g.files.length);
    this.groups = groups; this.error = null; this.loaded = true;
    this.prune();
    // The file asked for, else the one shown, else the first.
    const all = this.all(), want = this.want;
    this.want = null;
    const found = (w) => (w?.path ? all.find((f) => f.path === w.path && (!w.group || f.group === w.group)) ?? all.find((f) => f.path === w.path) : null);
    const next = found(want) ?? found(this.cur) ?? all[0] ?? null;
    if (!next) { this.cur = null; this.doc = null; return; }
    const other = !this.cur || next.path !== this.cur.path || next.group !== this.cur.group;
    if (other) { this.whole = false; this.cur = { group: next.group, path: next.path }; }
    // A commit's file never changes; an uncommitted one is read again every time, since the
    // same line can be edited twice and the list would look the same.
    if (other || !this.doc || s.kind === "work") await this.open(cx, other);
  }

  // Every file, in the order drawn, each with its group.
  all() {
    return this.groups.flatMap((g) => g.files.map((f) => ({ ...f, group: g.id })));
  }

  file() {
    return this.cur ? this.all().find((f) => f.path === this.cur.path && f.group === this.cur.group) ?? null : null;
  }

  // Reads the diff of the file shown. `fresh`: another file than before, so from its top.
  async open(cx, fresh) {
    const req = this.req, s = req.source, cur = this.cur, f = this.file(), from = this.from;
    if (!f) return;
    const turn = this.opening = (this.opening ?? 0) + 1;
    const whole = this.whole, expect = this.workHead;
    const editable = s.kind === "work" && !whole && f.mark !== "U" && f.mark !== "!";
    let parsed, raw;
    try {
      if (s.kind === "work" && f.mark === "U") {
        raw = await readTextFile(`${req.root}/${f.path}`, { on: req.on });
        parsed = raw === null ? { note: "This file can't be shown (too large, or gone)" } : raw.includes("\0") ? { binary: true, hunks: [] } : diff.added(raw);
      } else if (cur.group === "untracked") {
        const r = await this.gitOf(req, ["show", `${s.sha}^3:${f.path}`]);
        raw = r.stdout;
        parsed = r.code !== 0 ? { note: "This file can't be read" } : raw.includes("\0") ? { binary: true, hunks: [] } : diff.added(raw);
      } else {
        const range = s.kind === "work" ? (cur.group === "staged" ? ["--cached"] : []) : [from, this.range?.tip ?? s.sha];
        const r = await this.gitOf(req, patchArgs(range, whole ? WHOLE : CONTEXT, f.path));
        if (r.code !== 0) throw new Error(r.stderr.trim() || "git diff failed");
        raw = r.stdout;
        parsed = diff.parse(raw, s.kind === "branch", editable);
        if (parsed.conflict) parsed = { note: "This file is in conflict: open it in the editor to resolve it" };
      }
    } catch (e) {
      parsed = { note: `This diff can't be shown: ${String(e?.message ?? e)}` };
    }
    if (this.req !== req || this.cur !== cur || this.opening !== turn || this.whole !== whole) return;
    // `sum` is of what changed, the same with three lines around it or the whole file: a
    // tick is kept with it. `raw` is of everything read: the rows are made again when it moves.
    const sum = diff.changes(parsed), text = diff.hash(raw ?? "");
    // A file marked as viewed that changed since is to be looked at again.
    const key = this.key(f), seen = this.viewed[key];
    if (seen && s.kind === "work" && seen.h !== sum) { delete this.viewed[key]; this.keep(); }
    const state = JSON.stringify(expect);
    if (this.doc && !fresh && this.doc.text === text && this.doc.whole === whole && this.doc.state === state) return;
    const hunks = parsed.hunks ?? [];
    const doc = { sum, text, whole, state, binary: Boolean(parsed.binary), cut: Boolean(parsed.cut), note: parsed.note ?? null,
      hunks, oldBlob: parsed.oldBlob, expanded: new Map(), baseWidth: diff.widest({ hunks }), styles: new Map(),
      oneSided: f.mark === "A" || f.mark === "D" || f.mark === "U",
      grammar: syntax.language(f.path), colorLeft: COLOR_CHARS };
    const patches = editable ? hunks.map((_, i) => diff.hunkPatch(parsed, i)) : [];
    if (expect && patches.some(Boolean)) doc.stage = { patches, raw, expect, staged: cur.group === "staged" };
    this.buildRows(doc);
    // Which words changed, for the lines that replaced others: worked out here, not while
    // drawing, and only as far as the budget goes. Past it a changed line is all one color.
    this.styleRows(doc);
    if (s.kind === "branch") doc.anchors = review.anchors({ hunks });
    this.doc = doc;
    if (fresh) this.scroll.scroll_to_item(0, "top");
  }

  buildRows(doc) {
    doc.unified = diff.unified(doc, doc.expanded);
    doc.split = diff.split(doc, doc.expanded);
    doc.widest = doc.baseWidth;
    for (const lines of doc.expanded.values()) {
      for (const line of lines) doc.widest = Math.max(doc.widest, line.length);
    }
  }

  styleRows(doc) {
    let spent = 0;
    for (const row of doc.unified) {
      if (typeof row.text !== "string" || doc.styles.has(lineKey(row))) continue;
      let marks = null, colors = [];
      if (row.pair != null) {
        spent += Math.min(row.text.length, 600) * Math.min(row.pair.length, 600);
        if (spent <= WORDS) marks = diff.words(row.text, row.pair);
      }
      if (doc.grammar && row.text.length <= 400 && row.text.length <= doc.colorLeft) {
        doc.colorLeft -= row.text.length;
        colors = syntax.spans(row.text, doc.grammar);
      }
      doc.styles.set(lineKey(row), syntax.colorPieces(row.text, marks, colors));
    }
  }

  expand(doc, row, cx) {
    if (this.doc !== doc || !doc.oldBlob || this.gapBusy) return;
    this.actionError = null;
    const rebuild = () => {
      this.buildRows(doc);
      this.styleRows(doc);
      const rows = this.layout() === "split" ? doc.split : doc.unified;
      const index = rows.findIndex((item) => item.kind === "gap" && item.hunk === row.hunk);
      if (index >= 0) this.scroll.scroll_to_item(index);
      cx.notify();
    };
    if (row.action === "hide") { doc.expanded.delete(row.hunk); rebuild(); return; }
    const visible = doc.expanded.get(row.hunk) ?? [];
    const used = [...doc.expanded.values()].reduce((total, lines) => total + lines.length, 0);
    const count = Math.min(row.count - visible.length, GAP_LINES, EXPANDED_LINES - used);
    if (count <= 0) { this.actionError = "Collapse an expanded gap to show more context."; cx.notify(); return; }
    const last = row.old + row.count - visible.length - 1, first = last - count + 1, req = this.req;
    this.gapBusy = { doc, hunk: row.hunk };
    cx.spawn(async (cx) => {
      try {
        const result = await exec("sh", ["-c", READ_CONTEXT, "git-diff-context", doc.oldBlob, String(first), String(last)], { cwd: req.root, on: req.on });
        const lines = result.stdout.replace(/\n$/, "").split("\n");
        if (result.code !== 0 || lines.length !== count) throw new Error("Could not read the unchanged lines from Git.");
        if (this.doc !== doc || this.req !== req) return;
        doc.expanded.set(row.hunk, [...lines.map((line) => diff.showLine(line.replace(/\r$/, ""))), ...visible]);
        rebuild();
      } catch (e) {
        if (this.doc === doc && this.req === req) this.actionError = String(e?.message ?? e);
      } finally {
        this.gapBusy = null;
        cx.notify();
      }
    });
  }

  stageHunk(doc, index, cx) {
    const req = this.req, cur = this.cur, stage = doc.stage, patch = stage?.patches[index];
    if (this.doc !== doc || this.whole || req?.source.kind !== "work" || !patch || this.hunkBusy) return;
    const key = JSON.stringify([req.on, req.root]);
    if (staging.has(key)) { this.actionError = "A hunk is already being staged in this checkout."; cx.notify(); return; }
    const staged = cur.group === "staged";
    const git = (args) => this.gitOf(req, args);
    this.actionError = null;
    this.hunkBusy = { doc, index };
    staging.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const why = await guard(req.root, req.on, git, stage.expect);
        if (why) throw new Error(why);
        const now = await git(patchArgs(staged ? ["--cached"] : [], CONTEXT, cur.path));
        if (now.code !== 0 || now.stdout !== stage.raw) throw new Error("The file changed. Review the refreshed diff and try again.");
        const result = await exec("sh", ["-c", APPLY, "git-diff-apply", patch, ...(staged ? ["--reverse"] : [])], { cwd: req.root, on: req.on });
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Git could not apply the hunk to the index.");
        setShared(INDEX_CHANGED, { root: req.root, on: req.on, at: Date.now() });
      } catch (e) {
        if (this.req === req && this.cur === cur) this.actionError = String(e?.message ?? e);
      } finally {
        this.hunkBusy = null;
        staging.delete(key);
        if (this.req === req) this.lists(cx);
        cx.notify();
      }
    });
  }

  select(f, cx) {
    if (!f || (this.cur && this.cur.path === f.path && this.cur.group === f.group)) return;
    this.cur = { group: f.group, path: f.path }; this.whole = false; this.doc = null; this.actionError = null;
    this.remember("last", JSON.stringify({ ...this.req, path: f.path, group: f.group }));
    cx.spawn(async (cx) => { await this.open(cx, true); cx.notify(); });
  }

  step(by, cx) {
    const all = this.all(), at = all.findIndex((f) => f.path === this.cur?.path && f.group === this.cur?.group);
    if (all.length) this.select(all[(Math.max(0, at) + by + all.length) % all.length], cx);
  }

  // ---- viewed

  key(f) {
    const r = this.req;
    return `${r.on ?? ""}|${r.root}|${sourceKey(r.source)}|${f.group}|${f.path}`;
  }

  // A commit never changes; an uncommitted file is still as it was viewed while it adds and
  // removes as many lines (open() looks closer, at the text, when the file is shown).
  isViewed(f) {
    if (this.range) return this.reviewState?.viewed?.[this.reviewFileKey(f)] === f.signature;
    const v = this.viewed[this.key(f)];
    if (!v) return false;
    return this.req.source.kind !== "work" || (v.a === (f.add ?? 0) && v.d === (f.del ?? 0));
  }

  keep() {
    const keys = Object.keys(this.viewed);
    for (const k of keys.slice(0, Math.max(0, keys.length - VIEWED_MOST))) delete this.viewed[k];
    this.remember("viewed", JSON.stringify(this.viewed));
  }

  // Marks of uncommitted files that changed since go, so the list says so at once.
  prune() {
    if (this.req.source.kind !== "work") return;
    let any = false;
    for (const f of this.all()) {
      const k = this.key(f), v = this.viewed[k];
      if (v && (v.a !== (f.add ?? 0) || v.d !== (f.del ?? 0))) { delete this.viewed[k]; any = true; }
    }
    if (any) this.keep();
  }

  mark(cx) {
    const f = this.file();
    if (!f || !this.doc) return;
    if (this.range) {
      const state = shared(this.reviewKey) ?? {}, viewed = { ...state.viewed }, key = this.reviewFileKey(f);
      const had = viewed[key] === f.signature;
      if (had) delete viewed[key]; else viewed[key] = f.signature;
      if (this.range.incremental) {
        const fullKey = JSON.stringify(["full", f.path]);
        if (!had) review.markSince(viewed, f, fullKey);
        else if (viewed[fullKey] === f.full?.signature) delete viewed[fullKey];
      }
      this.updateReview({ ...state, viewed });
      if (!had) this.nextUnread(f, cx);
      return;
    }
    const k = this.key(f);
    if (this.isViewed(f)) { delete this.viewed[k]; this.keep(); return; }
    this.viewed[k] = this.req.source.kind === "work" ? { a: f.add ?? 0, d: f.del ?? 0, h: this.doc.sum } : 1;
    this.keep();
    this.nextUnread(f, cx);
  }

  nextUnread(f, cx) {
    // On to the next file not viewed yet, when there is one.
    const all = this.all(), at = all.findIndex((x) => x.path === f.path && x.group === f.group);
    const next = [...all.slice(at + 1), ...all.slice(0, at)].find((x) => !this.isViewed(x));
    if (next) this.select(next, cx);
  }

  reviewFileKey(f) {
    return JSON.stringify([this.range.incremental ? "since" : "full", f.path]);
  }

  updateReview(state) {
    this.reviewState = state;
    setShared(this.reviewKey, state);
  }

  checkpoint(cx) {
    const range = this.range, state = shared(this.reviewKey) ?? {};
    if (!range || state.checkpoint?.tip === range.tip && state.checkpoint.fork === range.fork) return;
    if (JSON.stringify(state.checkpoint ?? null) !== JSON.stringify(range.checkpoint ?? null)) {
      this.take({ ...this.req, path: this.cur?.path }, cx);
      return;
    }
    const checkpoint = { tip: range.tip, fork: range.fork };
    this.updateReview({ ...state, checkpoint });
    this.take({ ...this.req, path: this.cur?.path, scope: "full" }, cx);
  }

  reviewNotes(choices) {
    if (!this.range) return;
    const { root, on, source } = this.req, { tip, fork, from } = this.range;
    const file = this.file();
    openOverlay({ mod: MOD, kind: "dialog", width: 550, height: choices ? 215 : 400, props: {
      reviewNotes: { key: this.reviewKey, root, on, source, tip, fork, from,
        ...(choices ? { choices, path: file.path, signature: file.signature } : {}) },
    } });
  }

  noteLine(row, split) {
    if (!this.range || !row || !this.doc?.anchors) return;
    const { anchors } = this.doc, choices = [];
    if (split) {
      if (row.left?.kind === "-") choices.push(anchors.get("old" + row.left.n));
      if (row.right?.kind === "+") choices.push(anchors.get("new" + row.right.n));
    } else if (row.kind === "-") choices.push(anchors.get("old" + row.old));
    else if (row.kind === "+") choices.push(anchors.get("new" + row.next));
    const usable = choices.filter(Boolean);
    if (usable.length) this.reviewNotes(usable);
  }

  // ---- commands

  // Side by side when the pane is wide and the longest line fits in half of it, unless told.
  layout() {
    if (this.mode !== "auto") return this.mode;
    const room = this.width() - (this.narrow() ? 0 : LIST);
    return room >= WIDE && this.doc && !this.doc.oneSided && (this.doc.widest + 1) * CHAR + NUMBER + 12 <= room / 2 ? "split" : "unified";
  }

  // The pane's width in its own pixels: the size comes in the window's, which at a zoom are
  // more of them.
  width() { return (this.size?.width ?? 0) / (Number(settings()?.zoom) || 1); }

  narrow() { return this.size ? this.width() < NARROW : false; }

  command(name, cx) {
    if (name === "review-refresh" || name === "review-scope") {
      if (!this.reviewKey) return;
      const scope = name === "review-refresh" ? "auto" : this.range?.incremental ? "full" : "since";
      this.take({ ...this.req, path: this.cur?.path, scope }, cx);
    } else if (name === "checkpoint" && this.range) this.checkpoint(cx);
    else if (name === "review-notes") this.reviewNotes();
    else if (name === "next") this.step(1, cx);
    else if (name === "prev") this.step(-1, cx);
    else if (name === "viewed") this.mark(cx);
    else if (name === "files") this.pickFile();
    else if (["mode", "unified", "split", "auto"].includes(name)) {
      this.mode = name === "mode" ? (this.layout() === "split" ? "unified" : "split") : name;
      this.remember("mode", this.mode);
    } else if (name === "whole") {
      if (!this.cur) return;
      this.whole = !this.whole;
      cx.spawn(async (cx) => { await this.open(cx, false); cx.notify(); });
    } else if (name === "edit") this.edit();
  }

  pickFile() {
    const files = this.groups.flatMap((g) => g.files.map((f) => ({ path: f.path, group: g.id, label: g.id === "files" ? "" : g.label })));
    if (!files.length) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.fileChoice = { id, req: this.req };
    openOverlay({ mod: MOD, kind: "dialog", width: 500, height: 386, props: {
      filePicker: { id, files, current: this.cur },
    } });
  }

  filePicked(cx) {
    const choice = this.fileChoice, result = choice && shared(FILE_PICK);
    if (!result || result.target !== choice.id) return;
    this.fileChoice = null;
    cx.spawn(async (cx) => {
      await null;
      if (shared(FILE_PICK)?.target === choice.id) setShared(FILE_PICK, null);
      if (choice.req === this.req) this.select(this.all().find((file) => file.path === result.path && file.group === result.group), cx);
      cx.notify();
    });
  }

  // The file as it is now, in the tab's editor, at the first line that changed.
  edit() {
    const f = this.file(), r = this.req;
    if (!f || !this.tab) return;
    const here = panes().filter((p) => p.tab === this.tab), editor = here.find((p) => p.mod === EDITOR);
    const me = here.find((p) => p.mod === MOD) ?? here[0];
    if (!editor && !me) return;
    const first = this.doc?.unified.find((row) => row.kind === "+" || row.kind === "-");
    const line = first?.next ?? null;
    setShared(`${EDITOR}.open`, { tab: this.tab, path: `${r.root}/${f.path}`, on: r.on ?? null, at: Date.now(), ...(line && r.source.kind === "work" ? { select: { line, start: 0, end: 0 } } : {}) });
    if (editor) run("pane.focus", { pane: editor.pane });
    else run("pane.split", { pane: me.pane, direction: "down", mod: EDITOR, props: { tab: this.tab } });
  }

  // Names the pane TITLE, once, when it has no name: a name someone gave it stays. From render(),
  // so a step later (a command is not run inside the draw).
  title(cx) {
    if (this.titled || !this.tab || checking()) return;
    const me = panes().find((p) => p.mod === MOD && p.tab === this.tab);
    if (!me) return;
    this.titled = true;
    if (!me.name) cx.spawn(async () => { await null; run("pane.rename", { pane: me.pane, name: TITLE }); });
  }

  // What the Git panel left in shared state, for this tab's pane.
  requests(cx) {
    const o = shared(OPEN);
    if (!o || o.tab !== this.tab || o.at === this.seen || typeof o.root !== "string" || !o.source) return;
    this.seen = o.at;
    cx.spawn(async (cx) => {
      await null;
      if (shared(OPEN)?.at === o.at) setShared(OPEN, null);
      if (Date.now() - o.at < FRESH) this.take(o, cx);
      cx.notify();
    });
  }

  // The pane became the focused one: Herdr gives a mod pane no keyboard by that, so it is
  // taken here, a moment later.
  arrived(cx) {
    const me = panes().find((p) => p.mod === MOD && p.tab === this.tab);
    const now = Boolean(me?.focused);
    if (now && !this.wasFocused) cx.timer.after(60, () => this.handle.focus());
    this.wasFocused = now;
  }

  // ---- drawing

  button(t, id, icon, tip, name, o = {}) {
    return h_flex().id(id).flex_none().h(24).px(o.label ? 7 : 5).gap(4).items_center().rounded(6).text_size(11).tooltip(tip).cursor_pointer()
      .text_color(o.on ? t.foreground : t.muted).when(Boolean(o.on), (e) => e.bg(t.selected))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); this.command(name, cx); if (name !== "review-notes") this.handle.focus(); cx.notify(); })
      .when(Boolean(icon), (e) => e.child(svg(icon).size(13).flex_none()))
      .when(Boolean(o.label), (e) => e.child(div().child(o.label)));
  }

  head(t) {
    const s = this.req?.source, all = this.all(), seen = all.filter((f) => this.isViewed(f)).length;
    const title = !s ? "Diff" : s.kind === "work" ? "Uncommitted changes" : s.kind === "branch" ? review.branchName(s.branch) : s.title || s.sha.slice(0, 7);
    const sub = !s ? "" : s.kind === "work" ? base(this.req.root) : s.kind === "branch" ? "against " + review.branchName(s.base) : s.sub ?? "";
    const side = this.layout() === "split", compact = this.width() < 490;
    return h_flex().flex_none().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().max_w("55%").truncate().font_semibold().child(title))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(sub))
      .when(all.length > 0, (e) => e
        .when(!compact, (x) => x.child(div().flex_none().text_size(11).text_color(seen === all.length ? t.ansi2 : t.dim).child(`${seen} / ${all.length} viewed`)))
        .child(compact
          ? this.button(t, "gd-mode", ICON(side ? "split" : "unified"), "Switch diff layout (S)", "mode", { label: side ? "Split" : "Unified", on: true })
          : h_flex().flex_none().rounded(7).gap(1).p(2).bg(t.raised)
            .child(this.button(t, "gd-unified", ICON("unified"), "Show one column (S)", "unified", { label: "Unified", on: !side }))
            .child(this.button(t, "gd-split", ICON("split"), "Show side by side (S)", "split", { label: "Split", on: side }))
            .when(this.mode !== "auto", (x) => x.child(this.button(t, "gd-auto", null, "Choose the layout to fit the pane", "auto", { label: "Auto" }))))
        .child(this.button(t, "gd-whole", compact ? null : ICON("whole"), this.whole ? "Show changes only (W)" : "Show the whole file (W)", "whole", { label: "Whole file", on: this.whole })));
  }

  reviewBar(t) {
    const r = this.range, state = this.reviewState ?? {}, count = (state.notes ?? []).length;
    const marked = r && state.checkpoint?.tip === r.tip && state.checkpoint.fork === r.fork;
    return v_flex().flex_none().px(8).py(4).gap(3).border_b(1).border_color(t.border)
      .child(h_flex().flex_wrap().items_center().gap(4)
        .child(this.button(t, "gd-refresh-review", null, "Read both branch tips again", "review-refresh", { label: "Refresh" }))
        .when(Boolean(r?.since), (e) => e.child(this.button(t, "gd-scope", null, "Switch the comparison range", "review-scope",
          { label: r.incremental ? "Show whole branch" : "Since my last review" })))
        .when(Boolean(r && !marked), (e) =>
          e.child(this.button(t, "gd-checkpoint", null, "Remember the displayed branch tip", "checkpoint", { label: "Mark this revision reviewed" })))
        .when(Boolean(r), (e) => e.child(this.button(t, "gd-notes", null, "Read and copy saved feedback. Click a changed line to add a note.", "review-notes",
          { label: count ? "Notes (" + count + ")" : "Notes" }))))
      .when(Boolean(r), (e) => e.child(div().text_size(11).text_color(t.dim)
        .child((r.incremental ? "Since your review" : "Whole branch") + " · " + r.from.slice(0, 7) + " → " + r.tip.slice(0, 7) + (r.notice ? " · " + r.notice : ""))));
  }

  list(t) {
    const out = [];
    let n = 0;
    for (const g of this.groups) {
      if (this.groups.length > 1 || g.id !== "files") out.push(div().h(24).flex_none().px(8).flex().items_center().text_size(11).text_color(t.dim).child(`${g.label.toUpperCase()} · ${g.files.length}`));
      for (const f of g.files) {
        if (++n > FILES) break;
        const file = { ...f, group: g.id }, on = this.cur?.path === f.path && this.cur?.group === g.id, viewed = this.isViewed(file);
        out.push(h_flex().id(`gd-f-${g.id}-${n}`).h(25).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer().tooltip(f.path)
          .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.select(file, cx); this.handle.focus(); cx.notify(); })
          .child(viewed ? svg(CHROME("check")).size(11).flex_none().text_color(t.ansi2) : div().w(11).flex_none())
          .child(div().w(10).flex_none().text_size(11).text_color(markColor(t, f.mark)).child(f.mark))
          .child(div().flex_none().max_w(150).truncate().text_color(viewed ? t.muted : t.foreground).child(base(f.path)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parent(f.path)))
          .child(this.counts(t, f)));
      }
    }
    if (n > FILES) out.push(div().px(8).h(22).text_size(11).text_color(t.dim).child(`and ${n - FILES} more`));
    return div().w(LIST).flex_none().h_full().relative().border_r(1).border_color(t.border)
      .child(v_flex().id("gd-files").absolute().inset_0().overflow_y_scroll().p(6).children(out))
      .child(Scrollbar.vertical("gd-files").absolute().inset_0());
  }

  counts(t, file) {
    return h_flex().flex_none().gap(4).items_center().text_size(11)
      .when(file.add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${file.add}`)))
      .when(file.del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${file.del}`)));
  }

  // The bar over a file's diff: which file, how much changed, and what can be done with it.
  bar(t) {
    const f = this.file(), all = this.all();
    if (!f) return div();
    const at = all.findIndex((x) => x.path === f.path && x.group === f.group), viewed = this.isViewed(f), dir = parent(f.path);
    const narrow = this.narrow(), compact = this.width() < 490;
    return h_flex().flex_none().h(34).px(10).gap(7).items_center().border_b(1).border_color(t.border).bg(t.surface)
      .child(div().flex_none().text_size(11).text_color(markColor(t, f.mark)).child(f.mark))
      .child(h_flex().id("gd-current-file").flex_1().min_w(0).h(25).gap(5).items_center()
        .when(narrow, (e) => e.px(4).rounded(5).cursor_pointer().hover((x) => x.bg(t.hover))
          .tooltip(`Choose a changed file (F) · ${f.path}`).on_click(() => this.pickFile()))
        .child(div().flex_none().max_w(narrow ? "85%" : "45%").truncate().font_medium().child(base(f.path)))
        .when(!narrow, (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir)))
        .when(narrow, (e) => e.child(svg(CHROME("chevron-down")).size(10).flex_none().text_color(t.muted))))
      .child(this.counts(t, f))
      .when(all.length > 1, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`${at + 1} / ${all.length}`)))
      .when(all.length > 1 && !compact, (e) => e
        .child(this.button(t, "gd-prev", CHROME("chevron-left"), "The previous file (K)", "prev"))
        .child(this.button(t, "gd-next", CHROME("chevron-right"), "The next file (J)", "next")))
      .when(f.mark !== "D", (e) => e.child(this.button(t, "gd-edit", ICON("edit"), "Open the file in the editor (O)", "edit")))
      .child(this.button(t, "gd-viewed", CHROME("check"), viewed ? "Viewed: click to take the mark back (V)" : "Mark as viewed, and go to the next file (V)", "viewed", { label: "Viewed", on: viewed }));
  }

  // The text of one line: in pieces where words changed, so those are colored stronger.
  text(doc, line, t) {
    const strong = line.kind === "+" ? t.ansi2 + "50" : t.ansi1 + "50";
    const pieces = doc.styles.get(lineKey(line));
    if (!pieces) return div().flex_none().whitespace_nowrap().child(hard(line.text) || " ");
    return h_flex().flex_none().children(pieces.map((p) => div().flex_none().whitespace_nowrap()
      .when(Boolean(p.tone), (e) => e.text_color(t[toneColor[p.tone]]))
      .when(p.marked, (e) => e.bg(strong).rounded(2)).child(hard(p.text))));
  }

  gap(doc, row, t) {
    const hide = row.action === "hide", remaining = row.count - row.showing;
    const count = hide ? row.showing : Math.min(remaining, GAP_LINES);
    const words = `${count}${!hide && count < remaining ? ` of ${remaining}` : ""} unchanged line${count === 1 ? "" : "s"}`;
    const reading = !hide && this.gapBusy?.doc === doc && this.gapBusy.hunk === row.hunk;
    return h_flex().w_full().h(ROW).flex_none().px(10).gap(5).items_center().bg(t.surface)
      .font_family(".SystemUIFont").text_size(11).text_color(doc.oldBlob ? t.accent : t.dim)
      .when(Boolean(doc.oldBlob), (e) => e.cursor_pointer())
      .child(div().flex_none().child(hide ? "▴" : "▾"))
      .child(div().min_w(0).truncate().child(doc.oldBlob ? (reading ? "Reading context…" : `${hide ? "Hide" : "Show"} ${words}`) : words));
  }

  hunk(doc, row, t) {
    const action = doc.stage?.patches[row.hunk];
    const busy = this.hunkBusy?.doc === doc && this.hunkBusy.index === row.hunk;
    return h_flex().w_full().h(ROW).flex_none().px(10).gap(8).items_center().bg(t.raised).border_t(1).border_color(t.border)
      .text_size(11).when(Boolean(action && !this.hunkBusy), (e) => e.cursor_pointer())
      .when(Boolean(action), (e) => e.child(div().flex_none().px(7).rounded(4).bg(t.surface).font_family(".SystemUIFont")
        .text_color(busy ? t.muted : t.foreground).child(busy ? "Updating index…" : doc.stage.staged ? "Unstage hunk" : "Stage hunk")))
      .child(div().flex_none().text_color(t.dim).child(`@@ ${row.old} → ${row.next}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(hard(row.note || "")));
  }

  tint(kind, t) { return kind === "+" ? t.ansi2 + "1c" : kind === "-" ? t.ansi1 + "1c" : null; }

  number(n, t) {
    return div().w(NUMBER).flex_none().pr(8).text_right().text_color(t.dim).child(n === undefined || n === null ? "" : String(n));
  }

  unifiedRow(doc, row, t) {
    if (row.kind === "gap") return this.gap(doc, row, t);
    if (row.kind === "hunk") return this.hunk(doc, row, t);
    const bg = this.tint(row.kind, t);
    return h_flex().w_full().h(ROW).flex_none().items_center().when(Boolean(bg), (e) => e.bg(bg))
      .child(this.number(row.old, t)).child(this.number(row.next, t))
      .child(div().w(SIGN).flex_none().text_color(row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.dim).child(row.kind === " " ? "" : row.kind === "-" ? "−" : "+"))
      .child(this.text(doc, row, t));
  }

  splitRow(doc, row, t) {
    if (row.kind === "gap") return this.gap(doc, row, t);
    if (row.kind === "hunk") return this.hunk(doc, row, t);
    const half = (side) => {
      const el = h_flex().flex_1().flex_basis(0).min_w(0).h_full().overflow_hidden().items_center();
      if (!side) return el.bg(t.raised + "70");
      const bg = this.tint(side.kind, t);
      return el.when(Boolean(bg), (e) => e.bg(bg)).child(this.number(side.n, t)).child(this.text(doc, side, t));
    };
    return h_flex().w_full().h(ROW).flex_none().child(half(row.left)).child(div().w(1).h_full().flex_none().bg(t.border)).child(half(row.right));
  }

  table(t) {
    const doc = this.doc, f = this.file();
    const say = (text) => div().p(16).text_color(t.dim).child(text);
    if (!doc) return say(this.error ?? (!this.req ? "Click a file in the Git panel to see its diff here" : this.cur || !this.loaded ? "Reading…" : "Nothing changed here"));
    if (doc.note) return say(doc.note);
    if (doc.binary) return say("A binary file: there are no lines to compare");
    const side = this.layout() === "split", rows = side ? doc.split : doc.unified;
    if (!rows.length) return say(f?.mark === "D" ? "The file was deleted, and it was empty" : "No lines changed (only the file's mode, or it is empty)");
    const width = side ? 0 : NUMBER * 2 + SIGN + (doc.widest + 2) * CHAR;
    const lines = v_virtual_list("gd-rows", rows.length, ROW, (i) => String(i), (range) => {
      const out = [];
      for (let i = range.start; i < range.end; i++) out.push(side ? this.splitRow(doc, rows[i], t) : this.unifiedRow(doc, rows[i], t));
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((key, cx) => {
        if (doc !== this.doc) return;
        const row = rows[Number(key)];
        if (row?.kind === "gap") this.expand(doc, row, cx);
        else if (row?.kind === "hunk") this.stageHunk(doc, row.hunk, cx);
        else this.noteLine(row, side);
      });
    return div().size_full().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(SIZE)
      .child(side ? lines : div().id("gd-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(width).h_full().child(lines)))
      .child(Scrollbar.vertical("gd-rows").viewport_from_layout().absolute().inset_0())
      .when(doc.cut, (e) => e.child(div().absolute().bottom(8).right(16).px(8).py(3).rounded(6).bg(t.raised).text_size(11).text_color(t.muted).child(`Only the first ${diff.MOST} lines are shown`)));
  }

  render(cx) {
    if (this.picker) return this.picker.render(cx);
    if (this.notes) return this.notes.render(cx);
    this.reviewState = this.reviewKey ? shared(this.reviewKey) : null;
    fit();
    this.title(cx);
    for (const [name, value] of Object.entries(this.pending)) localStorage.setItem(name, value);
    this.pending = {};
    this.requests(cx);
    this.filePicked(cx);
    this.arrived(cx);
    const t = theme();
    return v_flex().id("git-diff").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      // The mouse's side buttons: back to the file before, forward to the next one.
      .on_mouse_down("back", (_e, cx) => { this.command("prev", cx); cx.notify(); })
      .on_mouse_down("forward", (_e, cx) => { this.command("next", cx); cx.notify(); })
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (m.control || m.alt || m.platform) return;
        const name = { j: "next", down: "next", k: "prev", up: "prev", v: "viewed", s: "mode", w: "whole", o: "edit", f: "files" }[e.key];
        if (!name) return;
        this.command(name, cx);
        cx.stop_propagation();
        cx.notify();
      })
      .child(this.head(t))
      .when(Boolean(this.reviewKey), (e) => e.child(this.reviewBar(t)))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(!this.narrow() && this.groups.length > 0, (e) => e.child(this.list(t)))
        .child(v_flex().flex_1().min_w(0).min_h(0)
          .child(this.bar(t))
          .when(Boolean(this.actionError), (e) => e.child(h_flex().flex_none().px(10).py(5).gap(6).items_center().bg(t.surface)
            .child(div().flex_1().min_w(0).text_size(11).text_color(t.ansi1).child(this.actionError))
            .child(div().id("gd-dismiss-error").cursor_pointer().text_color(t.muted).tooltip("Dismiss")
              .on_click((_e, cx) => { this.actionError = null; cx.notify(); }).child("×"))))
          .child(div().flex_1().min_h(0).child(this.table(t)))));
  }
}
