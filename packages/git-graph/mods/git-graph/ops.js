// What the panel does to a repository, and how its menu and dialogs ask for it.
//
// A menu or a dialog is a short-lived copy of this mod: it is gone before a program it started
// could answer. So it leaves a request in shared state, and the panel, which stays, takes it,
// runs it and reports what went wrong. Every request has { op, root, on }, and may have
// `expect`: what must still be true when it runs (below). A request is one of:
//   { op: "fetch" }                              every remote, pruning branches gone from them
//   { op: "pull" }                               the current branch, fast-forward only
//   { op: "push", branch, remote, remoteBranch?, track }   never forced; track: also set the
//                                                upstream; remoteBranch: when its name differs
//   { op: "forward", branch, remote, remoteBranch }  a branch that is not the current one, up to
//                                                its remote's: git refuses unless it is a fast-forward
//   { op: "switch", branch }                     a local branch
//   { op: "track", name }                        a remote branch ("origin/x"), as a local one
//   { op: "branch", name, at, go }               a new branch at `at`; go: switch to it
//   { op: "branch-delete", name }                only one that is merged (`-d`)
//   { op: "tag", name, at }   { op: "tag-delete", name }   { op: "tag-push", name, remote }
//   { op: "stash", message? }                    everything uncommitted, untracked files too
//   { op: "stash-apply", ref }   { op: "stash-pop", ref }   { op: "stash-drop", ref }
//   { op: "stage", paths }  { op: "unstage", paths }     paths under root; none: everything
//   { op: "discard", path }                      the file's changes, staged ones too, kept as a stash
//   { op: "commit", message, all }               all: stage everything first
//   { op: "copy", text }   { op: "url", url }   { op: "edit", path }   { op: "show", sha }
//   { op: "failure", run }                        opens the failed run's read-only inspector
//   { op: "repo", to }   { op: "writer", id }    the panel's own (main.js): no program is run,
//                                                or none on the repository
//   { op: "open-checkout", branch, space? }      navigate to a terminal already on that branch
//
// `expect` is { branch?, refs?: [[name, sha]] }: the branch HEAD is on (null: detached) and
// what names must still lead to. The panel shows what was true a moment ago, and an agent may
// have switched branch, or a stash may have moved down the list, between the click and the
// run: then the request is refused and nothing is touched.

import { exec, shared, setShared, home } from "herdr";
import { READ } from "./git.js";

const KEY = "git-panel.request";
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;
// A push or a fetch waits for the network, and a commit for the repository's hooks.
const LONG = 120000;

export function request(r) {
  setShared(KEY, { ...r, at: Date.now() });
}

export const waiting = () => Boolean(shared(KEY));

// The waiting request, taken: nobody else gets it. `mine` says whether it is for the copy
// that asks (its repository): another copy's is left for that one, until it is too old.
export function take(mine) {
  const r = shared(KEY);
  if (!r) return null;
  const fresh = Date.now() - (r.at ?? 0) < FRESH;
  if (fresh && !mine(r)) return null;
  setShared(KEY, null);
  return fresh ? r : null;
}

// Where a repository is, and what it is in the middle of. Prints the top folder, git's own
// folder, the one a worktree shares with its repository, and then a line for each thing under
// way. The script has no values in it: the folder is where it runs.
const PROBE = 'top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 3; dir=$(git rev-parse --absolute-git-dir) || exit 3; '
  + 'common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P) || exit 3; printf "%s\\n%s\\n%s\\n" "$top" "$dir" "$common"; '
  + 'for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do if [ -e "$dir/$f" ]; then echo "$f"; fi; done';
const UNDER_WAY = { "rebase-merge": "Rebase", "rebase-apply": "Rebase", MERGE_HEAD: "Merge", CHERRY_PICK_HEAD: "Cherry-pick", REVERT_HEAD: "Revert", BISECT_LOG: "Bisect" };

// { root, dir, common, state } for the repository `cwd` is in, or null when it is in none.
// `state` names what is under way ("Rebase", "Merge"…), or is null.
export async function probe(cwd, on) {
  const r = await exec("sh", ["-c", PROBE], { cwd, on });
  if (r.code !== 0) return null;
  const [root, dir, common, ...rest] = r.stdout.split("\n");
  if (!root) return null;
  return { root, dir, common, state: UNDER_WAY[rest.find((l) => UNDER_WAY[l])] ?? null };
}

// The repositories under a folder: the folders that hold a `.git`, as deep as $2 says, without
// going into one that was found, into the folders of installed packages or into a site's
// uploaded files (`uploads`: half a million of them in one WordPress site here, five seconds
// to walk). The script has no values in it: the folder and the depth are its arguments.
const BELOW = 'find "$1" -maxdepth "$2" \\( -name node_modules -o -name .venv -o -name venv -o -name target -o -name vendor -o -name uploads -o -name Library -o -name .cache -o -name .Trash \\) -prune -o -name .git -print -prune 2>/dev/null | head -n 80';
// A folder that is not searched: a home folder, or the top of the disk, is too much to read.
const tooWide = (dir) => dir === "/" || dir === home() || /^\/(Users|home)\/[^/]+\/?$/.test(dir) || dir === "/root";

// The repositories inside `dir` (not `dir` itself), as their top folders, sorted.
export async function below(dir, on, depth) {
  if (tooWide(dir)) return [];
  try {
    const r = await exec("sh", ["-c", BELOW, "git-graph", dir, String(depth)], { on, timeout: 10000 });
    return r.stdout.split("\n").filter((l) => l.endsWith("/.git")).map((l) => l.slice(0, -5)).filter((d) => d && d !== dir).sort();
  } catch { return []; }
}

// The repositories a repository is inside of, the outermost first: at most three.
export async function around(root, on) {
  const out = [];
  let dir = root;
  for (let i = 0; i < 3; i++) {
    const up = dir.slice(0, dir.lastIndexOf("/"));
    if (!up || tooWide(up)) break;
    const r = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd: up, on }).catch(() => null);
    const top = r?.code === 0 ? r.stdout.trim() : "";
    if (!top || top === dir || out.includes(top)) break;
    out.unshift(top);
    dir = top;
  }
  return out;
}

// The ops that only look, or change nothing but what a remote already has.
const HARMLESS = new Set(["fetch"]);

// Why a request can't run now: a message, or null.
async function refused(r, git) {
  if (!HARMLESS.has(r.op)) {
    const at = await probe(r.root, r.on);
    if (!at) return "This is no longer a git repository";
    if (at.state) return `${at.state} in progress: finish or abort it in a terminal first`;
  }
  // A stash applied over other changes leaves files in conflict with nothing "under way":
  // staging or committing everything would commit the conflict marks.
  if ((r.op === "commit" && r.all) || (r.op === "stage" && !r.paths?.length)) {
    const unmerged = await git(["ls-files", "--unmerged"]);
    if (unmerged.stdout.trim()) return "Some files are in conflict: resolve them, and stage each one, first";
  }
  const e = r.expect;
  if (!e) return null;
  if ("branch" in e) {
    // The whole name, cut here: `--short` says "heads/main" when a tag is called main too.
    const head = await git(["symbolic-ref", "-q", "HEAD"]);
    const branch = head.code === 0 ? head.stdout.trim().replace(/^refs\/heads\//, "") : null;
    if (branch !== (e.branch ?? null)) return `The branch changed (now ${branch ?? "no branch"}): nothing was done`;
  }
  for (const [name, sha] of e.refs ?? []) {
    const now = await git(["rev-parse", "-q", "--verify", name]);
    if (now.code !== 0 || now.stdout.trim() !== sha) return `${name} is not what it was a moment ago: nothing was done`;
  }
  return null;
}

// What git said went wrong, without the hints it adds for someone at a terminal.
function complaint(r, fallback) {
  const lines = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("hint:"));
  if (lines.some((l) => l.includes("would be overwritten"))) return "Uncommitted changes would be overwritten: commit or stash them first";
  const said = lines.find((l) => /^(fatal|error):/.test(l)) ?? lines.find((l) => l.includes("rejected")) ?? lines[0];
  return said ? said.replace(/^(fatal|error): /, "") : fallback;
}

// Runs a request. Resolves with { error }, or with {} or { note } (something to say).
export async function perform(r) {
  const at = { cwd: r.root, on: r.on };
  const git = (args) => exec("git", [...READ, ...args], at);
  // A path is that file and no other: without this git reads `*`, `[` and a first `:` in a
  // name as a pattern, and "x*" would be every file that starts with x.
  const write = (args) => exec("git", ["--literal-pathspecs", ...args], { ...at, timeout: LONG });
  // A prompt for a password would wait for ever: nobody is there to answer it.
  const net = (args) => exec("env", ["GIT_TERMINAL_PROMPT=0", "git", ...args], { ...at, timeout: LONG });
  const done = (result, fallback, note) => (result.code === 0 ? (note ? { note } : {}) : { error: complaint(result, fallback) });
  try {
    const why = await refused(r, git);
    if (why) return { error: why };
    switch (r.op) {
      case "fetch": return done(await net(["fetch", "--all", "--prune"]), "The fetch failed");
      case "pull": return done(await net(["pull", "--ff-only"]), "The pull failed");
      case "push": return done(await net(["push", ...(r.track ? ["--set-upstream"] : []), r.remote, `refs/heads/${r.branch}:refs/heads/${r.remoteBranch ?? r.branch}`]), "The push failed");
      case "forward": return done(await net(["fetch", r.remote, `refs/heads/${r.remoteBranch}:refs/heads/${r.branch}`]), "It could not be fast-forwarded");
      case "switch": return done(await write(["switch", "--", r.branch]), "The branch could not be switched to");
      case "track": return done(await write(["switch", "--track", "--", r.name]), "The branch could not be switched to");
      case "branch": return done(await write(r.go ? ["switch", "-c", r.name, r.at] : ["branch", "--", r.name, r.at]), "The branch could not be made");
      case "branch-delete": {
        const result = await write(["branch", "-d", "--", r.name]);
        if (result.code !== 0 && result.stderr.includes("not fully merged")) {
          return { error: `“${r.name}” has commits that are in no other branch. To delete it anyway: git branch -D ${r.name}` };
        }
        return done(result, "The branch could not be deleted");
      }
      case "tag": return done(await write(["tag", "--", r.name, r.at]), "The tag could not be made");
      case "tag-delete": return done(await write(["tag", "-d", "--", r.name]), "The tag could not be deleted");
      case "tag-push": return done(await net(["push", r.remote, `refs/tags/${r.name}:refs/tags/${r.name}`]), "The push failed");
      case "stash": return done(await write(["stash", "push", "--include-untracked", ...(r.message ? ["-m", r.message] : [])]), "Nothing could be stashed");
      case "stash-apply": return done(await write(["stash", "apply", r.ref]), "The stash could not be applied");
      case "stash-pop": return done(await write(["stash", "pop", r.ref]), "The stash could not be applied");
      case "stash-drop": return done(await write(["stash", "drop", r.ref]), "The stash could not be dropped");
      case "stage": return done(await write(r.paths?.length ? ["add", "-A", "--", ...r.paths] : ["add", "-A"]), "It could not be staged");
      // `reset` and not `restore --staged`: it also works before the first commit.
      case "unstage": return done(await write(r.paths?.length ? ["reset", "-q", "--", ...r.paths] : ["reset", "-q"]), "It could not be unstaged");
      case "discard": {
        // Nothing is thrown away: the file's changes become a stash, which can be applied
        // again. All of them, what is staged too: the file is as the last commit has it. Not
        // `--keep-index`, which would leave the staged part: that stash can't be applied
        // again over the staged part without a conflict.
        const result = await write(["stash", "push", "--include-untracked", "-m", `Discarded: ${r.path}`, "--", r.path]);
        return done(result, "It could not be discarded", "Kept as a stash");
      }
      case "commit": {
        if (r.all) {
          const staged = await write(["add", "-A"]);
          if (staged.code !== 0) return { error: complaint(staged, "The changes could not be staged") };
        }
        return done(await write(["commit", "-m", r.message]), "The commit failed");
      }
      default: return { error: `Unknown request “${r.op}”` };
    }
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
