// A text editor that opens as a pane beside the terminals: the files of a tab as a strip of
// tabs, long lines wrapped, find and replace, Markdown shortcuts and a rendered preview.
//
// One editor a tab. The Files panel (`files-actions`) and the Search panel (`project-search`)
// split it in with props { tab } and ask for a file through shared state; the editor that
// belongs to that tab takes the request:
//   file-editor.open   { tab, path, on, at, select? }   path is absolute; on: the machine, null
//                      for here; select: { line (from 1), start, end (in that line) }, what a
//                      search found there, to show selected
//   file-editor.moved  { from, to, on, at }     a file or a folder was renamed or moved
// And it says which file it shows, for the panel to mark it in the tree:
//   file-editor.shown  { [tab]: { path, on } }  no entry: the tab's editor shows no file
//
// Only whole files are edited: one cut short for its size is shown read-only. A file on another
// machine is saved through a shell script there (remote.js). Nothing is saved until asked
// (`save`), and a save is refused when the file changed since it was read: the editor then asks.
// What is open, and every unsaved text, is kept in this copy's localStorage as it is typed, so
// closing the pane, a reload of the mod or a restart loses nothing.
//
// A file git has is held against the last commit: a strip beside the text marks where its
// lines were added, changed or deleted (diff.js), and next-change and prev-change go there.
//
// The editing itself is Herdr's `Editor`: undo, several cursors (Alt-click, Cmd-Alt-Up/Down),
// indenting, bracket pairs, folding. What this mod adds is in edit.js, and reaches it as key
// commands (keys.json, section `mod:file-editor`): save, find, replace, find-next, find-prev,
// escape, preview, close, bold, italic, code, strike, link, bullets, numbers, tasks, comment,
// line-up, line-down, duplicate, next-same, next-change, prev-change, search-project.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, TextView } from "gpui-base";
import { props, shared, setShared, readTextFile, writeTextFile, exec, theme, settings, nextCommand, notify, keys, checking, panes, run } from "herdr";
import * as edit from "./edit.js";
import * as diff from "./diff.js";
import * as remote from "./remote.js";
import * as fieldKeys from "./fieldkeys.js";

const MOD = "file-editor";
// The pane's name while it shows no file.
const TITLE = "File Editor";
const OPEN = "file-editor.open", MOVED = "file-editor.moved", SHOWN = "file-editor.shown";
// The Search panel (`project-search`), and what it reads in shared state (its header).
const SEARCH = "project-search", ASK = "project-search.ask";
// A request older than this was left by a window that closed before it was taken.
const FRESH = 10000;
// More text than this is shown cut short, and read-only.
const MOST = 400000;
// How often the file shown is read again, to notice a change made elsewhere (an agent, git).
const LOOK_EVERY = 5000;
// How long after the last key the unsaved text is put in localStorage.
const STASH_AFTER = 800;
// How long after a key the marks of what changed are worked out again, and the least time
// between two looks at what the last commit has.
const MARK_AFTER = 200, HEAD_EVERY = 2000;
// The strip of marks: its width, and the least height of a mark.
const RULER = 8, MARK = 4;
// The text's size: the terminals' (as Herdr's own Files preview has it since 0.1.17), else SIZE.
// And how tall a row of it is for that size (GPUI's line height, the golden ratio, on whole
// pixels of the zoomed window).
const SIZE = 13;
const textSize = () => Number(settings()?.font_size) || SIZE;
const rowHeight = (zoom, size) => Math.round(size * 1.618034 * zoom) / zoom;
const NO_MARKS = { marks: [], lines: 1 };
// Going to a change: how many lines around it are brought into sight with it, and how long
// the editor is given to scroll between two moves of the cursor.
const AROUND = 3, MOVE_AFTER = 40;
// How long a place asked for is gone to again, when the file turns out to have changed on disk.
const GOAL_FOR = 3000;
const STORE = "state";
const REFOCUS = 300, REFOCUS_SOON = 60;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", markdown: "md", mdx: "md" };
const MARKDOWN = /\.(md|markdown|mdx)$/i;

const base = path => path.slice(path.lastIndexOf("/") + 1);
const same = (a, b) => Boolean(a && b) && a.start === b.start && a.end === b.end;
const idOf = (path, on) => `${on ?? ""}\n${path}`;

// "cmd-shift-z" as a Mac shows it: "⇧⌘Z".
const SIGN = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
const KEY = { up: "↑", down: "↓", left: "←", right: "→", enter: "↩", escape: "Esc" };
function keyLabel(chord) {
  const parts = chord.split("-"), key = parts.pop() || "-";
  return ["ctrl", "alt", "shift", "cmd"].filter(m => parts.includes(m)).map(m => SIGN[m]).join("") + (KEY[key] ?? (key.length === 1 ? key.toUpperCase() : key));
}
// What a control says when pointed at: what it does, and the key bound to it.
function hint(text, command) {
  const bound = keys().find(k => k.action === `${MOD}.${command}` && !k.keys.includes(" "));
  return bound ? `${text} (${keyLabel(bound.keys)})` : text;
}

export default class FileEditor extends View {
  init(_props, cx) {
    this.tab = props()?.tab ?? null;
    this.docs = []; // the open files, in the strip's order (see load())
    this.active = null; // the id of the one shown
    this.serial = 0;
    this.seen = { open: 0, moved: Date.now() };
    // The pane's own place for the keyboard, for when no text can take it (the preview, no
    // file): the keys in `mod:file-editor` count only while the keyboard is in this pane.
    this.handle = cx.focus_handle();
    // Cmd+F and Cmd+Shift+F in the text (keys.json, `mod:file-editor > Input`): see fieldkeys.js.
    fieldKeys.bind(MOD, cx);
    this.find = { open: false, replacing: false, cs: false, regex: false, matches: [], at: -1, error: null, focused: null };
    this.query = InputState.new({ placeholder: "Find" });
    this.to = InputState.new({ placeholder: "Replace" });
    this.query.on("change", (_e, cx) => { this.search(true); cx.notify(); });
    this.query.on("submit", (e, cx) => { if (e.secondary) this.goTo(); else this.step(e.shift ? -1 : 1); cx.notify(); });
    this.to.on("submit", (_e, cx) => { this.replaceOne(); cx.notify(); });
    for (const [name, input] of [["query", this.query], ["to", this.to]]) {
      input.on("focus", (_e, cx) => { this.find.focused = name; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.find.focused === name) this.find.focused = null; cx.notify(); });
    }
    this.restore(cx);
    cx.spawn(async cx => {
      for (;;) { const command = await nextCommand(); this.command(command, cx); cx.notify(); }
    });
    // A file on another machine is read again when its tab is shown, not on a timer.
    if (!checking()) cx.timer.every(LOOK_EVERY, cx => { const d = this.doc(); if (d && !d.on) { this.look(d, cx); this.head(d, cx); } });
  }

  // The pane is going (or the app): what was typed is kept for the next time.
  async close() {
    this.store();
    if (this.tab) this.say(null);
  }

  doc() {
    return this.docs.find(d => d.id === this.active) ?? null;
  }

  // The file shown, when it can be changed now.
  editable() {
    const d = this.doc();
    return d && d.state && !d.readonly && !d.preview ? d : null;
  }

  // What is open and what is unsaved, in localStorage.
  store() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        active: this.active,
        open: this.docs.map(d => ({ path: d.path, on: d.on, preview: d.preview, ...(d.dirty && d.state ? { draft: d.text, base: d.base } : {}) })),
      }));
    } catch (e) { console.log(`${MOD}: could not keep the open files: ${e}`); }
  }

  // Soon: once for a burst of typing.
  stash(cx) {
    if (this.stashing) return;
    this.stashing = true;
    cx.timer.after(STASH_AFTER, () => { this.stashing = false; this.store(); });
  }

  restore(cx) {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { kept = null; }
    for (const o of kept?.open ?? []) {
      if (typeof o?.path === "string") this.load({ path: o.path, on: o.on ?? null, preview: Boolean(o.preview), draft: o.draft, base: o.base }, cx, false);
    }
    if (this.docs.some(d => d.id === kept?.active)) this.active = kept.active;
  }

  // Opens `path`, or shows it when it is open already. `kept`: what was unsaved the last time
  // ({ draft, base: the file's text the draft began from }).
  load(o, cx, show = true) {
    const id = idOf(o.path, o.on);
    let d = this.docs.find(d => d.id === id);
    // Herdr focuses the pane after the click that asked for the file, which can take the
    // keyboard from the text again: so it is taken once more, a moment later.
    if (show) cx.timer.after(REFOCUS, () => { if (this.active === id && !this.find.focused) this.focus(); });
    // What a search found is gone to a moment later: once the text is drawn, and after
    // Herdr has focused the pane, which takes the keyboard (and so the selection) from it.
    const reveal = d => { if (show && o.select) cx.timer.after(REFOCUS_SOON, cx => { if (this.active === d.id) this.reveal(d, o.select, cx); }); };
    if (d) {
      if (show) { this.active = id; this.focus(); this.look(d, cx); this.head(d, cx); reveal(d); }
      return;
    }
    d = {
      id, n: ++this.serial, path: o.path, on: o.on ?? null, name: base(o.path), markdown: MARKDOWN.test(o.path),
      state: null, // Herdr's editor for it, once read
      base: null, // the file's text as last read or saved: what a save must still find there. null: no file
      text: "", prev: "", // the editor's text now, and before the last change
      dirty: false, readonly: null, // or why, as the pane says it
      preview: Boolean(o.preview), error: null,
      notice: null, // "changed": on disk under unsaved text (`disk` has it); "gone"; "closing": asked to close unsaved
      disk: null, saving: false, looking: false,
      head: null, oid: null, // the file as the last commit has it, and git's name for that. null: git has none
      diff: NO_MARKS, drawn: "", // the lines that differ from `head` (diff.js), and the same as drawn
      stale: false, marking: false, cost: 0, heading: false, headAt: 0,
    };
    this.docs.push(d);
    if (show || !this.active) this.active = id;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(d.path, { on: d.on });
        if (!this.docs.includes(d)) return;
        const draft = typeof o.draft === "string" ? o.draft : null;
        if (text === null && draft === null) { d.error = "This file is no longer there"; return; }
        if (text?.includes("\0")) { d.error = "A binary file: there is no text to show"; return; }
        const long = (text?.length ?? 0) > MOST;
        // From another machine the text comes decoded leniently: bytes that are not UTF-8 would
        // be saved back as something else.
        d.readonly = long ? "Read-only: the file is too large to edit here"
          : d.on && text?.includes("\ufffd") ? "Read-only: the file is not plain UTF-8 text" : null;
        const shown = draft ?? (long ? text.slice(0, MOST) + "\n… (cut short)" : text);
        d.base = draft !== null ? o.base ?? null : text;
        d.text = d.prev = shown;
        d.dirty = draft !== null && draft !== d.base;
        // The file moved on while the unsaved text waited.
        if (draft !== null && text !== d.base) { if (text === null) { d.base = null; d.notice = "gone"; } else { d.notice = "changed"; d.disk = text; } }
        const t = theme(), ext = d.name.includes(".") ? d.name.split(".").pop().toLowerCase() : "txt";
        d.state = EditorState.new({
          language: LANG[ext] ?? ext, value: shown, readonly: Boolean(d.readonly), soft_wrap: true,
          font_family: settings().font_family, font_size: textSize(),
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
        });
        d.state.on("change", (_e, cx) => this.changed(d, cx));
        d.state.on("submit", (e, cx) => this.entered(d, e, cx));
        d.state.on("focus", (_e, cx) => { this.look(d, cx); this.head(d, cx); });
        if (show && this.active === d.id) this.focus();
        reveal(d);
        this.head(d, cx);
      } catch (e) {
        d.error = "This file can't be shown (too large, or unreadable)";
        console.log(`${MOD}: ${d.path}: ${e}`);
      } finally {
        if (show) this.store();
        cx.notify();
      }
    });
  }

  // The keyboard comes here: to the text, or to the pane itself when there is none to type in.
  focus() {
    const d = this.doc();
    if (d?.state && !d.preview) d.state.focus(); else this.handle.focus();
  }

  // The text changed, by typing or by a command.
  changed(d, cx) {
    const text = d.state.value();
    if (text === d.text) return;
    d.prev = d.text;
    d.text = text;
    const dirty = !d.readonly && text !== d.base;
    const searching = this.find.open && d.id === this.active;
    if (searching) this.search(false);
    if (dirty !== d.dirty || searching) { d.dirty = dirty; cx.notify(); }
    if (!d.readonly) this.stash(cx);
    this.remark(d, cx);
  }

  // Enter was pressed: its line break is in already. In Markdown, a list goes on.
  entered(d, e, cx) {
    if (!d.markdown || d.readonly || e?.shift || e?.secondary) return;
    const sel = d.state.selected_range();
    if (sel.start !== sel.end) return;
    this.apply(d, edit.continued(d.prev, d.text, sel.start));
    cx.notify();
  }

  // One change to the text, and where the selection goes after it (edit.js).
  apply(d, r) {
    if (!r || !d?.state) return false;
    if (r.range) { d.state.set_selected_range(r.range); d.state.replace(r.insert); }
    if (r.select) d.state.set_selected_range(r.select);
    return true;
  }

  // Reads the file again: a change made elsewhere is shown at once when nothing is unsaved
  // here, and asked about when something is.
  look(d, cx) {
    if (!d?.state || d.looking || d.saving || d.notice === "changed") return;
    d.looking = true;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(d.path, { on: d.on });
        if (!this.docs.includes(d) || d.saving) return;
        if (text === null) {
          if (d.base !== null && !d.readonly) { d.base = null; d.dirty = true; d.notice = "gone"; this.store(); cx.notify(); }
          return;
        }
        if (text === d.base || text.includes("\0") || text.length > MOST) return;
        if (d.dirty && d.text !== text) { d.notice = "changed"; d.disk = text; }
        else {
          this.take(d, text);
          // The place just asked for is another one in the new text.
          if (d.goal && Date.now() - d.goal.at < GOAL_FOR && this.active === d.id) this.reveal(d, d.goal.select, cx);
        }
        cx.notify();
      } catch { /* unreadable for now: the next look tries again */ }
      finally { d.looking = false; }
    });
  }

  // The file's text, as it is on disk, becomes the editor's.
  take(d, text) {
    const sel = d.state.selected_range();
    d.base = d.text = d.prev = text;
    d.dirty = false; d.notice = null; d.disk = null;
    d.state.set_value(text);
    const at = Math.min(sel.start, text.length);
    d.state.set_selected_range({ start: at, end: at });
    if (this.find.open && d.id === this.active) this.search(false);
    this.mark(d);
    this.store();
  }

  // Reads the file as the last commit has it, when that is not what was read before: the
  // lines that differ from it are marked. A file git doesn't have, in a repository or outside
  // one, has no marks. Only whole files: one cut short would differ in its end.
  head(d, cx) {
    if (!d?.state || d.readonly || d.heading || Date.now() - d.headAt < HEAD_EVERY) return;
    d.heading = true; d.headAt = Date.now();
    const path = d.path, here = () => this.docs.includes(d) && d.path === path;
    const git = (...args) => exec("git", args, { cwd: path.slice(0, path.lastIndexOf("/")) || "/", on: d.on, timeout: 10000 });
    cx.spawn(async cx => {
      try {
        const at = await git("rev-parse", "--verify", "--quiet", `HEAD:./${d.name}`);
        const oid = at.code === 0 ? at.stdout.trim() : null;
        if (!here() || oid === d.oid) return;
        let text = null;
        if (oid) {
          const blob = await git("cat-file", "blob", oid);
          if (!here() || blob.code !== 0) return;
          if (!blob.stdout.includes("\0") && blob.stdout.length <= MOST) text = blob.stdout;
        }
        d.oid = oid; d.head = text;
        if (this.mark(d)) cx.notify();
      } catch { /* no git, or the machine is away: the next look tries again */ }
      finally { d.heading = false; }
    });
  }

  // Works the marks out again. True when they are no longer the ones drawn.
  mark(d) {
    const began = Date.now();
    d.stale = false;
    d.diff = d.head === null ? NO_MARKS : diff.compare(d.head, d.text);
    d.cost = Date.now() - began;
    const now = JSON.stringify(d.diff), differs = now !== d.drawn;
    d.drawn = now;
    return differs;
  }

  // Soon, and once for a burst of typing: the longer the last time took, the later.
  remark(d, cx) {
    d.stale = true;
    if (d.marking || d.head === null) return;
    d.marking = true;
    cx.timer.after(Math.max(MARK_AFTER, d.cost * 10), cx => {
      d.marking = false;
      if (d.stale && this.docs.includes(d) && this.mark(d)) cx.notify();
    });
  }

  // To the next change (`by` 1) or the one before (-1), from the cursor and going round, or
  // to `mark`. Its lines are selected, which is what shows them: the keyboard goes to the text.
  //
  // The editor scrolls only as far as the first line selected needs, which coming from above
  // is the pane's last row: the change itself would stay out of sight. And of two moves made
  // at once it follows the last only. So the cursor goes there in three moves, a frame or
  // two apart: under the change, above it, then the change. Whichever side it comes from,
  // the change's first lines end up in sight, with a few of the lines around them.
  change(by, mark, cx) {
    const d = this.doc();
    if (!d?.state || d.preview) return;
    if (d.stale) this.mark(d);
    const m = mark ?? diff.next(d.diff.marks, edit.position(d.text, d.state.selected_range().start).line - 1, by);
    if (!m) return;
    const text = d.text, lines = d.diff.lines;
    const at = line => { const o = diff.range(text, { line: Math.max(0, Math.min(lines - 1, line)), count: 0 }).start; return { start: o, end: o }; };
    this.travel(d, [at(m.line + m.count + AROUND), at(m.line - AROUND), diff.range(text, m)], cx);
  }

  // The cursor goes through `moves` (selections of the text as it is now), a frame or two
  // apart, and the keyboard goes to the text: see change().
  travel(d, moves, cx) {
    const text = d.text;
    const turn = this.turn = (this.turn ?? 0) + 1;
    const move = (i, cx) => {
      // Not when another jump began meanwhile, or the text is no longer what was measured.
      if (turn !== this.turn || this.doc() !== d || d.text !== text) return;
      d.state.set_selected_range(moves[i]);
      if (i + 1 < moves.length) cx.timer.after(MOVE_AFTER, cx => move(i + 1, cx));
    };
    move(0, cx);
    d.state.focus();
  }

  // Shows what a search found: `select` is { line (from 1), start, end (in that line) }. Its
  // text is selected, which is what shows it, and brought into sight as a change is. The line
  // is counted in the editor's text: with unsaved typing above it, it is the wrong one.
  reveal(d, select, cx) {
    const line = Math.floor(Number(select?.line)) - 1;
    if (!d?.state || !(line >= 0)) return;
    d.goal = { select, at: d.goal?.select === select ? d.goal.at : Date.now() };
    // The rendered page has no selection to show.
    if (d.preview) { d.preview = false; this.store(); }
    const text = d.text, whole = diff.range(text, { line, count: 1 });
    const within = n => Math.max(whole.start, Math.min(whole.end, whole.start + (Number(n) || 0)));
    const at = n => { const o = diff.range(text, { line: Math.max(0, n), count: 0 }).start; return { start: o, end: o }; };
    this.travel(d, [at(line + AROUND), at(line - AROUND), { start: within(select.start), end: within(select.end) }], cx);
  }

  // `then`: what a save that went through is followed by.
  save(d, cx, then) {
    if (!d?.state || d.readonly || d.saving || !d.dirty) return;
    const text = d.state.value();
    d.saving = true;
    cx.spawn(async cx => {
      try {
        if (d.on) await remote.write(d.path, d.on, text, d.base); else await writeTextFile(d.path, text, d.base);
        d.base = text;
        d.dirty = d.state.value() !== text;
        d.notice = null; d.disk = null;
        this.store();
        then?.(cx);
      } catch (e) {
        // Refused: the file is not what was read. See what it is now, and ask.
        const disk = await readTextFile(d.path, { on: d.on }).catch(() => undefined);
        if (disk === null) { d.base = null; d.notice = "gone"; }
        else if (typeof disk === "string" && disk !== d.base) { d.notice = "changed"; d.disk = disk; }
        else notify({ title: `Couldn't save “${d.name}”`, body: String(e?.message ?? e), level: "error" });
      } finally { d.saving = false; cx.notify(); }
    });
  }

  // Closes a file's tab. Unsaved text is asked about first.
  shut(d, cx, sure = false) {
    if (!d) return;
    if (d.dirty && !sure) { d.notice = "closing"; this.active = d.id; return; }
    const at = this.docs.indexOf(d);
    this.docs.splice(at, 1);
    d.state?.release();
    if (this.active === d.id) { this.active = (this.docs[at] ?? this.docs[at - 1])?.id ?? null; this.focus(); }
    this.find.matches = []; this.find.at = -1;
    if (this.find.open) this.search(false);
    this.store();
  }

  // The rendered page has no selection to show a match by, nor a way to scroll to one: finding
  // goes back to the text, as a result of the Search panel does (reveal()).
  unpreview(d) {
    if (d?.preview) { d.preview = false; this.store(); }
  }

  // Finds the query again in the file shown. `reveal`: go to the first match from the cursor on.
  search(reveal) {
    const f = this.find, d = this.doc();
    const r = d?.state ? edit.find(d.text, this.query.value(), f) : { matches: [] };
    f.matches = r.matches; f.error = r.error ?? null;
    const sel = d?.state ? d.state.selected_range() : { start: 0, end: 0 };
    f.at = f.matches.findIndex(m => same(m, sel));
    if (reveal && f.matches.length && d) {
      this.unpreview(d);
      const from = f.at >= 0 ? f.at : f.matches.findIndex(m => m.start >= sel.start);
      f.at = from < 0 ? 0 : from;
      d.state.set_selected_range(f.matches[f.at]);
    }
  }

  // To the next match (`by` 1) or the one before (-1), from the cursor, going round.
  step(by) {
    const f = this.find, d = this.doc(), n = f.matches.length;
    if (!d?.state || !n) return;
    this.unpreview(d);
    const sel = d.state.selected_range();
    let at = f.matches.findIndex(m => same(m, sel));
    if (at >= 0) at = (at + by + n) % n;
    else if (by > 0) { at = f.matches.findIndex(m => m.start >= sel.start); if (at < 0) at = 0; }
    else { at = n - 1; while (at > 0 && f.matches[at].end > sel.start) at--; if (f.matches[at].end > sel.start) at = n - 1; }
    f.at = at;
    d.state.set_selected_range(f.matches[at]);
  }

  // The keyboard goes to the text, with the current match selected: there it shows.
  goTo() {
    const f = this.find, d = this.doc();
    if (!d?.state) return;
    this.unpreview(d);
    if (f.at >= 0 && f.matches[f.at]) d.state.set_selected_range(f.matches[f.at]);
    d.state.focus();
  }

  // Replaces the match selected and goes to the next; with none selected, only goes to one.
  replaceOne() {
    const f = this.find, d = this.editable();
    if (!d || !f.matches.length) return;
    const sel = d.state.selected_range(), m = f.matches.find(m => same(m, sel));
    if (!m) return this.step(1);
    const insert = edit.replacement(d.text.slice(m.start, m.end), this.query.value(), f, this.to.value());
    const at = m.start + insert.length;
    this.apply(d, { range: m, insert, select: { start: at, end: at } });
    this.search(false);
    this.step(1);
  }

  replaceAll() {
    const d = this.editable();
    if (!d) return;
    const r = edit.replaceAll(d.text, this.query.value(), this.find, this.to.value());
    if (!r.count) return;
    const at = Math.min(d.state.selected_range().start, r.text.length);
    this.apply(d, { range: { start: 0, end: d.text.length }, insert: r.text, select: { start: at, end: at } });
    this.search(false);
    notify({ title: `Replaced ${r.count} ${r.count === 1 ? "match" : "matches"}`, body: `in ${d.name}` });
  }

  openFind(replacing) {
    const f = this.find, d = this.doc();
    this.unpreview(d);
    f.open = true;
    if (replacing) f.replacing = true;
    // What is selected, on one line, is what is looked for.
    const sel = d?.state ? d.state.selected_range() : null;
    const picked = sel && sel.end > sel.start ? d.text.slice(sel.start, sel.end) : "";
    if (picked && !picked.includes("\n")) this.query.set_value(picked);
    this.query.set_selected_range({ start: 0, end: this.query.value().length });
    this.query.focus();
    this.search(false);
  }

  closeFind() {
    this.find.open = false;
    this.find.replacing = false;
    this.focus();
  }

  // A key command (keys.json), or a button here.
  command(name, cx) {
    const d = this.doc();
    if (name === "focus") return this.focus();
    if (name === "save") return this.save(d, cx);
    if (name === "find") return this.openFind(false);
    if (name === "replace") return this.openFind(true);
    if (name === "find-next") return this.step(1);
    if (name === "find-prev") return this.step(-1);
    if (name === "escape") { if (d?.notice === "closing") d.notice = null; else if (this.find.open) this.closeFind(); return; }
    if (name === "close") return this.shut(d, cx);
    if (name === "next-change") return this.change(1, null, cx);
    if (name === "prev-change") return this.change(-1, null, cx);
    if (name === "search-project") {
      // What is selected, on one line, is what is looked for: as in the find bar.
      const sel = d?.state && !d.preview ? d.state.selected_range() : null;
      const picked = sel && sel.end > sel.start ? d.text.slice(sel.start, sel.end) : "";
      setShared(ASK, { ...(picked && !picked.includes("\n") ? { query: picked } : {}), at: Date.now() });
      return void run(`${SEARCH}.open`);
    }
    if (name === "preview") {
      if (!d?.markdown || !d.state) return;
      d.preview = !d.preview;
      this.store();
      return this.focus();
    }
    // The rest changes the text: not while a find field has the keyboard.
    const e = this.editable();
    if (!e || this.find.focused) return;
    const text = e.text, sel = e.state.selected_range();
    const r = name === "bold" ? edit.wrap(text, sel, "**") : name === "italic" ? edit.wrap(text, sel, "_")
      : name === "code" ? edit.wrap(text, sel, "`") : name === "strike" ? edit.wrap(text, sel, "~~")
      : name === "link" ? edit.link(text, sel)
      : name === "bullets" ? edit.list(text, sel, "bullet") : name === "numbers" ? edit.list(text, sel, "number") : name === "tasks" ? edit.list(text, sel, "task")
      : name === "comment" ? edit.comment(text, sel, edit.commentOf(e.name))
      : name === "line-up" ? edit.move(text, sel, -1) : name === "line-down" ? edit.move(text, sel, 1)
      : name === "duplicate" ? edit.duplicate(text, sel)
      : name === "next-same" ? edit.nextSame(text, sel) : null;
    this.apply(e, r);
  }

  // What the Files panel left in shared state, for this tab's editor.
  requests(cx) {
    const o = shared(OPEN);
    if (o && o.tab === this.tab && o.at !== this.seen.open && typeof o.path === "string") {
      this.seen.open = o.at;
      cx.spawn(async cx => {
        if (shared(OPEN)?.at === o.at) setShared(OPEN, null);
        if (Date.now() - o.at < FRESH) this.load({ path: o.path, on: o.on ?? null, select: o.select ?? null }, cx);
        cx.notify();
      });
    }
    const m = shared(MOVED);
    if (m && m.at > this.seen.moved && typeof m.from === "string" && typeof m.to === "string") {
      this.seen.moved = m.at;
      let any = false;
      for (const d of this.docs) {
        if ((d.on ?? null) !== (m.on ?? null) || !(d.path === m.from || d.path.startsWith(m.from + "/"))) continue;
        const was = d.id;
        d.path = m.to + d.path.slice(m.from.length); d.name = base(d.path); d.id = idOf(d.path, d.on);
        if (this.active === was) this.active = d.id;
        if (d.notice === "gone") d.notice = null;
        // Under its new name git may have another file, or none.
        d.head = d.oid = null; d.headAt = 0; this.mark(d);
        any = true;
      }
      if (any) cx.spawn(async () => this.store());
    }
  }

  // Leaves the file shown in shared state, where the Files panel reads it. Only when it is
  // another one than the last told: setting shared state draws every mod again, this one too.
  tell(cx) {
    const now = this.doc()?.id ?? "";
    if (!this.tab || now === this.told) return;
    this.told = now;
    cx.spawn(async () => { const d = this.doc(); this.told = d?.id ?? ""; this.say(d); await null; this.name(d); });
  }

  // The pane is named after the file it shows (its header says so), and TITLE with none: a mod
  // pane's own title is its folder's name. A name someone gave it is left alone: one that is
  // none of TITLE, the last this copy gave and an open file's. Herdr keeps the name with the tab,
  // so after a restart it is one of those.
  name(d) {
    const me = panes().find(p => p.mod === MOD && p.tab === this.tab);
    if (!me) return;
    const want = d?.name ?? TITLE, has = me.name ?? "";
    const ours = !has || has === TITLE || has === this.named || this.docs.some(o => o.name === has);
    if (has === want || !ours) return;
    this.named = want;
    run("pane.rename", { pane: me.pane, name: want });
  }

  say(d) {
    const all = { ...shared(SHOWN) };
    if (d) all[this.tab] = { path: d.path, on: d.on }; else delete all[this.tab];
    setShared(SHOWN, all);
  }

  button(t, id, label, tip, action, o = {}) {
    return h_flex().id(id).h(24).min_w(24).px(7).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(o.on ? t.foreground : t.muted)
      .when(Boolean(o.on), el => el.bg(t.selected))
      .when(Boolean(o.bold), el => el.font_semibold())
      .when(Boolean(o.italic), el => el.italic())
      .when(Boolean(o.off), el => el.opacity(0.4))
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => { if (!o.off) action(cx); cx.notify(); })
      .child(label);
  }

  strip(t, d) {
    return h_flex().id("fe-strip").h(36).flex_none().pl(6).pr(8).gap(2).items_center().border_b(1).border_color(t.border).bg(t.background)
      // On the click, not the press: the press gives the keyboard to the pane itself.
      .on_click(() => this.focus())
      .child(h_flex().id("fe-tabs").flex_1().min_w(0).h_full().gap(2).items_center().overflow_x_scroll()
        .children(this.docs.map(o => {
          const on = o.id === this.active;
          return h_flex().id(`fe-tab-${o.n}`).h(26).flex_none().max_w(220).pl(9).pr(4).gap(6).items_center().rounded(7).cursor_pointer()
            .text_size(12.5).text_color(on ? t.foreground : t.muted)
            .when(on, el => el.bg(t.selected))
            .when(!on, el => el.hover(s => s.bg(t.hover)))
            .tooltip(o.on ? `${o.on}: ${o.path}` : o.path)
            .on_click((_e, cx) => { this.active = o.id; if (this.find.open) this.search(false); this.focus(); this.look(o, cx); this.head(o, cx); this.store(); cx.notify(); })
            .child(div().min_w(0).truncate().child(o.name))
            .child(h_flex().id(`fe-shut-${o.n}`).size(18).flex_none().items_center().justify_center().rounded(5)
              .text_size(o.dirty ? 9 : 13).text_color(o.dirty ? t.foreground : t.dim)
              .hover(s => s.bg(t.raised).text_color(t.foreground))
              .tooltip(o.dirty ? "Unsaved · close" : "Close")
              .on_click((_e, cx) => { cx.stop_propagation(); this.shut(o, cx); cx.notify(); })
              .child(o.dirty ? "●" : "×"));
        })))
      .when(Boolean(d?.state), el => el
        .when(Boolean(d.markdown), el => el.child(this.button(t, "fe-preview", d.preview ? "Edit" : "Preview", hint(d.preview ? "Back to the text" : "Show it rendered", "preview"), cx => this.command("preview", cx), { on: d.preview })))
        .when(d.diff.marks.length > 0 && !d.preview, el => el.child(this.button(t, "fe-changes", `±${d.diff.marks.length}`,
          hint(`${d.diff.marks.length === 1 ? "1 change" : `${d.diff.marks.length} changes`} since the last commit: go to the next`, "next-change"), cx => this.command("next-change", cx))))
        .child(this.button(t, "fe-find", "Find", hint("Find in this file", "find"), cx => this.command("find", cx), { on: this.find.open }))
        .when(!d.readonly, el => el.child(this.button(t, "fe-save", d.saving ? "Saving…" : "Save", hint(d.dirty ? "Save" : "Nothing to save", "save"), cx => this.command("save", cx), { off: !d.dirty }))));
  }

  // Markdown's own row: what the shortcuts do, as buttons.
  tools(t) {
    const b = (name, label, tip, o) => this.button(t, `fe-md-${name}`, label, hint(tip, name), cx => { this.command(name, cx); this.focus(); }, o);
    return h_flex().id("fe-tools").h(32).flex_none().px(6).gap(1).items_center().border_b(1).border_color(t.border).overflow_hidden()
      .child(b("bold", "B", "Bold", { bold: true }))
      .child(b("italic", "I", "Italic", { italic: true }))
      .child(b("strike", "S", "Strikethrough"))
      .child(b("code", "</>", "Code"))
      .child(b("link", "Link", "Link"))
      .child(div().w(1).h(14).mx(5).flex_none().bg(t.border))
      .child(b("bullets", "• List", "Bulleted list"))
      .child(b("numbers", "1. List", "Numbered list"))
      .child(b("tasks", "☐ Tasks", "Task list: again ticks them"));
  }

  finder(t, d) {
    const f = this.find, n = f.matches.length, has = Boolean(this.query.value());
    const count = f.error ? "Not a pattern" : !has ? "" : !n ? "No results" : f.at >= 0 ? `${f.at + 1} of ${n}` : `${n} found`;
    const field = (state, name) => Input.new(state).h(26).flex_1().min_w(60).px(8).rounded(6).border_1()
      .border_color(name === "query" && (f.error || (has && !n)) ? t.blocked : f.focused === name ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const can = !d.readonly && !d.preview;
    // Where the match is: the text shows a selection only while it has the keyboard, and here
    // the field has it. So the bar says the line, and shows the match in it.
    const m = !d.preview && f.at >= 0 ? f.matches[f.at] : null;
    const at = m ? edit.position(d.text, m.start) : null;
    const lineEnd = m ? (d.text.indexOf("\n", m.end) < 0 ? d.text.length : d.text.indexOf("\n", m.end)) : 0;
    const part = m ? {
      before: d.text.slice(Math.max(m.start - at.column + 1, m.start - 32), m.start).trimStart(),
      hit: d.text.slice(m.start, Math.min(m.end, m.start + 80)).split("\n")[0],
      after: d.text.slice(m.end, Math.max(m.end, Math.min(lineEnd, m.end + 80))),
    } : null;
    return v_flex().id("fe-find-bar").flex_none().px(8).py(6).gap(6).border_b(1).border_color(t.border).bg(t.surface)
      .child(h_flex().gap(4).items_center()
        .child(this.button(t, "fe-find-more", f.replacing ? "▾" : "▸", hint("Replace", "replace"), () => { f.replacing = !f.replacing; }, { off: !can }))
        .child(field(this.query, "query"))
        .child(div().w(74).flex_none().text_right().text_size(11.5).text_color(f.error || (has && !n) ? t.blocked : t.dim).child(count))
        .child(this.button(t, "fe-find-cs", "Aa", "Match case", () => { f.cs = !f.cs; this.search(true); }, { on: f.cs }))
        .child(this.button(t, "fe-find-re", ".*", "Regular expression", () => { f.regex = !f.regex; this.search(true); }, { on: f.regex }))
        .child(this.button(t, "fe-find-prev", "↑", hint("Previous match", "find-prev"), () => this.step(-1), { off: !n }))
        .child(this.button(t, "fe-find-next", "↓", hint("Next match", "find-next"), () => this.step(1), { off: !n }))
        .child(this.button(t, "fe-find-shut", "×", hint("Close", "escape"), () => this.closeFind())))
      .when(Boolean(part), el => el.child(h_flex().id("fe-find-line").ml(26).pl(4).pr(4).h(22).gap(10).items_center().rounded(5).cursor_pointer().text_size(11.5)
        .hover(s => s.bg(t.hover))
        .tooltip("Go to this line, with the keyboard in the text (⌘↩)")
        .on_click((_e, cx) => { this.goTo(); cx.notify(); })
        .child(div().flex_none().text_color(t.accent).child(`Go to line ${at.line}`))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_color(t.muted)
          .child(div().flex_none().child(part.before))
          .child(div().flex_none().px(1).rounded(3).bg(t.selection).text_color(t.foreground).child(part.hit))
          .child(div().flex_1().min_w(0).truncate().child(part.after)))))
      .when(f.replacing && can, el => el.child(h_flex().gap(4).items_center().pl(28)
        .child(field(this.to, "to"))
        .child(this.button(t, "fe-find-one", "Replace", "Replace this match, and go to the next (↩)", () => this.replaceOne(), { off: !n }))
        .child(this.button(t, "fe-find-all", "Replace all", "Replace every match", () => this.replaceAll(), { off: !n }))));
  }

  // The strip beside the text: the file from top to bottom, with a mark where its lines differ
  // from the last commit. It is a map and not a margin: Herdr's editor gives a mod nothing to
  // draw beside a line, and doesn't say how far it is scrolled. So the strip is as tall as the
  // file's lines would be, and no taller than the pane: a short file's marks are level with
  // their lines (until a long line wraps above them), a long file's show where to scroll to.
  // A click goes to the lines.
  ruler(t, d) {
    const lines = Math.max(1, d.diff.lines), color = { added: t.ansi2, changed: t.ansi4, deleted: t.ansi1 };
    return div().w(RULER).flex_none().border_l(1).border_color(t.border)
      .child(div().id(`fe-ruler-${d.n}`).relative().w_full().h(lines * rowHeight(settings().zoom || 1, textSize())).max_h("100%").overflow_hidden()
        .children(d.diff.marks.map((m, i) => {
          // What reaches the last line hangs from the bottom, so its least height stays inside.
          const last = m.line + Math.max(1, m.count) >= lines;
          return div().id(`fe-mark-${d.n}-${i}`).absolute().left(0).w_full().min_h(MARK).cursor_pointer()
            .when(last, el => el.bottom(0))
            .when(!last, el => el.top(`${(m.line / lines) * 100}%`))
            .h(`${(m.count / lines) * 100}%`)
            .tooltip(diff.say(m))
            .on_click((_e, cx) => { this.change(0, m, cx); cx.notify(); })
            .child(div().ml(2).w(4).h_full().min_h(MARK).rounded(1).bg(color[m.kind]));
        })));
  }

  // A line that asks: a file changed under unsaved text, gone, or closing with unsaved text.
  notice(t, d) {
    const act = (id, label, action, primary) => h_flex().id(id).h(24).px(10).flex_none().items_center().rounded(6).cursor_pointer()
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12).hover(s => s.opacity(0.88)).on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
    const row = (text, ...actions) => h_flex().id("fe-notice").flex_none().min_h(38).px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border).bg(t.surface)
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(text)).children(actions);
    if (d.notice === "closing") return row(`“${d.name}” has unsaved changes.`,
      act("fe-n-cancel", "Cancel", () => { d.notice = null; this.focus(); }),
      act("fe-n-discard", "Discard", cx => this.shut(d, cx, true)),
      act("fe-n-save", "Save", cx => { d.notice = null; this.save(d, cx, cx => this.shut(d, cx)); }, true));
    if (d.notice === "changed") return row("This file changed on disk while it was being edited here.",
      act("fe-n-theirs", "Load the file", () => this.take(d, d.disk)),
      // What is on disk now is what a save may replace.
      act("fe-n-mine", "Keep my text", () => { d.base = d.disk; d.disk = null; d.notice = null; d.dirty = d.text !== d.base; this.store(); this.focus(); }, true));
    if (d.notice === "gone") return row("This file is no longer on disk: it was moved or deleted. Saving writes it again.",
      act("fe-n-ok", "OK", () => { d.notice = null; this.focus(); }));
    return null;
  }

  // The pane became the focused one (its header was clicked, `pane.focus`): Herdr gives a mod
  // pane no keyboard by that, so it is taken here. A moment later, and not from a find field,
  // which a click may just have given it.
  arrived(cx) {
    const me = panes().find(p => p.mod === MOD && p.tab === this.tab);
    const focused = Boolean(me?.focused);
    if (focused && !this.wasFocused) cx.timer.after(REFOCUS_SOON, () => { if (!this.find.focused) this.focus(); });
    this.wasFocused = focused;
  }

  // A key went down in the text and no binding took it: it is about to be typed. Over a
  // selection, a character that opens a pair wraps the selection instead (edit.js).
  typed(e, cx) {
    const m = e.modifiers ?? {}, ch = e.key_char;
    if (!ch || ch.length !== 1 || m.control || m.alt || m.platform || m.function) return;
    const d = this.editable();
    if (!d || this.find.focused) return;
    if (!this.apply(d, edit.surround(d.text, d.state.selected_range(), ch, d.markdown))) return;
    cx.stop_propagation();
    cx.notify();
  }

  render(cx) {
    fieldKeys.watch(MOD, cx);
    this.requests(cx);
    this.arrived(cx);
    this.tell(cx);
    const t = theme(), d = this.doc();
    const empty = text => v_flex().id("fe-empty").flex_1().min_h(0).items_center().justify_center().p(24).text_size(13).text_color(t.dim)
      .on_mouse_down("left", () => this.handle.focus()).child(text);
    return v_flex().id("file-editor").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .child(this.strip(t, d))
      .when(Boolean(d?.state && d.markdown && !d.preview && !d.readonly), el => el.child(this.tools(t)))
      .when(Boolean(d?.state && this.find.open), el => el.child(this.finder(t, d)))
      .when(Boolean(d?.state && d.notice), el => el.child(this.notice(t, d)))
      .when(Boolean(d?.state && d.readonly), el => el.child(div().flex_none().px(12).py(5).border_b(1).border_color(t.border).text_size(11.5).text_color(t.dim).child(d.readonly)))
      .child(!d ? empty("Click a file in the Files panel to open it here")
        : !d.state ? empty(d.error ?? "Loading…")
        : d.preview ? div().id(`fe-view-${d.n}`).flex_1().min_h(0).overflow_y_scrollbar().px(28).py(20)
            .on_mouse_down("left", () => this.handle.focus())
            .child(div().w_full().max_w(820).child(TextView.markdown(`fe-md-${d.n}`, d.text).selectable(true)))
        : h_flex().flex_1().min_h(0).items_stretch()
            .child(v_flex().id(`fe-text-${d.n}`).flex_1().min_w(0).min_h(0).on_key_down((e, cx) => this.typed(e, cx))
              .child(Editor.new(d.state).font_family(settings().font_family).text_size(textSize()).flex_1().min_h(0)))
            .when(d.head !== null, el => el.child(this.ruler(t, d))));
  }
}
