// Where each commit of a history is drawn, and the lines between them.
//
// Nothing here touches the app, so it runs under `node`: test a change to it there.
//
// The commits come newest first, every commit before its parents (`git log --date-order`).
// `lanes` is the columns as they stand under the row being placed: each holds the commit it
// is waiting for, or nothing. A column that ends is left empty, never taken out, so the ones
// right of it never move and a line that passes a row is always straight. The leftmost empty
// column is used again, which keeps the graph narrow.
//
// The layout is the one described by pvigier ("Commit graph drawing algorithms") and DoltHub
// ("Drawing a commit graph"). Giving each row its own few lines, to be painted over that row
// alone, is how the Herdr mod rabeeh-ta/herdr-git-graph draws its graph. No code is theirs.

// A row's lines are [fromLane, fromY, toLane, toY, color, loose], with Y one of these. `loose`
// (1 or 0) is for the line under a commit given as `loose`, all the way to its first parent:
// what is not committed yet hangs from HEAD by it.
export const TOP = 0, MID = 1, BOTTOM = 2;

// commits: [{ sha, parents: [sha], loose? }]. Returns { rows, width }: one row for each commit,
// { lane, color, lines }, and the number of columns the widest row needs.
export function layout(commits) {
  const lanes = [];
  let colors = 0, width = 0;
  const free = () => {
    const at = lanes.indexOf(null);
    if (at >= 0) return at;
    lanes.push(null);
    return lanes.length - 1;
  };
  const waiting = (sha) => lanes.findIndex((l) => l && l.sha === sha);
  const rows = commits.map((commit) => {
    const lines = [];
    let lane = waiting(commit.sha), color;
    if (lane < 0) {
      // Nothing above leads here: the tip of a branch.
      lane = free();
      color = colors++;
    } else color = lanes[lane].color;
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (!l) continue;
      if (l.sha === commit.sha) {
        // A line from above that ends here.
        lines.push([i, TOP, lane, MID, l.color, l.loose]);
        lanes[i] = null;
      } else lines.push([i, TOP, i, BOTTOM, l.color, l.loose]);
    }
    lanes[lane] = null;
    commit.parents.forEach((parent, n) => {
      let to = waiting(parent);
      if (n === 0) {
        // The first parent goes on in this column, in this color, unless a column left of
        // this one is already waiting for it: then this branch joins that one. A column
        // right of this one that waits for it too joins here, at the parent.
        const loose = commit.loose ? 1 : 0;
        if (to < 0 || to > lane) { to = lane; lanes[lane] = { sha: parent, color, loose }; }
        lines.push([lane, MID, to, BOTTOM, color, loose]);
        return;
      }
      // Another parent (a merge) takes a column, and a color, of its own.
      if (to < 0) { to = free(); lanes[to] = { sha: parent, color: colors++, loose: 0 }; }
      lines.push([lane, MID, to, BOTTOM, lanes[to].color, 0]);
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    for (const l of lines) width = Math.max(width, l[0] + 1, l[2] + 1);
    width = Math.max(width, lane + 1);
    return { lane, color, lines };
  });
  return { rows, width };
}
