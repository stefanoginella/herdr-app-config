// Search in every file of the project, and replace: a panel beside Files and Changes.
//
// The project is the repository the focused pane is in, else its folder. ripgrep does the
// searching (search.js says what it is asked), on the project's own machine: what git ignores
// is left out unless asked for, and filters narrow it to some files. In a repository the search
// runs as the query is typed; elsewhere (a home folder is a lot to read) on Enter.
//
// A result opens in the tab's editor (the `file-editor` mod) with the match selected. Drag one
// onto a terminal to paste its path; right-click it for more (menu.js). With the replace row
// open every match shows what it becomes: replace one, a file's, or all of them. The files are
// written at once, and the last replace can be taken back from here.
//
// Others ask for a search through shared state, then run the command `project-search.open`:
//   project-search.ask  { query?, to?, folder?, on?, focus?, at }
// `to`: what to replace it with, which opens the replace row. `folder`: absolute, to search only
// there. `focus: false` leaves the keyboard where it is.
// A copy with props { keys: true, show: { stack, child, panel } } draws nothing: it sits in a
// block that is always shown, takes that command while the panel is hidden, and shows it.
// The panel's own props: { back: { stack, child } }, what its header's Files button shows, and
// { root, on }: a folder to search whatever pane has the focus.
//
// Key commands (keys.json): open, next, prev (to the next result, from anywhere), undo (the
// last replace), and for the panel's own keys: list, tab, back-tab, older, newer.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, theme, settings, props, openOverlay, notify, nextCommand, run, shared, setShared, home, checking } from "herdr";
import Menu from "./menu.js";
import Confirm from "./confirm.js";
import * as search from "./search.js";
import * as ops from "./ops.js";
import * as external from "./external-apps.js";
import * as fieldKeys from "./fieldkeys.js";

const MOD = "project-search";
// The mod that shows a file, one pane a tab, and what it reads in shared state (its header).
const EDITOR = "file-editor";
const ASK = "project-search.ask";
// Herdr's own: the panels its tab bar counts as enabled (ids of the layout's panel stack).
const PANELS = "workspace.panels";
// An ask older than this was left by a window that closed before it was taken.
const FRESH = 10000;
// How long after the last key the search runs, and the fields are put in localStorage.
const TYPE_AFTER = 150, STASH_AFTER = 800;
// How many rows are drawn at first, and with each "Show more" (or scroll to the end).
// Each row is built by the script engine in every draw (every key, every row the pointer
// crosses), and a draw is stopped at 50 ms. Under `herdr-app check`, which runs scripts slower
// than the app, 300 rows took 20 to 25 ms and 100 took 8.
const PAGE = 100;
const STORE = "state";
const HISTORY = 30;
// The most text a replace keeps to be taken back, before and after together.
const UNDO_MOST = 24000000;
// The panel may not be drawn yet when it is asked to take the keyboard: it is tried again.
const REFOCUS = [150, 450];
// How long a folder's repository is remembered.
const TOP_FOR = 60000;
const ICON = {
  right: "mods/workspace-chrome/chevron-right.svg", down: "mods/workspace-chrome/chevron-down.svg",
  x: "mods/workspace-chrome/x.svg", files: "mods/workspace-chrome/files.svg",
  replace: `mods/${MOD}/replace.svg`, all: `mods/${MOD}/replace-all.svg`, collapse: `mods/${MOD}/collapse.svg`,
  expand: `mods/${MOD}/expand.svg`, refresh: `mods/${MOD}/refresh.svg`, more: `mods/${MOD}/more.svg`,
};

const num = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
const count = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const clip = (s, most = 60) => (s.length > most ? `${s.slice(0, most)}…` : s);
// A theme color, see-through.
const tint = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color ?? "") ? color + alpha : color);
const fileKey = (path) => `\n${path}`;
const placeKey = ({ on, cwd }) => `${on ?? ""}\n${cwd ?? ""}`;

export default class ProjectSearch extends View {
  init(_props, cx) {
    const p = props();
    // Down, Tab and Shift+Tab in the fields (keys.json, `mod:project-search > Input`): see fieldkeys.js.
    fieldKeys.bind(MOD, cx);
    // Opened by itself as a popup or a dialog: a result's menu, the Replace All question.
    const Other = p?.menu ? Menu : p?.confirm ? Confirm : null;
    if (Other) {
      this.other = new Other();
      this.other.init(cx);
      return;
    }
    // The copy that only listens for the key (see the header).
    if (p?.keys) {
      this.keysOnly = true;
      cx.spawn(async () => {
        // Herdr's tab bar remembers which panel each space shows, among the ones listed in
        // its own shared state: listed there, Search is still shown on coming back to a space.
        const listed = shared(PANELS);
        if (!checking() && p.show?.child && Array.isArray(listed) && !listed.includes(p.show.child)) setShared(PANELS, [...listed, p.show.child]);
        for (;;) if ((await nextCommand()) === "open") this.summon(p.show);
      });
      return;
    }
    this.back = p?.back ?? null;
    this.fixed = typeof p?.root === "string" && p.root ? { cwd: p.root, on: p.on ?? null } : null;
    this.held = new Map(); // tab: its last focused terminal pane (see location())
    this.tops = new Map(); // a folder: its repository's top folder, and when that was read
    this.where = null; // the pane's place, as last seen
    this.ctx = null; // what is searched: { key, root, on, name, repo, auto }
    this.placing = 0;
    this.handle = cx.focus_handle(); // the list's place for the keyboard
    this.scroll = ScrollHandle.new();
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { kept = null; }
    const text = (v) => (typeof v === "string" ? v : "");
    // cs: match case. word: whole words. ignored: also what git ignores. replacing, details:
    // the replace row and the filters are open (closed, they don't count).
    this.opt = { cs: Boolean(kept?.cs), word: Boolean(kept?.word), regex: Boolean(kept?.regex), ignored: Boolean(kept?.ignored), replacing: Boolean(kept?.replacing), details: Boolean(kept?.details) };
    this.history = Array.isArray(kept?.history) ? kept.history.filter((q) => typeof q === "string" && q).slice(0, HISTORY) : [];
    this.historyAt = -1; // which of them is in the field, -1: what was typed (`draft`)
    this.draft = "";
    this.query = InputState.new({ placeholder: "Search", value: text(kept?.query) });
    this.to = InputState.new({ placeholder: "Replace", value: text(kept?.to) });
    this.include = InputState.new({ placeholder: "files to include: src, *.ts, ./docs", value: text(kept?.include) });
    this.exclude = InputState.new({ placeholder: "files to exclude", value: text(kept?.exclude) });
    this.field = null; // the name of the field that has the keyboard
    for (const [name, input] of Object.entries(this.inputs())) {
      input.on("change", (_e, cx) => this.edited(name, cx));
      input.on("submit", (_e, cx) => { this.remember(); this.go(cx); });
      input.on("focus", (_e, cx) => { this.field = name; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.field === name) this.field = null; cx.notify(); });
    }
    this.result = null; // what search.parse() gave, with { want, o, root, on, repo }: the search it is of
    this.error = null; // or why there is none: { text, pattern }
    this.running = null; // the search under way, as `want` says it
    this.next = false; // another one is wanted when it ends
    this.search = null; // the search under way: { id: its token, on, stopped }
    this.turn = 0; // counts the keys, so that only the last one starts a search
    this.folded = new Set(); // the files whose matches are not shown
    this.limit = PAGE; // how many rows are drawn
    this.grown = null; // the list's height when `limit` last grew by itself (see reach())
    this.cursor = null; // the row last opened or gone to: a match's id, or fileKey()
    this.hot = null; // the row under the pointer
    this.busy = null; // what is being written, in words
    this.undo = null; // what takes the last replace back: { on, files, count }
    this.seen = 0; // the last ask taken
    this.pending = null; // an ask that waits for the project to be known
    cx.spawn(async (cx) => {
      for (;;) { const command = await nextCommand(); this.command(command, cx); cx.notify(); }
    });
  }

  // The panel is going (or the app): the fields are kept for the next time.
  async close() {
    if (!this.other && !this.keysOnly) this.keep();
    if (this.search && !this.search.stopped) await ops.stop(this.search.id, this.search.on);
  }

  // The hidden copy's whole job: the panel is shown, and asked to take the keyboard unless
  // an ask is already waiting for it.
  summon(show) {
    if (show?.stack && show.child) run("layout.select", { stack: show.stack, child: show.child });
    if (show?.panel) run("layout.show", { id: show.panel });
    const a = shared(ASK);
    if (!a || Date.now() - (a.at ?? 0) > FRESH) setShared(ASK, { at: Date.now() });
  }

  // A task begun while the panel is drawn. Its first step would run inside the draw itself,
  // where asking for another draw (`cx.notify()`) is refused, and that ends the task: so it
  // waits one step, and runs once the draw is over.
  after(cx, body) {
    cx.spawn(async (cx) => { await null; await body(cx); });
  }

  inputs() {
    return { query: this.query, to: this.to, include: this.include, exclude: this.exclude };
  }

  keep() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        ...this.opt, history: this.history,
        query: this.query.value(), to: this.to.value(), include: this.include.value(), exclude: this.exclude.value(),
      }));
    } catch (e) { console.log(`${MOD}: could not keep the fields: ${e}`); }
  }

  // Soon: once for a burst of typing.
  stash(cx) {
    if (this.stashing) return;
    this.stashing = true;
    cx.timer.after(STASH_AFTER, () => { this.stashing = false; this.keep(); });
  }

  // The shown tab owns the search, even when a panel has the keyboard. Read the last terminal's
  // live folder when the editor is focused, or use the tab's first terminal on a fresh visit.
  location() {
    if (this.fixed) return this.fixed;
    const space = spaces().find((s) => s.active), f = focused();
    if (f?.pane === null && f.terminal && f.cwd && (!space || f.space === space.id)) {
      return { cwd: f.cwd, on: f.terminal.includes("/") ? f.terminal.split("/")[0] : null };
    }
    const tab = space?.tabs.find((t) => t.active)?.id;
    const terminals = tab ? panes().filter((p) => p.tab === tab && p.terminal) : [];
    const pane = terminals.find((p) => p.pane === f?.pane);
    if (pane) this.held.set(tab, pane.pane);
    const last = terminals.find((p) => p.pane === this.held.get(tab));
    const first = terminals.find((p) => p.cwd);
    return { cwd: pane?.cwd || (pane && f.cwd) || last?.cwd || first?.cwd || space?.folder || null, on: space?.machine ?? null };
  }

  // The top folder of the repository `cwd` is in, or null. Spelled as `cwd` is, where it can
  // be: git names the folder behind a link, and the Files panel and the editor know a file by
  // the path the terminal is in.
  async top(cwd, on) {
    const key = `${on ?? ""}\n${cwd}`, had = this.tops.get(key);
    if (had && Date.now() - had.at < TOP_FOR) return had.top;
    const done = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd, on, timeout: 10000 }).catch(() => null);
    let top = null;
    if (done?.code === 0) {
      const [real, inside = ""] = done.stdout.split("\n"), under = inside.replace(/\/+$/, "");
      top = !under ? cwd : cwd.endsWith(`/${under}`) ? cwd.slice(0, -under.length - 1) : real || null;
    }
    this.tops.set(key, { top, at: Date.now() });
    return top;
  }

  // Follows the focused pane: when it is in another project, that one is searched.
  place(cx) {
    const at = this.location(), where = placeKey(at);
    if (where === this.where || checking()) return;
    this.where = where;
    const turn = ++this.placing;
    this.placed = false;
    this.ctx = null;
    this.result = null; this.error = null; this.cursor = null;
    this.next = false;
    this.halt(cx);
    this.after(cx, async (cx) => {
      const top = at.cwd ? await this.top(at.cwd, at.on) : null;
      if (turn !== this.placing) return;
      if (where !== placeKey(this.location())) return this.place(cx);
      const root = top ?? at.cwd, key = root ? `${at.on ?? ""}\n${root}` : null;
      // Outside a repository nothing says where the project ends: the search waits for Enter.
      this.ctx = root ? { key, root, on: at.on, name: root.split("/").pop() || root, repo: Boolean(top), auto: Boolean(top) && !(!at.on && root === home()) } : null;
      this.placed = true;
      const requested = this.searchWhenPlaced;
      this.searchWhenPlaced = false;
      if (!this.answer(cx) && (this.ctx?.auto || requested)) this.go(cx);
      cx.notify();
    });
  }

  // Someone asked for a search (the header): taken once, by this copy alone.
  asked(cx) {
    const a = shared(ASK);
    if (!a || a.at === this.seen) return;
    this.seen = a.at;
    this.after(cx, async (cx) => {
      if (shared(ASK)?.at === a.at) setShared(ASK, null);
      if (Date.now() - a.at > FRESH) return;
      this.pending = a;
      this.place(cx);
      this.answer(cx);
      cx.notify();
    });
  }

  // Does what the waiting ask says, once the project is known. True when it began a search.
  answer(cx) {
    const a = this.pending, c = this.ctx;
    if (!a || !this.placed) return false;
    this.pending = null;
    let any = false;
    if (typeof a.query === "string" && a.query) { this.query.set_value(a.query); any = true; }
    if (typeof a.to === "string") { this.to.set_value(a.to); this.opt.replacing = true; any = true; }
    if (typeof a.folder === "string" && c && (a.on ?? null) === c.on) {
      const under = a.folder === c.root ? "" : a.folder.startsWith(`${c.root}/`) ? a.folder.slice(c.root.length + 1) : null;
      if (under !== null) {
        this.include.set_value(under ? `./${search.literal(under)}` : "");
        this.opt.details = true;
        any = true;
      }
    }
    if (a.focus !== false) this.focusQuery(cx);
    if (!any) return false;
    this.keep();
    this.go(cx);
    return true;
  }

  // The keyboard goes to the search field, with what is in it selected: typing replaces it.
  focusQuery(cx) {
    this.query.set_selected_range({ start: 0, end: this.query.value().length });
    this.query.focus();
    for (const after of REFOCUS) cx.timer.after(after, () => { if (!this.field && !this.handle.is_focused()) this.query.focus(); });
  }

  // The search as the fields say it now.
  options() {
    const o = this.opt;
    return {
      query: this.query.value(), cs: o.cs, word: o.word, regex: o.regex, ignored: o.details && o.ignored,
      include: o.details ? this.include.value() : "", exclude: o.details ? this.exclude.value() : "",
      replacing: o.replacing, to: o.replacing ? this.to.value() : "",
    };
  }

  want() {
    return this.ctx ? JSON.stringify([this.ctx.key, this.options()]) : null;
  }

  // The list is of the search the fields say: only then can it be replaced from.
  fresh() {
    return Boolean(this.result) && !this.running && this.result.want === this.want();
  }

  canReplace() {
    return this.fresh() && this.result.o.replacing && !this.busy;
  }

  // A field changed, by typing or by a command.
  edited(name, cx) {
    if (name === "query" && !(this.historyAt >= 0 && this.query.value() === this.history[this.historyAt])) this.historyAt = -1;
    this.stash(cx);
    if (this.ctx?.auto) this.later(cx);
    else { this.turn++; cx.notify(); }
  }

  // Soon: once for a burst of typing.
  later(cx) {
    const turn = ++this.turn;
    cx.notify();
    cx.timer.after(TYPE_AFTER, (cx) => { if (turn === this.turn) this.go(cx); });
  }

  // Searches now. One search at a time: asked again while one runs, that one is stopped, and
  // the next one starts when it ends, with the fields as they are then.
  go(cx) {
    this.place(cx);
    if (!this.placed) { this.searchWhenPlaced = true; return; }
    this.turn++;
    const c = this.ctx, o = this.options();
    if (!c || !o.query) {
      this.result = null; this.error = null; this.next = false; this.cursor = null;
      this.halt(cx);
      cx.notify();
      return;
    }
    const want = this.want();
    if (this.running) {
      this.next = this.running !== want;
      if (this.next) this.halt(cx);
      return;
    }
    this.running = want;
    const run = (this.search = { id: ops.token(), on: c.on, stopped: false });
    cx.notify();
    cx.spawn(async (cx) => {
      // Whatever happens, the search is over: nothing may leave it "running". An answer that
      // another search, another project or a cleared field has overtaken is not read, nor one
      // that was stopped: it is cut short.
      const stale = () => run.stopped || this.next || this.ctx !== c || !this.query.value();
      const found = await ops.find(c.root, c.on, o, stale, run.id).catch((e) => ({ error: String(e?.message ?? e) }));
      this.running = null; this.search = null;
      // Stopped, then asked for as it was (typed and taken back): it is run again.
      const again = this.next || (run.stopped && this.ctx === c && Boolean(this.query.value()));
      this.next = false;
      if (again) return this.go(cx);
      // Cleared, or another project, meanwhile.
      if (!found.stale && this.ctx === c && this.query.value()) this.take(found, { want, o, root: c.root, on: c.on, repo: c.repo });
      cx.notify();
    });
  }

  // Stops the search under way, once: Herdr can't cancel an exec, so ripgrep is ended on its
  // machine (ops.stop()), and the exec then comes back at once. In a task that waits a step:
  // go() may run in a draw.
  halt(cx) {
    const run = this.search;
    if (!run || run.stopped) return;
    run.stopped = true;
    this.after(cx, () => ops.stop(run.id, run.on));
  }

  take(found, of) {
    if (found.error) {
      this.result = null;
      this.error = { text: found.error, pattern: Boolean(found.pattern) };
      return;
    }
    this.error = null;
    this.result = { ...found, ...of };
    const paths = new Set(found.files.map((f) => f.path));
    this.folded = new Set([...this.folded].filter((path) => paths.has(path)));
    this.limit = PAGE; this.grown = null;
    this.hot = null;
    if (this.cursor && !this.rows().some((r) => r.key === this.cursor)) this.cursor = null;
  }

  // The query goes to the top of the earlier ones: on Enter, a result opened, a replace.
  remember() {
    const q = this.query.value();
    if (!q) return;
    this.history = [q, ...this.history.filter((h) => h !== q)].slice(0, HISTORY);
    this.historyAt = -1;
    this.keep();
  }

  // An earlier query (`by` 1) or a later one (-1) comes back in the field.
  recall(by, cx) {
    if (!this.history.length) return;
    if (this.historyAt < 0) this.draft = this.query.value();
    const at = Math.max(-1, Math.min(this.history.length - 1, this.historyAt + by));
    if (at === this.historyAt) return;
    this.historyAt = at;
    const q = at < 0 ? this.draft : this.history[at];
    this.query.set_value(q);
    this.query.set_selected_range({ start: q.length, end: q.length });
    this.edited("query", cx);
  }

  // Every row there is to draw: a file ({ key, f, m: null }), then its matches unless folded.
  rows() {
    const out = [];
    for (const f of this.result?.files ?? []) {
      out.push({ key: fileKey(f.path), f, m: null });
      if (!this.folded.has(f.path)) for (const m of f.matches) out.push({ key: m.id, f, m });
    }
    return out;
  }

  // The cursor's row is brought into sight.
  show(key) {
    this.cursor = key;
    const at = this.rows().findIndex((r) => r.key === key);
    if (at < 0) return;
    if (at >= this.limit) this.limit = (Math.floor(at / PAGE) + 1) * PAGE;
    this.scroll.scroll_to_item(at);
  }

  fold(f, folded) {
    if (folded) this.folded.add(f.path); else this.folded.delete(f.path);
  }

  // Shows a result in the tab's editor, a pane split in beside the focused one when the tab
  // has none yet: the editor takes the file, and what to select in it, from shared state.
  open(f, m) {
    const r = this.result, focus = focused(), tab = focus?.tab;
    if (!r || !tab) return;
    const here = panes().filter((p) => p.tab === tab), editor = here.find((p) => p.mod === EDITOR);
    const beside = here.find((p) => p.pane === focus.pane) ?? here[0];
    if (!editor && !beside) return;
    this.cursor = m ? m.id : fileKey(f.path);
    this.remember();
    const select = m ? { line: m.line, start: Math.max(0, m.start), end: Math.max(0, m.end) } : null;
    setShared(`${EDITOR}.open`, { tab, path: `${r.root}/${f.path}`, on: r.on ?? null, at: Date.now(), select });
    if (editor) run("pane.focus", { pane: editor.pane });
    else run("pane.split", { pane: beside.pane, direction: "right", mod: EDITOR, props: { tab } });
  }

  // To the next match (`by` 1) or the one before (-1), from the cursor and going round: it
  // opens in the editor.
  step(by) {
    const all = [];
    for (const f of this.result?.files ?? []) for (const m of f.matches) all.push({ f, m });
    if (!all.length) return;
    let at = all.findIndex((o) => o.m.id === this.cursor);
    if (at >= 0) at = (at + by + all.length) % all.length;
    else {
      // From a file's row: its first match, or the last of the file before it.
      const first = all.findIndex((o) => fileKey(o.f.path) === this.cursor);
      at = first < 0 ? (by > 0 ? 0 : all.length - 1) : by > 0 ? first : (first - 1 + all.length) % all.length;
    }
    const { f, m } = all[at];
    this.fold(f, false);
    this.open(f, m);
    this.show(m.id);
  }

  // Out of the list, until the next search.
  dismiss(f, m) {
    const r = this.result;
    if (!r) return;
    const rows = this.rows(), at = rows.findIndex((row) => row.key === (m ? m.id : fileKey(f.path)));
    if (m) f.matches = f.matches.filter((o) => o !== m);
    const gone = m ? 1 : f.matches.length;
    if (!m || !f.matches.length) { r.files = r.files.filter((o) => o !== f); this.folded.delete(f.path); }
    r.count -= gone;
    this.hot = null;
    // The cursor stays where the row was.
    const left = this.rows();
    if (this.cursor && !left.some((row) => row.key === this.cursor)) this.cursor = left[Math.min(Math.max(0, at), left.length - 1)]?.key ?? null;
  }

  // What a replace would write: [{ path, edits }], for one match, one file, or every file.
  plan(path, id) {
    const out = [];
    for (const f of this.result?.files ?? []) {
      if (path && f.path !== path) continue;
      const edits = f.matches.filter((m) => (!id || m.id === id) && m.start >= 0 && typeof m.to === "string");
      if (edits.length) out.push({ path: f.path, edits });
    }
    return out;
  }

  // Replaces one match (`path`, `id`), the matches listed of one file (`path`), or all listed.
  replace(path, id, cx) {
    if (!this.canReplace()) return;
    const r = this.result, plan = this.plan(path, id);
    if (!plan.length) return notify({ title: "Nothing to replace", body: "What these matches become is not known here" });
    // While it runs there is nothing to take back: not the replace before it either.
    this.undo = null;
    this.busy = "Replacing…";
    this.remember();
    cx.notify();
    cx.spawn(async (cx) => {
      const done = await ops.replace(r.root, r.on, plan, (n) => { if (plan.length > 1) { this.busy = `Replacing… ${num(n)} of ${num(plan.length)}`; cx.notify(); } });
      this.busy = null;
      const n = done.changed.reduce((sum, f) => sum + f.count, 0);
      if (n) {
        const size = done.changed.reduce((sum, f) => sum + f.before.length + f.after.length, 0);
        this.undo = size <= UNDO_MOST ? { on: r.on ?? null, files: done.changed, count: n } : null;
        notify({ title: `Replaced ${count(n, "match", "matches")}`, body: `in ${done.changed.length === 1 ? `“${ops.base(done.changed[0].path)}”` : count(done.changed.length, "file", "files")}${this.undo ? "" : " · too much text to undo from here"}` });
      }
      this.report(done.missed, "left as it was", "left as they were");
      if (!n && !done.missed.length) notify({ title: "Nothing was replaced", body: "The replacement is the same text" });
      this.go(cx);
      cx.notify();
    });
  }

  // The files a replace or its undo could not write, in one toast.
  report(missed, one, many) {
    if (!missed.length) return;
    notify({
      title: missed.length === 1 ? `“${ops.base(missed[0].path)}” was ${one}` : `${count(missed.length, "file", "files")} were ${many}`,
      body: missed.length === 1 ? `It ${missed[0].why}` : `“${ops.base(missed[0].path)}” ${missed[0].why}, and ${count(missed.length - 1, "other", "others")}`,
      level: "warning",
    });
  }

  // Every match listed: asked about first (confirm.js).
  askAll() {
    if (!this.canReplace()) return;
    const r = this.result, plan = this.plan(), n = plan.reduce((sum, f) => sum + f.edits.length, 0);
    if (!n) return notify({ title: "Nothing to replace", body: "What these matches become is not known here" });
    const becomes = r.o.to ? `“${clip(r.o.query)}” becomes “${clip(r.o.to)}”.` : `“${clip(r.o.query)}” is deleted.`;
    openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 196, props: { confirm: {
      title: `Replace ${count(n, "match", "matches")} in ${count(plan.length, "file", "files")}?`,
      detail: `${becomes} The files are written at once.${r.capped ? " Only the matches listed are replaced: there are more." : ""} Undo is in this panel until the next replace.`,
      button: "Replace",
      request: { op: "replace-all", want: r.want },
    } } });
  }

  // Takes the last replace back, once.
  unreplace(cx) {
    const u = this.undo;
    if (!u || this.busy) return;
    this.undo = null;
    this.busy = "Undoing…";
    cx.notify();
    cx.spawn(async (cx) => {
      const done = await ops.restore(u.on, u.files);
      this.busy = null;
      if (done.restored) notify({ title: `Put ${count(done.restored, "file", "files")} back`, body: "as before the replace" });
      this.report(done.missed, "not put back", "not put back");
      this.go(cx);
      cx.notify();
    });
  }

  // The menu is this mod again, as a popup (menu.js).
  menu(f, m) {
    const r = this.result;
    if (!r) return;
    this.cursor = m ? m.id : fileKey(f.path);
    const replace = this.canReplace() && this.plan(f.path, m?.id).length > 0;
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: MOD, kind: "popup", width: 236, height: 530, props: { menu: {
      root: r.root, on: r.on ?? null, path: f.path, id: m?.id ?? null, line: m?.line ?? null, text: m?.full ?? null, replace,
    } } });
  }

  // Runs what the menu or the dialog asked for (ops.js).
  act(q, cx) {
    const r = this.result;
    if (!r) return;
    if (q.op === "replace-all") { if (q.want === r.want) this.replace(null, null, cx); return; }
    const f = r.files.find((o) => o.path === q.path), m = q.id ? f?.matches.find((o) => o.id === q.id) : null;
    if (!f || (q.id && !m)) return;
    if (q.op === "open") this.open(f, m);
    else if (q.op === "dismiss") this.dismiss(f, m);
    else if (q.op === "replace") this.replace(f.path, m?.id ?? null, cx);
    else if (q.op === "app" && q.root === r.root && !q.on && !r.on) cx.spawn(async () => {
      const done = await external.open(q.app, {
        path: `${r.root}/${f.path}`, repo: r.repo ? r.root : null, on: r.on,
        line: m?.line, column: m ? Math.max(0, m.start) + 1 : null,
      });
      if (done.error) notify({ title: done.title, body: done.error, level: "error" });
    });
  }

  // The keyboard goes back to the pane: the editor's text, or the terminal. From a field, the
  // field gives it up (`blur()`) and Herdr hands it to the focused pane, a terminal block too.
  // The editor wants its text to have it, which only it can do; and the list is no field.
  leave() {
    const f = focused(), pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const field = this.field ? this.inputs()[this.field] : null;
    if (pane?.mod === EDITOR) run(`${EDITOR}.focus`);
    else if (field) field.blur();
    else if (pane) run("pane.focus", { pane: pane.pane });
  }

  // A key command (keys.json).
  command(name, cx) {
    if (name === "open") return this.focusQuery(cx);
    if (name === "next") return this.step(1);
    if (name === "prev") return this.step(-1);
    if (name === "undo") return this.unreplace(cx);
    if (name === "older") return this.recall(1, cx);
    if (name === "newer") return this.recall(-1, cx);
    if (name === "list") {
      const rows = this.rows();
      if (!rows.length) return;
      this.handle.focus();
      return this.show(rows.some((r) => r.key === this.cursor) ? this.cursor : rows[0].key);
    }
    if (name === "tab" || name === "back-tab") {
      const shown = ["query", this.opt.replacing && "to", this.opt.details && "include", this.opt.details && "exclude"].filter(Boolean);
      const at = shown.indexOf(this.field), by = name === "tab" ? 1 : -1;
      this.inputs()[shown[(Math.max(0, at) + by + shown.length) % shown.length]].focus();
    }
  }

  // A key went down in the panel and no binding took it. Escape gives the keyboard back to
  // the pane; the rest is for the list, while it has the keyboard.
  key(e, cx) {
    const m = e.modifiers ?? {};
    if (e.key === "escape") {
      this.leave();
      cx.stop_propagation();
      return;
    }
    if (!this.handle.is_focused() || m.control || m.alt) return;
    const rows = this.rows(), at = rows.findIndex((r) => r.key === this.cursor), row = rows[at];
    if (e.key === "down") { if (rows.length) this.show(rows[Math.min(rows.length - 1, at + 1)].key); }
    else if (e.key === "up") { if (at <= 0) this.query.focus(); else this.show(rows[at - 1].key); }
    else if (!row) return;
    else if (e.key === "enter") { if (row.m) this.open(row.f, row.m); else this.fold(row.f, !this.folded.has(row.f.path)); }
    else if (e.key === "left") { if (row.m) this.show(fileKey(row.f.path)); else this.fold(row.f, true); }
    else if (e.key === "right") { if (!row.m) this.fold(row.f, false); }
    else if (e.key === "backspace" && m.platform) this.dismiss(row.f, row.m);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // A small button with an icon. `o`: { on: it is switched on, off: it can't be used now }.
  icon(t, id, path, tip, action, o = {}) {
    return h_flex().id(id).size(o.size ?? 24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .when(Boolean(o.on), (el) => el.bg(t.selected))
      .when(Boolean(o.off), (el) => el.opacity(0.4))
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); if (!o.off) action(cx); cx.notify(); })
      .child(svg(path).size(o.glyph ?? 14).flex_none().text_color(o.on ? t.foreground : t.muted));
  }

  // One with a word on it.
  button(t, id, label, tip, action, o = {}) {
    return h_flex().id(id).h(24).min_w(24).px(6).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(o.on ? t.foreground : t.muted)
      .when(Boolean(o.on), (el) => el.bg(t.selected))
      .when(Boolean(o.off), (el) => el.opacity(0.4))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); if (!o.off) action(cx); cx.notify(); })
      .child(label);
  }

  // A switch of the search: it runs again at once, and the keyboard stays in the field.
  flip(name, cx) {
    this.opt[name] = !this.opt[name];
    this.keep();
    this.query.focus();
    this.go(cx);
  }

  form(t) {
    const o = this.opt, bad = Boolean(this.error?.pattern);
    const field = (state, name) => Input.new(state).h(26).flex_1().min_w(60).px(8).rounded(6).border_1()
      .border_color(name === "query" && bad ? t.blocked : this.field === name ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const can = this.canReplace() && this.result.count > 0;
    return v_flex().id("ps-form").flex_none().px(8).pt(8).pb(6).gap(6)
      .child(h_flex().gap(3).items_center()
        .child(this.icon(t, "ps-replacing", o.replacing ? ICON.down : ICON.right, o.replacing ? "Hide the replace row" : "Replace", (cx) => {
          o.replacing = !o.replacing;
          this.keep();
          if (o.replacing) this.to.focus(); else this.query.focus();
          this.go(cx);
        }, { size: 22, glyph: 12 }))
        .child(field(this.query, "query"))
        .child(this.button(t, "ps-cs", "Aa", "Match case", (cx) => this.flip("cs", cx), { on: o.cs }))
        .child(this.button(t, "ps-word", "ab", "Match whole words", (cx) => this.flip("word", cx), { on: o.word }))
        .child(this.button(t, "ps-regex", ".*", "Regular expression", (cx) => this.flip("regex", cx), { on: o.regex })))
      .when(o.replacing, (el) => el.child(h_flex().gap(3).items_center().pl(25)
        .child(field(this.to, "to"))
        .child(this.icon(t, "ps-all", ICON.all, can ? "Replace all" : "Replace all: when the search is done", () => this.askAll(), { off: !can }))))
      .when(o.details, (el) => el.child(v_flex().gap(6).pl(25)
        .child(field(this.include, "include"))
        .child(field(this.exclude, "exclude"))
        .child(h_flex().id("ps-ignored").h(22).gap(7).items_center().cursor_pointer().text_size(12).text_color(o.ignored ? t.foreground : t.muted)
          .tooltip("Also search what git ignores: node_modules, build output")
          .on_click((_e, cx) => { this.flip("ignored", cx); cx.notify(); })
          .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(4).border_1().border_color(o.ignored ? t.accent : t.input).bg(o.ignored ? t.accent : t.background)
            .text_size(10).text_color(t.accent_foreground).child(o.ignored ? "✓" : ""))
          .child("Search ignored files too"))));
  }

  // One line under the fields: what the list is, or why there is none.
  status(t) {
    const r = this.result, c = this.ctx, o = this.opt, query = this.query.value();
    const waiting = Boolean(this.running) || (Boolean(c?.auto) && Boolean(query) && !this.fresh() && !this.error);
    let text = "", color = t.dim;
    if (!c) text = this.placed ? "No folder to search" : "";
    else if (this.busy) text = this.busy;
    else if (this.error && !waiting) { text = this.error.pattern ? `Not a pattern: ${this.error.text}` : this.error.text; color = t.blocked; }
    else if (!query) text = `In ${c.on ? `${c.on}: ` : ""}${c.name}`;
    else if (!r) text = waiting ? "Searching…" : "Press ↩ to search";
    else {
      text = !r.count ? "No results" : `${count(r.count, "result", "results")} in ${count(r.files.length, "file", "files")}`;
      if (r.capped) text += " · there are more";
      if (waiting) text += " · searching…"; else if (!this.fresh()) text += " · ↩ to search again";
    }
    return h_flex().id("ps-status").h(26).flex_none().pl(12).pr(8).gap(4).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(color).tooltip(text).child(text))
      .when(Boolean(this.undo) && !this.busy, (el) => el.child(this.button(t, "ps-undo", "Undo replace", `Put back the ${count(this.undo.count, "match", "matches")} last replaced`, (cx) => this.unreplace(cx))))
      .child(this.icon(t, "ps-details", ICON.more, o.details ? "Hide the filters" : "Filter the files searched", (cx) => {
        o.details = !o.details;
        this.keep();
        if (o.details) this.include.focus(); else this.query.focus();
        this.go(cx);
      }, { on: o.details, size: 22 }));
  }

  // A row's own buttons, shown while the pointer is on it.
  tools(t, f, m, can) {
    const id = m ? m.id : fileKey(f.path);
    return h_flex().flex_none().gap(1).items_center()
      .when(can, (el) => el.child(this.icon(t, `ps-r-${id}`, ICON.replace, m ? "Replace" : "Replace in this file", (cx) => this.replace(f.path, m?.id ?? null, cx), { size: 20, glyph: 12 })))
      .child(this.icon(t, `ps-x-${id}`, ICON.x, "Dismiss", () => this.dismiss(f, m), { size: 20, glyph: 12 }));
  }

  // `s`: what every row needs. { root, on, replace: the list can be replaced now, mono }
  row(t, row, s) {
    const { f, m, key } = row, hot = this.hot === key, on = this.cursor === key;
    const base = (el) => el.flex_none().items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((st) => st.bg(t.hover)))
      // Herdr's file drag: the name follows the pointer, and a terminal takes it as a path.
      .drag_paths([`${s.root}/${f.path}`], { on: s.on })
      .on_hover((hovered, cx) => {
        if (hovered ? this.hot === key : this.hot !== key) return;
        this.hot = hovered ? key : null;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { this.menu(f, m); cx.notify(); });
    if (!m) {
      const folded = this.folded.has(f.path), dir = ops.parent(f.path);
      return base(h_flex().id(`ps-f-${f.path}`).h(28).pl(6).pr(5).gap(6).rounded(7))
        .on_click((_e, cx) => { this.fold(f, !folded); this.cursor = key; cx.notify(); })
        .child(svg(folded ? ICON.right : ICON.down).size(12).flex_none().text_color(t.dim))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(ops.base(f.path)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(dir))
        .child(hot ? this.tools(t, f, null, s.replace && f.matches.some((o) => o.start >= 0 && typeof o.to === "string"))
          : div().flex_none().h(17).min_w(17).px(5).rounded(9).bg(t.raised).text_size(10.5).text_color(t.muted).text_center().child(num(f.matches.length)));
    }
    const becomes = s.replace && m.start >= 0 && typeof m.to === "string", p = search.pieces(m);
    return base(h_flex().id(`ps-m-${m.id}`).h(24).pl(24).pr(5).gap(6).rounded(6))
      .on_click((_e, cx) => { this.open(f, m); cx.notify(); })
      .child(h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().font_family(s.mono).text_size(12).text_color(t.muted)
        .child(div().flex_none().child(p.before))
        .child(div().flex_none().px(1).rounded(3).text_color(t.foreground)
          .when(becomes, (el) => el.bg(tint(t.ansi1, "40")).line_through())
          .when(!becomes, (el) => el.bg(t.selection))
          .child(p.shown))
        .when(becomes && m.to !== "", (el) => el.child(div().flex_none().px(1).rounded(3).bg(tint(t.ansi2, "40")).text_color(t.foreground).child(clip(m.to.replace(/[\t\r\n]/g, " "), 120))))
        .child(div().flex_1().min_w(0).truncate().child(p.after)))
      .child(hot ? this.tools(t, f, m, becomes) : div().flex_none().text_size(10.5).text_color(t.dim).child(String(m.line)));
  }

  // Scrolled to within a screen of the end, the next PAGE rows are drawn, as "Show more" does.
  // The handle tells of the last layout: a page is added only once one has the rows of the page
  // before (its height is no longer `grown`), else one wheel turn would add several.
  reach(cx) {
    const s = this.scroll, high = s.content_size().height, view = s.viewport_size().height;
    if (!high || !view || high === this.grown || s.offset().y + view < high - view) return;
    if (this.rows().length <= this.limit) return;
    this.limit += PAGE; this.grown = high;
    cx.notify();
  }

  list(t) {
    const r = this.result, rows = this.rows();
    const s = { root: r?.root, on: r?.on ?? null, replace: this.canReplace(), mono: settings().font_family };
    const say = (text) => div().p(10).text_size(12).text_color(t.dim).child(text);
    return v_flex().id("ps-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).p(5)
      // The wheel, and the release of the scrollbar dragged, near the end: more rows.
      .on_scroll_wheel((_e, cx) => this.reach(cx))
      .on_mouse_up("left", (_e, cx) => this.reach(cx))
      .children(rows.slice(0, this.limit).map((row) => this.row(t, row, s)))
      .when(rows.length > this.limit, (el) => el.child(h_flex().id("ps-more").h(28).flex_none().px(10).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.accent)
        .hover((st) => st.bg(t.hover))
        // A page, not two: the list's own release (reach()) is not to add one as well.
        .on_click((_e, cx) => { cx.stop_propagation(); this.limit += PAGE; this.grown = this.scroll.content_size().height; cx.notify(); })
        .child(`Show more (${num(rows.length - this.limit)} rows not shown)`)))
      .when(!r && !this.query.value() && Boolean(this.ctx), (el) => el.child(say(this.ctx?.auto
        ? "Type to search every file of the project. What git ignores is left out."
        : "Type, then press ↩ to search this folder: it is not in a repository.")));
  }

  render(cx) {
    fieldKeys.watch(MOD, cx);
    if (this.other) return this.other.render(cx);
    if (this.keysOnly) return div();
    this.place(cx);
    this.asked(cx);
    // A menu or a dialog left something to do. Taken in a task: only one copy gets it.
    if (ops.waiting()) this.after(cx, async (cx) => { const q = ops.take(); if (q) this.act(q, cx); cx.notify(); });
    const t = theme(), r = this.result, c = this.ctx;
    const all = Boolean(r?.files.length) && r.files.every((f) => this.folded.has(f.path));
    return v_flex().id("project-search").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().id("ps-head").h(42).flex_none().pl(14).pr(8).gap(2).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Search"))
        .child(div().flex_1().min_w(0).truncate().text_right().pr(6).text_size(12).text_color(t.dim).child(c ? `${c.on ? `${c.on}: ` : ""}${c.name}` : ""))
        .child(this.icon(t, "ps-refresh", ICON.refresh, "Search again", (cx) => this.go(cx), { off: !this.query.value() || !c }))
        .child(this.icon(t, "ps-fold", all ? ICON.expand : ICON.collapse, all ? "Expand all" : "Collapse all", () => {
          this.folded = all ? new Set() : new Set(r.files.map((f) => f.path));
        }, { off: !r?.files.length }))
        .child(this.icon(t, "ps-clear", ICON.x, "Clear the search", (cx) => { this.query.set_value(""); this.query.focus(); this.keep(); this.go(cx); }, { off: !this.query.value() }))
        .when(Boolean(this.back?.stack && this.back.child), (el) => el.child(this.icon(t, "ps-back", ICON.files, "Back to Files", () => run("layout.select", { stack: this.back.stack, child: this.back.child })))))
      .child(this.form(t))
      .child(this.status(t))
      .child(this.list(t));
  }
}
