// What the panel does to files, and how its menu and dialogs ask for it.
//
// A menu or a dialog is a short-lived copy of this mod: it is gone before a program it started
// could answer. So it leaves a request in shared state, and the panel, which stays, takes it,
// runs it and reports what went wrong. A request is one of:
//   { op: "move",    root, on, from, to }   paths under root; a rename is a move in place
//   { op: "copy",    root, on, from, dir }  a duplicate next to the original, named as Finder names it
//   { op: "make",    root, on, to, dir }    a new, empty file at `to`, or (dir) a new folder
//   { op: "trash",   root, on, from }
//   { op: "restore", root, on, trashed, to }   out of the Trash again; trashed is absolute
//   { op: "add",     root, on, to, sources }   copies of files from elsewhere on this Mac (absolute
//                                              paths) into the folder `to`: a drop from Finder
//   { op: "paste",   root, on, to }         the same, for the files on the clipboard
//   { op: "clip",    root, on, from }       onto the clipboard, as a file Finder can paste
//   { op: "open",    app: "vscode" | "obsidian" | "textedit" | "finder", path, dir, repo?, vault? }
//                                           path is absolute; "finder" shows it in its folder
// `undo: true` on a request marks the reverse of an earlier one (main.js): it only changes the toast.

import { exec, shared, setShared, readTextFile, home, window } from "herdr";

const KEY = "files-actions.request";
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;

export const join = (dir, name) => (dir ? `${dir}/${name}` : name);
export const parent = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const base = (path) => path.slice(path.lastIndexOf("/") + 1);
export const within = (path, dir) => path === dir || path.startsWith(`${dir}/`);

export function request(r) {
  setShared(KEY, { ...r, at: Date.now() });
}

export const waiting = () => Boolean(shared(KEY));

// The waiting request, taken: nobody else gets it.
export function take() {
  const r = shared(KEY);
  if (!r) return null;
  setShared(KEY, null);
  return Date.now() - (r.at ?? 0) < FRESH ? r : null;
}

// Why a name can't be used: null when it can, "" when there is nothing to say yet.
export function nameError(name) {
  if (!name) return "";
  if (name === "." || name === "..") return "That name is reserved";
  if (name.includes("/")) return "A name can't contain a slash";
  if (/[\x00-\x1f\x7f]/.test(name)) return "A name can't contain control characters";
  return null;
}

// Never onto something else: 17. Only a change of case ($3) may find its target there, and
// only as the same file (`-ef`), which is what it finds where names ignore case.
const MOVE = 'if { [ -e "$2" ] || [ -L "$2" ]; } && ! { [ "$3" = case ] && [ "$1" -ef "$2" ]; }; then exit 17; fi; [ -e "$1" ] || [ -L "$1" ] || exit 18; mv -- "$1" "$2"';

// A new, empty file at $1, or a folder ($3 = dir), in the folder $2 (gone: 20). Never onto
// something else (17): the check is for the message, and `mkdir` and the no-clobber create are
// what hold if a name is taken in between.
const MAKE = 'if [ -e "$1" ] || [ -L "$1" ]; then exit 17; fi; [ -d "$2" ] || exit 20; if [ "$3" = dir ]; then mkdir -- "$1"; else ( set -C; : > "$1" ); fi';

// A copy of $1 in the folder $2, never onto something else. The name is $3 + " copy" + $4, then
// " copy 2", " copy 3"… from $5 on, and the free one is claimed here ($5 = 0: the name itself or
// nothing, 17). Claiming is `mkdir` or a no-clobber create, so two copies at once can't pick the
// same name. Prints the name used. A copy that fails is removed: it was made here. A folder is
// never copied into itself (22), wherever links make that happen.
const COPY = 'src=$1; dir=$2; stem=$3; ext=$4; n=$5; '
  + '[ -e "$src" ] || [ -L "$src" ] || exit 18; [ -d "$dir" ] || exit 20; '
  + 'folder() { [ -d "$src" ] && [ ! -L "$src" ]; }; '
  + 'if folder; then a=$(cd "$src" && pwd -P) && b=$(cd "$dir" && pwd -P) || exit 21; case "$b/" in "$a"/*) exit 22;; esac; fi; '
  + 'while :; do case $n in 0) name=$stem$ext;; 1) name="$stem copy$ext";; *) name="$stem copy $n$ext";; esac; t=$dir/$name; '
  + 'if folder; then mkdir "$t" 2>/dev/null && break; else ( set -C; : > "$t" ) 2>/dev/null && break; fi; '
  + '[ -e "$t" ] || [ -L "$t" ] || exit 19; [ "$n" = 0 ] && exit 17; n=$((n+1)); [ "$n" -gt 999 ] && exit 19; done; '
  + 'if folder; then cp -pPR "$src/." "$t"; else cp -pPR "$src" "$t"; fi || { rm -rf "$t"; exit 21; }; printf %s "$name"';
// A big folder takes a while to copy; this is the most `exec` allows.
const COPY_TIMEOUT = 600000;

// How a duplicate of `name` is named: { stem, ext, n }, for COPY. "a.txt" gives "a copy.txt",
// and "a copy.txt" gives "a copy 2.txt". A folder, like a dotfile, is all name.
export function copyName(name, dir) {
  const dot = dir ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  const again = /^(.+) copy(?: (\d+))?$/.exec(stem);
  return again ? { stem: again[1], ext, n: Number(again[2] ?? 1) + 1 } : { stem, ext, n: 1 };
}

// Where `trash -v` says it put the file: the line is `# Moved "<from>" to "<where>"`.
function trashedPath(out) {
  const line = out.split("\n").find((l) => l.startsWith('# Moved "') && l.endsWith('"')) ?? "";
  const at = line.lastIndexOf('" to "');
  const path = at < 0 ? "" : line.slice(at + 6, -1);
  return path.startsWith("/") ? path : null;
}

const APPS = { vscode: "VS Code", obsidian: "Obsidian", textedit: "TextEdit", finder: "Finder" };
export const appName = (app) => APPS[app];

// These are this Mac's apps: a file on another machine has nowhere to open.
export const canOpen = (on) => !on && window()?.platform === "macos";
export const canTrash = canOpen;
// The clipboard and Finder are this Mac's too: their files can't be another machine's.
export const canShare = canOpen;

// Files on the clipboard, as Finder puts them there and takes them: `write <path>…` replaces
// what it holds, anything else prints the paths it holds as JSON. Text is not enough for this,
// and AppKit is reached through `osascript`, which asks no other app for anything.
const CLIP = 'ObjC.import("AppKit"); function run(argv) { const pb = $.NSPasteboard.generalPasteboard; '
  + 'if (argv[0] === "write") { pb.clearContents; const urls = $.NSMutableArray.alloc.init; '
  + 'for (const p of argv.slice(1)) urls.addObject($.NSURL.fileURLWithPath(p)); return String(pb.writeObjects(urls)); } '
  + 'const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), $()), out = []; '
  + 'for (let i = 0; i < (urls.isNil() ? 0 : urls.count); i++) { const u = urls.objectAtIndex(i); if (u.isFileURL) out.push(ObjC.unwrap(u.path)); } '
  + 'return JSON.stringify(out); }';
const clip = (...args) => exec("osascript", ["-l", "JavaScript", "-e", CLIP, ...args]);

// The files on the clipboard: { paths } (absolute), or { error }.
export async function clipboardFiles() {
  try {
    const done = await clip("read");
    if (done.code !== 0) return { error: done.stderr.trim() || "The clipboard could not be read" };
    const paths = JSON.parse(done.stdout);
    return { paths: Array.isArray(paths) ? paths.filter((p) => typeof p === "string" && p.startsWith("/")) : [] };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Obsidian's vaults: [{ id, path }]. It opens a folder only as one of these.
export async function vaults() {
  if (window()?.platform !== "macos") return [];
  try {
    const text = await readTextFile(`${home()}/Library/Application Support/obsidian/obsidian.json`);
    return Object.entries(JSON.parse(text ?? "{}").vaults ?? {})
      .filter(([, v]) => typeof v?.path === "string")
      .map(([id, v]) => ({ id, path: v.path.replace(/\/+$/, "") }));
  } catch { return []; }
}

// The id of the vault a path is in (the innermost), or null.
export function vaultOf(list, path) {
  return list.filter((v) => within(path, v.path)).sort((a, b) => b.path.length - a.path.length)[0]?.id ?? null;
}

// Obsidian opens these from anywhere; everything else only inside a vault.
export const isNote = (name) => /\.(md|markdown|canvas|base)$/i.test(name);

async function open(r) {
  let result;
  if (r.app === "vscode") {
    // A file opens in its repo's window, so the editor has the project around it.
    const paths = !r.dir && r.repo && r.repo !== r.path && within(r.path, r.repo) ? [r.repo, r.path] : [r.path];
    try { result = await exec("code", paths); }
    catch { result = await exec("open", ["-a", "Visual Studio Code", ...paths]); }
  } else if (r.app === "obsidian") {
    // In a vault: Obsidian's own link, to the file or (it can't show a folder) to the vault.
    const link = r.dir ? `vault=${encodeURIComponent(r.vault)}` : `path=${encodeURIComponent(r.path)}`;
    result = await exec("open", r.vault ? [`obsidian://open?${link}`] : ["-a", "Obsidian", r.path]);
  } else if (r.app === "finder") result = await exec("open", ["-R", r.path]);
  else result = await exec("open", ["-a", "TextEdit", r.path]);
  return result.code === 0 ? {} : { error: result.stderr.trim() || `${APPS[r.app]} didn't open it` };
}

// Runs a request. Resolves with { error }, or with what it made: { name } for a copy,
// { trashed } (where it is in the Trash, when `trash` said) for a trash, else {}.
// "add" is run one source at a time, as { op: "add", root, on, to, source }; "paste" is the
// panel's to turn into that (main.js).
export async function perform(r) {
  try {
    if (r.op === "open") return await open(r);
    const abs = (path) => `${r.root}/${path}`;
    const taken = (path) => ({ error: `“${base(path)}” already exists in ${parent(path) || "the top folder"}` });
    if (r.op === "move") {
      const recase = r.from !== r.to && r.from.toLowerCase() === r.to.toLowerCase() && parent(r.from) === parent(r.to);
      const done = await exec("sh", ["-c", MOVE, "files-actions", abs(r.from), abs(r.to), recase ? "case" : "move"], { on: r.on });
      if (done.code === 17) return taken(r.to);
      if (done.code === 18) return { error: `“${base(r.from)}” is no longer there` };
      return done.code === 0 ? {} : { error: done.stderr.trim() || "It could not be moved" };
    }
    if (r.op === "copy" || r.op === "add") {
      // A duplicate goes next to the original under a new name; an added file keeps its name.
      const add = r.op === "add", from = add ? r.source : abs(r.from), name = base(from);
      if (add && !canShare(r.on)) return { error: "Only folders on this Mac can take files from it" };
      const { stem, ext, n } = add ? { stem: name, ext: "", n: 0 } : copyName(name, r.dir);
      const into = add ? (r.to ? abs(r.to) : r.root) : parent(from);
      const done = await exec("sh", ["-c", COPY, "files-actions", from, into, stem, ext, String(n)], { on: r.on, timeout: COPY_TIMEOUT });
      if (done.code === 17) return taken(join(r.to, name));
      if (done.code === 18) return { error: `“${name}” is no longer there` };
      if (done.code === 19) return { error: "No free name could be made for the copy" };
      if (done.code === 20) return { error: "The folder it was going to is no longer there" };
      if (done.code === 22) return { error: "A folder can't be copied into itself" };
      return done.code === 0 ? { name: done.stdout } : { error: done.stderr.trim() || "It could not be copied" };
    }
    if (r.op === "make") {
      const done = await exec("sh", ["-c", MAKE, "files-actions", abs(r.to), parent(abs(r.to)), r.dir ? "dir" : "file"], { on: r.on });
      if (done.code === 17) return taken(r.to);
      if (done.code === 20) return { error: "The folder it was going to is no longer there" };
      return done.code === 0 ? {} : { error: done.stderr.trim() || "It could not be created" };
    }
    if (r.op === "clip") {
      if (!canShare(r.on)) return { error: "Only files on this Mac can go on its clipboard" };
      const done = await clip("write", abs(r.from));
      return done.code === 0 && done.stdout.trim() === "true" ? {} : { error: done.stderr.trim() || "The clipboard didn't take it" };
    }
    if (r.op === "trash") {
      if (!canTrash(r.on)) return { error: "Only files on this Mac can go to the Trash" };
      // The system's own, by its path: another `trash` on the PATH may not take `-v`, or not as this.
      const done = await exec("/usr/bin/trash", ["-v", abs(r.from)]);
      return done.code === 0 ? { trashed: trashedPath(`${done.stdout}\n${done.stderr}`) } : { error: done.stderr.trim() || "It could not be moved to the Trash" };
    }
    if (r.op === "restore") {
      const done = await exec("sh", ["-c", MOVE, "files-actions", r.trashed, abs(r.to), "move"], { on: r.on });
      if (done.code === 17) return taken(r.to);
      if (done.code === 18) return { error: `“${base(r.to)}” is no longer in the Trash` };
      return done.code === 0 ? {} : { error: done.stderr.trim() || "It could not be put back" };
    }
    return { error: `Unknown request “${r.op}”` };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
