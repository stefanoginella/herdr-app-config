// Find spaces whose live terminals are in a checkout of the chosen local branch.
// A space's original folder and a terminal's reported branch can both be stale.
import { exec, panes, spaces } from "herdr";

// One call on the repository's machine. Compare Git's common directories by identity:
// linked worktrees and symlinked paths match, independent clones and nested repos do not.
const FIND = `ref=$1
shift
common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
i=0
for dir do
  if [ "$(git -C "$dir" symbolic-ref -q HEAD 2>/dev/null)" = "$ref" ] &&
     [ "$(git -C "$dir" rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then
    other=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    [ "$other" -ef "$common" ] && printf '%s\\n' "$i"
  fi
  i=$((i+1))
done
exit 0`;

function candidates(on, spaceId) {
  const tabs = new Map();
  for (const space of spaces()) {
    if ((space.machine ?? null) !== (on ?? null) || (spaceId && space.id !== spaceId)) continue;
    for (const tab of space.tabs) tabs.set(tab.id, { space, tab });
  }
  const out = [];
  for (const p of panes()) {
    const place = tabs.get(p.tab);
    if (!place || !p.terminal || !p.cwd) continue;
    out.push({ ...place, p });
  }
  return out;
}

export async function find({ root, on, branch, space }) {
  const dirs = [...new Set(candidates(on, space).map(({ p }) => p.cwd))];
  if (!dirs.length) return [];
  const r = await exec("sh", ["-c", FIND, "checkouts", `refs/heads/${branch}`, ...dirs], { cwd: root, on });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not read the branch’s checkouts.");
  const matches = new Set(r.stdout.trim().split(/\s+/).filter(Boolean).map((i) => dirs[Number(i)]));
  const best = new Map();
  // Reread the layout after the Git call: a pane may have moved, closed or changed folder.
  for (const { p, space: s, tab } of candidates(on, space)) {
    if (!matches.has(p.cwd)) continue;
    // Keep the selected tab and its focused pane when possible. Among the other
    // matching panes, prefer an agent over a shell.
    const priority = (tab.active ? 4 : 0) + (p.focused ? 2 : 0) + (p.status ? 1 : 0);
    if (best.has(s.id) && best.get(s.id).priority >= priority) continue;
    best.set(s.id, { space: s.id, name: s.name, index: s.index, tab: tab.id, pane: p.pane, priority });
  }
  return [...best.values()].sort((a, b) => a.index - b.index);
}
