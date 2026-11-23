// Go to a file of the project by its name: a popup, like Herdr's own "Go to…" for tabs.
// keys.json opens it (`mod.open:go-to-file`, and the same key closes it again).
//
// The project is the repository the focused pane is in, else its folder: what the Files and
// the Search panels show. Its files are listed once, when the popup opens, by ripgrep on the
// project's own machine (ops.js), and what is typed is looked for in that list here (match.js):
// words in any order, in the name first, then in the folders, then as letters in order.
// "name:12" goes to a line. A project with more files than are listed (match.MOST) is asked
// for the files that match instead, each time the typing stops.
//
// The file opens in the tab's editor (the `file-editor` mod), a pane split in beside the
// focused one when the tab has none yet. With nothing typed the files opened lately from here
// come first.
//
// Props, for a test window: { root, on } pins the folder whose project is listed, whatever pane
// has the focus, and leaves the keyboard where it is; { query } is what the field says at first.
//
// Key commands (keys.json, section `mod:go-to-file > Input`): up, down. The field binds those
// keys and passes nothing on, so they come as commands; Enter is the field's own `submit`.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, theme, props, closeOverlay, run, shared, setShared, nextCommand, checking } from "herdr";
import * as match from "./match.js";
import * as ops from "./ops.js";

// The mod that shows a file, one pane a tab, and what it reads in shared state (its header).
const EDITOR = "file-editor";
// A row's height, and how many rows show before the list scrolls.
const ROW = 30, TALL = 10;
// How long after the last key the machine is asked, when the project is not listed whole.
const TYPE_AFTER = 180;
// The field may not be drawn yet when the popup opens: it is given the keyboard again.
const REFOCUS = 600;

const num = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
const count = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
// A space as one that is not dropped: a name is drawn in pieces, and a piece would lose the
// spaces at its ends.
const hard = (text) => text.replace(/ /g, " ");

export default class GoToFile extends View {
  init(_props, cx) {
    // Kept: after an `await`, props() may answer for another copy.
    const p = props() ?? {};
    this.overlay = p.overlay;
    this.pin = typeof p.root === "string" && p.root ? { cwd: p.root, on: p.on ?? null } : null;
    this.rows = []; this.total = 0; this.at = 0; this.turn = 0;
    // `ix`: the project's list. `pool`: what is looked in, the list or the machine's last answer.
    this.ix = null; this.pool = null; this.cut = false; this.more = false;
    this.error = null; this.loading = false; this.asking = false; this.again = false;
    this.lately = []; this.late = new Set();
    this.input = InputState.new({ placeholder: "Go to a file…" });
    this.input.on("change", (_e, cx) => { this.typed(cx); cx.notify(); });
    this.input.on("submit", () => this.pick(this.rows[this.at]));
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    if (typeof p.query === "string") this.input.set_value(p.query);
    if (!this.pin) {
      this.input.focus();
      cx.timer.after(REFOCUS, () => this.input.focus());
    }
    if (checking()) return;
    this.from = this.where();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "up" || c === "down") { this.move(c === "up" ? -1 : 1); cx.notify(); }
      }
    });
    this.load(cx);
  }

  // Where the popup was opened from: the tab and its focused pane, and the folder to find the
  // project by. A mod pane (the editor) is in no folder: then it is the folder of the tab's
  // terminal that the file shown is under, else that file's own, else the tab's first terminal's.
  where() {
    const f = focused(), space = spaces().find((s) => s.active);
    const tab = f?.tab ?? null, here = tab ? panes().filter((p) => p.tab === tab) : [];
    const pane = f?.pane ? here.find((p) => p.pane === f.pane) : null;
    // A terminal block of the layout is no pane: its machine is in its address.
    const on = (f && f.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine) ?? null;
    const shown = tab ? shared(`${EDITOR}.shown`)?.[tab] : null;
    const file = shown?.path && (shown.on ?? null) === on ? shown.path : null;
    let cwd = pane?.mod ? null : pane?.cwd || f?.cwd || null;
    if (pane?.mod) {
      const terminals = here.filter((p) => !p.mod && p.cwd);
      const around = file ? terminals.filter((p) => file.startsWith(`${p.cwd.replace(/\/+$/, "")}/`)).sort((a, b) => b.cwd.length - a.cwd.length)[0] : null;
      cwd = around?.cwd ?? (file ? file.slice(0, file.lastIndexOf("/")) || "/" : terminals[0]?.cwd ?? null);
    }
    if (this.pin) return { tab, pane: f?.pane ?? null, ...this.pin, file: null };
    return { tab, pane: f?.pane ?? null, cwd: cwd || space?.folder || null, on, file };
  }

  load(cx) {
    const { cwd, on } = this.from;
    if (!cwd) { this.error = "There is no folder here to list"; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      let got;
      try { got = await ops.list(cwd, on); } catch (e) { got = { error: String(e?.message ?? e) }; }
      this.loading = false;
      if (got.error) this.error = got.error;
      else {
        this.root = got.root; this.on = on; this.cut = got.cut;
        this.project = ops.key(got.root, on);
        this.lately = ops.recent(this.project); this.late = new Set(this.lately);
        this.ix = this.pool = match.index(got.paths);
        // The file the editor shows, as the list names it.
        const file = this.from.file;
        this.current = file?.startsWith(`${got.root}/`) ? file.slice(got.root.length + 1) : null;
        this.show();
        // Typed while the files were read.
        if (this.cut && match.parse(this.input.value()).terms.length) this.ask(cx);
      }
      cx.notify();
    });
  }

  // The rows for what the field says now, from what is at hand.
  show() {
    const q = match.parse(this.input.value());
    // With nothing typed it is the project's own list, also while an answer for words is at hand.
    const ix = q.terms.length ? this.pool : this.ix;
    this.rows = []; this.total = 0;
    if (!ix) return;
    const row = (path, pieces) => {
      const b = path.lastIndexOf("/") + 1;
      return { path, dir: b ? path.slice(0, b - 1) : "", pieces: pieces ?? [{ text: path.slice(b), hit: false }], late: this.late.has(path) };
    };
    if (q.terms.length) {
      const found = match.rank(ix, q.terms, match.SHOWN, this.late);
      this.rows = found.rows.map((i) => row(ix.paths[i], match.pieces(ix, i, q.terms)));
      this.total = found.total;
      return;
    }
    // Nothing typed: the files opened lately, then the first ones by name. A line alone (":12")
    // is a line of the file the editor shows, so that one comes first; otherwise it is the one
    // file there is no need to go to.
    const known = (p) => !this.cut ? ix.paths.includes(p) : true;
    const first = q.line && this.current ? [this.current] : [];
    const lately = this.lately.filter((p) => p !== this.current && known(p));
    const head = [...first, ...lately], seen = new Set(head);
    for (let i = 0; i < ix.paths.length && head.length < match.SHOWN; i++) if (!seen.has(ix.paths[i])) head.push(ix.paths[i]);
    this.rows = head.map((p) => row(p));
    this.total = ix.paths.length;
  }

  typed(cx) {
    this.at = 0;
    this.scroll.scroll_to_item(0);
    this.show();
    if (!this.ix || !this.cut) return;
    const turn = ++this.turn;
    cx.timer.after(TYPE_AFTER, (cx) => { if (turn === this.turn) this.ask(cx); });
  }

  // The project has more files than are listed: its machine is asked for those that match what
  // the field says. One answer at a time; asked again meanwhile, the next starts when it ends.
  ask(cx) {
    if (this.asking) { this.again = true; return; }
    const q = match.parse(this.input.value());
    if (!q.terms.length) { this.pool = this.ix; this.more = false; this.show(); cx.notify(); return; }
    this.asking = true;
    cx.spawn(async (cx) => {
      let got;
      try { got = await ops.list(this.root, this.on, q.terms.map(match.pattern)); } catch (e) { got = { error: String(e?.message ?? e) }; }
      this.asking = false;
      this.error = got.error ?? null;
      if (!got.error) { this.pool = match.index(got.paths); this.more = got.cut; }
      this.show();
      this.at = Math.min(this.at, Math.max(0, this.rows.length - 1));
      cx.notify();
      if (this.again) { this.again = false; this.ask(cx); }
    });
  }

  move(by) {
    const n = this.rows.length;
    if (!n) return;
    this.at = (this.at + by + n) % n;
    this.scroll.scroll_to_item(this.at);
  }

  close() {
    closeOverlay(this.overlay);
  }

  // Opens the file in the tab's editor, which takes it from shared state (and the line to go
  // to: the editor selects what a search found, here nothing, at the line's start or column).
  pick(r) {
    const { tab } = this.from ?? {};
    if (!r || !tab || !this.root || this.gone) return;
    const here = panes().filter((p) => p.tab === tab), editor = here.find((p) => p.mod === EDITOR);
    const beside = here.find((p) => p.pane === this.from.pane) ?? here.find((p) => p.focused) ?? here[0];
    if (!editor && !beside) return;
    const q = match.parse(this.input.value()), column = Math.max(0, (q.column ?? 1) - 1);
    // Enter may come twice, as the field's `submit` and as a key.
    this.gone = true;
    this.close();
    ops.remember(this.project, r.path);
    setShared(`${EDITOR}.open`, {
      tab, path: `${this.root}/${r.path}`, on: this.on ?? null, at: Date.now(),
      select: q.line ? { line: q.line, start: column, end: column } : null,
    });
    if (editor) run("pane.focus", { pane: editor.pane });
    else run("pane.split", { pane: beside.pane, direction: "right", mod: EDITOR, props: { tab } });
  }

  // What the line under the list says.
  status(q) {
    if (this.error) return this.error;
    if (this.loading) return "Reading the files…";
    if (!this.ix) return "";
    const where = this.on ?? "this computer";
    if (!q.terms.length) return this.cut ? `More than ${num(match.MOST)} files: type to have ${where} look for one` : count(this.total, "file", "files");
    if (this.cut && this.asking) return "Looking…";
    if (!this.rows.length) return "No file matches";
    if (this.cut && this.more) return `More than ${num(match.MOST)} match: type more`;
    return this.total > this.rows.length ? `The best ${num(this.rows.length)} of ${count(this.total, "match", "matches")}` : count(this.total, "match", "matches");
  }

  row(t, r, i) {
    return h_flex()
      .id(`gtf-${i}`)
      .flex_none()
      .h(ROW)
      .mx(4)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.pick(r))
      .child(h_flex().flex_none().max_w(360).overflow_hidden().text_color(t.foreground)
        .children(r.pieces.map((p) => div().flex_none().whitespace_nowrap().when(p.hit, (d) => d.text_color(t.accent).font_semibold()).child(hard(p.text)))))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.dir))
      .when(r.late, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("recent")));
  }

  render() {
    const t = theme(), rows = this.rows, q = match.parse(this.input.value());
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const name = this.root ? `${this.root.split("/").pop() || this.root}${this.on ? ` on ${this.on}` : ""}` : "";
    const says = this.status(q);
    return v_flex()
      .id("go-to-file")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      // For a key no binding took. The rest count only with the keyboard on the popup itself:
      // Enter in the field comes here too, after its `submit`.
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.close();
        if (!this.handle.is_focused()) return;
        if (e.key === "down") this.move(1);
        else if (e.key === "up") this.move(-1);
        else if (e.key === "enter") this.pick(rows[this.at]);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(div().flex_none().text_size(15).font_semibold().text_color(t.foreground).child("Go to File"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(name))
        .child(div().id("gtf-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .when(Boolean(q.line), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`line ${num(q.line)}`))))
      .when(rows.length > 0, (el) => el.child(v_flex().id("gtf-list").flex_none().h(Math.min(rows.length, TALL) * ROW).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((r, i) => this.row(t, r, i)))))
      .child(h_flex().flex_none().px(4).gap(10).text_size(11).text_color(this.error ? t.blocked : t.dim)
        .child(div().flex_1().min_w(0).truncate().child(says))
        .child(div().flex_none().text_color(t.dim).child("name:12 goes to a line")));
  }
}
