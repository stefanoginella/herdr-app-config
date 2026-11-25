// What git is asked, and what its answers mean.
//
// Nothing here touches the app, so it runs under `node`: test a change to it there, against
// what a real `git` prints.

// A read writes nothing under .git (no index refresh or lock, no fsmonitor cookie): the panel
// watches that folder, and every refresh would start the next one.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// Fields end with \x1f and records with \x1e: neither is in a name or a subject.
const FIELD = "\x1f", RECORD = "\x1e";

// The history of every branch, tag and remote branch, and of HEAD. Not `--all`: other tools
// keep refs of their own (refs/stash, a review tool's), and their commits would show as tips
// that belong to nothing. Before the first commit there is no HEAD to name.
export const logArgs = (limit, head = true) => ["log", "--branches", "--tags", "--remotes", ...(head ? ["HEAD"] : []), "--date-order", `-n${limit}`,
  "--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e"];

// [{ sha, parents, author, time (seconds), subject }], newest first.
export function parseLog(text) {
  const out = [];
  for (const record of text.split(RECORD)) {
    const f = record.replace(/^\n/, "").split(FIELD);
    if (f.length < 5 || !f[0]) continue;
    out.push({ sha: f[0], parents: f[1] ? f[1].split(" ") : [], author: f[2], time: Number(f[3]) || 0, subject: f[4] });
  }
  return out;
}

export const refArgs = ["for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track)%1f%(creatordate:unix)%1f%(upstream:remotename)%1f%(upstream:remoteref)%1f%(if)%(worktreepath)%(then)Y%(end)%1e",
  "refs/heads", "refs/remotes", "refs/tags"];

// { heads, remotes, tags }. A head: { name, sha, upstream, ahead, behind, gone, time, remote,
// remoteBranch, checkedOut }. A remote branch: { name ("origin/main"), remote, branch, sha, time }. A tag:
// { name, sha (the commit it leads to), time }.
// `remoteNames`: the remotes, to tell where a remote's name ends when it has a slash in it.
export function parseRefs(text, remoteNames = []) {
  const heads = [], remotes = [], tags = [];
  for (const record of text.split(RECORD)) {
    const f = record.replace(/^\n/, "").split(FIELD);
    if (f.length < 8) continue;
    const [ref, sha, peeled, upstream, track, time, remote, remoteRef] = f;
    if (ref.startsWith("refs/heads/")) {
      heads.push({
        name: ref.slice(11), sha, checkedOut: f[8] === "Y", upstream: upstream || null, time: Number(time) || 0,
        ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
        gone: track.includes("gone"), remote: remote || null,
        remoteBranch: remoteRef.startsWith("refs/heads/") ? remoteRef.slice(11) : null,
      });
    } else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice(13);
      const known = remoteNames.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
      const slash = known ? known.length : name.indexOf("/");
      // `origin/HEAD` only says which branch the remote shows first.
      if (slash < 0 || name.endsWith("/HEAD")) continue;
      remotes.push({ name, remote: name.slice(0, slash), branch: name.slice(slash + 1), sha, time: Number(time) || 0 });
    } else if (ref.startsWith("refs/tags/")) {
      tags.push({ name: ref.slice(10), sha: peeled || sha, time: Number(time) || 0 });
    }
  }
  return { heads, remotes, tags };
}

export const statusArgs = ["status", "--porcelain=v2", "--branch", "-z", "--no-renames", "--untracked-files=all"];

// { branch (null: detached), oid (null: no commit yet), upstream, ahead, behind, staged,
// unstaged }. A file: { path, mark }, where the mark is M, A or D, U for one git doesn't have
// yet, and ! for a conflict (those are in `unstaged` only).
export function parseStatus(text) {
  const out = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [] };
  for (const entry of text.split("\0")) {
    if (!entry) continue;
    if (entry.startsWith("# ")) {
      const [, key, ...rest] = entry.split(" "), value = rest.join(" ");
      if (key === "branch.oid") out.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") out.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") out.upstream = value;
      else if (key === "branch.ab") { out.ahead = Number(/\+(\d+)/.exec(value)?.[1] ?? 0); out.behind = Number(/-(\d+)/.exec(value)?.[1] ?? 0); }
      continue;
    }
    const kind = entry[0];
    if (kind === "?") out.unstaged.push({ path: entry.slice(2), mark: "U" });
    else if (kind === "u") out.unstaged.push({ path: entry.split(" ").slice(10).join(" "), mark: "!" });
    else if (kind === "1") {
      const xy = entry.slice(2, 4), path = entry.split(" ").slice(8).join(" ");
      if (xy[0] !== ".") out.staged.push({ path, mark: xy[0] === "T" ? "M" : xy[0] });
      if (xy[1] !== ".") out.unstaged.push({ path, mark: xy[1] === "T" ? "M" : xy[1] });
    }
  }
  return out;
}

export const stashArgs = ["stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%gs%x1e"];

// [{ index, ref ("stash@{0}"), sha, time, subject }], newest first.
export function parseStashes(text) {
  const out = [];
  for (const record of text.split(RECORD)) {
    const f = record.replace(/^\n/, "").split(FIELD);
    if (f.length < 4) continue;
    out.push({ index: Number(/\{(\d+)\}/.exec(f[0])?.[1] ?? out.length), ref: f[0], sha: f[1], time: Number(f[2]) || 0, subject: f[3] });
  }
  return out;
}

// `--numstat -z` (without renames): { path: { add, del, binary } }.
export function parseNumstat(text) {
  const out = {};
  for (const entry of text.split("\0")) {
    const [add, del, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    out[parts.join("\t")] = { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" };
  }
  return out;
}

// `--name-status -z` (without renames): [{ path, mark }], in git's order.
export function parseNameStatus(text) {
  const f = text.split("\0"), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) if (f[i]) out.push({ mark: f[i][0] === "T" ? "M" : f[i][0], path: f[i + 1] });
  return out;
}

// "3m", "5h", "2d", "6w", "4mo", "2y": how long ago, in as little room as it takes.
export function ago(seconds, now = Date.now() / 1000) {
  if (!seconds) return "";
  const s = Math.max(0, now - seconds);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 60) return `${Math.floor(s / (86400 * 7))}w`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

// An author's initials, for the circle in a commit's row: the first letter of the first and of
// the last word of the name ("Ada Lovelace": AL), or the first two of a name of one word. What
// is in brackets is left out ("dependabot[bot]": DE), and an address is cut at its @.
export function initials(name) {
  const words = String(name ?? "").replace(/[\[(<].*?[\])>]/g, " ").split("@")[0].split(/[\s._\-]+/).filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0]), last = words.length > 1 ? Array.from(words[words.length - 1]) : [];
  return (first[0] + (last[0] ?? first[1] ?? "")).toUpperCase();
}

// A day and a time, for a commit's own line: "22 Nov 2026, 14:05".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function when(seconds) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000), two = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// A short number that changes when the text does: to tell whether anything moved.
export function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

// Why a branch or tag name can't be used: null when it can, "" when there is nothing to say
// yet. git has the last word (`check-ref-format`): this only catches what is typed most.
export function nameError(name) {
  if (!name) return "";
  if (/\s/.test(name)) return "A name can't contain spaces";
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return "A name can't contain ~ ^ : ? * [ or \\";
  if (name.startsWith("-")) return "A name can't start with a dash";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return "A slash can't be first, last or doubled";
  if (name.includes("..") || name.endsWith(".") || name.endsWith(".lock") || name.includes("@{")) return "git doesn't allow that name";
  return null;
}
