// Branch review uses only full ref names and immutable commit IDs. All git reads are
// supplied by the pane, which knows the repository and machine that opened it.
export const branchName = (ref) => ref.replace(/^refs\/(heads|remotes)\//, "");
export const storeKey = (req) => "git-diff.review." + JSON.stringify([req.on ?? null, req.root, req.source.branch, req.source.base]);
export const oid = (s) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s || "");
export const patchArgs = (from, tip, path) => ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "-U3", from, tip, "--", path];

export async function range(git, source, checkpoint, scope = "auto") {
  const resolve = async (ref) => {
    if (!/^refs\/(heads|remotes)\//.test(ref)) throw new Error("Choose a local or remote branch.");
    const result = await git(["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]);
    if (result.code || !oid(result.stdout.trim())) throw new Error("Branch is unavailable: " + branchName(ref));
    return result.stdout.trim();
  };
  const [tip, base] = await Promise.all([resolve(source.branch), resolve(source.base)]);
  const forkResult = await git(["merge-base", base, tip]);
  if (forkResult.code || !oid(forkResult.stdout.trim())) throw new Error("These branches have no readable common ancestor.");
  const fork = forkResult.stdout.trim();
  let notice = "", since = false;
  if (checkpoint) {
    if (checkpoint.fork !== fork) notice = "The common ancestor changed. Showing the whole branch.";
    else if (checkpoint.tip === tip) notice = "This revision was marked reviewed.";
    else if (oid(checkpoint.tip) && (await git(["merge-base", "--is-ancestor", checkpoint.tip, tip])).code === 0) since = true;
    else notice = "The reviewed commit is outside this history. Showing the whole branch.";
  }
  const incremental = since && scope !== "full";
  return { tip, fork, checkpoint, since, incremental, from: incremental ? checkpoint.tip : fork, notice };
}

// --raw --no-abbrev --no-renames -z: modes and both blob IDs change whenever that
// file's diff changes, including mode-only changes, binary files, and long lines.
export function rawFiles(text) {
  const fields = text.split("\0"), out = new Map();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i];
    if (!meta.startsWith(":")) continue;
    const [oldMode, newMode, oldId, newId, mark] = meta.slice(1).split(" ");
    const before = oldMode + ":" + oldId, after = newMode + ":" + newId;
    out.set(fields[i + 1], { before, after, signature: before + " " + after, mark });
  }
  return out;
}

// Seeing an incremental diff completes the full diff only when the file was unchanged
// at the checkpoint, or the reader had already marked its earlier full diff viewed.
export function markSince(viewed, file, fullKey) {
  const full = file.full;
  if (full && (full.before === file.before || viewed[fullKey] === full.before + " " + file.before))
    viewed[fullKey] = full.signature;
}

// Only changed lines can receive feedback. Keep their original text (tabs included)
// and the nearest unchanged or changed lines on the same side within this hunk.
export function anchors(patch) {
  const lines = new Map();
  for (const hunk of patch.hunks) {
    for (const side of ["old", "new"]) {
      const take = side === "new" ? "+" : "-";
      const list = hunk.lines.filter((l) => l.kind === take || l.kind === " ");
      const start = side === "new" ? hunk.next : hunk.old;
      for (let i = 0; i < list.length; i++) {
        if (list[i].kind !== take || list[i].original == null) continue;
        const at = { side, line: start + i, text: list[i].original,
          before: list[i - 1]?.original ?? null, after: list[i + 1]?.original ?? null };
        lines.set(side + at.line, at);
      }
    }
  }
  return lines;
}

export function relocate(anchor, candidates) {
  let match = null;
  for (const line of candidates.values()) {
    if (line.side !== anchor.side || line.text !== anchor.text) continue;
    if (anchor.before !== null && anchor.before !== line.before) continue;
    if (anchor.after !== null && anchor.after !== line.after) continue;
    if (match) return null;
    match = line;
  }
  return match;
}

export function feedback(source, tip, notes) {
  return [`Review of ${branchName(source.branch)} against ${branchName(source.base)} at ${tip}`, ...notes.map(({ note, line }) =>
    `${JSON.stringify(note.path)}:${line} (${note.anchor.side} side, originally ${note.revision.slice(0, 12)})\n> ${note.anchor.text}\n${note.body}`)].join("\n\n");
}
