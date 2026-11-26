// What the panel runs: the search itself, a replace and its undo, and a result opened in an app.
// And how its menu and its dialog ask for something.
//
// A menu or a dialog is a short-lived copy of this mod: it is gone before a program it started
// could answer. So it leaves a request in shared state, and the panel, which stays, takes it.
// A request names a result by its file (`path`, under the folder searched) and its match (`id`):
//   { op: "open",        path, id? }      in the tab's editor
//   { op: "app",         app, root, on, path, id? }
//   { op: "dismiss",     path, id? }      out of the list, until the next search
//   { op: "replace",     path, id? }      one match, or every match listed in the file
//   { op: "replace-all", want }           every match listed; `want`: the search they are of

import { exec, shared, setShared, readTextFile, writeTextFile } from "herdr";
import * as search from "./search.js";
import * as remote from "./remote.js";

const KEY = "project-search.request";
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;
// How long a search may take, and the most it may say, in bytes.
const TIMEOUT = 20000, BYTES = 3000000;

export const base = (path) => path.slice(path.lastIndexOf("/") + 1);
export const parent = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

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

// ripgrep, cut short. Only what search.parse() reads is kept (KEEP): the match records, at
// most $1 of them, and the summary, which ends a whole answer. The other records were most of
// an answer, and moving them into the mod took time. Then at most $2 bytes. Taking no more
// ends ripgrep: it has nowhere to write. 127: there is no ripgrep.
// While it runs, its shell's number is in a file named after $3, the search's token, for
// stop(). The awk program is $4. The rest of the arguments are ripgrep's own (search.js): a
// query or a filter is never part of this text.
const PID_FILE = 'f="${TMPDIR:-/tmp}/herdr-project-search.$t"';
const FIND = `command -v rg >/dev/null 2>&1 || exit 127; n=$1; c=$2; t=$3; p=$4; shift 4; ${PID_FILE}; echo $$ > "$f"; rg "$@" | LC_ALL=C awk -v n="$n" "$p" | head -c "$c"; s=$?; rm -f "$f"; exit $s`;
const KEEP = 'index($0, "{\\"type\\":\\"match\\"") == 1 { if (++k > n) exit; print; next } index($0, "{\\"data\\":") == 1 { print }';
// Ends the search whose token is $1: ripgrep and the rest of its pipeline, its shell's
// children. A search already over has no file, and nothing happens.
const STOP = `t=$1; ${PID_FILE}; [ -f "$f" ] || exit 0; p=$(cat "$f"); rm -f "$f"; [ -n "$p" ] && pkill -TERM -P "$p"; exit 0`;

// A token naming one search, for stop(): letters and digits only.
export const token = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// Stops the search `id` (its token) on the machine `on`, if it is still running. Herdr can't
// cancel an exec, and a search of a big project can take seconds, which the next one would
// wait for. Never rejects. Without pkill there, the search runs to its end, as before.
export async function stop(id, on) {
  await exec("sh", ["-c", STOP, "project-search", id], { on, timeout: 5000 }).catch(() => null);
}

// Searches the folder `root` on the machine `on` for `o` (search.js). `id`: the search's token
// (token()), for stop(). Resolves with what search.parse() gives, or with { error }. When
// `stale()` says the answer is no longer wanted once ripgrep is done, it is not read (reading
// is most of a search's time): { stale: true }.
export async function find(root, on, o, stale, id) {
  let done;
  try { done = await exec("sh", ["-c", FIND, "project-search", String(search.MOST), String(BYTES), id, KEEP, ...search.args(o)], { cwd: root, on, timeout: TIMEOUT }); }
  catch (e) {
    const said = String(e?.message ?? e), late = /tim(ed|e) ?out/i.test(said);
    // Herdr ends only the shell: ripgrep would go on.
    if (late) await stop(id, on);
    return { error: late ? "The search took too long: narrow it with a filter" : said };
  }
  if (stale?.()) return { stale: true };
  if (done.code === 127) return { error: `ripgrep (rg) is not installed on ${on ?? "this computer"}`, missing: true };
  let found;
  try { found = search.parse(done.stdout, search.plain(o)); }
  catch (e) { return { error: `ripgrep's answer could not be read: ${e?.message ?? e}` }; }
  if (!found.count && done.stderr.trim()) return { error: search.reason(done.stderr), pattern: /regex parse error|error parsing/i.test(done.stderr) };
  return found;
}

// Why a file's text can't be replaced in, or null.
function unfit(text) {
  if (text === null) return "is no longer there";
  if (text.includes("\0") || text.includes("�")) return "is not plain UTF-8 text";
  return null;
}

const write = (path, on, text, expected) => (on ? remote.write(path, on, text, expected) : writeTextFile(path, text, expected));

// Replaces matches in files of the folder `root`. `plan`: [{ path, edits }], the matches as
// search.parse() gave them. A file is read, changed here and written back only if it is still
// the text that was read; one that is no longer what was searched is left alone. `tick(n)` is
// called before the nth file. Resolves with { changed: [{ path, abs, before, after, count }],
// missed: [{ path, why }] }.
export async function replace(root, on, plan, tick) {
  const changed = [], missed = [];
  for (let i = 0; i < plan.length; i++) {
    const { path, edits } = plan[i], abs = `${root}/${path}`;
    tick?.(i + 1);
    let text;
    try { text = await readTextFile(abs, { on }); }
    catch { missed.push({ path, why: "can't be read here (too large, or not text)" }); continue; }
    const why = unfit(text);
    if (why) { missed.push({ path, why }); continue; }
    const out = search.apply(text, edits);
    if (out.stale) { missed.push({ path, why: "changed since the search" }); continue; }
    if (out.text === text) continue;
    try { await write(abs, on, out.text, text); }
    catch (e) { missed.push({ path, why: e instanceof remote.Stale ? "changed while it was replaced" : String(e?.message ?? e) }); continue; }
    changed.push({ path, abs, before: text, after: out.text, count: out.count });
  }
  return { changed, missed };
}

// Takes a replace back: each file gets the text it had, if it is still the text the replace
// left. Resolves with { restored, missed: [{ path, why }] }.
export async function restore(on, files, tick) {
  let restored = 0;
  const missed = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    tick?.(i + 1);
    try {
      const text = await readTextFile(f.abs, { on });
      if (text !== f.after) { missed.push({ path: f.path, why: text === null ? "is no longer there" : "changed since the replace" }); continue; }
      await write(f.abs, on, f.before, f.after);
      restored++;
    } catch (e) { missed.push({ path: f.path, why: String(e?.message ?? e) }); }
  }
  return { restored, missed };
}
