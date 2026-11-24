// A space's containers: the DDEV projects and Docker Compose stacks in its project (its repo's top
// folder, else where it is), in that folder or under it, and a DDEV project it is inside of.
//
// What is running comes from one `ddev list` and one `docker compose ls` per machine (`lists()`),
// asked by the sidebar every POLL while Herdr is in front. Stacks never started (a DDEV project not
// registered yet, a compose file never brought up) come from one `find` per project folder
// (`found()`). `stacksFor()` puts the two together for a folder. Nothing above `lists()`/`found()`
// touches the app, so the rest runs under `node`.
//
// The menu is a short-lived copy of this mod, gone before `ddev start` could answer. So it leaves a
// request in shared state (as open.js does), and the sidebar takes it and runs it (`perform()`).
// A request: { op: "start" | "stop" | "site", on, stacks: [stack] }.

import { exec, shared, setShared } from "herdr";

const KEY = "space-folders.stack";
const FRESH = 10000;
// How deep under the project folder a stack is looked for: its compose file or `.ddev` folder at
// most this many folders down (`a/b/.ddev/config.yaml` is 3).
const DEPTH = 3;
// More stacks than this under one folder: it holds projects, it isn't one. Nothing is shown.
const MANY = 4;
// Starting a DDEV project pulls images the first time: give it all the time exec allows.
const LONG = 600000;

const COMPOSE = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
// Folders `find` never enters: they are big, and hold other people's compose files.
const SKIP = ["node_modules", "vendor", ".git", "uploads", "wp-content", ".venv", "venv", "dist", "build", "target", ".devcontainer", ".next", ".cache"];

// The folder's stack files, one per line. The folder is the script's argument, never its text.
export const FIND = `cd "$1" || exit 0
find . -maxdepth ${DEPTH + 1} \\( ${SKIP.map((n) => `-name '${n}'`).join(" -o ")} \\) -prune -o \\( -path '*/.ddev/config.yaml' -o ${COMPOSE.map((n) => `-name '${n}'`).join(" -o ")} \\) -type f -print 2>/dev/null | head -n 40`;

const parent = (p) => p.replace(/\/[^/]*$/, "") || "/";
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
const levels = (p, dir) => p.slice(dir.length).split("/").filter(Boolean).length;

// A folder too wide to look in: the root, a home folder or one holding it, or one just under the root
// (a disk under /Volumes). A space at home has no project.
export function tooWide(folder, home) {
  const f = folder.replace(/\/+$/, "");
  const h = home.replace(/\/+$/, "");
  return !f || f.split("/").filter(Boolean).length < 3 || under(h, f);
}

// `find`'s answer as { ddev: [project folder], compose: [compose file's folder] }.
export function readFound(stdout, folder) {
  const ddev = [], compose = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("./")) continue;
    const path = `${folder}${line.slice(1)}`;
    if (path.endsWith("/.ddev/config.yaml")) ddev.push(parent(parent(path)));
    else if (!path.includes("/.ddev/") && levels(parent(path), folder) <= DEPTH) compose.push(parent(path));
  }
  return { ddev: [...new Set(ddev)], compose: [...new Set(compose)] };
}

// `ddev list --json-output`: JSON lines, the one with `raw` holds the projects.
export function readDdev(stdout) {
  for (const line of stdout.split("\n")) {
    try {
      const d = JSON.parse(line);
      if (Array.isArray(d?.raw)) return d.raw.filter((p) => typeof p?.approot === "string")
        .map((p) => ({ name: p.name, dir: p.approot.replace(/\/+$/, ""), status: p.status ?? "", url: p.primary_url || null }));
    } catch {}
  }
  return null;
}

// `docker compose ls --all --format json`, without DDEV's own stacks (they are its projects). A stack
// with a compose file in a `.devcontainer` folder is a dev container's (`dev`: the project folder that
// holds it), made by VS Code or the devcontainer CLI.
export function readCompose(stdout) {
  let list;
  try { list = JSON.parse(stdout || "[]"); } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list.filter((c) => typeof c?.Name === "string" && !c.Name.startsWith("ddev-") && !String(c.ConfigFiles ?? "").includes("/.ddev/"))
    .map((c) => {
      const files = String(c.ConfigFiles ?? "").split(",").filter(Boolean);
      const inDev = files.find((f) => f.includes("/.devcontainer/"));
      return { name: c.Name, files, status: String(c.Status ?? ""), dev: inDev ? inDev.slice(0, inDev.indexOf("/.devcontainer/")) || "/" : null };
    });
}

// "running" | "partial" (some of it, or unwell) | "stopped" | "busy" (on its way).
export function ddevState(status) {
  if (status === "running") return "running";
  if (status === "starting") return "busy";
  if (/unhealthy|problem/.test(status)) return "partial";
  return "stopped";
}

export function composeState(status) {
  const running = /running\((\d+)\)/.exec(status)?.[1];
  if (!running) return /restarting/.test(status) ? "partial" : "stopped";
  return status.split(",").every((s) => s.trim().startsWith("running")) ? "running" : "partial";
}

// A folder's stacks: [{ id, kind: "ddev" | "compose", name, dir, state, url?, project?, dev? }]. `lists`:
// one machine's { ddev, compose } (null where it couldn't be asked); `found`: readFound() for the folder.
// A dev container's stack (`dev: true`) is named after its project folder, and is never the stack of a
// compose file found on disk: its first file may be the project's own `../docker-compose.yml`.
export function stacksFor(folder, home, lists, found) {
  const f = folder.replace(/\/+$/, "");
  if (tooWide(f, home)) return [];
  const out = [];
  for (const p of lists?.ddev ?? []) {
    const inside = under(p.dir, f) && levels(p.dir, f) <= DEPTH;
    const around = under(f, p.dir) && !tooWide(p.dir, home);
    if (inside || around) out.push({ id: `ddev:${p.dir}`, kind: "ddev", name: p.name, dir: p.dir, state: ddevState(p.status), url: p.url });
  }
  for (const dir of found?.ddev ?? []) {
    if (!out.some((s) => s.kind === "ddev" && s.dir === dir)) out.push({ id: `ddev:${dir}`, kind: "ddev", name: base(dir), dir, state: "stopped", url: null });
  }
  for (const c of lists?.compose ?? []) {
    const dir = c.dev ?? (c.files[0] ? parent(c.files[0]) : null);
    if (dir && under(dir, f) && levels(dir, f) <= DEPTH) out.push({ id: `compose:${c.name}`, kind: "compose", name: c.dev ? base(c.dev) : c.name, dir, state: composeState(c.status), project: c.name, dev: Boolean(c.dev) });
  }
  for (const dir of found?.compose ?? []) {
    if (!out.some((s) => s.kind === "compose" && !s.dev && s.dir === dir)) out.push({ id: `compose:${dir}`, kind: "compose", name: base(dir), dir, state: "stopped", project: null });
  }
  return out.length > MANY ? [] : out;
}

// What the row's button shows for several stacks: busy if one is on its way, running if all are,
// partial if some are, else stopped.
export function overall(stacks, acting) {
  if (stacks.some((s) => acting[s.id] || s.state === "busy")) return "busy";
  if (stacks.every((s) => s.state === "running")) return "running";
  if (stacks.some((s) => s.state !== "stopped")) return "partial";
  return "stopped";
}

// What a stack is called in a tooltip, the menu and a toast: "Docker web", "Dev container app".
export const title = (s) => `${s.dev ? "Dev container" : s.kind === "ddev" ? "DDEV" : "Docker"} ${s.name}`;

// ---- what touches the app ----

// One machine's lists. A program that isn't there answers null for its part.
export async function lists(on) {
  const ask = async (cmd, args, read) => {
    try {
      const r = await exec(cmd, args, { on, timeout: 20000 });
      return r.code === 0 ? read(r.stdout) : null;
    } catch { return null; }
  };
  const [ddev, compose] = await Promise.all([
    ask("ddev", ["list", "--json-output"], readDdev),
    ask("docker", ["compose", "ls", "--all", "--format", "json"], readCompose),
  ]);
  return { ddev, compose };
}

export async function found(folder, on) {
  try {
    const r = await exec("sh", ["-c", FIND, "sh", folder], { on, timeout: 15000 });
    return r.code === 0 ? readFound(r.stdout, folder.replace(/\/+$/, "")) : null;
  } catch { return null; }
}

// Starts or stops one stack. Resolves with {} or { error }.
export async function act(op, stack, on) {
  const run = (cmd, args, cwd) => exec(cmd, args, { on, cwd, timeout: LONG });
  try {
    let r;
    if (stack.kind === "ddev") r = await run("ddev", [op], stack.dir);
    else if (op === "stop") r = await run("docker", ["compose", "-p", stack.project ?? base(stack.dir), "stop"], stack.dir);
    // A stack whose containers exist starts as it was made (a dev container's comes from files that may
    // be gone); one never brought up is made from its folder's compose file.
    else if (stack.project) r = await run("docker", ["compose", "-p", stack.project, "start"], stack.dir);
    else r = await run("docker", ["compose", "up", "-d"], stack.dir);
    if (r.code === 0) return {};
    const text = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-6).join("\n");
    return { error: text || `${op} failed (${r.code})` };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

export function request(r) {
  setShared(KEY, { ...r, at: Date.now() });
}

export const waiting = () => Boolean(shared(KEY));

export function take() {
  const r = shared(KEY);
  if (!r) return null;
  setShared(KEY, null);
  return Date.now() - (r.at ?? 0) < FRESH ? r : null;
}
