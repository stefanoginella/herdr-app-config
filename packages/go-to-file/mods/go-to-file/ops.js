// What the popup runs: the listing of the project's files. And the files opened lately.

import { exec, shared, setShared } from "herdr";
import * as match from "./match.js";

// How long a listing may take, and the most it may say, in bytes.
const TIMEOUT = 10000, BYTES = 4000000;
// The files opened lately, by project: { "<machine>\n<folder>": [path under it, newest first] }.
const RECENT = "go-to-file.recent";
// How many are kept for a project, and for how many projects.
const PER = 12, PROJECTS = 40;

// The project's files, as ripgrep lists them: all but what git ignores and git's own folder,
// dotfiles too. That is what the Search panel searches.
//   $1: the most lines, $2: the most bytes. The rest: patterns, each of which a path must match
//   (match.pattern()). A word typed is only ever one of these arguments, never part of this text.
// It says the repository's top folder (empty outside one) and the folder it runs in, under that
// top, each on a line, then the files from the top (from the folder itself outside a
// repository), sorted, and an empty line: what tells a whole answer from one cut short.
// 127: there is no ripgrep.
const LIST = `command -v rg >/dev/null 2>&1 || exit 127
n=$1; c=$2; shift 2
if top=$(git rev-parse --show-toplevel 2>/dev/null); then pre=$(git rev-parse --show-prefix 2>/dev/null); cd "$top" || exit 1; else top=; pre=; fi
narrow() { if [ $# -eq 0 ]; then cat; else p=$1; shift; rg --ignore-case --no-line-number --no-filename --color never --regexp "$p" - | narrow "$@"; fi; }
{ printf '%s\\n%s\\n' "$top" "$pre"; rg --files --hidden --glob '!.git' ./ 2>/dev/null | narrow "$@" | head -n "$n" | LC_ALL=C sort; echo; } | head -c "$c"`;

// Lists the files of the project the folder `cwd` is in, on the machine `on`: those that match
// every one of `patterns`, all of them with none. Resolves with what match.read() gives, or
// with { error }.
export async function list(cwd, on, patterns = []) {
  let done;
  try { done = await exec("sh", ["-c", LIST, "go-to-file", String(match.MOST + 1), String(BYTES), ...patterns], { cwd, on, timeout: TIMEOUT }); }
  catch (e) {
    const said = String(e?.message ?? e);
    return { error: /tim(ed|e) ?out/i.test(said) ? "Listing the files took too long" : said };
  }
  if (done.code === 127) return { error: `ripgrep (rg) is not installed on ${on ?? "this computer"}` };
  if (done.code !== 0) return { error: done.stderr.trim() || "The files could not be listed" };
  return match.read(done.stdout, cwd);
}

export const key = (root, on) => `${on ?? ""}\n${root}`;

// The files opened lately in a project, newest first.
export function recent(project) {
  const kept = shared(RECENT)?.[project];
  return Array.isArray(kept) ? kept.filter((p) => typeof p === "string") : [];
}

// `path` was opened: it is the newest of its project, and its project the newest of all.
export function remember(project, path) {
  const all = shared(RECENT), kept = all && typeof all === "object" && !Array.isArray(all) ? { ...all } : {};
  const mine = [path, ...recent(project).filter((p) => p !== path)].slice(0, PER);
  delete kept[project];
  const names = Object.keys(kept);
  for (const old of names.slice(0, Math.max(0, names.length - PROJECTS + 1))) delete kept[old];
  setShared(RECENT, { ...kept, [project]: mine });
}
