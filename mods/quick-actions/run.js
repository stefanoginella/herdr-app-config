import { hc, exec, notify, readTextFile, home } from "herdr";
import { context, checkTarget, expand, usedVars, filterMatches, filterNeedsRepo, filterParts, asksOf, psq, windowsTools } from "./vars.js";
import { writeRunFile, logRun, SHELL_LABEL } from "./store.js";
import { jobKey, jobOf, isRunning, addJob, startTerminal, timeoutMin } from "./jobs.js";

export function fail(name, body) {
  notify({ title: `Quick action: ${name || "(no name)"}`, body, level: "error", timeout: 8000 });
}

/** A path with `~` as the home folder of this computer. */
export function expandHome(path) {
  const p = String(path ?? "").trim().replace(/\\/g, "/");
  if (p === "~") return home().replace(/\\/g, "/");
  if (p.startsWith("~/")) return home().replace(/\\/g, "/") + p.slice(1);
  return p;
}

const extOf = (file) => /\.([a-z0-9]+)$/i.exec(String(file ?? ""))?.[1]?.toLowerCase() ?? "";

/** The shell that a script file asks for by its extension, or null. */
export function fileShell(file) {
  const ext = extOf(file);
  if (ext === "ps1") return "ps";
  if (ext === "sh" || ext === "bash") return "bash";
  if (ext === "zsh") return "zsh";
  if (ext === "py") return "python";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "node";
  return null;
}

/** The text of the script of an action: { text } or { error, info? }. A missing file is info, not a fault. */
export async function scriptText(a) {
  if (a.source !== "file") return { text: a.script };
  const path = expandHome(a.file);
  if (!path) return { error: "No script file yet. Write its path, or click Write with an agent…", info: true };
  const text = await readTextFile(path).catch(() => null);
  if (text == null) return { error: `The file ${a.file} does not exist yet. Click Write with an agent…, or write the path of a file that exists.`, info: true, missing: true };
  return { text };
}

/** The extension of the run file of a script. */
function runExt(a, shell) {
  if (shell === "ps") return "ps1";
  if (shell === "python") return "py";
  if (shell === "node") return a.source === "file" && ["mjs", "cjs"].includes(extOf(a.file)) ? extOf(a.file) : "js";
  return "sh";
}

/**
 * Everything that a run needs, without side effects:
 * Substitutes project values and any answers to {ask:…} before launching the command.
 */
export async function prepare(a, target, answers = null) {
  if (!target) return { error: "Open Quick Actions in a tab with a project terminal." };
  checkTarget(target);
  const src = await scriptText(a);
  if (src.error) return { error: src.error, info: src.info, missing: src.missing };
  if (!String(src.text ?? "").trim()) return { error: "The script is empty.", info: true };
  const need = usedVars(src.text);
  if (filterNeedsRepo(a.filter)) need.add("repo_name");
  const background = a.where === "background";
  const ctx = await context(target, need);
  if (!filterMatches(a.filter, ctx)) return { ctx, error: "This action is limited to " + filterParts(a.filter).join(", "), filtered: true };
  const term = ctx.shell;
  const shell = (a.shell && a.shell !== "auto" ? a.shell : null) ?? (a.source === "file" ? fileShell(a.file) : null) ?? term;
  const expanded = expand(src.text, ctx.values, shell, answers).trim();
  return { ctx, background, shell, expanded, asks: asksOf(src.text) };
}

/** Copies a local file to the machine of a terminal (`hc put`) and returns its path there. */
async function putFile(address, local) {
  const r = await hc(["put", "--json", address, local]);
  let path = null;
  try { path = JSON.parse(r.stdout)?.path ?? null; } catch { path = null; }
  if (r.code !== 0 || !path) throw new Error(`Cannot copy the script to the machine of ${address}: ${(r.stderr || r.stdout || "").trim()}`);
  return String(path).replace(/\\/g, "/");
}

/**
 * The program and arguments of a background run of a script file. `pwsh -File` ends with 0 after a program
 * that failed, so a short command gives the exit code of the last program. A script that stops with an error
 * (throw, or a cmdlet error with $ErrorActionPreference = 'Stop') ends with 1. A cmdlet error that does not
 * stop the script does not count (tested 2026-11-22).
 */
async function fileArgv(p, path) {
  const { ctx, shell } = p;
  const where = ctx.machine ?? "this computer";
  if (shell === "ps") {
    const file = ctx.windows ? path.replace(/\//g, "\\") : path;
    const cmd = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; & ${psq(file)}; exit $LASTEXITCODE`;
    return ["pwsh", "-NoProfile", ...(ctx.windows ? ["-ExecutionPolicy", "Bypass"] : []), "-Command", cmd];
  }
  if (shell === "node") return ["node", path];
  if (!ctx.windows) return [shell === "python" ? "python3" : shell, path];
  const tools = await windowsTools(ctx.machine);
  if (shell === "python") {
    if (!tools.python) throw new Error(`Python was not found on ${where}.`);
    return tools.python === "py" ? ["py", "-3", path] : [tools.python, path];
  }
  if (!tools.bash) throw new Error(`Git Bash was not found on ${where}. Install Git for Windows.`);
  return [tools.bash, path];
}

// Use the app command's argv entry point. No text or keys go to a terminal that is
// already running, even if somebody opens a tab or starts an agent at the same time.
export async function runAction(cx, a, target, answers = null) {
  try {
    const p = await prepare(a, target, answers);
    if (p.error) throw new Error(p.error);
    const { ctx } = p;
    if (p.background && isRunning(jobOf("run", a.id))) throw new Error("This action is already running.");
    let path = await writeRunFile(a.name, runExt(a, p.shell), p.expanded + "\n");
    if (ctx.machine) {
      checkTarget(target);
      path = await putFile(target.terminal, path);
    }
    const argv = await fileArgv(p, path);
    checkTarget(target);
    if (p.background) {
      const address = await startTerminal({ argv, cwd: target.folder, on: target.machine, labels: { "quick-actions": a.id } });
      addJob(jobKey("run", a.id), { kind: "run", action: a.id, name: a.name, address, machine: target.machine });
      notify({ title: a.name, body: "Running in the background.", level: "info", timeout: 4000 });
    } else {
      const cmd = { space: target.space, folder: target.folder, name: a.name, argv };
      const r = await exec("herdr-app", ["do", "tab.new", JSON.stringify(cmd)]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not open the action tab.");
      const reply = JSON.parse(r.stdout);
      if (!reply.tab) throw new Error(reply.error?.message || "The action tab did not open.");
    }
    logRun({ at: new Date().toISOString(), action: a.name, target, result: "ok" });
    return { background: p.background };
  } catch (e) {
    const reason = String(e?.message || e);
    await logRun({ at: new Date().toISOString(), action: a.name, target, result: "failed", reason });
    fail(a.name, reason);
    return null;
  }
}

/** A short text that says where and how the action runs (the preview). */
export function howText(p) {
  if (!p || p.error) return "";
  if (p.background) {
    const on = p.ctx.machine ? ` on ${p.ctx.machine}` : "";
    return `In the background${on}, in ${p.ctx.folder || "~"}: a ${SHELL_LABEL[p.shell] ?? p.shell} script. It stops after ${timeoutMin()} min.`;
  }
  return `New tab in ${p.ctx.folder} · ${SHELL_LABEL[p.shell] ?? p.shell}`;
}
