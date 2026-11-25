// What GitHub knows about a repository: its open pull requests, its workflow runs and its
// releases, read with the `gh` program on the repository's own machine. The panel shows them
// as marks beside what git shows. Nothing here changes anything on GitHub.
//
// A repository that is not on GitHub, or a machine without `gh` or not logged in to it, has
// no marks, and nothing says so: the panel is about git first.

import { exec } from "herdr";

const TIMEOUT = 20000;
const MOST = 60;

// The worse of two states, for a commit or a pull request with several checks.
const ORDER = ["fail", "running", "pass"];
const worse = (a, b) => (!a ? b : !b ? a : ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

// One check as "fail", "running", "pass" or null (it doesn't count: skipped, neutral).
function state(status, conclusion) {
  const s = String(status ?? "").toLowerCase(), c = String(conclusion ?? "").toLowerCase();
  if (["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"].includes(c || s)) return "fail";
  if (["in_progress", "queued", "pending", "waiting", "requested", "expected"].includes(s) && !c) return "running";
  if (c === "success" || s === "success") return "pass";
  return null;
}

async function json(args, cwd, on) {
  const r = await exec("gh", args, { cwd, on, timeout: TIMEOUT });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "gh failed");
  return JSON.parse(r.stdout || "null");
}

// The repository as GitHub names it: { name: "owner/repo", url }, or null when it is not there
// (or `gh` is not, or is not logged in).
export async function repo(cwd, on) {
  try {
    const r = await json(["repo", "view", "--json", "nameWithOwner,url"], cwd, on);
    return r?.url ? { name: r.nameWithOwner, url: r.url } : null;
  } catch { return null; }
}

// gh accepts HOST/OWNER/REPO, also on Enterprise. Pin it to the selected run's
// address: a remote or the focused folder can change while the window stays open.
export function runRepo(run, repoUrl) {
  const parts = /^https:\/\/([\w.:-]+)\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:[/?#]|$)/.exec(run?.url || "");
  const host = /^https:\/\/([^/]+)/.exec(repoUrl || "")?.[1];
  if (!parts || host?.toLowerCase() !== parts[1].toLowerCase() || parts[4] !== String(run.id)) return null;
  return parts.slice(1, 4).join("/");
}

export async function failedJobs(run, cwd, on, repo) {
  const data = await json(["run", "view", String(run.id), "--repo", repo, "--json", "jobs"], cwd, on);
  return (data?.jobs ?? []).filter((job) => job.databaseId && state(job.status, job.conclusion) === "fail")
    .map((job) => ({ id: String(job.databaseId), name: job.name, conclusion: job.conclusion,
      steps: (job.steps ?? []).filter((s) => state(s.status, s.conclusion) === "fail").map((s) => s.name) }));
}

// Bound the stream BEFORE it goes over a remote connection or enters the JS engine.
// The last line carries gh's exit status: tail's alone would report success even for
// an expired log. Losing the leading marker means the byte limit was reached.
const LOG = `{
  printf 'BEGIN_LOG\\n'
  gh run view --job "$1" --repo "$2" --log-failed 2>&1
  printf '\\n%s\\n' "$?"
} | tail -c 32768`;

export async function failedLog(id, cwd, on, repo) {
  const result = await exec("sh", ["-c", LOG, "gh-log", String(id), repo], { cwd, on, timeout: 60000 });
  const body = result.stdout || "", end = /\n(\d+)\n?$/.exec(body);
  if (result.code !== 0 || !end) throw new Error(result.stderr?.trim() || "Could not read the job log.");
  const whole = body.startsWith("BEGIN_LOG\n");
  const raw = body.slice(whole ? 10 : 0, end.index).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trimEnd();
  if (end[1] !== "0") throw new Error(raw.slice(-700).trim() || "GitHub could not provide the job log.");
  const lines = raw.split(/\r?\n/);
  return (!whole || lines.length > 160 ? "… earlier output omitted …\n" : "") + lines.slice(-160).join("\n");
}

// A failing PR check can belong to an external provider. Keep its link in that case.
function failedCheck(check) {
  const url = check.detailsUrl || check.targetUrl || "";
  const run = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/(\d+)(?:\/job\/(\d+))?(?:[/?#]|$)/.exec(url);
  return { state: "fail", url, name: check.workflowName || check.name || check.context || "Check",
    id: run?.[1] ?? null, job: run?.[2] ?? null };
}

// { prs: [{ branch, oid, cross, number, title, url, draft, checks, failure }], runs: { sha: { state, url, name, id } },
// releases: { tag: { latest, pre, draft } }, running }. A part that could not be read is empty.
// `running`: a workflow is under way, so it is worth looking again soon.
export async function read(cwd, on) {
  const quiet = (p) => p.catch(() => []);
  const [prs, runs, releases] = await Promise.all([
    quiet(json(["pr", "list", "--state", "open", "--limit", String(MOST), "--json", "number,title,headRefName,headRefOid,isDraft,isCrossRepository,url,statusCheckRollup"], cwd, on)),
    quiet(json(["run", "list", "--limit", String(MOST), "--json", "databaseId,headSha,status,conclusion,workflowName,url"], cwd, on)),
    quiet(json(["release", "list", "--limit", String(MOST), "--json", "tagName,isLatest,isPrerelease,isDraft"], cwd, on)),
  ]);
  const out = { prs: [], runs: {}, releases: {}, running: false };
  for (const p of prs ?? []) {
    let checks = null, failure = null;
    for (const c of p.statusCheckRollup ?? []) {
      const result = state(c.status ?? c.state, c.conclusion);
      checks = worse(checks, result);
      if (result === "fail" && !failure?.id) {
        const check = failedCheck(c);
        if (check.id || !failure) failure = check;
      }
    }
    // `cross`: from a fork. Its branch has the name of one here only by chance, unless it is
    // of the same commit (main.js looks).
    out.prs.push({ branch: p.headRefName, oid: p.headRefOid, cross: Boolean(p.isCrossRepository), number: p.number, title: p.title, url: p.url, draft: Boolean(p.isDraft), checks, failure });
  }
  for (const r of runs ?? []) {
    const s = state(r.status, r.conclusion);
    if (!s) continue;
    if (s === "running") out.running = true;
    const was = out.runs[r.headSha];
    // The worst run of a commit is the one worth opening.
    if (!was || worse(was.state, s) !== was.state) out.runs[r.headSha] = { state: s, url: r.url, name: r.workflowName, id: r.databaseId };
  }
  for (const r of releases ?? []) out.releases[r.tagName] = { latest: Boolean(r.isLatest), pre: Boolean(r.isPrerelease), draft: Boolean(r.isDraft) };
  return out;
}
