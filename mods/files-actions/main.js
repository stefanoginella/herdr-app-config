// A lazy file browser for the focused pane's folder. A click on a file opens it in the tab's
// editor, a pane beside the terminals (the `file-editor` mod). The file that editor shows is
// highlighted, or the closed folder it is in.
// Each entry has its file type's icon; what git ignores is faded, and a folder with changes
// inside has a dot. Right-click an entry to open it in an editor, rename it, duplicate it, move
// it to the Trash or make a new file or folder by it (menu.js); right-click the header or the
// room under the list for the project and the folder shown.
// Drag an entry onto a folder, or under the list for the top folder, to move it, or onto a
// terminal to paste its path there: its name follows the pointer (Herdr's own file drag).
// Files dropped from Finder, or pasted from the clipboard, are copied in.
// The key command `files-actions.undo` takes back the last move, rename or Trash.
// Modified from Herdr's `files` mod (version 0.1.16, Apache-2.0): see NOTICE at the repository root.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, window, props, openOverlay, notify, nextCommand, keys, run, shared, setShared } from "herdr";
import Menu, { any } from "./menu.js";
import Naming from "./naming.js";
import Confirm from "./confirm.js";
import { fileIcon, folderIcon } from "./icons.js";
import * as ops from "./ops.js";

const MOD = "files-actions";
// The mod that shows a file, one pane a tab, and what it reads in shared state (its header).
const EDITOR = "file-editor";
const CLEAR = "#00000000";
// How often Obsidian's list of vaults is read again.
const VAULTS_EVERY = 60000;
// How far the pointer goes from where it was pressed before the press is a drag, in window
// pixels: where Herdr's own drag begins too.
const DRAG_FROM = 2;
// How long after its press a drag is trusted when the pointer is reported coming into the list:
// that report can also be the echo of the drag before it, which a click right after must survive.
const FRESH = 300;
// A drag that leaves the panel says nothing more: no event tells it left. So it is taken to have
// left when the last thing seen of it was at the panel's edge (within EDGE, the panel's pixels)
// or fast (over FAST, window pixels a millisecond), and nothing came for GONE ms. Looked at every TICK.
const EDGE = 14, FAST = 0.8, GONE = 150, TICK = 100;
// The header's height with its border: under it, the pointer is over the list.
const HEAD = 43;
// How long the last change can be taken back. The key for it works wherever the keyboard is,
// so one pressed by habit, long after, must find nothing.
const UNDO_FOR = 5 * 60000;

// What a folder shows for the changes inside it: the one kind they all are, a conflict if there
// is one, else "M".
const mix = (a, b) => (!a || a === b ? b : a === "U" || b === "U" ? "U" : "M");
const markColor = (t, mark) => (mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked);

// What went wrong, as a toast's title.
function failed(r) {
  if (r.op === "open") return r.app === "finder" ? "Couldn't show it in Finder" : `Couldn't open it in ${ops.appName(r.app)}`;
  if (r.op === "clip") return "Couldn't copy it to the clipboard";
  if (r.op === "trash") return "Couldn't move it to the Trash";
  if (r.op === "copy") return "Couldn't duplicate it";
  if (r.op === "make") return `Couldn't create the ${r.dir ? "folder" : "file"}`;
  if (r.op === "restore") return "Couldn't put it back";
  const what = ops.parent(r.from) === ops.parent(r.to) ? "rename" : "move";
  return r.undo ? `Couldn't undo the ${what}` : `Couldn't ${what} it`;
}

// The request that takes `r` back, once it has been done (`done`: what ops.perform said), or null.
function reverse(r, done) {
  if (r.undo) return null;
  if (r.op === "move") return { op: "move", root: r.root, on: r.on, from: r.to, to: r.from, undo: true };
  if (r.op === "trash" && done.trashed) return { op: "restore", root: r.root, on: r.on, trashed: done.trashed, to: r.from, undo: true };
  return null;
}

// "cmd-shift-z" as a Mac shows it: "⇧⌘Z".
const SIGN = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
function keyLabel(chord) {
  const parts = chord.split("-"), key = parts.pop() || "-";
  return ["ctrl", "alt", "shift", "cmd"].filter(m => parts.includes(m)).map(m => SIGN[m]).join("") + (key.length === 1 ? key.toUpperCase() : key);
}
// The key bound to undo, when there is one: said after a drop.
function undoKey() {
  const bound = keys().find(k => k.action === `${MOD}.undo` && !k.keys.includes(" "));
  return bound ? keyLabel(bound.keys) : null;
}

// A mod pane (the editor) is in no folder: while one has the focus, the panel goes on showing
// the folder of the terminal that had it before, in that tab.
const held = new Map();
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane?.mod && held.has(pane.tab)) return held.get(pane.tab);
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const at = { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
  if (pane && !pane.mod) held.set(pane.tab, at);
  return at;
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    // Opened by itself as a popup or a dialog: the menu, the name prompt, the Trash question.
    const p = props();
    const Other = p?.menu ? Menu : p?.naming ? Naming : p?.confirm ? Confirm : null;
    if (Other) {
      this.other = new Other();
      this.other.init(cx);
      return;
    }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.changed = {}; // folders with changes inside, as absolute paths: "A", "D", "U" or "M"
    this.ignored = new Set(); // what git ignores, as absolute paths; a folder stands for all in it
    this.inIgnored = false; // the folder shown is itself inside an ignored one
    this.top = null; // the repo's top folder, null outside a repo
    this.vaults = []; this.vaultsAt = 0; // Obsidian's vaults, and when they were read
    // The entry pressed: { path, name, dir, x, y, t } (where, in the window, and when). Once the
    // pointer has left that spot it is `moving`, and `seen`: { x, y, t, leaving } is the last of it seen in
    // the panel. `away`: taken to have left the panel (see EDGE).
    this.drag = null;
    this.over = null; // where it would land: { dir } (a folder's path, "" for the top), null: nowhere
    this.last = null; // the request that takes back the last move, rename or Trash, or null
    this.lastAt = 0; // when it was done
    this.turn = 0; // counts the changes begun, so that one ending late doesn't speak for the last
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) if ((await nextCommand()) === "undo") this.undo(cx);
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.changed = {}; this.watched = null; this.error = null; this.limited = false;
      this.ignored = new Set(); this.inIgnored = false; this.top = null; this.drag = null; this.over = null;
      // What undo takes back is of the folder that was shown.
      this.last = null;
      this.loading = false; this.again = false;
    }
    if (!cwd) return;
    // A change that lands while a load runs (a move just made) is read by one more load.
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          // Moved or put in the Trash since the load began: there is nothing to list.
          if (path && !this.folders.has(path)) continue;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {}, changed = {}, ignored = new Set();
        const root = top?.code === 0 ? top.stdout.trim() : null;
        if (root) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          // An ignored folder is listed alone ("!! node_modules/"), not file by file.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignored=matching"], { cwd, on }).catch(() => null);
          let marked = 0;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean)) {
            const xy = entry.slice(0, 2), path = `${root}/${entry.slice(3)}`;
            if (xy === "!!") { if (ignored.size < TOTAL) ignored.add(path.replace(/\/$/, "")); }
            else if (marked++ < TOTAL) marks[path] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
          // Every folder above a change, up to the repo's top, shows it.
          for (const [path, mark] of Object.entries(marks)) {
            for (let dir = ops.parent(path); dir.length > root.length; dir = ops.parent(dir)) changed[dir] = mix(changed[dir], mark);
          }
        }
        if (!on && Date.now() - this.vaultsAt > VAULTS_EVERY) {
          this.vaults = await ops.vaults();
          this.vaultsAt = Date.now();
        }
        if (!this.current(context)) return;
        this.marks = marks; this.changed = changed; this.ignored = ignored; this.top = root; this.error = null; this.watch(cwd, cx);
        this.inIgnored = [...ignored].some(path => ops.within(cwd, path));
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  // The menu is this mod again, as a popup (menu.js). `entry`: { path, dir }, or nothing for the project alone.
  menu(entry) {
    if (!this.root) return;
    const project = this.top ?? this.root;
    const m = {
      root: this.root, on: this.on, path: entry?.path ?? null, dir: Boolean(entry?.dir),
      project, repo: this.top,
      vault: entry ? ops.vaultOf(this.vaults, `${this.root}/${entry.path}`) : null,
      projectVault: ops.vaultOf(this.vaults, project),
    };
    // A popup is as tall as its items; height is only the most.
    if (any(m)) openOverlay({ mod: MOD, kind: "popup", width: 236, height: 620, props: { menu: m } });
  }

  // Runs what the menu, a dialog or a drop asked for (ops.js), then shows what became of it.
  act(r, cx) {
    if (r.op === "add" || r.op === "paste") return this.bring(r, cx);
    // These change no file: the tree, and what undo takes back, stay as they are.
    const quiet = r.op === "open" || r.op === "clip";
    // While a change runs there is nothing to take back: not the one before it either, which
    // is no longer the last. If it fails, and nothing else began meanwhile, that one is again.
    const before = this.last, turn = quiet ? this.turn : ++this.turn;
    if (!quiet) this.last = null;
    cx.spawn(async cx => {
      const done = await ops.perform(r);
      if (done.error) {
        notify({ title: failed(r), body: done.error, level: "error" });
        if (!quiet && !r.undo && turn === this.turn) this.last = before;
      }
      else if (r.op === "clip") notify({ title: `Copied “${ops.base(r.from)}”`, body: "Paste it in Finder, or in a folder here" });
      else if (!quiet) {
        if (r.root === this.root && (r.on ?? null) === (this.on ?? null)) {
          if (r.op === "move") this.moved(r.from, r.to); else if (r.op === "trash") this.gone(r.from);
          else if (r.op === "make") this.made(r.to, Boolean(r.dir));
        }
        // The editor goes on with a file it has open under its new name.
        if (r.op === "move") setShared(`${EDITOR}.moved`, { from: `${r.root}/${r.from}`, to: `${r.root}/${r.to}`, on: r.on ?? null, at: Date.now() });
        // Only the last thing done can be taken back: after a duplicate, nothing can.
        if (turn === this.turn) { this.last = reverse(r, done); this.lastAt = Date.now(); }
        // A new file is made to be written: it opens in the editor.
        if (r.op === "make" && !r.dir && r.root === this.root && (r.on ?? null) === (this.on ?? null)) this.open(r.to);
        const where = ops.parent(r.to ?? "") || ops.base(r.root), name = ops.base(r.to ?? "");
        // A drop is easy to make by accident: say where the entry went. An undo says what it did.
        if (r.dropped) notify({ title: `Moved “${name}”`, body: [`to ${where}`, undoKey() && `${undoKey()} to undo`].filter(Boolean).join(" · ") });
        else if (r.op === "restore") notify({ title: `Put “${name}” back`, body: `in ${where}` });
        else if (r.undo && ops.parent(r.from) === ops.parent(r.to)) notify({ title: `Renamed “${ops.base(r.from)}” back`, body: `to “${name}”` });
        else if (r.undo) notify({ title: `Moved “${name}” back`, body: `to ${where}` });
      }
      if (!quiet) this.refresh(cx);
      cx.notify();
    });
  }

  // Copies files from elsewhere on this Mac into the folder `r.to`: the ones dropped from Finder
  // (`r.sources`), or the ones on the clipboard. Each keeps its name, and is refused if taken.
  bring(r, cx) {
    cx.spawn(async cx => {
      let sources = r.sources ?? [];
      if (r.op === "paste") {
        const got = await ops.clipboardFiles();
        if (got.error) return notify({ title: "Couldn't paste", body: got.error, level: "error" });
        if (!got.paths.length) return notify({ title: "Nothing to paste", body: "The clipboard holds no files: copy some in Finder first" });
        sources = got.paths;
      }
      const made = [], missed = [];
      // As in act(): nothing to take back while this runs, nor after it unless it all failed.
      const before = this.last, turn = ++this.turn;
      this.last = null;
      for (const source of sources) {
        const done = await ops.perform({ op: "add", root: r.root, on: r.on, to: r.to, source });
        if (done.error) missed.push({ name: ops.base(source), error: done.error }); else made.push(done.name);
      }
      if (made.length) {
        // The folder that took them opens, so they are seen.
        if (r.to && r.root === this.root && (r.on ?? null) === (this.on ?? null)) this.folders.add(r.to);
        notify({ title: made.length === 1 ? `Copied “${made[0]}”` : `Copied ${made.length} items`, body: `to ${r.to || ops.base(r.root)}` });
      }
      else if (turn === this.turn) this.last = before;
      if (missed.length) notify({ title: missed.length === 1 ? `Couldn't copy “${missed[0].name}”` : `Couldn't copy ${missed.length} items`, body: missed[0].error, level: "error" });
      this.refresh(cx);
      cx.notify();
    });
  }

  // Files dragged in from outside the app were let go over the folder `to`.
  dropped(paths, to, cx) {
    this.drag = null;
    this.over = null;
    this.act({ op: "add", root: this.root, on: this.on, to, sources: paths }, cx);
  }

  // Takes back the last move, rename or Trash, once.
  undo(cx) {
    const r = this.last;
    this.last = null;
    if (r && Date.now() - this.lastAt < UNDO_FOR) this.act(r, cx);
  }

  // No drag is under way, whatever was pressed before.
  still(cx) {
    if (!this.drag && !this.over) return;
    this.drag = null;
    this.over = null;
    cx.notify();
  }

  // An entry has a new path: what was open in it stays open, and it shows in its new place
  // at once (the reload that follows only confirms it).
  moved(from, to) {
    const swap = path => path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path;
    const entry = this.take(from);
    this.folders = new Set([...this.folders].map(swap));
    this.entries = new Map([...this.entries].map(([path, list]) => [swap(path), list]));
    const list = this.entries.get(ops.parent(to));
    if (entry && list) {
      list.push({ ...entry, name: ops.base(to) });
      list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    }
  }

  // A new entry: the folder it is in opens, so it is seen, and it shows there at once.
  made(path, dir) {
    const into = ops.parent(path), list = this.entries.get(into);
    if (into) this.folders.add(into);
    if (list && !list.some(e => e.name === ops.base(path))) {
      list.push({ name: ops.base(path), dir });
      list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    }
  }

  gone(path) {
    this.take(path);
    for (const folder of [...this.folders]) if (ops.within(folder, path)) { this.folders.delete(folder); this.entries.delete(folder); }
  }

  // Takes an entry out of its folder's list, and returns it.
  take(path) {
    const list = this.entries.get(ops.parent(path)), at = list?.findIndex(e => e.name === ops.base(path)) ?? -1;
    return at < 0 ? null : list.splice(at, 1)[0];
  }

  // A drag is over `dir`. It can land there unless it is where the entry already is, or inside itself.
  aim(dir, cx) {
    const d = this.drag;
    const next = d && dir !== null && dir !== ops.parent(d.path) && !(d.dir && ops.within(dir, d.path)) ? dir : null;
    if (next === (this.over?.dir ?? null)) return;
    this.over = next === null ? null : { dir: next };
    cx.notify();
  }

  // The button went up: a drop where the drag was aimed, else a click on what was pressed.
  release(cx, click) {
    const d = this.drag, o = this.over;
    this.drag = null;
    this.over = null;
    if (d && o) {
      const to = ops.join(o.dir, d.name);
      this.act({ op: "move", root: this.root, on: this.on, from: d.path, to, dropped: true }, cx);
    } else if (d && click) click(d);
    cx.notify();
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // Shows a file in the tab's editor: a pane of the `file-editor` mod, split in beside the
  // focused pane when the tab has none yet. The editor takes the file from shared state.
  open(path) {
    const f = focused(), tab = f?.tab;
    if (!tab || !this.root) return;
    const here = panes().filter(p => p.tab === tab), editor = here.find(p => p.mod === EDITOR);
    const beside = here.find(p => p.pane === f.pane) ?? here[0];
    if (!editor && !beside) return;
    setShared(`${EDITOR}.open`, { tab, path: `${this.root}/${path}`, on: this.on ?? null, at: Date.now() });
    if (editor) run("pane.focus", { pane: editor.pane });
    else run("pane.split", { pane: beside.pane, direction: "right", mod: EDITOR, props: { tab } });
  }

  // The row that stands for the file the tab's editor shows (its `file-editor.shown`): the
  // file's own, or the closed folder it is in, the topmost one. A path under the folder shown,
  // or null: the tab has no editor, the editor no file, or the file is not under this folder.
  shown() {
    const tab = focused()?.tab, s = tab ? shared(`${EDITOR}.shown`)?.[tab] : null;
    if (!this.root || typeof s?.path !== "string" || (s.on ?? null) !== (this.on ?? null) || !s.path.startsWith(`${this.root}/`)) return null;
    // An editor that went without a word (a crash) left its file behind.
    if (!panes().some(p => p.tab === tab && p.mod === EDITOR)) return null;
    const path = s.path.slice(this.root.length + 1);
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
      if (!this.folders.has(path.slice(0, at))) return path.slice(0, at);
    }
    return path;
  }

  // `s`: what every row needs. { dark, parent: the folder's name, ignored: it is inside an
  // ignored folder, shown: the row to highlight (shown()) }
  rows(prefix, depth, out, t, s) {
    if (out.length >= TOTAL || depth > 40) return out;
    const d = this.drag, aim = this.over?.dir ?? null;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      // A folder's own mark (a submodule) counts as a change inside it.
      const mark = entry.dir ? this.changed[`${this.root}/${path}`] ?? this.marks[`${this.root}/${path}`] : this.marks[`${this.root}/${path}`];
      const ignored = s.ignored || this.ignored.has(`${this.root}/${path}`);
      const icon = entry.dir ? folderIcon(entry.name, s.parent, open, s.dark) : fileIcon(entry.name, s.parent, s.dark);
      // A drop goes into the folder the pointer is on, or the one the file under it is in.
      const into = entry.dir ? path : prefix;
      const target = aim !== null && aim !== "" && ops.within(path, aim);
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .when(target, el => el.bg(path === aim ? t.selected : t.hover))
        .when(!target && path === s.shown, el => el.bg(t.selected))
        .when(!target && path !== s.shown, el => el.hover(st => st.bg(t.hover)))
        .when(Boolean(d?.moving) && !d.away && d.path === path, el => el.opacity(0.5))
        // Herdr's file drag: the name follows the pointer, and a terminal takes it as a path.
        // The move within the list is this panel's own, on the same press.
        .drag_paths([`${this.root}/${path}`], { on: this.on ?? null })
        .on_mouse_down("left", e => { this.drag = { path, name: entry.name, dir: entry.dir, x: e.position.x, y: e.position.y, t: Date.now() }; this.over = null; })
        .on_mouse_move((e, cx) => { if (this.drag) { this.stir(e, cx); this.aim(into, cx); } })
        // The drop is on this row, wherever the last move was seen.
        .on_mouse_up("left", (_e, cx) => { this.aim(into, cx); this.release(cx, d => { if (d.path === path) entry.dir ? this.toggle(path, cx) : this.open(path); }); })
        .on_mouse_down("right", () => this.menu({ path, dir: entry.dir }))
        .on_drop((e, cx) => this.dropped(e.paths, into, cx))
        .child(entry.dir ? svg(`mods/files-actions/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(image(icon).size(16).flex_none().when(ignored, el => el.opacity(0.45)))
        .child(div().flex_1().min_w(0).truncate().text_color(ignored ? t.dim : t.foreground).child(entry.name))
        // A file says what happened to it; a folder only that something inside changed.
        .when(Boolean(mark), el => el.child(entry.dir ? div().size(7).mx(1).flex_none().rounded(4).bg(markColor(t, mark)) : div().text_size(11).text_color(markColor(t, mark)).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t, { ...s, parent: entry.name, ignored });
    }
    return out;
  }

  // The room under the list: a drop there goes to the top folder. Right-click: the project.
  tail() {
    return div().id("files-tail").flex_1().min_h(24)
      // A press here drags nothing: it also ends a drag whose release was never seen.
      .on_mouse_down("left", () => { this.drag = null; this.over = null; })
      .on_mouse_move((e, cx) => { if (this.drag) { this.stir(e, cx); this.aim("", cx); } })
      .on_mouse_up("left", (_e, cx) => { this.aim("", cx); this.release(cx); })
      // Taken here, not left to the list around it: a drop is a release too, and the one above
      // would see it first.
      .on_drop((e, cx) => this.dropped(e.paths, "", cx))
      .on_mouse_down("right", () => this.menu());
  }

  // The pointer moved in the panel with an entry pressed. Seen by the panel itself, so over the
  // header too, where nothing is aimed at.
  follow(e, cx) {
    const d = this.drag;
    if (!d || !this.stir(e, cx)) return;
    const p = e.position, l = e.local_position, b = e.bounds, now = Date.now();
    // The pointer is in window pixels: at a zoom, more of them than the panel's own.
    const z = Number(settings()?.zoom) || 1;
    const speed = d.seen ? Math.hypot(p.x - d.seen.x, p.y - d.seen.y) / Math.max(8, now - d.seen.t) : 0;
    const edge = Math.min(l.x, l.y, b.width - l.x, b.height - l.y) < EDGE * z;
    d.seen = { x: p.x, y: p.y, t: now, leaving: edge || speed > FAST };
    if (l.y < HEAD * z) this.aim(null, cx);
    if (d.away) { d.away = false; cx.notify(); }
    if (!d.watched) { d.watched = true; this.watch(d, cx); }
  }

  // The pointer moved with an entry pressed: far enough from the press, the drag is `moving`.
  // Called by whatever sees the move first (a row, before the list around it hears of a hover),
  // because a drag known to be moving is what the pointer coming in again puts an end to.
  stir(e, cx) {
    const d = this.drag;
    if (!d.moving && Math.hypot(e.position.x - d.x, e.position.y - d.y) > DRAG_FROM) { d.moving = true; cx.notify(); }
    return Boolean(d.moving);
  }

  // Notices that the drag `d` left the panel: it may end on a terminal, and until it is seen
  // again nothing here is aimed at or faded. Only what is drawn: the drag itself goes on, and
  // may come back.
  watch(d, cx) {
    cx.timer.after(TICK, cx => {
      if (this.drag !== d) return;
      if (!d.seen.leaving || Date.now() - d.seen.t < GONE) return this.watch(d, cx);
      d.watched = false;
      d.away = true;
      this.over = null;
      cx.notify();
    });
  }

  render(cx) {
    if (this.other) return this.other.render(cx);
    if (key() !== this.context?.key) this.refresh(cx);
    // A menu or a dialog left something to do. Taken in a task: only one copy gets it.
    if (ops.waiting()) cx.spawn(async cx => { const r = ops.take(); if (r) this.act(r, cx); });
    const t = theme();
    const list = this.rows("", 0, [], t, { dark: settings().dark !== false, parent: this.root?.split("/").pop(), ignored: this.inIgnored, shown: this.shown() });
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_mouse_move((e, cx) => this.follow(e, cx))
      // A release is not always seen (over a toast, outside the window), and a drag left behind
      // would turn a later release into a drop. So every press that is not the one that began
      // the drag ends it: here (a row's own press comes first, and is this very event), and
      // anywhere else in the window.
      .on_mouse_down("left", (e, cx) => { const d = this.drag; if (d && (d.x !== e.position.x || d.y !== e.position.y)) this.still(cx); })
      .on_mouse_down_out((_e, cx) => this.still(cx))
      .child(h_flex().id("files-head").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .on_mouse_down("right", () => this.menu())
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(5).border_1().border_color(this.over?.dir === "" ? t.accent : CLEAR).rounded_b(10)
        // A release outside the list never reaches it, and must not turn the next one here
        // into a drop. While Herdr's drag is under way no hover is reported at all, so a drag
        // can leave and come back; once it has ended elsewhere (on a terminal), the pointer
        // coming in is reported, and that ends what was left of it here: a drag that moved,
        // or (it may have left too fast to be seen moving) one pressed a while ago. Going out
        // is reported only when no such drag began: a press that never moved far.
        .on_hover((hovered, cx) => { const d = this.drag; if (!hovered || (d && (d.moving || Date.now() - d.t > FRESH))) this.still(cx); })
        .on_mouse_up("left", (_e, cx) => { this.drag = null; this.over = null; cx.notify(); })
        // From Finder, anywhere a row didn't take it: the top folder.
        .on_drop((e, cx) => this.dropped(e.paths, "", cx))
        .children(list)
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))
        .child(this.tail()));
  }
}
