// The diff pane: what the Git panel's selection changed, file by file, beside the terminals.
// One a tab (props { tab }). What it shows is asked for through shared `git-diff.open`:
//   { tab, root, on, source, path, group, at }
// `source` is { kind: "work" } (what is not committed), { kind: "commit", sha, parent, title,
// sub } or { kind: "stash", sha, title, sub }. `path` is the file to show first, and `group`
// which list it is in when there are two: "staged" or "unstaged", "untracked" in a stash.
//
//   take()      a request: reads the lists of files (lists(), read()) and shows one (open())
//   open()      reads one file's diff and makes its rows (diff.js)
//   table()     draws them, side by side or one under the other
//   mark()      a file as viewed; a mark goes when the file changes again
//
// It only reads. Nothing here changes the repository.
//
// Keys, while the pane has the keyboard: J/K or ↓/↑ the next and the previous file, V viewed
// (and on to the next one not viewed), S side by side or not, W the whole file, O the editor.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, run, shared, setShared, nextCommand, checking } from "herdr";
import * as diff from "./diff.js";

const MOD = "git-diff";
const OPEN = `${MOD}.open`;
const EDITOR = "file-editor";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
// A read writes nothing under .git: the pane watches that folder. And a path is that file and
// no other: without `--literal-pathspecs` git reads `*`, `[` and a first `:` as a pattern.
const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;
// The text: its size, a character's width at that size, a row's height, a line number's room.
const SIZE = 12, CHAR = 7.23, ROW = 20, NUMBER = 44, SIGN = 16;
// The list of files: its width, the most files drawn, and the pane's width under which it
// is left out.
const LIST = 250, FILES = 500, NARROW = 700;
// Side by side by itself only in a pane at least this wide.
const WIDE = 900;
// Lines around a change, and "all of them" for the whole file.
const CONTEXT = 3, WHOLE = 100000;
// How much comparing of words one file gets (the lengths of two lines, multiplied, summed).
const WORDS = 6000000;
// Uncommitted files are read again when the folder changes, at most this often, and on a
// timer on another machine, whose folder can't be watched.
const TICK = 2000, THERE_EVERY = 8000;
const VIEWED_MOST = 800;

const base = (path) => path.slice(path.lastIndexOf("/") + 1);
const parent = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const markColor = (t, mark) => (mark === "A" || mark === "U" ? t.ansi2 : mark === "D" || mark === "!" ? t.ansi1 : t.blocked);
// A space the text element can't drop at the start or the end of a piece of a line.
const hard = (text) => text.replace(/ /g, " ");
const sourceKey = (s) => (s.kind === "work" ? "work" : s.sha);

export default class GitDiff extends View {
  init(_props, cx) {
    this.tab = props()?.tab ?? null;
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
    const same = this.req && this.req.root === o.root && (this.req.on ?? null) === (o.on ?? null) && sourceKey(this.req.source) === sourceKey(o.source);
    this.req = { root: o.root, on: o.on ?? null, source: o.source };
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
    let groups, from = null;
    if (s.kind === "work") {
      const [staged, unstaged, fresh] = await Promise.all([
        files("Staged", "staged", ["--cached"]), files("Not staged", "unstaged", []),
        this.gitOf(req, ["ls-files", "--others", "--exclude-standard", "-z"]),
      ]);
      for (const path of fresh.stdout.split("\0").filter(Boolean)) unstaged.files.push({ path, mark: "U" });
      if (!staged.files.length) unstaged.label = "Changes";
      groups = [staged, unstaged];
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
    this.from = from;
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
    const context = `-U${this.whole ? WHOLE : CONTEXT}`;
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
        const range = s.kind === "work" ? (cur.group === "staged" ? ["--cached"] : []) : [from, s.sha];
        const r = await this.gitOf(req, [...DIFF, context, ...range, "--", f.path]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || "git diff failed");
        raw = r.stdout;
        parsed = diff.parse(raw);
        if (parsed.conflict) parsed = { note: "This file is in conflict: open it in the editor to resolve it" };
      }
    } catch (e) {
      parsed = { note: `This diff can't be shown: ${String(e?.message ?? e)}` };
    }
    if (this.req !== req || this.cur !== cur) return;
    // `sum` is of what changed, the same with three lines around it or the whole file: a
    // tick is kept with it. `raw` is of everything read: the rows are made again when it moves.
    const sum = diff.changes(parsed), text = diff.hash(raw ?? "");
    // A file marked as viewed that changed since is to be looked at again.
    const key = this.key(f), seen = this.viewed[key];
    if (seen && s.kind === "work" && seen.h !== sum) { delete this.viewed[key]; this.keep(); }
    if (this.doc && !fresh && this.doc.text === text && this.doc.whole === this.whole) return;
    const hunks = parsed.hunks ?? [];
    const doc = { sum, text, whole: this.whole, binary: Boolean(parsed.binary), cut: Boolean(parsed.cut), note: parsed.note ?? null,
      unified: diff.unified({ hunks }), split: diff.split({ hunks }), widest: diff.widest({ hunks }), marks: new Map() };
    // Which words changed, for the lines that replaced others: worked out here, not while
    // drawing, and only as far as the budget goes. Past it a changed line is all one color.
    let spent = 0;
    for (const row of doc.unified) {
      if (row.kind === "gap" || row.pair === null || row.pair === undefined) continue;
      spent += Math.min(row.text.length, 600) * Math.min(row.pair.length, 600);
      if (spent > WORDS) break;
      const id = `${row.text}\0${row.pair}`;
      if (!doc.marks.has(id)) doc.marks.set(id, diff.pieces(row.text, diff.words(row.text, row.pair)));
    }
    this.doc = doc;
    if (fresh) this.scroll.scroll_to_item(0, "top");
  }

  select(f, cx) {
    if (!f || (this.cur && this.cur.path === f.path && this.cur.group === f.group)) return;
    this.cur = { group: f.group, path: f.path }; this.whole = false; this.doc = null;
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
    const k = this.key(f);
    if (this.isViewed(f)) { delete this.viewed[k]; this.keep(); return; }
    this.viewed[k] = this.req.source.kind === "work" ? { a: f.add ?? 0, d: f.del ?? 0, h: this.doc.sum } : 1;
    this.keep();
    // On to the next file not viewed yet, when there is one.
    const all = this.all(), at = all.findIndex((x) => x.path === f.path && x.group === f.group);
    const next = [...all.slice(at + 1), ...all.slice(0, at)].find((x) => !this.isViewed(x));
    if (next) this.select(next, cx);
  }

  // ---- commands

  // Side by side when the pane is wide and the longest line fits in half of it, unless told.
  layout() {
    if (this.mode !== "auto") return this.mode;
    const room = this.width() - (this.narrow() ? 0 : LIST);
    return room >= WIDE && this.doc && (this.doc.widest + 1) * CHAR + NUMBER + 12 <= room / 2 ? "split" : "unified";
  }

  // The pane's width in its own pixels: the size comes in the window's, which at a zoom are
  // more of them.
  width() { return (this.size?.width ?? 0) / (Number(settings()?.zoom) || 1); }

  narrow() { return this.size ? this.width() < NARROW : false; }

  command(name, cx) {
    if (name === "next") this.step(1, cx);
    else if (name === "prev") this.step(-1, cx);
    else if (name === "viewed") this.mark(cx);
    else if (name === "mode") {
      this.mode = this.layout() === "split" ? "unified" : "split";
      this.remember("mode", this.mode);
    } else if (name === "whole") {
      if (!this.cur) return;
      this.whole = !this.whole;
      cx.spawn(async (cx) => { await this.open(cx, false); cx.notify(); });
    } else if (name === "edit") this.edit();
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
      .on_click((_e, cx) => { cx.stop_propagation(); this.command(name, cx); this.handle.focus(); cx.notify(); })
      .when(Boolean(icon), (e) => e.child(svg(icon).size(13).flex_none()))
      .when(Boolean(o.label), (e) => e.child(div().child(o.label)));
  }

  head(t) {
    const s = this.req?.source, all = this.all(), seen = all.filter((f) => this.isViewed(f)).length;
    const title = !s ? "Diff" : s.kind === "work" ? "Uncommitted changes" : s.title || s.sha.slice(0, 7);
    const sub = !s ? "" : s.kind === "work" ? base(this.req.root) : s.sub ?? "";
    const side = this.layout() === "split";
    return h_flex().flex_none().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().max_w("55%").truncate().font_semibold().child(title))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(sub))
      .when(all.length > 0, (e) => e
        .child(div().flex_none().text_size(11).text_color(seen === all.length ? t.ansi2 : t.dim).child(`${seen} / ${all.length} viewed`))
        .child(this.button(t, "gd-mode", ICON(side ? "split" : "unified"), side ? "Side by side: click for one column (S)" : "One column: click for side by side (S)", "mode"))
        .child(this.button(t, "gd-whole", ICON("whole"), this.whole ? "The whole file: click for the changes only (W)" : "Show the whole file (W)", "whole", { on: this.whole })));
  }

  list(t) {
    const out = [];
    let n = 0;
    for (const g of this.groups) {
      if (this.groups.length > 1 || g.id !== "files") out.push(div().h(24).flex_none().px(8).flex().items_center().text_size(11).text_color(t.dim).child(`${g.label.toUpperCase()} · ${g.files.length}`));
      for (const f of g.files) {
        if (++n > FILES) break;
        const file = { ...f, group: g.id }, on = this.cur?.path === f.path && this.cur?.group === g.id, viewed = this.isViewed(file);
        out.push(h_flex().id(`gd-f-${g.id}-${n}`).h(25).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer()
          .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.select(file, cx); this.handle.focus(); cx.notify(); })
          .child(viewed ? svg(CHROME("check")).size(11).flex_none().text_color(t.ansi2) : div().w(11).flex_none())
          .child(div().w(10).flex_none().text_size(11).text_color(markColor(t, f.mark)).child(f.mark))
          .child(div().flex_none().max_w(150).truncate().text_color(viewed ? t.muted : t.foreground).child(base(f.path)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parent(f.path))));
      }
    }
    if (n > FILES) out.push(div().px(8).h(22).text_size(11).text_color(t.dim).child(`and ${n - FILES} more`));
    return div().w(LIST).flex_none().h_full().relative().border_r(1).border_color(t.border)
      .child(v_flex().id("gd-files").absolute().inset_0().overflow_y_scroll().p(6).children(out))
      .child(Scrollbar.vertical("gd-files").absolute().inset_0());
  }

  // The bar over a file's diff: which file, how much changed, and what can be done with it.
  bar(t) {
    const f = this.file(), all = this.all();
    if (!f) return div();
    const at = all.findIndex((x) => x.path === f.path && x.group === f.group), viewed = this.isViewed(f), dir = parent(f.path);
    return h_flex().flex_none().h(34).px(10).gap(7).items_center().border_b(1).border_color(t.border).bg(t.surface)
      .child(div().flex_none().text_size(11).text_color(markColor(t, f.mark)).child(f.mark))
      .child(div().flex_none().max_w("45%").truncate().font_medium().child(base(f.path)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
      .when(all.length > 1, (e) => e
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${at + 1} / ${all.length}`))
        .child(this.button(t, "gd-prev", CHROME("chevron-left"), "The previous file (K)", "prev"))
        .child(this.button(t, "gd-next", CHROME("chevron-right"), "The next file (J)", "next")))
      .when(f.mark !== "D", (e) => e.child(this.button(t, "gd-edit", ICON("edit"), "Open the file in the editor (O)", "edit")))
      .child(this.button(t, "gd-viewed", CHROME("check"), viewed ? "Viewed: click to take the mark back (V)" : "Mark as viewed, and go to the next file (V)", "viewed", { label: "Viewed", on: viewed }));
  }

  // The text of one line: in pieces where words changed, so those are colored stronger.
  text(doc, line, t) {
    const strong = line.kind === "+" ? t.ansi2 + "50" : t.ansi1 + "50";
    const pieces = line.pair !== null && line.pair !== undefined ? doc.marks.get(`${line.text}\0${line.pair}`) : null;
    if (!pieces || pieces.length < 2) return div().flex_none().whitespace_nowrap().child(hard(line.text) || " ");
    return h_flex().flex_none().children(pieces.map((p) => div().flex_none().whitespace_nowrap().when(p.marked, (e) => e.bg(strong).rounded(2)).child(hard(p.text))));
  }

  gap(row, t) {
    const words = row.count > 0 ? `${row.count} unchanged line${row.count === 1 ? "" : "s"}` : "";
    return h_flex().w_full().h(ROW).flex_none().px(12).gap(10).items_center().bg(t.raised).text_color(t.dim).whitespace_nowrap()
      .child(div().flex_none().child(words ? `⋯  ${words}` : "⋯"))
      .child(div().flex_1().min_w(0).truncate().child(hard(row.note ?? "")));
  }

  tint(kind, t) { return kind === "+" ? t.ansi2 + "1c" : kind === "-" ? t.ansi1 + "1c" : null; }

  number(n, t) {
    return div().w(NUMBER).flex_none().pr(8).text_right().text_color(t.dim).child(n === undefined || n === null ? "" : String(n));
  }

  unifiedRow(doc, row, t) {
    if (row.kind === "gap") return this.gap(row, t);
    const bg = this.tint(row.kind, t);
    return h_flex().w_full().h(ROW).flex_none().items_center().when(Boolean(bg), (e) => e.bg(bg))
      .child(this.number(row.old, t)).child(this.number(row.next, t))
      .child(div().w(SIGN).flex_none().text_color(row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.dim).child(row.kind === " " ? "" : row.kind === "-" ? "−" : "+"))
      .child(this.text(doc, row, t));
  }

  splitRow(doc, row, t) {
    if (row.kind === "gap") return this.gap(row, t);
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
      // A click on what is left out between two changes shows the whole file.
      .on_item_click((key, cx) => { if (rows[Number(key)]?.kind === "gap" && !this.whole) { this.command("whole", cx); cx.notify(); } });
    return div().size_full().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(SIZE)
      .child(side ? lines : div().id("gd-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(width).h_full().child(lines)))
      .child(Scrollbar.vertical("gd-rows").viewport_from_layout().absolute().inset_0())
      .when(doc.cut, (e) => e.child(div().absolute().bottom(8).right(16).px(8).py(3).rounded(6).bg(t.raised).text_size(11).text_color(t.muted).child(`Only the first ${diff.MOST} lines are shown`)));
  }

  render(cx) {
    for (const [name, value] of Object.entries(this.pending)) localStorage.setItem(name, value);
    this.pending = {};
    this.requests(cx);
    this.arrived(cx);
    const t = theme();
    return v_flex().id("git-diff").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (m.control || m.alt || m.platform) return;
        const name = { j: "next", down: "next", k: "prev", up: "prev", v: "viewed", s: "mode", w: "whole", o: "edit" }[e.key];
        if (!name) return;
        this.command(name, cx);
        cx.stop_propagation();
        cx.notify();
      })
      .child(this.head(t))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(!this.narrow() && this.groups.length > 0, (e) => e.child(this.list(t)))
        .child(v_flex().flex_1().min_w(0).min_h(0)
          .child(this.bar(t))
          .child(div().flex_1().min_h(0).child(this.table(t)))));
  }
}
