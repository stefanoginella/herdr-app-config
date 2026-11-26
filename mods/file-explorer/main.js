// A lazy file browser for the focused pane's folder. A click on a file opens it in the tab's
// editor, a pane beside the terminals (the `file-editor` mod). The file that editor shows is
// highlighted, or the closed folder it is in.
// Each entry has its file type's icon; what git ignores is faded, and a folder with changes
// inside has a dot. Right-click an entry to open it in an editor, rename it, duplicate it, move
// it to the Trash or make a new file or folder by it (menu.js); right-click the header or the
// room under the list for the project and the folder shown.
// Drag an entry onto a folder, or under the list for the top folder, to move it, or onto a
// terminal to paste its path there: its name follows the pointer (Herdr's own file drag).
// Files dropped from Finder, pasted from the clipboard or picked (the menu's "Add Files…") are
// copied in.
// The header's lens, and a folder's "Find in Folder…", go to the Search panel (`project-search`).
// The key command `file-explorer.undo` takes back the last move, rename or Trash.
// Modified from Herdr's `files` mod (version 0.1.16, Apache-2.0): see NOTICE at the repository root.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, pickFiles, theme, settings, window, props, openOverlay, notify, nextCommand, keys, run, shared, setShared } from "herdr";
import Menu, { any } from "./menu.js";
import Naming from "./naming.js";
import Confirm from "./confirm.js";
import { fileIcon, folderIcon } from "./icons.js";
import * as ops from "./ops.js";

const MOD = "file-explorer";
// The mod that shows a file, one pane a tab, and what it reads in shared state (its header).
const EDITOR = "file-editor";
// The Search panel, which its own command shows.
const SEARCH = "project-search";
const CLEAR = "#00000000";
// How far the pointer goes from where it was pressed before the press is a drag, in window
// pixels: where Herdr's own drag begins too.
const DRAG_FROM = 2;
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
// The key bound to an action, when there is one.
function keyOf(action) {
  const bound = keys().find(k => k.action === action && !k.keys.includes(" "));
  return bound ? keyLabel(bound.keys) : null;
}
// The key bound to undo: said after a drop.
const undoKey = () => keyOf(`${MOD}.undo`);

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

// One git scan of a repository at a time, shared by every copy of this panel (as Herdr's own
// Files and Changes share theirs, from 0.1.18). A scan that took long is reused for longer: a
// folder watch waits until `watchAt`, a poll until `pollAt`. While the window isn't active none
// starts, unless `allowInactive`.
// The key is this mod's own: its scan lists what git ignores too (`--ignored=matching`), which
// Herdr's (`herdr.repoStatus.v2`) doesn't. Made once, and found again after a reload.
const scans = globalThis[Symbol.for("file-explorer.repoStatus.v1")] ??= new Map();

async function repoStatus(root, on, { after, visiting, urgent, allowInactive }, cx, current) {
  const repo = JSON.stringify([on, root]), now = Date.now();
  for (const [key, scan] of scans) {
    if (scan.pollAt <= now || (!scan.pollAt && scan.task.is_done())) scans.delete(key);
  }
  while (current()) {
    let scan = scans.get(repo);
    const pending = scan && !scan.pollAt && !scan.task.is_done();
    const reusable = scan?.status?.code === 0 && Date.now() < scan.pollAt
      && (scan.started >= after || (!urgent && Date.now() < scan.watchAt));
    if (!reusable && (!pending || (visiting && scan.started !== undefined && scan.started < after))) {
      if (!allowInactive && window()?.active === false) return null;
      const next = {};
      next.task = cx.spawn(async cx => {
        await cx.sleep(25); // Let both listeners for a watch batch join before starting Git.
        if (!allowInactive && window()?.active === false) return;
        next.started = Date.now();
        try {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would see it.
          // An ignored folder is listed alone ("!! node_modules/"), not file by file.
          next.status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignored=matching"], { cwd: root, on });
        } catch (error) {
          next.error = error;
        } finally {
          const finished = Date.now(), duration = finished - next.started;
          const delay = duration < 500 ? 0 : Math.min(60000, 5 * duration);
          next.watchAt = finished + delay;
          next.pollAt = finished + Math.max(10000, delay);
          if (next.status?.code !== 0 && scans.get(repo) === next) scans.delete(repo);
        }
      });
      scans.set(repo, next);
      scan = next;
    }
    // Resume through our own host task, so another copy's close cannot cancel our follow-up work.
    while (current() && !scan.pollAt && !scan.task.is_done()) await cx.sleep(50);
    if (!current()) return null;
    if (!scan.pollAt) continue; // The scanning copy closed or reloaded.
    return scan;
  }
  return null;
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
    // The entry pressed: { path, name, dir, x, y } (where, in the window). Once the pointer has
    // left that spot it is `moving`; `out`: the pointer is outside the panel now (follow()).
    this.drag = null;
    this.over = null; // where it would land: { dir } (a folder's path, "" for the top), null: nowhere
    this.last = null; // the request that takes back the last move, rename or Trash, or null
    this.lastAt = 0; // when it was done
    this.turn = 0; // counts the changes begun, so that one ending late doesn't speak for the last
    this.refresh(cx);
    cx.timer.every(500, cx => this.refreshIfDue(cx));
    cx.spawn(async cx => {
      for (;;) if ((await nextCommand()) === "undo") this.undo(cx);
    });
  }

  // Refreshes when it is time to: the window came back to the front after something changed,
  // the folder changed and the last scan's wait is over, or the poll is due. Never while the
  // window isn't active, or while a load runs.
  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context) return;
    if (refocused && (context.dirtyAt || !context.watch)) context.catchUp = true;
    if (!active || this.loading) return;
    const now = Date.now();
    if (context.catchUp || (context.dirtyAt && now >= context.watchAt) || now >= context.pollAt) this.refresh(cx);
  }

  // Watches the folder shown (here only), for as long as it is shown: the watch is the
  // context's, and cancelled when another folder is shown.
  watchRoot(root, context, cx) {
    if (context.on || context.watch?.root === root) return;
    context.watch?.pending?.cancel();
    const watch = { root };
    context.watch = watch;
    cx.spawn(async cx => {
      try {
        while (this.context === context && context.watch === watch) {
          watch.pending = watchFolder(root);
          const paths = await watch.pending;
          // A cancelled watch answers with nothing.
          if (paths.length && context.watch === watch && this.current(context)) {
            context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
          }
        }
      } catch {
        if (context.watch === watch) context.watch = null;
      }
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

  // `force`: this panel just changed a file (act(), bring()). The scan is then made after the
  // change, also while the window isn't active.
  refresh(cx, force = false) {
    const { cwd, on } = location(), next = key();
    const visiting = next !== this.context?.key;
    if (visiting) {
      if (this.context) {
        this.saved.set(this.context.key, { folders: this.folders });
        // At most 64 folders can have a watch waiting: the one no longer shown lets go.
        this.context.watch?.pending?.cancel();
      }
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on, dirtyAt: 0 }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.changed = {}; this.error = null; this.limited = false;
      this.ignored = new Set(); this.inIgnored = false; this.top = null; this.drag = null; this.over = null;
      // What undo takes back is of the folder that was shown.
      this.last = null;
      this.loading = false; this.again = false;
    }
    const context = this.context;
    const now = Date.now();
    if (!cwd) {
      context.catchUp = false;
      context.dirtyAt = 0;
      context.pollAt = now + 10000;
      return;
    }
    // A change that lands while a load runs (a move just made) is read by one more load, forced
    // if any of the asks was.
    if (this.loading) { this.again = this.again === "force" || force ? "force" : true; return; }
    if (force || (context.catchUp && !context.dirtyAt)) context.dirtyAt = now + 1;
    const request = {
      after: visiting ? now + 1 : context.dirtyAt || (context.lastStatus ?? -1) + 1,
      visiting,
      urgent: force || visiting || context.catchUp,
      allowInactive: force || visiting,
    };
    context.catchUp = false;
    context.pollAt = context.watchAt = now + 10000;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        this.watchRoot(cwd, context, cx);
        const dirtyAtListing = context.dirtyAt;
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          // Moved or put in the Trash since the load began: there is nothing to list.
          if (path && !this.folders.has(path)) continue;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (!this.current(context)) return;
        const marks = {}, changed = {}, ignored = new Set();
        const root = top?.code === 0 ? top.stdout.trim() : null;
        let covered = dirtyAtListing;
        if (root) {
          const scan = await repoStatus(root, on, request, cx, () => this.context === context);
          if (!scan || !this.current(context)) return;
          const { status, started, pollAt, watchAt } = scan;
          context.lastStatus = started;
          context.pollAt = pollAt;
          context.watchAt = watchAt;
          covered = Math.min(dirtyAtListing, started);
          // The scan reused began before what had to be seen: one more, at the next tick.
          if (request.urgent && request.after > started) context.catchUp = true;
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
        } else {
          context.watchAt = Date.now();
        }
        if (!this.current(context)) return;
        if (context.dirtyAt <= covered) context.dirtyAt = 0;
        this.marks = marks; this.changed = changed; this.ignored = ignored; this.top = root; this.error = null;
        this.inIgnored = [...ignored].some(path => ops.within(cwd, path));
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { const forced = this.again === "force"; this.again = false; this.refresh(cx, forced); }
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
    };
    // A popup is as tall as its items; height is only the most.
    if (any(m)) openOverlay({ mod: MOD, kind: "popup", width: 236, height: 620, props: { menu: m } });
  }

  // Runs what the menu, a dialog or a drop asked for (ops.js), then shows what became of it.
  act(r, cx) {
    if (r.op === "add" || r.op === "paste" || r.op === "pick") return this.bring(r, cx);
    // These change no file: the tree, and what undo takes back, stay as they are.
    const quiet = r.op === "open" || r.op === "clip";
    // While a change runs there is nothing to take back: not the one before it either, which
    // is no longer the last. If it fails, and nothing else began meanwhile, that one is again.
    const before = this.last, turn = quiet ? this.turn : ++this.turn;
    if (!quiet) this.last = null;
    cx.spawn(async cx => {
      const done = await ops.perform(r);
      if (done.error) {
        notify({ title: done.title ?? failed(r), body: done.error, level: "error" });
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
      if (!quiet) this.refresh(cx, true);
      cx.notify();
    });
  }

  // Copies files from elsewhere on this Mac into the folder `r.to`: the ones dropped from Finder
  // (`r.sources`), the ones on the clipboard ("paste"), or the ones picked in the system's file
  // picker ("pick"). Each keeps its name, and is refused if taken.
  bring(r, cx) {
    cx.spawn(async cx => {
      let sources = r.sources ?? [];
      if (r.op === "paste") {
        const got = await ops.clipboardFiles();
        if (got.error) return notify({ title: "Couldn't paste", body: got.error, level: "error" });
        if (!got.paths.length) return notify({ title: "Nothing to paste", body: "The clipboard holds no files: copy some in Finder first" });
        sources = got.paths;
      }
      if (r.op === "pick") {
        // A request is taken while the panel draws: the picker opens once that is over.
        await cx.sleep(0);
        let got;
        try { got = await pickFiles({ prompt: "Add", multiple: true }); }
        catch (e) { return notify({ title: "Couldn't add files", body: String(e?.message ?? e), level: "error" }); }
        // Cancelled.
        if (!got?.length) return;
        sources = got;
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
      this.refresh(cx, true);
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
        .when(Boolean(d?.moving) && !d.out && d.path === path, el => el.opacity(0.5))
        // Herdr's file drag: the name follows the pointer, and a terminal takes it as a path.
        // The move within the list is this panel's own, on the same press.
        .drag_paths([`${this.root}/${path}`], { on: this.on ?? null })
        // Drawn again at once: from that draw on, the panel watches the window (follow(), ended()).
        .on_mouse_down("left", (e, cx) => { this.drag = { path, name: entry.name, dir: entry.dir, x: e.position.x, y: e.position.y }; this.over = null; cx.notify(); })
        .on_mouse_move((e, cx) => { if (this.drag) { this.stir(e, cx); this.aim(into, cx); } })
        // The drop is on this row, wherever the last move was seen. A drop from Finder never
        // gets here: on_drop runs first, and stops the release.
        .on_mouse_up("left", (_e, cx) => { this.aim(into, cx); this.release(cx, d => { if (d.path === path) entry.dir ? this.toggle(path, cx) : this.open(path); }); })
        .on_mouse_down("right", () => this.menu({ path, dir: entry.dir }))
        .on_drop((e, cx) => this.dropped(e.paths, into, cx))
        .child(entry.dir ? svg(`mods/file-explorer/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
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
      // Taken here, not left to the list around it: a drop from Finder is a release too, and this
      // element's own on_drop runs before its on_mouse_up, and stops it.
      .on_drop((e, cx) => this.dropped(e.paths, "", cx))
      .on_mouse_down("right", () => this.menu());
  }

  // The pointer moved, anywhere in the window, with an entry pressed: on_window_mouse_move on
  // the panel's root, so `e.local_position` is against the panel's box (both in window pixels).
  // Only what is drawn follows from where it is: outside the panel, or over its header, nothing
  // is aimed at; outside, nothing is faded. The drag itself goes on, and may come back.
  follow(e, cx) {
    const d = this.drag;
    if (!d) return;
    // No button held: the release was never seen (the drag went out of the window and ended
    // there, where Herdr hears nothing more of it). What is left of it must not be a drop.
    if (e.pressed_button !== "left") return this.still(cx);
    this.stir(e, cx);
    const l = e.local_position, b = e.bounds;
    const out = l.x < 0 || l.y < 0 || l.x >= b.width || l.y >= b.height;
    // The header is in the panel's pixels: at a zoom, the window has more of them.
    if (out || l.y < HEAD * (Number(settings()?.zoom) || 1)) this.aim(null, cx);
    if (out !== Boolean(d.out)) { d.out = out; cx.notify(); }
  }

  // The left button went up, anywhere in the window: every drag of this panel ends with it.
  // Herdr's window observers run between GPUI's capture and bubble phases, so this comes before
  // the handlers of the same release in the panel: a row's or the tail's on_mouse_up, which drop
  // or click (release()), and an on_drop, which takes a drop from Finder (dropped()) and stops
  // the release there. Ending the drag here would take it from them. So it ends once the release
  // has been through them, a step later, unless one of them ended it, or a new press began
  // another.
  ended(cx) {
    const d = this.drag;
    if (d) cx.timer.after(0, cx => { if (this.drag === d) this.still(cx); });
  }

  // The pointer moved with an entry pressed: far enough from the press, the drag is `moving`,
  // and the entry is faded.
  stir(e, cx) {
    const d = this.drag;
    if (!d.moving && Math.hypot(e.position.x - d.x, e.position.y - d.y) > DRAG_FROM) { d.moving = true; cx.notify(); }
  }

  render(cx) {
    if (this.other) return this.other.render(cx);
    if (key() !== this.context?.key) this.refresh(cx);
    else this.refreshIfDue(cx);
    // A menu or a dialog left something to do. Taken in a task: only one copy gets it.
    if (ops.waiting()) cx.spawn(async cx => { const r = ops.take(); if (r) this.act(r, cx); });
    const t = theme();
    const list = this.rows("", 0, [], t, { dark: settings().dark !== false, parent: this.root?.split("/").pop(), ignored: this.inIgnored, shown: this.shown() });
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Only while an entry is pressed: every move in the window is a call into the script.
      .when(Boolean(this.drag), el => el
        .on_window_mouse_move((e, cx) => this.follow(e, cx))
        .on_window_mouse_up("left", (_e, cx) => this.ended(cx)))
      // A release is not always seen (outside the window), and a drag left behind would turn a
      // later release into a drop. So every press that is not the one that began the drag ends
      // it too: here (a row's own press comes first, and is this very event), and anywhere else
      // in the window. A window can be pressed with no move seen before it (back from another
      // Space), so this stays beside follow()'s.
      .on_mouse_down("left", (e, cx) => { const d = this.drag; if (d && (d.x !== e.position.x || d.y !== e.position.y)) this.still(cx); })
      .on_mouse_down_out((_e, cx) => this.still(cx))
      .child(h_flex().id("files-head").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .on_mouse_down("right", () => this.menu())
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? ""))
        // To the Search panel, which takes this one's place.
        .child(h_flex().id("files-search").size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
          .hover(st => st.bg(t.hover))
          .tooltip(keyOf(`${SEARCH}.open`) ? `Search in the project (${keyOf(`${SEARCH}.open`)})` : "Search in the project")
          .on_click(() => run(`${SEARCH}.open`))
          .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.muted))))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(5).border_1().border_color(this.over?.dir === "" ? t.accent : CLEAR).rounded_b(10)
        // A release here that no row took (the padding) ends the drag at once; ended() would a
        // step later, once it watches the window (the draw after the press).
        .on_mouse_up("left", (_e, cx) => this.still(cx))
        // From Finder, anywhere a row didn't take it: the top folder.
        .on_drop((e, cx) => this.dropped(e.paths, "", cx))
        .children(list)
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))
        .child(this.tail()));
  }
}
