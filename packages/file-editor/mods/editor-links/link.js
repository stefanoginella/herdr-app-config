// Cmd-click (Ctrl-click) on a file path in a terminal: the file opens in its tab's editor
// (`file-editor`), at the line and column the path ends with: `src/app.ts:42`, `src/app.ts:42:7`,
// `src/app.ts(42,7)`, or the first line of a range or an anchor: `src/app.ts:5-12`,
// `src/app.ts#L42`, `src/app.ts#L5-L12`. Herdr works the line and column out itself
// (`link.line`, `link.column`) for every form but `(42,7)`; this mod's own reading is what's left.
//
// What the editor can't show goes on ("pass") to the next link handler, then to Herdr's own
// opener: images, PDFs, archives and other binaries by their name, folders, missing files, and a
// terminal outside any tab. A path in a terminal on another machine opens in the editor there.
//
// The editor is asked as the Search panel asks it (`project-search`'s `open()`): the request in
// shared `file-editor.open`, then the tab's editor pane focused, or one split in beside the pane
// that was clicked.
import { panes, setShared, run, exec } from "herdr";

const EDITOR = "file-editor";
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|icns|tiff?|heic|avif|psd|sketch|fig|pdf|zip|gz|tgz|bz2|xz|zst|7z|rar|dmg|pkg|iso|exe|dll|so|dylib|a|o|class|jar|wasm|pyc|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|avi|mkv|webm|wav|flac|ogg|sqlite3?|db)$/i;
// Where a file ends and its place begins, after a period that ends the sentence is taken off, in
// the order Herdr tries them (`without_suffix()` in its `src/links.rs`): an anchor, `#L42`,
// `#L5-12`, `#L5-L12`; a range, `:5-12`, `:5-L12`; then `:12`, `:12:5`, `(12)`, `(12,5)`, a colon
// after. A range or an anchor gives its first line.
const ANCHOR = /#L(\d+)(?:-L?\d+)?$/;
const RANGE = /:(\d+)-L?\d+$/;
const PLACE = /(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\)):?$/;
const CHECK_FOR = 5000;

const count = (n) => (Number(n) > 0 ? Number(n) : null);

// The line and column the clicked text ends with (1-based), or nulls, and the text without them.
function place(raw) {
  let text = raw ?? "";
  if (text.endsWith(".")) text = text.slice(0, -1);
  const lines = ANCHOR.exec(text) ?? RANGE.exec(text);
  if (lines) return { line: count(lines[1]), col: null, rest: text.slice(0, lines.index) };
  const m = PLACE.exec(text);
  if (!m) return { line: null, col: null, rest: text };
  return { line: count(m[1] ?? m[3]), col: count(m[2] ?? m[4]), rest: text.slice(0, m.index) };
}

// The file's path on its machine. Herdr resolves a local one (`link.path`); one on another
// machine is worked out here, from the text and the terminal's folder there.
function where(link, source, rest) {
  if (link.path) return link.path;
  if (!source.machine) return null;
  let p = rest;
  if (p.startsWith("file://")) {
    try { p = decodeURIComponent(new URL(p).pathname); } catch { return null; }
  }
  if (p.startsWith("/")) return p;
  if (p.startsWith("~")) return null; // the remote home isn't known here: Herdr's own opener
  if (!source.cwd) return null;
  return `${source.cwd.replace(/\/+$/, "")}/${p.replace(/^\.\//, "")}`;
}

export async function handleLink({ link, source }) {
  if (link.kind !== "file" || !source?.tab) return "pass";
  // Herdr's line and column when it found one (never for a `file:` URI), else the mod's own.
  const own = place(link.raw);
  const line = link.line ?? own.line, col = link.line ? link.column ?? null : own.col;
  const path = where(link, source, own.rest);
  if (!path || BINARY.test(path)) return "pass";
  const on = source.machine ?? null;
  // Only a regular file (not a folder, not a missing one): the editor would show an error.
  try {
    const r = await exec("test", ["-f", path], { on, timeout: CHECK_FOR });
    if (r.code !== 0) return "pass";
  } catch {
    return "pass";
  }
  const tab = source.tab, here = panes().filter((p) => p.tab === tab);
  const editor = here.find((p) => p.mod === EDITOR);
  const beside = here.find((p) => p.pane === source.pane) ?? here[0];
  if (!editor && !beside) return "pass";
  const at = col ? col - 1 : 0;
  const select = line ? { line, start: at, end: at } : null;
  setShared(`${EDITOR}.open`, { tab, path, on, at: Date.now(), select });
  if (editor) run("pane.focus", { pane: editor.pane });
  else run("pane.split", { pane: beside.pane, direction: "right", mod: EDITOR, props: { tab } });
  return "handled";
}
