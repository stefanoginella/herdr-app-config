// Shared with git-diff. Check the checkout and any refs a write was based on.
import { exec } from "herdr";

const PROBE = 'top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 3; dir=$(git rev-parse --absolute-git-dir) || exit 3; '
  + 'common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P) || exit 3; printf "%s\\n%s\\n%s\\n" "$top" "$dir" "$common"; '
  + 'for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do if [ -e "$dir/$f" ]; then echo "$f"; fi; done';
const UNDER_WAY = { "rebase-merge": "Rebase", "rebase-apply": "Rebase", MERGE_HEAD: "Merge", CHERRY_PICK_HEAD: "Cherry-pick", REVERT_HEAD: "Revert", BISECT_LOG: "Bisect" };

export async function probe(cwd, on) {
  const r = await exec("sh", ["-c", PROBE, "git-probe"], { cwd, on });
  if (r.code !== 0) return null;
  const [root, dir, common, ...rest] = r.stdout.split("\n");
  if (!root) return null;
  return { root, dir, common, state: UNDER_WAY[rest.find((line) => UNDER_WAY[line])] ?? null };
}

export async function guard(root, on, git, expect, checkOperation = true) {
  if (checkOperation) {
    const at = await probe(root, on);
    if (!at || at.root !== root) return "This is no longer the same Git checkout";
    if (at.state) return `${at.state} in progress: finish or abort it in a terminal first`;
  }
  if (!expect) return null;
  if ("branch" in expect) {
    // --short can say "heads/main" when a tag is called main too.
    const head = await git(["symbolic-ref", "-q", "HEAD"]);
    const branch = head.code === 0 ? head.stdout.trim().replace(/^refs\/heads\//, "") : null;
    if (branch !== (expect.branch ?? null)) return `The branch changed (now ${branch ?? "no branch"}): nothing was done`;
  }
  for (const [name, sha] of expect.refs ?? []) {
    const now = await git(["rev-parse", "-q", "--verify", name]);
    const found = now.code === 0 ? now.stdout.trim() : null;
    if (found !== sha) return `${name} is not what it was a moment ago: nothing was done`;
  }
  return null;
}
