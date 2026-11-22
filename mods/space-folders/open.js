// Opens a space's project in an editor on this Mac.
//
// The menu that offers it is a short-lived copy of this mod: it is gone before a program it
// started could answer. So it leaves a request in shared state, and the sidebar, which stays,
// takes it, runs it and reports what went wrong. A request: { app: "vscode" | "obsidian",
// folder, vault? } (vault: the id of the Obsidian vault the folder is in).

import { exec, shared, setShared, readTextFile, home, window } from "herdr";

const KEY = "space-folders.open";
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;

const APPS = { vscode: "VS Code", obsidian: "Obsidian" };
export const appName = (app) => APPS[app];

// These are this Mac's apps: a space on another machine has nowhere to open.
export const possible = (machine) => !machine && window()?.platform === "macos";

export function request(r) {
  setShared(KEY, { ...r, at: Date.now() });
}

export const waiting = () => Boolean(shared(KEY));

// The waiting request, taken: nobody else gets it.
export function take() {
  const r = shared(KEY);
  if (!r) return null;
  setShared(KEY, null);
  return Date.now() - (r.at ?? 0) < FRESH ? r : null;
}

// Obsidian's vaults: [{ id, path }]. It opens a folder only as one of these.
export async function vaults() {
  if (window()?.platform !== "macos") return [];
  try {
    const text = await readTextFile(`${home()}/Library/Application Support/obsidian/obsidian.json`);
    return Object.entries(JSON.parse(text ?? "{}").vaults ?? {})
      .filter(([, v]) => typeof v?.path === "string")
      .map(([id, v]) => ({ id, path: v.path.replace(/\/+$/, "") }));
  } catch { return []; }
}

// The id of the vault a folder is in (the innermost), or null.
export function vaultOf(list, folder) {
  return list.filter((v) => folder === v.path || folder.startsWith(`${v.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.id ?? null;
}

// Runs a request. Resolves with {} or { error }.
export async function perform(r) {
  try {
    let result;
    if (r.app === "vscode") {
      try { result = await exec("code", [r.folder]); }
      catch { result = await exec("open", ["-a", "Visual Studio Code", r.folder]); }
    } else result = await exec("open", [`obsidian://open?vault=${encodeURIComponent(r.vault)}`]);
    return result.code === 0 ? {} : { error: result.stderr.trim() || `${APPS[r.app]} didn't open it` };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
